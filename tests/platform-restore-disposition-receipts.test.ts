import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, digest } from "../src/server/core.ts";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import type { Region } from "../src/server/iam.ts";
import type { Effect } from "../src/server/integration.ts";
import type { IntegrationDispositionBinding } from "../src/server/integration-restore-dispositions.ts";

const hash = (v: unknown) => digest(canonical(v));
async function setup(
  t: Parameters<typeof fixture>[0],
  region: Region = "CA",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "disposition-consent", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe", "quickbooks"],
    version: 1,
    acknowledgment: "Synthetic test consent",
  });
  const parent = f.app.integration.accounting(f.actor, "native-invoice", {
    invoiceId,
    customerRef: "customer-synthetic",
    itemRefs: { [f.product]: "item-synthetic" },
    taxCodeRef: "tax-synthetic",
    taxRateRef: "rate-synthetic",
  });
  // Real owning claims/completion with a deterministic in-memory adapter only.
  // These historical fixture results are not actual verified provider truth.
  const adapter = (reference: string) => ({
    execute: async () => ({ reference, result: {} }),
    lookup: async () => null,
  });
  await f.app.integration.execute(
    f.actor,
    parent.id,
    adapter("invoice-synthetic"),
  );
  const line = f.app.billing.lines(f.actor, invoiceId)[0]!;
  const creditId = f.app.billing.issueCredit(f.actor, "native-credit", {
    invoiceId,
    reference: "SYNTHETIC-CREDIT",
    reason: "Synthetic native credit",
    lines: [{ lineId: String(line.id), quantity: 1 }],
  }).id;
  const credit = f.app.integration.accountingCredit(
    f.actor,
    "native-credit-effect",
    { creditId },
  );
  await f.app.integration.execute(
    f.actor,
    credit.id,
    adapter("credit:synthetic"),
  );
  const application = f.app.integration.accountingCreditApplication(
    f.actor,
    "native-application",
    { creditId, amount: 5000 },
  );
  const financeUser = f.app.identity.createUser(f.actor, "finance-reader", {
    email: "disposition-finance@example.test",
    name: "Synthetic finance",
    role: "finance",
    sites: [f.w1],
    password: "synthetic-test-password",
  });
  const finance = f.app.identity.currentActor({
    ...f.actor,
    id: financeUser.id,
  });
  const review = f.app.integration
    .list(finance)
    .find((e) => e.id === application.id)!.accountingApplication!;
  const cancellation = f.app.integration.cancelCreditApplication(
    finance,
    "native-cancel",
    {
      effectId: application.id,
      reviewVersion: review.reviewVersion,
      amount: review.amount,
      reason: "Synthetic unsent release",
    },
  );
  const checkout = f.app.integration.checkout(f.actor, "native-checkout", {
    invoiceId,
  });
  f.app.billing.manualPayment(f.actor, "native-partial-payment", {
    invoiceId,
    amount: 100,
    reference: "SYNTHETIC-BANK",
    reason: "Synthetic partial payment",
  });
  const checkoutReview = f.app.integration
    .list(finance)
    .find((e) => e.id === checkout.id)!.checkout!;
  const successor = f.app.integration.renewCheckout(finance, "native-renew", {
    effectId: checkout.id,
    reviewVersion: checkoutReview.reviewVersion,
    amount: checkoutReview.currentBalance,
    reason: "Synthetic immutable replacement",
  });
  const receipts = f.app.platform.integrationDispositionReceipts(finance);
  const binding = (id: string): IntegrationDispositionBinding => {
    const e = f.app.database
      .owned("integration")
      .get<Effect>("SELECT * FROM integration_effects WHERE id=?", id)!;
    return {
      effectId: id,
      effectHash: hash(e),
      orgId: f.actor.orgId,
      accountId: f.buyer,
      region,
      currency,
      provider: e.provider as "stripe" | "quickbooks",
      residencyVersion: e.residency_version,
    };
  };
  const project = (id: string) =>
    f.app.database.transaction(() =>
      f.app.integration.restoreDispositionInTransaction(
        finance,
        binding(id),
        receipts,
      ),
    );
  return {
    ...f,
    finance,
    application,
    cancellation,
    checkout,
    successor,
    receipts,
    project,
    binding,
  };
}

