import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";
import { carrierConfiguration } from "../src/server/carrier-configuration.ts";
import { canonical, digest } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";
import type { Effect } from "../src/server/integration.ts";
import {
  captureRestoreCandidate,
  restoreApprovalMessage,
  type RestoreDossier,
} from "../src/server/restore-review.ts";
import {
  restoreNativeMaintenanceMessage,
  type RestoreNativeDispositionConfiguration,
  type RestoreNativeMaintenanceAssociation,
  type RestoreNativeMaintenanceRequest,
  restoreReleaseApprovalMessage,
  type RestoreActivationAdapter,
  type RestoreControl,
  type RestoreReleaseInput,
} from "../src/server/restore-activation.ts";
import type { RestoreEvidenceManifest } from "../src/server/restore-evidence.ts";
import { providerNames } from "../src/shared/provider-choices.ts";
const hash = (v: unknown) => digest(canonical(v));
async function creditSetup(
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
  const store = f.app.database.owned("integration");
  const effect = (id: string) =>
    store.get<Effect>("SELECT * FROM integration_effects WHERE id=?", id)!;
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
    store,
    effect,
  };
}

function carrierSetup(
  t: Parameters<typeof fixture>[0],
  reports = false,
  cancelBookings = true,
  keysAreIds = false,
  mismatchedGroupConfiguration = false,
) {
  const f = fixture(t, { eventReports: reports });
  chooseProviders(f, f.actor, "cp-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic choice",
  });
  const configuration = carrierConfiguration(
    "canada-post",
    { customer: "synthetic-account" },
    "Synthetic account",
    ["CA domestic"],
    [{ service: "DOM.EP", description: "Synthetic service" }],
  );
  const entries = [0, 1].map((i) => {
    const orderId = accept(f, 1, `restore-order-${i}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const pick of picks)
      f.app.fulfillment.pick(f.actor, `restore-pick-${i}`, {
        orderId,
        allocationId: pick.id,
        serial: pick.serial,
      });
    const address = "Synthetic CA destination";
    const shipmentId = f.app.fulfillment.pack(f.actor, `restore-pack-${i}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
    }).id;
    const booking = f.app.carriers.prepare(
      f.actor,
      `restore-booking-${i}`,
      {
        shipmentId,
        previousId: null,
        provider: "canada-post",
        service: "DOM.EP",
        origin,
        destination: { ...origin, name: "Synthetic receiver" },
        parcel: {
          weightGrams: 1000,
          lengthMm: 100,
          widthMm: 100,
          heightMm: 100,
        },
        reviewedDestination: address,
        acknowledgment: "Synthetic reviewed parcel",
        configurationHash: configuration.hash,
      },
      configuration,
    );
    return { bookingId: booking.id, reviewHash: booking.reviewHash };
  });
  const group = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "restore-group",
    {
      configurationHash: mismatchedGroupConfiguration
        ? "b".repeat(64)
        : configuration.hash,
      entries,
    },
  );
  const cancel = {
    groupId: group.id,
    reviewHash: group.reviewHash,
    reason: "Synthetic wholly unsent group",
  };
  f.app.carriers.cancelCanadaPostGroup(
    f.actor,
    keysAreIds ? group.id : "restore-cancel",
    cancel,
  );
  for (const entry of cancelBookings ? entries : [])
    f.app.carriers.cancel(
      f.actor,
      keysAreIds ? entry.bookingId : `cancel-${entry.bookingId}`,
      {
        ...entry,
        reason: "Synthetic booking canceled separately",
      },
    );
  return { ...f, group, entries, configuration, cancel };
}
function restoreSetup(f: ReturnType<typeof fixture>) {
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  chmodSync(f.path, 0o600);
  let at = Date.now();
  const root = join(dirname(f.path), "evidence");
  mkdirSync(root, { mode: 0o700 });
  writeFileSync(
    join(root, "report"),
    "synthetic independently reconciled interval",
    { mode: 0o600 },
  );
  const evidence = {
    reference: "synthetic:report",
    sha256: digest("synthetic independently reconciled interval"),
  };
  const candidate = captureRestoreCandidate(f.path);
  const dossier: RestoreDossier = {
    version: 1,
    preparedBy: "preparer",
    preparedAt: new Date(at - 1000).toISOString(),
    expiresAt: new Date(at + 60000).toISOString(),
    candidate,
    source: {
      identity: "synthetic-source",
      logicalHash: digest("source"),
      durableCursor: "cutoff-43",
      auditSequence: 43,
      cutoff: evidence,
    },
    organizations: candidate.organizations.map((o) => ({
      orgId: o.id,
      inventory: evidence,
      billing: evidence,
      access: evidence,
      residency: evidence,
      providers: providerNames.map((provider) => ({
        provider,
        outcome: "not-used",
        evidence,
      })),
    })),
    operations: {
      fencing: evidence,
      routing: evidence,
      rollback: evidence,
      sourceWriters: [
        "source-app",
        "source-worker",
        "source-cli",
        "source-callback",
      ],
      candidateWriters: ["candidate-app", "candidate-worker"],
      rollbackMode: "source-before-effects-forward-recovery-after-effects",
      rpoMinutes: 15,
      rtoMinutes: 240,
    },
  };
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  let trust = pairs.map((p, i) => ({
    id: i ? "security" : "finance",
    role: i ? ("security" as const) : ("finance" as const),
    publicKey: p.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }));
  const approve = () =>
    trust.map((a, i) => ({
      signerId: a.id,
      role: a.role,
      dossierHash: digest(canonical(dossier)),
      signature: sign(
        null,
        Buffer.from(
          restoreApprovalMessage(digest(canonical(dossier)), a.id, a.role),
        ),
        pairs[i]!.privateKey,
      ).toString("base64"),
    }));
  const manifest: RestoreEvidenceManifest = {
    version: 1,
    root,
    files: [{ reference: evidence.reference, path: "report" }],
  };
  const input: RestoreReleaseInput = {
    id: "synthetic-release",
    dossier,
    approvals: approve(),
    manifest,
  };
  let route: "isolated" | "candidate" | "source" | "unknown" = "isolated",
    sourceFenced = false,
    candidateFenced = true,
    effects: "none" | "observed" | "unknown" = "none",
    settled = true;
  const calls: string[] = [];
  const adapter: RestoreActivationAdapter = {
    enabled: true,
    identity: "synthetic-only-v1",
    fence() {
      calls.push("fence");
      sourceFenced = true;
      candidateFenced = true;
    },
    routeCandidate() {
      calls.push("candidate");
      route = "candidate";
      candidateFenced = false;
    },
    stopCandidate() {
      calls.push("stop");
      candidateFenced = true;
      route = "isolated";
    },
    routeSource() {
      calls.push("source");
      route = "source";
      sourceFenced = false;
    },
    observe(c: RestoreControl) {
      return {
        releaseId: c.releaseId,
        binding: c.binding,
        token: "synthetic-fence-1",
        observedAt: at,
        validUntil: at + 1000,
        settled,
        sourceFenced,
        candidateFenced,
        route,
        sourceHash: dossier.source.logicalHash,
        sourceCursor: dossier.source.durableCursor,
        evidenceSetHash: c.evidenceSetHash,
        reconciliation: "complete",
        externalEffects: effects,
      };
    },
  };
  const configure = (app = f.app) =>
    app.platform.restore.configure(
      adapter,
      () => trust,
      () => at,
    );
  configure();
  const releaseApprovals = (binding: string) =>
    trust.map((a, i) => ({
      signerId: a.id,
      role: a.role,
      dossierHash: binding,
      signature: sign(
        null,
        Buffer.from(restoreReleaseApprovalMessage(binding, a.id, a.role)),
        pairs[i]!.privateKey,
      ).toString("base64"),
    }));
  const prepare = (value = input) => {
    const r = f.app.platform.restore.prepare(value);
    return f.app.platform.restore.approveRelease(
      r.id,
      releaseApprovals(r.binding),
    );
  };
  return {
    prepare,
    releaseApprovals,
    trust: () => trust,
    f,
    input,
    adapter,
    calls,
    configure,
    approve,
    clock: (value: number) => {
      at = value;
    },
    now: () => at,
    revoke: () => {
      trust = [];
    },
    effect: (value: typeof effects) => {
      effects = value;
    },
    unsettled: () => {
      settled = false;
    },
    mutate: () => {
      const db = new DatabaseSync(f.path);
      try {
        db.exec(
          "UPDATE iam_organizations SET name='synthetic post-cutoff edit'",
        );
      } finally {
        db.close();
      }
    },
  };
}

