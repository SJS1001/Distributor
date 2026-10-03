import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, digest } from "../src/server/core.ts";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import type { Region } from "../src/server/iam.ts";
import type { Effect } from "../src/server/integration.ts";
import type {
  IntegrationDispositionBinding,
  IntegrationDispositionReceipts,
} from "../src/server/integration-restore-dispositions.ts";

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
  // Test-only Platform-owned port: actual committed native command receipts, no
  // external imports, fake success rows, or production foreign-table reads.
  const receipts: IntegrationDispositionReceipts = {
    forResultInTransaction(orgId, command, resultId) {
      f.app.database.requireTransaction();
      return f.app.database
        .owned("platform")
        .all<{
          org_id: string;
          actor_id: string;
          name: typeof command;
          key: string;
          hash: string;
          result: string;
          created_at: string;
        }>(
          "SELECT * FROM platform_commands WHERE org_id=? AND name=? AND json_extract(result,'$.id')=?",
          orgId,
          command,
          resultId,
        )
        .map((r) => ({
          orgId: r.org_id,
          actorId: r.actor_id,
          command: r.name,
          key: r.key,
          requestHash: r.hash,
          result: JSON.parse(r.result),
          createdAt: r.created_at,
        }));
    },
  };
  const store = f.app.database.owned("integration");
  const effect = (id: string) =>
    store.get<Effect>("SELECT * FROM integration_effects WHERE id=?", id)!;
  const binding = (id: string): IntegrationDispositionBinding => {
    const e = effect(id);
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
  const project = (id: string, b = binding(id), source = receipts) =>
    f.app.database.transaction(() =>
      f.app.integration.restoreDispositionInTransaction(f.actor, b, source),
    );
  const rows = () =>
    Object.fromEntries(
      (
        [
          "iam",
          "billing",
          "integration",
          "platform",
          "inventory",
          "orders",
          "fulfillment",
          "report",
        ] as const
      ).flatMap((owner) => {
        const owned = f.app.database.owned(owner);
        return owned
          .all<{ name: string }>(
            "SELECT name FROM sqlite_schema WHERE type='table' AND substr(name,1,?)=? ORDER BY name",
            owner.length + 1,
            `${owner}_`,
          )
          .map(({ name }) => {
            assert.match(name, /^[a-z_]+$/);
            return [name, owned.all(`SELECT * FROM ${name} ORDER BY rowid`)];
          });
      }),
    );
  return {
    ...f,
    region,
    currency,
    invoiceId,
    creditId,
    parent,
    credit,
    application,
    cancellation,
    checkout,
    successor,
    finance,
    receipts,
    store,
    effect,
    binding,
    project,
    rows,
  };
}