function snapshot(f: ReturnType<typeof fixture>) {
  return Object.fromEntries(
    (
      [
        "platform",
        "integration",
        "iam",
        "billing",
        "inventory",
        "orders",
        "fulfillment",
        "report",
      ] as const
    ).flatMap((owner) => {
      const store = f.app.database.owned(owner);
      return store
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,?)=? ORDER BY name",
          owner.length + 1,
          `${owner}_`,
        )
        .map(({ name }) => {
          assert.match(name, /^[a-z_]+$/);
          return [name, store.all(`SELECT * FROM ${name} ORDER BY rowid`)];
        });
    }),
  );
}
const command = "quickbooks.credit.apply" as const;
function simple(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const input = { creditId: "synthetic-credit", amount: 100 };
  const result = {
    id: "synthetic-effect",
    state: "pending",
    details: { marker: "original" },
  };
  f.app.platform.command(
    f.actor,
    command,
    "original",
    input,
    () => {},
    () => result,
  );
  const receipts = f.app.platform.integrationDispositionReceipts(f.actor);
  const read = () =>
    receipts.forResultInTransaction(f.actor.orgId, command, result.id);
  return {
    ...f,
    input,
    result,
    receipts,
    read,
    store: f.app.database.owned("platform"),
  };
}

for (const [region, currency, reports] of [
  ["CA", "CAD", false],
  ["US", "USD", true],
  ["CA", "USD", true],
] as const)
  test(`${region}/${currency} Platform receipts qualify native cancellation and unsent supersession without changing history or hold`, async (t) => {
    const f = await setup(t, region, currency, reports);
    f.app.platform.isolateRestore("a".repeat(64), new Date().toISOString());
    const before = snapshot(f),
      hold = f.app.platform.recoveryHold();
    const canceled = f.project(f.application.id),
      replaced = f.project(f.checkout.id);
    assert.equal(canceled?.disposition, "canceled-unsent-credit-application");
    assert.equal(replaced?.disposition, "superseded-unsent-checkout");
    assert.equal(replaced?.successorId, f.successor.id);
    assert.equal(f.project(f.successor.id), null);
    for (const d of [canceled, replaced]) {
      assert.equal(d?.transportPermission, false);
      assert.equal(d?.externalOutcomeVerified, false);
      assert.equal(d?.binding.currency, currency);
    }
    f.app.database.transaction(() => {
      const applied = f.receipts.forResultInTransaction(
        f.actor.orgId,
        command,
        f.application.id,
      );
      const canceled = f.receipts.forResultInTransaction(
        f.actor.orgId,
        "quickbooks.credit.cancel",
        f.application.id,
      );
      assert.equal(applied[0]?.actorId, f.actor.id);
      assert.equal(canceled[0]?.actorId, f.finance.id);
      assert.equal(applied.length, 1);
      assert.equal(canceled.length, 1);
    });
    assert.deepEqual(snapshot(f), before);
    assert.deepEqual(f.app.platform.recoveryHold(), hold);
    const stop = Error("rollback read-only candidate transaction");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.receipts.forResultInTransaction(
            f.actor.orgId,
            command,
            f.application.id,
          );
          throw stop;
        }),
      (e) => e === stop,
    );
    assert.deepEqual(snapshot(f), before);
  });

test("port preserves every duplicate across actors and beyond public page limits", (t) => {
  const f = simple(t);
  const user = f.app.identity.createUser(f.actor, "historical-finance", {
    email: "historical@example.test",
    name: "Historical finance",
    role: "finance",
    sites: [f.w1],
    password: "synthetic-test-password",
  });
  const historical = f.app.identity.currentActor({ ...f.actor, id: user.id });
  for (let i = 0; i < 205; i++)
    f.app.platform.command(
      i % 2 ? historical : f.actor,
      command,
      `duplicate-${i}`,
      f.input,
      () => {},
      () => f.result,
    );
  const historicalUser = f.app.identity
    .users(f.actor)
    .find((v) => v.id === historical.id)!;
  f.app.identity.updateUser(f.actor, "retire-historical-author", {
    userId: historical.id,
    revision: historicalUser.revision,
    email: historicalUser.email,
    name: historicalUser.name,
    role: "support",
    sites: [f.w1],
    active: false,
    currentPassword: "long-test-only-password",
    reason: "Synthetic historical author retirement",
  });
  const before = snapshot(f);
  const rows = f.app.database.transaction(f.read);
  assert.equal(rows.length, 206);
  assert.deepEqual(
    new Set(rows.map((r) => r.actorId)),
    new Set([historical.id, f.actor.id]),
  );
  assert.equal(new Set(rows.map((r) => `${r.actorId}:${r.key}`)).size, 206);
  assert.deepEqual(snapshot(f), before);
});

test("native owner rejects an extra genuine committed cancellation receipt", async (t) => {
  const f = await setup(t);
  assert.ok(f.project(f.application.id));
  f.app.platform.command(
    f.finance,
    "quickbooks.credit.cancel",
    "duplicate-cancellation",
    { effectId: f.application.id, syntheticDuplicate: true },
    () => {},
    () => f.cancellation,
  );
  const before = snapshot(f);
  assert.equal(
    f.app.database.transaction(() =>
      f.receipts.forResultInTransaction(
        f.actor.orgId,
        "quickbooks.credit.cancel",
        f.application.id,
      ),
    ).length,
    2,
  );
  assert.equal(f.project(f.application.id), null);
  assert.deepEqual(snapshot(f), before);
});