type F = ReturnType<typeof fixture>;
function boundary(f: F) {
  // Focused native boundary checks do not replace full prepare/release tests.
  (
    f.app.platform.restore as unknown as { settledNativeQueues(): void }
  ).settledNativeQueues();
}
function queues(f: F) {
  return f.app.database.transaction(() => boundary(f));
}
function isolate(f: F) {
  f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
}
function maintenance(f: F, clock = Date.now) {
  const principal = (role: "finance" | "warehouse") => {
    const { id } = f.app.identity.createUser(f.actor, `maintenance-${role}`, {
      email: `maintenance-${role}@synthetic.test`,
      name: `Native ${role}`,
      role,
      sites: [f.w1],
      password: "long-synthetic-password",
    });
    return f.app.identity.currentActor({ ...f.actor, id });
  };
  const finance = principal("finance"),
    warehouse = principal("warehouse");
  const pair = generateKeyPairSync("ed25519");
  const externalAuthorityId = "external-maintenance-not-a-native-user";
  let trust = [
    {
      id: externalAuthorityId,
      publicKey: pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
  ];
  const seen: RestoreNativeMaintenanceRequest[] = [];
  const configuration: RestoreNativeDispositionConfiguration = {
    mappings: (
      [
        "canceled-unsent-credit-application",
        "superseded-unsent-checkout",
        "canceled-unused-membership",
      ] as const
    ).map((projection) => ({
      orgId: f.actor.orgId,
      projection,
      externalAuthorityId,
      principal:
        projection === "canceled-unused-membership" ? warehouse : finance,
    })),
    loadTrust: () => trust,
    observe(request) {
      f.app.database.requireTransaction();
      seen.push(structuredClone(request));
      const body = {
        request,
        associationId: "synthetic-separately-qualified-association",
        evidenceHash: hash("synthetic-external-authorization-evidence"),
        observedAt: clock(),
        validUntil: clock() + 10000,
      };
      return {
        ...body,
        signature: sign(
          null,
          Buffer.from(restoreNativeMaintenanceMessage(body)),
          pair.privateKey,
        ).toString("base64"),
      };
    },
  };
  const configure = () =>
    f.app.configureRestoreNativeDispositions(configuration);
  configure();
  return {
    configuration,
    configure,
    seen,
    finance,
    warehouse,
    revoke: () => {
      trust = [];
    },
    pair,
  };
}
function ownerRows(f: F) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='platform_restore_releases' ORDER BY name",
        )
        .all()
        .map((r) => [
          r.name,
          db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`).all(),
        ]),
    );
  } finally {
    db.close();
  }
}
async function settleSuccessor(f: Awaited<ReturnType<typeof creditSetup>>) {
  const p = JSON.parse(f.effect(f.successor.id).payload);
  const r = await f.app.integration.execute(f.finance, f.successor.id, {
    execute: async () => ({
      reference: "cs_test_synthetic_terminal",
      result: {
        amount: p.amount,
        currency: p.currency,
        status: "expired",
        paymentStatus: "unpaid",
        expiresAt: 1900000000,
        checkoutUrl: "https://checkout.stripe.com/synthetic",
      },
    }),
    lookup: async () => {
      throw Error("Unexpected synthetic lookup");
    },
  });
  assert.equal(r.state, "completed");
}

for (const [region, currency, reports] of [
  ["CA", "CAD", false],
  ["US", "USD", true],
  ["CA", "USD", true],
] as const) {
  test(`native queue ${region}/${currency}/${reports}: real cancellation and settled renewal preserve all owner rows`, async (t) => {
    const f = await creditSetup(t, region, currency, reports);
    await settleSuccessor(f);
    const m = maintenance(f);
    isolate(f);
    const before = ownerRows(f);
    queues(f);
    queues(f);
    assert.equal(ownerRows(f), before);
    assert.equal(f.effect(f.application.id).state, "blocked");
    assert.equal(f.effect(f.checkout.id).state, "blocked");
    assert.equal(f.effect(f.successor.id).state, "completed");
    assert.equal(m.seen.length, 4);
    assert.equal(new Set(m.seen.map((r) => r.challenge)).size, 4);
    assert(
      m.seen.every(
        (r) =>
          r.nativePrincipalId === m.finance.id && r.orgId === f.actor.orgId,
      ),
    );
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });
}
for (const reports of [false, true])
  test(`native queue canceled Canada Post membership reporting=${reports}`, (t) => {
    const f = carrierSetup(t, reports);
    const m = maintenance(f);
    isolate(f);
    const before = ownerRows(f);
    queues(f);
    assert.equal(ownerRows(f), before);
    assert.equal(m.seen.length, 2);
    assert(m.seen.every((r) => r.nativePrincipalId === m.warehouse.id));
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("native queue defaults closed without native/external association; dossier-style IDs cannot supply one", (t) => {
  const f = carrierSetup(t);
  isolate(f);
  assert.throws(() => queues(f), { code: "RESTORE_MAINTENANCE_AUTHORITY" });
});
test("native queue always requires the existing writer transaction", (t) => {
  const f = carrierSetup(t);
  maintenance(f);
  isolate(f);
  assert.throws(() => boundary(f), { code: "TRANSACTION" });
});
test("native queue fresh association rejects revocation, cached grants, changed binding and ambiguous mappings", (t) => {
  const f = carrierSetup(t),
    m = maintenance(f);
  isolate(f);
  const observe = m.configuration.observe;
  const cases: [string, typeof observe][] = [
    ["unavailable", () => null],
    [
      "forged signature",
      (r) => ({ ...observe(r)!, signature: "A".repeat(86) + "==" }),
    ],
    ["wrong target", (r) => observe({ ...r, recordId: "foreign" })],
    [
      "wrong generation",
      (r) =>
        observe({
          ...r,
          generation: { ...r.generation, snapshotHash: "b".repeat(64) },
        }),
    ],
    [
      "wrong principal",
      (r) => observe({ ...r, nativePrincipalId: f.actor.id }),
    ],
    ["wrong org", (r) => observe({ ...r, orgId: "foreign" })],
    [
      "wrong projection",
      (r) => observe({ ...r, projection: "superseded-unsent-checkout" }),
    ],
    [
      "expired",
      (r) => {
        const a = observe(r)!;
        a.observedAt -= 20000;
        a.validUntil -= 20000;
        return a;
      },
    ],
  ];
  for (const [name, handler] of cases) {
    m.configuration.observe = handler;
    m.configure();
    assert.throws(
      () => queues(f),
      { code: "RESTORE_MAINTENANCE_AUTHORITY" },
      name,
    );
  }
  let cached: RestoreNativeMaintenanceAssociation | null = null;
  m.configuration.observe = (r) => (cached ??= observe(r));
  m.configure();
  assert.throws(
    () => queues(f),
    { code: "RESTORE_MAINTENANCE_AUTHORITY" },
    "each target requires its own challenge",
  );
  m.configuration.observe = observe;
  m.configuration.mappings = [
    ...m.configuration.mappings,
    m.configuration.mappings[2]!,
  ];
  m.configure();
  assert.throws(() => queues(f), { code: "RESTORE_MAINTENANCE_AUTHORITY" });
  m.configuration.mappings = m.configuration.mappings.slice(0, 3);
  m.configure();
  queues(f);
  m.revoke();
  assert.throws(() => queues(f), { code: "RESTORE_MAINTENANCE_AUTHORITY" });
});
test("native queue repeats IAM role, site, password and tenant checks under the same transaction", (t) => {
  const f = carrierSetup(t),
    m = maintenance(f);
  isolate(f);
  const before = ownerRows(f),
    iam = f.app.database.owned("iam");
  const attacks = [
    () => iam.run("UPDATE iam_users SET active=0 WHERE id=?", m.warehouse.id),
    () =>
      iam.run("UPDATE iam_users SET role='support' WHERE id=?", m.warehouse.id),
    () =>
      iam.run("UPDATE iam_users SET role='admin' WHERE id=?", m.warehouse.id),
    () => iam.run("UPDATE iam_users SET sites='[]' WHERE id=?", m.warehouse.id),
    () =>
      iam.run(
        "UPDATE iam_users SET org_id='foreign' WHERE id=?",
        m.warehouse.id,
      ),
    () =>
      iam.run(
        "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
        m.warehouse.id,
      ),
  ];
  const rollback = new Error("rollback synthetic corruption");
  for (const attack of attacks) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          attack();
          assert.throws(
            () => boundary(f),
            (e: any) =>
              ["FORBIDDEN", "RESTORE_MAINTENANCE_AUTHORITY"].includes(e.code),
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(ownerRows(f), before);
    queues(f);
  }
});
test("native queue checks current finance role/password rather than copied grant", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  const m = maintenance(f);
  isolate(f);
  for (const query of [
    "UPDATE iam_users SET role='support' WHERE id=?",
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
  ]) {
    const rollback = Error("test rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database.owned("iam").run(query, m.finance.id);
          assert.throws(() => boundary(f), {
            code: "RESTORE_MAINTENANCE_AUTHORITY",
          });
          throw rollback;
        }),
      (e) => e === rollback,
    );
  }
  queues(f);
});
for (const unknown of [false, true])
  test(`native queue pending successor remains independent (unknown=${unknown})`, async (t) => {
    const f = await creditSetup(t);
    maintenance(f);
    if (unknown) {
      const r = await f.app.integration.execute(f.finance, f.successor.id, {
        execute: async () => {
          throw Error("Synthetic completed attempt lost response");
        },
        lookup: async () => null,
      });
      assert.equal(r.state, "unknown");
    }
    isolate(f);
    assert.throws(() => queues(f), { code: "RESTORE_UNRESOLVED" });
  });
test("native queue canceled group does not settle its ordinary pending booking", (t) => {
  const f = carrierSetup(t, false, false);
  maintenance(f);
  isolate(f);
  assert.throws(() => queues(f), { code: "RESTORE_UNRESOLVED" });
});
test("native queue malformed/duplicate/missing receipt or changed cancellation/renewal/binding is unresolved", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  maintenance(f);
  isolate(f);
  const p = f.app.database.owned("platform"),
    i = f.store;
  const attacks = [
    () =>
      p.run(
        "DELETE FROM platform_commands WHERE name='quickbooks.credit.cancel'",
      ),
    () =>
      p.run(
        "UPDATE platform_commands SET hash=? WHERE name='quickbooks.credit.cancel'",
        "1".repeat(64),
      ),
    () =>
      p.run(
        "UPDATE platform_commands SET result='{' WHERE name='quickbooks.credit.apply'",
      ),
    () =>
      p.run(
        "INSERT INTO platform_commands SELECT org_id,actor_id,name,'duplicate-receipt',hash,result,created_at FROM platform_commands WHERE name='quickbooks.credit.cancel'",
      ),
    () =>
      p.run("DELETE FROM platform_commands WHERE name='stripe.checkout.renew'"),
    () =>
      i.run(
        "UPDATE integration_credit_applications SET amount=1 WHERE effect_id=?",
        f.application.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET reference='wrong' WHERE id=?",
        f.application.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET payload=json_set(payload,'$.amount',1) WHERE id=?",
        f.application.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET account_id='foreign' WHERE id=?",
        f.application.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET org_id='foreign' WHERE id=?",
        f.application.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET result='{}' WHERE id=?",
        f.application.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET external_ref='foreign' WHERE id=?",
        f.checkout.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET started_at=1 WHERE id=?",
        f.checkout.id,
      ),
    () =>
      i.run(
        "UPDATE integration_checkout_renewals SET reason='forged' WHERE predecessor_id=?",
        f.checkout.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET reference='wrong' WHERE id=?",
        f.successor.id,
      ),
    () =>
      i.run(
        "UPDATE integration_effects SET state='blocked',error='unrelated' WHERE id=?",
        f.parent.id,
      ),
    () =>
      i.run(
        "INSERT INTO integration_operation_leases VALUES(?,?,?,?)",
        f.checkout.id,
        f.actor.orgId,
        "held-claim",
        1,
      ),
  ];
  const before = ownerRows(f);
  for (const attack of attacks) {
    const rollback = Error("rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          attack();
          assert.throws(
            () => boundary(f),
            (e: any) =>
              ["RESTORE_UNRESOLVED", "RESTORE_MAINTENANCE_AUTHORITY"].includes(
                e.code,
              ),
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(ownerRows(f), before);
    queues(f);
  }
});
test("native queue Canada Post complete receipt/member/group corruption cannot project", (t) => {
  const f = carrierSetup(t);
  maintenance(f);
  isolate(f);
  const p = f.app.database.owned("platform"),
    i = f.app.database.owned("integration");
  const attacks = [
    () =>
      p.run(
        "DELETE FROM platform_commands WHERE name='carrier.canada-post.group.cancel'",
      ),
    () =>
      p.run(
        "UPDATE platform_commands SET hash=? WHERE name='carrier.canada-post.group.cancel'",
        "1".repeat(64),
      ),
    () =>
      p.run(
        "INSERT INTO platform_commands SELECT org_id,actor_id,name,'duplicate-receipt',hash,result,created_at FROM platform_commands WHERE name='carrier.canada-post.group.cancel'",
      ),
    () =>
      p.run(
        "DELETE FROM platform_events WHERE type='carrier.canada-post.group.canceled'",
      ),
    () =>
      i.run(
        "UPDATE integration_canada_post_members SET state='unknown' WHERE group_id=?",
        f.group.id,
      ),
    () =>
      i.run(
        "UPDATE integration_canada_post_members SET review_hash=? WHERE group_id=?",
        "1".repeat(64),
        f.group.id,
      ),
    () =>
      i.run(
        "UPDATE integration_canada_post_groups SET observation='{}' WHERE id=?",
        f.group.id,
      ),
    () =>
      i.run(
        "UPDATE integration_canada_post_groups SET token='claimed' WHERE id=?",
        f.group.id,
      ),
    () =>
      i.run(
        "UPDATE integration_canada_post_groups SET configuration_hash=? WHERE id=?",
        "1".repeat(64),
        f.group.id,
      ),
  ];
  for (const attack of attacks) {
    const rollback = Error("rollback");
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          attack();
          assert.throws(() => boundary(f));
          throw rollback;
        }),
      (e) => e === rollback,
    );
    queues(f);
  }
});
test("native queue faulty maintenance callback cannot mutate owner history inside its transaction", (t) => {
  const f = carrierSetup(t),
    m = maintenance(f);
  isolate(f);
  const before = ownerRows(f);
  const observe = m.configuration.observe;
  m.configuration.observe = (r) => {
    f.app.database
      .owned("integration")
      .run(
        "UPDATE integration_carrier_bookings SET state='pending' WHERE id=?",
        f.entries[0]!.bookingId,
      );
    return observe(r);
  };
  m.configure();
  assert.throws(() => queues(f));
  assert.equal(ownerRows(f), before);
});
test("native queue current snapshot sees uncommitted receipt damage and rolls back", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  maintenance(f);
  isolate(f);
  const before = ownerRows(f),
    rollback = Error("rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("platform")
          .run(
            "UPDATE platform_commands SET hash=? WHERE name='quickbooks.credit.cancel'",
            "a".repeat(64),
          );
        assert.throws(() => boundary(f), { code: "RESTORE_UNRESOLVED" });
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.equal(ownerRows(f), before);
  queues(f);
});

// Full release tests deliberately retain the real candidate/private-byte guard.
// UID-0 filesystems may fail capture before the target boundary; report, do not skip.
test("full restore: canceled Canada Post prepare retains rows and later receipt damage refuses review", (t) => {
  const f = carrierSetup(t);
  let s: ReturnType<typeof restoreSetup> | undefined;
  maintenance(f, () => s?.now() ?? Date.now());
  s = restoreSetup(f);
  const before = ownerRows(f);
  assert.equal(s.prepare().state, "prepared");
  assert.equal(ownerRows(f), before);
  f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_commands SET hash=? WHERE name='carrier.canada-post.group.cancel'",
      "a".repeat(64),
    );
  assert.throws(() => f.app.platform.restore.prepare(s!.input));
  assert.throws(() => f.app.platform.restore.activate(s!.input));
  assert.deepEqual(s.calls, []);
});
test("full restore: canceled credit and superseded checkout prepare/release revalidate current external maintenance authority", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  let s: ReturnType<typeof restoreSetup> | undefined;
  const m = maintenance(f, () => s?.now() ?? Date.now());
  s = restoreSetup(f);
  assert.equal(s.prepare().state, "prepared");
  m.revoke();
  assert.throws(() => f.app.platform.restore.prepare(s!.input), {
    code: "RESTORE_MAINTENANCE_AUTHORITY",
  });
  assert.throws(() => f.app.platform.restore.activate(s!.input), {
    code: "RESTORE_MAINTENANCE_AUTHORITY",
  });
  assert.deepEqual(s.calls, []);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

test("native queue current configuration withdrawal during observation refuses retained grant", (t) => {
  const f = carrierSetup(t),
    m = maintenance(f);
  isolate(f);
  const observe = m.configuration.observe;
  m.configuration.observe = (r) => {
    f.app.configureRestoreNativeDispositions();
    return observe(r);
  };
  m.configure();
  assert.throws(() => queues(f), { code: "RESTORE_MAINTENANCE_AUTHORITY" });
});

test("native queue preserves every independent callback, journal, auth, revocation and read/poll claim blocker", (t) => {
  const f = carrierSetup(t);
  maintenance(f);
  isolate(f);
  const store = f.app.database.owned("integration");
  // Deliberately inserted additional synthetic queue corruption, independent of
  // the real command-created/canceled group. Never an external result fixture.
  const rows: [string, Record<string, string | number>][] = [
    [
      "integration_callbacks",
      {
        id: "callback",
        org_id: f.actor.orgId,
        binding_id: "binding",
        event_id: "event",
        session_id: "session",
        effect_id: "effect",
        hash: "hash",
        state: "pending",
        created_at: "synthetic",
      },
    ],
    [
      "integration_refund_callbacks",
      {
        id: "refund-callback",
        org_id: f.actor.orgId,
        binding_id: "binding",
        event_id: "event",
        effect_id: "effect",
        provider_reference: "refund",
        event_type: "refund.updated",
        hash: "hash",
        state: "waiting",
        created_at: "synthetic",
      },
    ],
    [
      "integration_stock_journals",
      {
        id: "journal",
        org_id: f.actor.orgId,
        realm: "realm",
        binding_id: "binding",
        source_id: "source",
        leg: "original",
        posting_date: "2026-10-03",
        attempt_id: "attempt",
        plan: "{}",
        review_hash: "hash",
        state: "unknown",
        created_by: f.actor.id,
        created_at: "synthetic",
      },
    ],
    [
      "integration_credential_revocations",
      {
        id: "revoke",
        org_id: f.actor.orgId,
        binding_id: "binding",
        worker_id: "worker",
        account_id: f.buyer,
        realm: "realm",
        client_id: "client",
        credential_revision: 1,
        disabled_revision: 2,
        residency_version: 1,
        state: "unknown",
        started_at: 1,
      },
    ],
    [
      "integration_ledger_revocations",
      {
        id: "revoke",
        org_id: f.actor.orgId,
        binding_id: "binding",
        worker_id: "worker",
        realm: "realm",
        client_id: "client",
        credential_revision: 1,
        disabled_revision: 2,
        authority: "{}",
        state: "sending",
        started_at: 1,
      },
    ],
    [
      "integration_authorizations",
      {
        id: "auth",
        org_id: f.actor.orgId,
        binding_id: "binding",
        worker_id: "worker",
        account_id: f.buyer,
        realm: "realm",
        client_id: "client",
        redirect_uri: "synthetic",
        state_hash: "hash",
        credential_revision: 1,
        residency_version: 1,
        expires_at: 1,
        state: "unknown",
      },
    ],
    [
      "integration_ledger_authorizations",
      {
        id: "auth",
        org_id: f.actor.orgId,
        binding_id: "binding",
        worker_id: "worker",
        realm: "realm",
        client_id: "client",
        redirect_uri: "synthetic",
        state_hash: "hash",
        credential_revision: 1,
        authority: "{}",
        expires_at: 1,
        state: "pending",
      },
    ],
    [
      "integration_balance_reads",
      {
        id: "read",
        org_id: f.actor.orgId,
        effect_id: "effect",
        command_key: "key",
        hash: "hash",
        token: "claim",
        requested_at: "synthetic",
      },
    ],
    [
      "integration_refund_polls",
      { effect_id: "effect", org_id: f.actor.orgId, token: "claim" },
    ],
    [
      "integration_operation_leases",
      {
        effect_id: "effect",
        org_id: f.actor.orgId,
        token: "claim",
        started_at: 1,
      },
    ],
  ];
  const before = ownerRows(f);
  for (const [table, row] of rows) {
    const rollback = Error(table);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          const keys = Object.keys(row);
          store.run(
            `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
            ...Object.values(row),
          );
          assert.throws(
            () => boundary(f),
            { code: "RESTORE_UNRESOLVED" },
            table,
          );
          throw rollback;
        }),
      (e) => e === rollback,
    );
    assert.equal(ownerRows(f), before);
  }
  queues(f);
});

