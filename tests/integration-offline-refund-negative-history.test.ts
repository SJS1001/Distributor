import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { accept, chooseProviders, fixture, ship } from "./fixtures.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { IntegrationOfflineRefundNegativeHistory } from "../src/server/integration-offline-refund-negative-history.ts";

async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic test consent",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      22600,
      "stripe",
      "pi_gap_original",
    ),
  );
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "GAP-CREDIT",
    reason: "Synthetic native credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId,
    paymentId: payment.id,
    amount: 5000,
    reference: "GAP-REFUND",
    reason: "Synthetic native refund",
  });
  const effect = f.app.integration.refund(f.actor, "queue", {
    refundId: refund.id,
  });
  let syntheticCalls = 0;
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async (_effect, beforeWrite) => {
        beforeWrite?.();
        syntheticCalls++;
        throw Error("synthetic lost response: no provider called");
      },
      lookup: async () => {
        throw Error("unexpected synthetic lookup");
      },
    }),
    /synthetic lost response/,
  );
  assert.equal(syntheticCalls, 1);
  const { id } = f.app.identity.createUser(f.actor, "finance", {
    name: "Negative-history finance",
    email: "gap-finance@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id });
  f.app.platform.isolateRestore(
    "synthetic-gap-source",
    new Date().toISOString(),
  );
  return Object.assign(f, {
    invoiceId,
    refundId: refund.id,
    effectId: effect.id,
    finance,
  });
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const reference = "re_proposed_gap";
const refused = { code: "OFFLINE_REFUND_NEGATIVE_HISTORY" };
const limited = { code: "OFFLINE_REFUND_NEGATIVE_HISTORY_LIMIT" };
function reader(f: Fixture) {
  return new IntegrationOfflineRefundNegativeHistory(
    f.app.database,
    f.app.identity,
    f.app.billing,
  );
}
function inside(
  f: Fixture,
  actor: Actor = f.finance,
  effect: unknown = f.effectId,
  proposed: unknown = reference,
) {
  return reader(f).getInTransaction(
    actor,
    effect as string,
    proposed as string,
  );
}
function review(f: Fixture) {
  return f.app.database.transaction(() => inside(f));
}
function conservation(f: Fixture) {
  return canonical(
    (["integration", "billing", "platform"] as const).map((owner) => {
      const store = f.app.database.owned(owner);
      return store
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          `${owner}_%`,
        )
        .map(({ name }) => [
          name,
          store.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]);
    }),
  );
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
function effects(
  f: Fixture,
  id: string,
  org = "other-org",
  external: string | null = null,
  payload = "{}",
  result: string | null = null,
  error: string | null = null,
) {
  f.app.database.owned("integration").run(
    `INSERT INTO integration_effects
    (id,org_id,account_id,provider,kind,reference,payload,state,external_ref,result,created_at,residency_version,error)
    VALUES(?,?,'other-account','stripe','refund',?,?,'unknown',?,?,'2026-10-03T00:00:00.000Z',1,?)`,
    id,
    org,
    id,
    payload,
    external,
    result,
    error,
  );
}
function callback(f: Fixture, org: string, providerReference = reference) {
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_refund_callbacks VALUES(?,?,?,?,?,?,?,?,'pending',0,NULL,0,NULL,?)",
      "orphan",
      org,
      "binding",
      "evt_orphan",
      "missing-effect",
      providerReference,
      "refund.failed",
      digest("synthetic"),
      "2026-10-03T00:00:00.000Z",
    );
}
function inbox(
  f: Fixture,
  event = "evt_unattributed",
  hash = digest("synthetic"),
) {
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_inbox VALUES('stripe',?,?,?)",
      event,
      hash,
      "2026-10-03T00:00:00.000Z",
    );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`clean ${region}/${currency}: exact detached frozen native target, purpose hash and conservation`, async (t) => {
    const f = await setup(t, region, currency),
      before = conservation(f);
    const r = f.app.database.transaction(() => {
      const changes = f.app.database
        .owned("integration")
        .get("SELECT total_changes() AS n")!.n;
      const result = inside(f);
      assert.equal(
        f.app.database.owned("integration").get("SELECT total_changes() AS n")!
          .n,
        changes,
      );
      return result;
    });
    assert.equal(r.region, region);
    assert.equal(r.currency, currency);
    assert.equal(r.effectId, f.effectId);
    assert.equal(r.proposedReference, reference);
    assert.equal(r.effect.payload, canonical(r.intent));
    assert.equal(r.effect.state, "unknown");
    assert.equal(r.effect.external_ref, null);
    assert.equal(r.effect.result, null);
    assert.deepEqual(r.negativeHistory, {
      scope:
        "all-native-integration-effects-inbox-refund-and-checkout-callbacks-offline-imports",
      inboxRows: 0,
      refundCallbackRows: 0,
      checkoutCallbackRows: 0,
      offlineImportRows: 0,
      referenceCollisions: 0,
      scannedEffectRows: 1,
    });
    const { hash, ...body } = r;
    assert.equal(hash, digest(canonical(body)));
    frozen(r);
    assert.throws(() => {
      (r.intent as any).amount = 1;
    }, TypeError);
    assert.throws(() => {
      (r.profile as any).fieldBytes = 1;
    }, TypeError);
    assert.deepEqual(review(f), r);
    assert.equal(conservation(f), before);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
    const old = f.app.database.transaction(() =>
      f.app.integration.reviewOfflineFailedRefundInTransaction(
        f.finance,
        f.effectId,
      ),
    );
    assert.deepEqual(old.blockers, [
      "BILLING_COMPLETE_HISTORY_REQUIRED",
      "INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE",
      "PLATFORM_RECEIPT_HISTORY_REQUIRED",
    ]);
    f.app.database.transaction(() =>
      f.app.database
        .owned("integration")
        .run(
          "UPDATE integration_effects SET error='changed native error' WHERE id=?",
          f.effectId,
        ),
    );
    assert.notEqual(review(f).hash, r.hash);
    assert.notEqual(r.effect.error, "changed native error");
  });