test("same writer transaction sees uncommitted receipt changes and duplicates; rollback preserves rows", (t) => {
  const f = simple(t),
    before = snapshot(f),
    stop = Error("synthetic rollback");
  assert.throws(f.read, { code: "TRANSACTION" });
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.store.run(
          "UPDATE platform_commands SET result=? WHERE name=? AND key='original'",
          JSON.stringify({ ...f.result, id: "uncommitted-result" }),
          command,
        );
        assert.deepEqual(f.read(), []);
        assert.equal(
          f.receipts.forResultInTransaction(
            f.actor.orgId,
            command,
            "uncommitted-result",
          ).length,
          1,
        );
        f.store.run(
          "INSERT INTO platform_commands SELECT org_id,actor_id,name,'uncommitted-copy',hash,result,created_at FROM platform_commands WHERE name=? AND key='original'",
          command,
        );
        assert.equal(
          f.receipts.forResultInTransaction(
            f.actor.orgId,
            command,
            "uncommitted-result",
          ).length,
          2,
        );
        throw stop;
      }),
    (e) => e === stop,
  );
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.app.database.transaction(f.read).length, 1);
  f.app.database.transaction(() =>
    f.store.visit("SELECT key FROM platform_commands LIMIT 1", [], () => {
      assert.throws(f.read, { code: "TRANSACTION" });
    }),
  );
});

test("exact scope/allowlist, detached principal/results and legacy journal receipt", (t) => {
  const f = simple(t),
    actor = structuredClone(f.actor);
  const port = f.app.platform.integrationDispositionReceipts(actor);
  actor.orgId = "other-org";
  actor.id = "external-dossier-signer";
  f.app.platform.command(
    f.actor,
    "accounting.journal.prepare",
    "legacy",
    { sourceId: "synthetic-source" },
    () => {},
    () => ({ id: "legacy-journal" }),
  );
  const before = snapshot(f);
  f.app.database.transaction(() => {
    assert.throws(
      () => port.forResultInTransaction("other-org", command, f.result.id),
      { code: "FORBIDDEN" },
    );
    for (const name of [
      "accounting.journal.prepare",
      "quickbooks.credit.apply ",
      "quickbooks.credit.apply' OR 1=1 --",
    ])
      assert.throws(
        () =>
          port.forResultInTransaction(
            f.actor.orgId,
            name as typeof command,
            f.result.id,
          ),
        { code: "VALIDATION" },
      );
    for (const id of [
      "",
      ` ${f.result.id}`,
      `${f.result.id} `,
      "x".repeat(161),
    ])
      assert.throws(
        () => port.forResultInTransaction(f.actor.orgId, command, id),
        { code: "VALIDATION" },
      );
    assert.deepEqual(
      port.forResultInTransaction(f.actor.orgId, command, "absent"),
      [],
    );
    assert.deepEqual(
      port.forResultInTransaction(
        f.actor.orgId,
        "quickbooks.credit.cancel",
        f.result.id,
      ),
      [],
    );
    const rows = port.forResultInTransaction(
      f.actor.orgId,
      command,
      f.result.id,
    );
    (rows[0]!.result as typeof f.result).details.marker =
      "mutated returned data";
    rows[0]!.actorId = "different historical actor";
    assert.deepEqual(f.read()[0]!.result, f.result);
    assert.equal(f.read()[0]!.actorId, f.actor.id);
    assert.deepEqual(
      f.app.platform.journalPreparationReceiptInTransaction(f.actor, "legacy"),
      {
        requestHash: hash({ sourceId: "synthetic-source" }),
        result: { id: "legacy-journal" },
      },
    );
    // Malformed other-command/other-organization history cannot supply evidence.
    f.store.run(
      "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
      "other-org",
      "other-actor",
      command,
      "key",
      "invalid",
      "invalid",
      "invalid",
    );
    assert.equal(f.read().length, 1);
    f.store.run("DELETE FROM platform_commands WHERE org_id='other-org'");
  });
  assert.deepEqual(snapshot(f), before);
});