test("native queue complete history scans cannot hide an extra blocked effect or ambiguous late receipt", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  maintenance(f);
  isolate(f);
  const p = f.app.database.owned("platform"),
    i = f.store;
  const before = ownerRows(f);
  const rollback = Error("test rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let n = 0; n < 130; n++)
          p.run(
            "INSERT INTO platform_commands SELECT org_id,actor_id,name,?,hash,json_set(result,'$.id',?),created_at FROM platform_commands WHERE name='quickbooks.credit.cancel' AND key='native-cancel'",
            `unrelated-${n}`,
            `unrelated-${n}`,
          );
        boundary(f);
        p.run(
          "INSERT INTO platform_commands SELECT org_id,actor_id,name,'zz-last-duplicate',hash,result,created_at FROM platform_commands WHERE name='quickbooks.credit.cancel' AND key='native-cancel'",
        );
        assert.throws(() => boundary(f), { code: "RESTORE_UNRESOLVED" });
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.equal(ownerRows(f), before);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        for (let n = 0; n < 130; n++)
          i.run(
            "INSERT INTO integration_effects SELECT ?,org_id,account_id,provider,kind,?,payload,'completed',NULL,NULL,created_at,residency_version,NULL,NULL FROM integration_effects WHERE id=?",
            `copy-${n}`,
            `copy-${n}`,
            f.parent.id,
          );
        i.run(
          "INSERT INTO integration_effects SELECT 'zz-last-blocked',org_id,account_id,provider,kind,'zz-blocked',payload,'blocked',NULL,NULL,created_at,residency_version,NULL,'unrelated' FROM integration_effects WHERE id=?",
          f.parent.id,
        );
        assert.throws(() => boundary(f), { code: "RESTORE_UNRESOLVED" });
        throw rollback;
      }),
    (e) => e === rollback,
  );
  assert.equal(ownerRows(f), before);
});