test("unattributed Stripe inbox omitted by old review now refuses without claiming its tenancy", async (t) => {
  const f = await setup(t);
  inbox(f);
  const before = conservation(f);
  assert.throws(() => review(f), refused);
  assert.equal(conservation(f), before);
});
for (const org of ["same", "foreign"])
  test(`${org}-org orphan callback with proposed reference refuses`, async (t) => {
    const f = await setup(t);
    callback(f, org === "same" ? f.actor.orgId : "other-org");
    assert.throws(() => review(f), refused);
  });
test("even terminal unrelated callbacks, checkout history and non-Stripe inbox refuse conservatively", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("integration");
  const cases = [
    () => {
      callback(f, "other-org", "re_unrelated");
      store.run("UPDATE integration_refund_callbacks SET state='completed'");
    },
    () =>
      store.run(
        "INSERT INTO integration_callbacks VALUES('checkout','other-org','binding','evt_checkout','cs_session','missing-effect',?,'completed',1,NULL,0,NULL,'2026-10-03T00:00:00.000Z')",
        digest("synthetic"),
      ),
    () =>
      store.run(
        "INSERT INTO integration_inbox VALUES('unknown-provider','evt_other',?,'2026-10-03T00:00:00.000Z')",
        digest("synthetic"),
      ),
  ];
  for (const change of cases) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          change();
          inside(f);
        }),
      refused,
    );
    assert.equal(review(f).negativeHistory.scannedEffectRows, 1);
  }
});
for (const org of ["same", "foreign"])
  test(`${org}-org retained effect proposed-reference collision refuses`, async (t) => {
    const f = await setup(t);
    effects(
      f,
      "other",
      org === "same" ? f.actor.orgId : "other-org",
      reference,
    );
    assert.throws(() => review(f), refused);
  });
for (const where of ["payload", "result", "escaped-result", "native-reference"])
  test(`copied other-provider ${where} identity collision refuses without materializing foreign rows`, async (t) => {
    const f = await setup(t);
    effects(f, "other");
    const store = f.app.database.owned("integration");
    store.run(
      "UPDATE integration_effects SET provider='quickbooks' WHERE id='other'",
    );
    if (where === "native-reference")
      store.run(
        "UPDATE integration_effects SET reference=? WHERE id='other'",
        reference,
      );
    else
      store.run(
        `UPDATE integration_effects SET ${where === "payload" ? "payload" : "result"}=? WHERE id='other'`,
        where === "escaped-result"
          ? '{"nested":{"ref":"r\\u0065_proposed_gap"}}'
          : canonical({ nested: { ref: reference } }),
      );
    assert.throws(() => review(f), refused);
  });