for (const [region, currency, reports] of [
  ["CA", "CAD", false],
  ["US", "USD", true],
  ["CA", "USD", true],
] as const)
  test(`native restore dispositions: ${region}/${currency} reports=${reports} exact terminal receipts conserve all rows under recovery hold`, async (t) => {
    const f = await setup(t, region, currency, reports);
    const events = f.app.platform.events(f.actor),
      audits = f.app.platform.audits(f.actor);
    f.app.platform.isolateRestore(
      "synthetic-snapshot",
      new Date().toISOString(),
    );
    const hold = f.app.platform.recoveryHold(),
      before = f.rows();
    const canceled = f.project(f.application.id)!,
      replaced = f.project(f.checkout.id)!;
    assert.equal(canceled?.disposition, "canceled-unsent-credit-application");
    assert.equal(replaced?.disposition, "superseded-unsent-checkout");
    for (const d of [canceled, replaced]) {
      assert.equal(d.transportPermission, false);
      assert.equal(d.externalOutcomeVerified, false);
      assert.equal(d.invoiceId, f.invoiceId);
      assert.match(d.evidenceHash, /^[a-f0-9]{64}$/);
      assert.equal(d.binding.region, region);
      assert.equal(d.binding.currency, currency);
    }
    assert.equal(canceled.successorId, null);
    assert.equal(replaced.successorId, f.successor.id);
    // Pending successor is still unresolved. Projection of a predecessor never
    // settles another row or grants a fresh effect permission to send.
    assert.equal(f.effect(f.successor.id).state, "pending");
    assert.equal(f.project(f.successor.id), null);
    assert.deepEqual(f.project(f.application.id), canceled);
    assert.deepEqual(f.project(f.checkout.id), replaced);
    assert.deepEqual(f.rows(), before);
    assert.deepEqual(f.app.platform.recoveryHold(), hold);
    assert.deepEqual(f.app.platform.events(f.actor), events);
    assert.deepEqual(f.app.platform.audits(f.actor), audits);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("native restore dispositions require current staff authority and exact org/region/currency/account/provider/row binding", async (t) => {
  const f = await setup(t);
  assert.throws(
    () =>
      f.app.integration.restoreDispositionInTransaction(
        f.actor,
        f.binding(f.application.id),
        f.receipts,
      ),
    { code: "TRANSACTION" },
  );
  for (const id of [f.application.id, f.checkout.id]) {
    for (const patch of [
      { orgId: "foreign" },
      { accountId: "foreign" },
      { region: "US" },
      { currency: "USD" },
      { provider: "foreign" },
      { residencyVersion: 99 },
      { effectHash: "0".repeat(64) },
      { effectId: f.parent.id },
    ])
      assert.equal(
        f.project(id, {
          ...f.binding(id),
          ...patch,
        } as IntegrationDispositionBinding),
        null,
      );
  }
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.throws(() => f.project(f.application.id), { code: "FORBIDDEN" });
});

test("native cancellation refuses missing, forged, ambiguous or mismatched owner command receipts", async (t) => {
  const f = await setup(t);
  for (const modify of [
    () => [],
    (r: any[]) => [...r, ...r],
    (r: any[]) => r.map((v) => ({ ...v, orgId: "foreign" })),
    (r: any[]) => r.map((v) => ({ ...v, actorId: "forged-finance" })),
    (r: any[]) => r.map((v) => ({ ...v, requestHash: "1".repeat(64) })),
    (r: any[]) => r.map((v) => ({ ...v, result: { ...v.result, amount: 1 } })),
    (r: any[]) =>
      r.map((v) => ({ ...v, result: { ...v.result, id: f.checkout.id } })),
  ]) {
    const source: IntegrationDispositionReceipts = {
      forResultInTransaction(...args) {
        return modify([...f.receipts.forResultInTransaction(...args)]);
      },
    };
    assert.equal(
      f.project(f.application.id, f.binding(f.application.id), source),
      null,
    );
  }
});

// Each corruption rolls back, so the next adversarial case starts from exact
// successful native receipts, including the native capacity-release fact.
test("native cancellation qualifies original source, reservation, complete hashes and absence of provider artifacts", async (t) => {
  const f = await setup(t),
    baseline = f.rows(),
    good = f.project(f.application.id);
  const faults = [
    () =>
      f.store.run(
        "DELETE FROM integration_credit_cancellations WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_cancellations SET reason='forged' WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_cancellations SET org_id='foreign' WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_cancellations SET amount=1 WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_cancellations SET review_version=? WHERE effect_id=?",
        "f".repeat(64),
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_applications SET invoice_id='foreign' WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_applications SET credit_id='foreign' WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_credit_applications SET amount=1 WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET reference='other' WHERE id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET payload=json_set(payload,'$.amount',1) WHERE id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET payload=json_set(payload,'$.credit.customerRef','foreign') WHERE id=?",
        f.application.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET payload=json_set(payload,'$.taxCodeRef','foreign') WHERE id=?",
        f.parent.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET external_ref='credit:foreign' WHERE id=?",
        f.credit.id,
      ),
    ...["started_at", "external_ref", "result"].map(
      (column) => () =>
        f.store.run(
          `UPDATE integration_effects SET ${column}=? WHERE id=?`,
          column === "started_at" ? 1 : "{}",
          f.application.id,
        ),
    ),
    () =>
      f.store.run(
        "INSERT INTO integration_operation_leases VALUES(?,?,?,?)",
        f.application.id,
        f.actor.orgId,
        "synthetic-claim",
        1,
      ),
    () =>
      f.store.run(
        "INSERT INTO integration_balance_reads VALUES(?,?,?,?,?,NULL,NULL,?,NULL,NULL)",
        "synthetic-read",
        f.actor.orgId,
        f.application.id,
        "read",
        "h",
        new Date().toISOString(),
      ),
  ];
  for (const [i, fault] of faults.entries()) {
    const rollback = Error(`rollback ${i}`);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          fault();
          assert.equal(
            f.app.integration.restoreDispositionInTransaction(
              f.actor,
              f.binding(f.application.id),
              f.receipts,
            ),
            null,
            `fault ${i}`,
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.deepEqual(f.rows(), baseline);
    assert.deepEqual(f.project(f.application.id), good);
  }
});

test("native renewal validates complete chain and reviewed successor amount without settling pending/unknown leaves", async (t) => {
  const f = await setup(t),
    old = f.project(f.checkout.id)!;
  assert.equal(old.successorId, f.successor.id);
  const review = f.app.integration
    .list(f.finance)
    .find((e) => e.id === f.successor.id)!.checkout!;
  const next = f.app.integration.renewCheckout(
    f.finance,
    "native-second-renewal",
    {
      effectId: f.successor.id,
      reviewVersion: review.reviewVersion,
      amount: review.currentBalance,
      reason: "Synthetic next immutable link",
    },
  );
  assert.equal(f.project(f.checkout.id)?.successorId, f.successor.id);
  assert.equal(f.project(f.successor.id)?.successorId, next.id);
  assert.equal(f.project(next.id), null);
  // An actual interrupted native send leaves the successor unknown. The old
  // unsent predecessor remains terminal; the new effect is never projected.
  const uncertain = await f.app.integration.execute(f.finance, next.id, {
    execute: async () => {
      throw Error("Synthetic response uncertainty");
    },
    lookup: async () => null,
  });
  assert.equal(uncertain.state, "unknown");
  assert.equal(f.effect(next.id).state, "unknown");
  assert.equal(f.project(next.id), null);
  assert.equal(
    f.project(f.checkout.id)?.disposition,
    "superseded-unsent-checkout",
  );
  assert.notEqual(f.project(f.checkout.id)?.evidenceHash, old.evidenceHash);
});

test("native checkout refuses missing/wrong renewal, payload, claim, provider artifact, cross-org lineage and unrelated blocked effects", async (t) => {
  const f = await setup(t),
    baseline = f.rows();
  const faults = [
    () =>
      f.store.run(
        "DELETE FROM integration_checkout_renewals WHERE predecessor_id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_checkout_renewals SET org_id='foreign' WHERE predecessor_id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_checkout_renewals SET invoice_id='foreign' WHERE predecessor_id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_checkout_renewals SET reason='forged' WHERE predecessor_id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_checkout_renewals SET review_version=? WHERE predecessor_id=?",
        "e".repeat(64),
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_checkout_renewals SET predecessor_id=successor_id WHERE predecessor_id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET reference='wrong-reference' WHERE id=?",
        f.successor.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET org_id='foreign' WHERE id=?",
        f.successor.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET account_id='foreign' WHERE id=?",
        f.successor.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET provider='quickbooks' WHERE id=?",
        f.successor.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET payload=json_set(payload,'$.amount',1) WHERE id=?",
        f.successor.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET payload=json_set(payload,'$.number','forged') WHERE id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "UPDATE integration_effects SET result='{}' WHERE id=?",
        f.checkout.id,
      ),
    () =>
      f.store.run(
        "INSERT INTO integration_operation_leases VALUES(?,?,?,?)",
        f.checkout.id,
        f.actor.orgId,
        "claim",
        1,
      ),
    () =>
      f.store.run(
        "INSERT INTO integration_checkout_observations(id,org_id,account_id,invoice_id,effect_id,claim_token,actor_id,snapshot,hash) VALUES(?,?,?,?,?,?,?,?,?)",
        "synthetic-observation",
        f.actor.orgId,
        f.buyer,
        f.invoiceId,
        f.checkout.id,
        "token",
        f.actor.id,
        "{}",
        "bad",
      ),
  ];
  for (const [i, fault] of faults.entries()) {
    const rollback = Error(`rollback ${i}`);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          fault();
          assert.equal(
            f.app.integration.restoreDispositionInTransaction(
              f.actor,
              f.binding(f.checkout.id),
              f.receipts,
            ),
            null,
            `fault ${i}`,
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.deepEqual(f.rows(), baseline);
  }
  f.store.run(
    "UPDATE integration_effects SET state='blocked',error='unrelated blocked' WHERE id=?",
    f.parent.id,
  );
  assert.equal(f.project(f.parent.id), null);
});

test("native disposition reads see caller's uncommitted changes and preserve snapshot bytes/hold on rollback", async (t) => {
  const f = await setup(t),
    binding = f.binding(f.application.id),
    before = f.rows();
  const rollback = Error("synthetic rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert.ok(
          f.app.integration.restoreDispositionInTransaction(
            f.actor,
            binding,
            f.receipts,
          ),
        );
        f.store.run(
          "UPDATE integration_credit_cancellations SET reason='uncommitted change' WHERE effect_id=?",
          f.application.id,
        );
        assert.equal(
          f.app.integration.restoreDispositionInTransaction(
            f.actor,
            binding,
            f.receipts,
          ),
          null,
        );
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.deepEqual(f.rows(), before);
  assert.ok(f.project(f.application.id));
});

test("native historical projections survive later capacity reuse, permission withdrawal and more than an audit page", async (t) => {
  const f = await setup(t),
    before = f.project(f.application.id)!;
  const later = f.app.integration.accountingCreditApplication(
    f.actor,
    "reuse-capacity",
    { creditId: f.creditId, amount: 5000 },
  );
  chooseProviders(f, f.actor, "withdraw-current-permission", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal does not erase local history",
  });
  for (let i = 0; i < 205; i++)
    f.app.platform.audit(f.actor, "synthetic-later-audit", String(i), {});
  const after = f.project(f.application.id)!;
  assert.equal(after.disposition, before.disposition);
  assert.notEqual(after.evidenceHash, before.evidenceHash);
  assert.equal(after.transportPermission, false);
  assert.equal(f.project(later.id), null);
  assert.equal(
    f.project(f.checkout.id)?.disposition,
    "superseded-unsent-checkout",
  );
});

test("native checkout owner receipt absence, ambiguity, forged result and review hash never establish supersession", async (t) => {
  const f = await setup(t);
  for (const modify of [
    () => [],
    (r: any[]) => [...r, ...r],
    (r: any[]) => r.map((v) => ({ ...v, requestHash: "a".repeat(64) })),
    (r: any[]) =>
      r.map((v) => ({
        ...v,
        result: { ...v.result, predecessorId: f.credit.id },
      })),
    (r: any[]) =>
      r.map((v) => ({ ...v, result: { ...v.result, invoiceId: "foreign" } })),
    (r: any[]) => r.map((v) => ({ ...v, orgId: "foreign" })),
  ]) {
    const receipts: IntegrationDispositionReceipts = {
      forResultInTransaction(...args) {
        return modify([...f.receipts.forResultInTransaction(...args)]);
      },
    };
    assert.equal(
      f.project(f.checkout.id, f.binding(f.checkout.id), receipts),
      null,
    );
  }
});

test("native receipt source joins the writer snapshot and read fences cannot escape an owning SQL scope", async (t) => {
  const f = await setup(t),
    b = f.binding(f.application.id),
    platform = f.app.database.owned("platform");
  const rollback = Error("receipt rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert.ok(
          f.app.integration.restoreDispositionInTransaction(
            f.actor,
            b,
            f.receipts,
          ),
        );
        platform.run(
          "UPDATE platform_commands SET hash=? WHERE org_id=? AND name='quickbooks.credit.cancel'",
          "b".repeat(64),
          f.actor.orgId,
        );
        assert.equal(
          f.app.integration.restoreDispositionInTransaction(
            f.actor,
            b,
            f.receipts,
          ),
          null,
        );
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.ok(f.project(f.application.id));
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.database.execute("integration", () =>
          f.app.integration.restoreDispositionInTransaction(
            f.actor,
            b,
            f.receipts,
          ),
        ),
      ),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () => f.store.get("SELECT * FROM platform_commands LIMIT 1"),
    /prohibited|not authorized|access/i,
  );
});