test("full restore: historical dispositions preserve dossier evidence and release signatures through activation", async (t) => {
  const f = await creditSetup(t, "US", "USD", true);
  await settleSuccessor(f);
  let s: ReturnType<typeof restoreSetup> | undefined;
  const m = maintenance(f, () => s?.now() ?? Date.now());
  s = restoreSetup(f);
  const before = ownerRows(f);
  assert.equal(s.prepare().state, "prepared");
  assert.equal(f.app.platform.restore.activate(s.input).state, "released");
  assert.equal(ownerRows(f), before);
  assert(
    m.seen.length >= 10,
    "prepare and every activation review revalidate both projections",
  );
  assert.deepEqual(s.calls, ["fence", "candidate"]);
});

test("native queue ordinary terminal store needs no historical maintenance grant", (t) => {
  const f = fixture(t);
  isolate(f);
  const before = ownerRows(f);
  queues(f);
  assert.equal(ownerRows(f), before);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});
test("native queue rejects and rolls back a callback-created independent claim after its initial scan", (t) => {
  const f = carrierSetup(t),
    m = maintenance(f);
  isolate(f);
  const before = ownerRows(f),
    observe = m.configuration.observe;
  m.configuration.observe = (r) => {
    if (!m.seen.length)
      f.app.database
        .owned("integration")
        .run(
          "INSERT INTO integration_refund_polls VALUES('synthetic-late-effect',?,'late-claim',1,0)",
          f.actor.orgId,
        );
    return observe(r);
  };
  m.configure();
  assert.throws(() => queues(f), { code: "RESTORE_UNRESOLVED" });
  assert.equal(
    m.seen.length,
    2,
    "all owner projections completed before the write guard refused",
  );
  assert.equal(ownerRows(f), before);
});