test("unclassified import record refuses, including other-org copied provenance", async (t) => {
  const f = await setup(t);
  effects(f, "other");
  const record = canonical({ externalReference: reference });
  f.app.database
    .owned("integration")
    .run(
      "INSERT INTO integration_offline_failed_refunds VALUES('other','other-org','request',?,?,?)",
      digest("binding"),
      record,
      digest(record),
    );
  assert.throws(() => review(f), refused);
});
test("bounded other-tenant effects are never returned; clean proposed reference changes purpose hash", async (t) => {
  const f = await setup(t);
  effects(
    f,
    "foreign-secret-id",
    "foreign-secret-org",
    null,
    '{"safe":"foreign-secret-marker"}',
  );
  const r = review(f);
  assert.equal(r.negativeHistory.scannedEffectRows, 2);
  assert(!canonical(r).includes("foreign-secret"));
  const different = f.app.database.transaction(() =>
    inside(f, f.finance, f.effectId, "re_another"),
  );
  assert.notEqual(different.hash, r.hash);
});
for (const change of [
  "state='pending'",
  "external_ref='re_already'",
  "result='{}'",
  "provider='quickbooks'",
  "kind='checkout'",
  "org_id='other-org'",
  "account_id='other-account'",
  "payload='{}'",
])
  test(`actual target ${change} refuses and rolls back`, async (t) => {
    const f = await setup(t),
      before = review(f);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("integration")
            .run(
              `UPDATE integration_effects SET ${change} WHERE id=?`,
              f.effectId,
            );
          inside(f);
        }),
      refused,
    );
    assert.deepEqual(review(f), before);
  });
for (const [change, code] of [
  ["role='support'", "FORBIDDEN"],
  ["active=0", "FORBIDDEN"],
  ["org_id='elsewhere'", "FORBIDDEN"],
  ["account_id='buyer'", "FORBIDDEN"],
])
  test(`fresh principal ${change}: stale actor cannot restore authority`, async (t) => {
    const f = await setup(t),
      before = review(f);
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.database
            .owned("iam")
            .run(`UPDATE iam_users SET ${change} WHERE id=?`, f.finance.id);
          inside(f, { ...f.finance, role: "admin", accountId: null });
        }),
      { code },
    );
    assert.deepEqual(review(f), before);
  });
test("forced password change and actual outer writer required", async (t) => {
  const f = await setup(t);
  assert.throws(() => inside(f), { code: "TRANSACTION" });
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run(
            "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
            f.finance.id,
          );
        inside(f);
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.equal(review(f).effectId, f.effectId);
});
test("primitive input refuses proxies (including revoked), accessors and coercion with zero trap invocation", async (t) => {
  const f = await setup(t);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("input trap invoked");
  };
  const proxy = new Proxy(
    {},
    {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    },
  );
  const revoked = Proxy.revocable({}, { get: trap, ownKeys: trap });
  revoked.revoke();
  const accessor = Object.defineProperty({}, "id", { get: trap });
  const inputs: unknown[] = [
    proxy,
    revoked.proxy,
    accessor,
    { toString: trap },
    new String(reference),
    null,
    undefined,
    1,
    Symbol("x"),
    () => trap(),
    "",
    "a".repeat(161),
    "é".repeat(100),
    "id\0hidden",
    " id",
    "id\n",
  ];
  for (const bad of inputs)
    for (const position of [0, 1])
      assert.throws(
        () =>
          f.app.database.transaction(() =>
            reader(f).getInTransaction(
              f.finance,
              (position === 0 ? bad : f.effectId) as string,
              (position === 1 ? bad : reference) as string,
            ),
          ),
        { code: "OFFLINE_REFUND_NEGATIVE_HISTORY_INPUT" },
      );
  assert.equal(traps, 0);
  for (const bad of ["pi_wrong", "re_", "re_x-y"])
    assert.throws(
      () =>
        f.app.database.transaction(() => inside(f, f.finance, f.effectId, bad)),
      { code: "OFFLINE_REFUND_NEGATIVE_HISTORY_INPUT" },
    );
});
// Calls through the real SQLite execution path, counting any variable value
// returned by Integration before rejection. Numeric preflight metadata is OK.
function noTextBeforeRefusal(
  t: TestContext,
  f: Fixture,
  expected = limited,
  existingWriter = false,
) {
  const execute = f.app.database.execute.bind(f.app.database);
  let textBytes = 0;
  const inspect = (v: unknown): void => {
    if (typeof v === "string") textBytes += Buffer.byteLength(v);
    else if (v && typeof v === "object") Object.values(v).forEach(inspect);
  };
  const spy = t.mock.method(
    f.app.database,
    "execute",
    (
      owner: Parameters<typeof execute>[0],
      fn: Parameters<typeof execute>[1],
    ) => {
      const value = execute(owner, fn);
      if (owner === "integration") inspect(value);
      return value;
    },
  );
  try {
    assert.throws(() => (existingWriter ? inside(f) : review(f)), expected);
  } finally {
    spy.mock.restore();
  }
  assert.equal(
    textBytes,
    0,
    "no Integration text may leave SQLite before refusal",
  );
}
for (const mode of [
  "multibyte-field",
  "nul-suffix",
  "row",
  "aggregate",
  "count",
  "json-document",
  "json-total",
  "malformed-json",
])
  test(`complete ${mode} preflight refuses before materialization`, async (t) => {
    const f = await setup(t);
    if (mode === "multibyte-field")
      effects(f, "other", "other-org", null, "{}", null, "界".repeat(22000));
    if (mode === "nul-suffix") inbox(f, "evt\0" + "界".repeat(22000));
    if (mode === "row")
      effects(
        f,
        "other",
        "other-org",
        null,
        canonical({ s: "x".repeat(50000) }),
        canonical({ s: "x".repeat(50000) }),
        "x".repeat(50000),
      );
    if (mode === "aggregate")
      for (let i = 0; i < 40; i++)
        effects(
          f,
          `other${i}`,
          "other-org",
          null,
          "{}",
          null,
          "界".repeat(20000),
        );
    if (mode === "count") for (let i = 0; i < 256; i++) effects(f, `other${i}`);
    if (mode === "json-document")
      effects(
        f,
        "other",
        "other-org",
        null,
        JSON.stringify(Array(4096).fill(0)),
      );
    if (mode === "json-total")
      for (let i = 0; i < 5; i++)
        effects(
          f,
          `other${i}`,
          "other-org",
          null,
          JSON.stringify(Array(4000).fill(0)),
        );
    if (mode === "malformed-json")
      effects(f, "other", "other-org", null, "{bad");
    noTextBeforeRefusal(t, f, mode === "malformed-json" ? refused : limited);
  });