for (const [field, value] of [
  ["result", "not-json"],
  ["result", "null"],
  ["result", "[]"],
  ["result", '{"id":"synthetic-effect","id":"elsewhere"}'],
  ["result", '{"id":" synthetic-effect"}'],
  ["result", '{"id":4}'],
  ["result", '{"id":"elsewhere", "state":"pending"}'],
  ["hash", "A".repeat(64)],
  ["hash", "short"],
  ["created_at", "not-a-date"],
  ["created_at", "2026-10-03"],
  ["created_at", "2026-02-30T00:00:00.000Z"],
  ["actor_id", " actor-alias "],
  ["key", " key-alias "],
] as const)
  test(`malformed ${field} ${value.slice(0, 35)} refuses the whole scoped receipt proof`, (t) => {
    const f = simple(t),
      before = snapshot(f),
      stop = Error("rollback corruption");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.store.run(
            `UPDATE platform_commands SET ${field}=? WHERE name=?`,
            value,
            command,
          );
          assert.throws(f.read, { code: "RESTORE_RECEIPT_INTEGRITY" });
          assert.throws(
            () =>
              f.receipts.forResultInTransaction(
                f.actor.orgId,
                command,
                "absent",
              ),
            { code: "RESTORE_RECEIPT_INTEGRITY" },
          );
          throw stop;
        }),
      (e) => e === stop,
    );
    assert.deepEqual(snapshot(f), before);
  });

test("current IAM authority is re-read while historical actors stay historical", (t) => {
  const f = simple(t);
  const u = f.app.identity.createUser(f.actor, "reader", {
    email: "receipt-reader@example.test",
    name: "Receipt reader",
    role: "finance",
    sites: [f.w1],
    password: "synthetic-test-password",
  });
  const actor = f.app.identity.currentActor({ ...f.actor, id: u.id });
  const port = f.app.platform.integrationDispositionReceipts(actor);
  const read = () =>
    port.forResultInTransaction(f.actor.orgId, command, f.result.id);
  assert.equal(f.app.database.transaction(read)[0]?.actorId, f.actor.id);
  const user = f.app.identity.users(f.actor).find((v) => v.id === u.id)!;
  f.app.identity.updateUser(f.actor, "revoke-finance", {
    userId: u.id,
    revision: Number(user.revision),
    email: String(user.email),
    name: String(user.name),
    role: "support",
    sites: [f.w1],
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic authority removal",
  });
  const before = snapshot(f);
  assert.throws(() => f.app.database.transaction(read), { code: "FORBIDDEN" });
  assert.deepEqual(snapshot(f), before);
  const external = f.app.platform.integrationDispositionReceipts({
    ...f.actor,
    id: "external-dossier-signer",
  });
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        external.forResultInTransaction(f.actor.orgId, command, f.result.id),
      ),
    { code: "FORBIDDEN" },
  );
});

test("well-formed false hash, result and time remain data, never native proof", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("platform"),
    before = snapshot(f),
    stop = Error("rollback false provenance");
  for (const [field, value] of [
    ["hash", "0".repeat(64)],
    [
      "result",
      JSON.stringify({ ...f.cancellation, amount: f.cancellation.amount + 1 }),
    ],
    ["created_at", "1970-01-01T00:00:00.000Z"],
  ] as const) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          store.run(
            `UPDATE platform_commands SET ${field}=? WHERE name='quickbooks.credit.cancel'`,
            value,
          );
          assert.equal(
            f.receipts.forResultInTransaction(
              f.actor.orgId,
              "quickbooks.credit.cancel",
              f.application.id,
            ).length,
            1,
          );
          assert.equal(
            f.app.integration.restoreDispositionInTransaction(
              f.finance,
              f.binding(f.application.id),
              f.receipts,
            ),
            null,
          );
          throw stop;
        }),
      (e) => e === stop,
    );
    assert.deepEqual(snapshot(f), before);
  }
});

test("password-restricted, buyer and unconfigured current access cannot read historical receipts", (t) => {
  const f = simple(t);
  const u = f.app.identity.createUser(f.actor, "restricted-reader", {
    email: "restricted-reader@example.test",
    name: "Restricted reader",
    role: "finance",
    sites: [f.w1],
    password: "synthetic-test-password",
    requirePasswordChange: true,
  });
  const restricted = f.app.platform.integrationDispositionReceipts({
    ...f.actor,
    id: u.id,
  });
  const buyerUser = f.app.identity.createUser(f.actor, "buyer-reader", {
    email: "buyer-reader@example.test",
    name: "Buyer reader",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
    password: "synthetic-test-password",
  });
  const buyer = f.app.platform.integrationDispositionReceipts(
    f.app.identity.currentActor({ ...f.actor, id: buyerUser.id }),
  );
  const before = snapshot(f);
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        restricted.forResultInTransaction(f.actor.orgId, command, f.result.id),
      ),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        buyer.forResultInTransaction(f.actor.orgId, command, f.result.id),
      ),
    { code: "FORBIDDEN" },
  );
  f.app.platform.configureReadAuthority(undefined as never);
  assert.throws(() => f.app.database.transaction(f.read), {
    code: "AUTHORITY",
  });
  assert.deepEqual(snapshot(f), before);
});