for (const [provider, kind] of [
  ["stripe", "checkout"],
  ["quickbooks", "credit-application"],
] as const)
  test(`native queue preliminary eligibility refuses unrelated blocked ${provider} intent before authority`, (t) => {
    const f = fixture(t);
    const m = maintenance(f);
    f.app.database
      .owned("integration")
      .run(
        "INSERT INTO integration_effects VALUES(?,?,?,?,?,?,?,'blocked',NULL,NULL,?,1,NULL,?)",
        "synthetic-blocked",
        f.actor.orgId,
        "synthetic-account",
        provider,
        kind,
        "synthetic-reference",
        "{}",
        new Date().toISOString(),
        "Synthetic unresolved provider intent",
      );
    isolate(f);
    const before = ownerRows(f);
    f.app.configureRestoreNativeDispositions();
    assert.throws(() => queues(f), { code: "RESTORE_UNRESOLVED" });
    m.configure();
    assert.throws(() => queues(f), { code: "RESTORE_UNRESOLVED" });
    assert.deepEqual(
      m.seen,
      [],
      "ineligible history never requests maintenance authority",
    );
    f.app.configureRestoreNativeDispositions();
    assert.throws(() => queues(f), { code: "RESTORE_UNRESOLVED" });
    assert.equal(ownerRows(f), before);
  });