test("per-table bounds include retained callback fields and byte totals before history refusal", async (t) => {
  const f = await setup(t);
  callback(f, "foreign");
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_refund_callbacks SET binding_id=?",
      "x\0" + "界".repeat(22000),
    );
  noTextBeforeRefusal(t, f);
});
test("cross-table total row bound refuses without truncation", async (t) => {
  const f = await setup(t);
  for (let i = 0; i < 255; i++) effects(f, `other${i}`);
  for (let i = 0; i < 256; i++) inbox(f, `evt_${i}`);
  callback(f, "foreign");
  noTextBeforeRefusal(t, f);
});
test("exact reopen and outer rollback remain read-only", async (t) => {
  const f = await setup(t),
    before = review(f),
    saved = conservation(f),
    stop = Error("rollback");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        assert.deepEqual(inside(f), before);
        throw stop;
      }),
    stop,
  );
  assert.equal(conservation(f), saved);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(review(f), before);
  assert.equal(conservation(f), saved);
});

test("organization region change is refreshed before Integration materialization", async (t) => {
  const f = await setup(t);
  const stop = Error("rollback region");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run(
            "UPDATE iam_organizations SET region='US' WHERE id=?",
            f.finance.orgId,
          );
        noTextBeforeRefusal(t, f, { code: "FORBIDDEN" }, true);
        throw stop;
      }),
    stop,
  );
  assert.equal(review(f).region, "CA");
});

test("checkout and import metadata are byte-bounded before nonempty-history refusal", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("integration"),
    stop = Error("rollback fixture");
  for (const mutate of [
    () =>
      store.run(
        "INSERT INTO integration_callbacks VALUES('checkout','other-org',?,'evt_checkout','cs_session','missing-effect',?,'completed',1,NULL,0,NULL,'2026-10-03T00:00:00.000Z')",
        "界".repeat(22000),
        digest("synthetic"),
      ),
    () =>
      store.run(
        "INSERT INTO integration_offline_failed_refunds VALUES(?, 'other-org', ?, ?, '{}', ?)",
        f.effectId,
        "x\0" + "界".repeat(22000),
        digest("binding"),
        digest("{}"),
      ),
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          mutate();
          noTextBeforeRefusal(t, f, limited, true);
          throw stop;
        }),
      stop,
    );
    assert.equal(review(f).effectId, f.effectId);
  }
});

test("all nonempty negative sets refuse with no tenant text materialized", async (t) => {
  const f = await setup(t),
    store = f.app.database.owned("integration"),
    stop = Error("rollback fixture");
  for (const mutate of [
    () => inbox(f),
    () => callback(f, "foreign"),
    () =>
      store.run(
        "INSERT INTO integration_callbacks VALUES('checkout','other-org','binding','evt_checkout','cs_session','missing-effect',?,'completed',1,NULL,0,NULL,'2026-10-03T00:00:00.000Z')",
        digest("synthetic"),
      ),
    () =>
      store.run(
        "INSERT INTO integration_offline_failed_refunds VALUES(?,'other-org','request',?,'{}',?)",
        f.effectId,
        digest("binding"),
        digest("{}"),
      ),
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          mutate();
          noTextBeforeRefusal(t, f, refused, true);
          throw stop;
        }),
      stop,
    );
});

test("escaped unrelated JSON is an explicit conservative refusal, never partial classification", async (t) => {
  const f = await setup(t);
  effects(f, "other", "foreign", null, '{"unrelated":"escaped\\nvalue"}');
  noTextBeforeRefusal(t, f, refused);
});