test("native queue preliminary eligibility requires the exact owning org/effect identity", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  const m = maintenance(f);
  isolate(f);
  const before = ownerRows(f);
  for (const [table, column, target] of [
    ["integration_credit_cancellations", "effect_id", f.application.id],
    ["integration_checkout_renewals", "predecessor_id", f.checkout.id],
  ] as const) {
    for (const statement of [
      `DELETE FROM ${table} WHERE ${column}=?`,
      `UPDATE ${table} SET org_id='foreign' WHERE ${column}=?`,
    ]) {
      const rollback = Error("Rollback synthetic missing/mismatched history");
      m.seen.length = 0;
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            f.store.run(statement, target);
            assert.throws(() => boundary(f), { code: "RESTORE_UNRESOLVED" });
            assert(!m.seen.some((request) => request.recordId === target));
            throw rollback;
          }),
        (error) => error === rollback,
      );
      assert.equal(ownerRows(f), before);
      queues(f);
    }
  }
  // Another effect's genuine same-org cancellation/renewal cannot qualify a row.
  for (const source of [f.application.id, f.checkout.id]) {
    const rollback = Error("Rollback unrelated blocked effect");
    const target = "synthetic-unrelated-blocked";
    m.seen.length = 0;
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.store.run(
            "INSERT INTO integration_effects SELECT ?,org_id,account_id,provider,kind,?,'{}',state,NULL,NULL,created_at,residency_version,NULL,error FROM integration_effects WHERE id=?",
            target,
            "unrelated-reference",
            source,
          );
          assert.throws(() => boundary(f), { code: "RESTORE_UNRESOLVED" });
          assert(!m.seen.some((request) => request.recordId === target));
          throw rollback;
        }),
      (error) => error === rollback,
    );
    assert.equal(ownerRows(f), before);
  }
});

test("native queue preliminary eligibility never substitutes for current authority or complete evidence", async (t) => {
  const f = await creditSetup(t);
  await settleSuccessor(f);
  const m = maintenance(f);
  isolate(f);
  f.app.configureRestoreNativeDispositions();
  assert.throws(() => queues(f), { code: "RESTORE_MAINTENANCE_AUTHORITY" });
  m.configure();
  queues(f);
  const rollback = Error("Rollback forged native cancellation");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.store.run(
          "UPDATE integration_credit_cancellations SET reason='forged' WHERE effect_id=?",
          f.application.id,
        );
        assert.throws(() => boundary(f), { code: "RESTORE_UNRESOLVED" });
        throw rollback;
      }),
    (error) => error === rollback,
  );
  m.revoke();
  assert.throws(() => queues(f), { code: "RESTORE_MAINTENANCE_AUTHORITY" });
});
