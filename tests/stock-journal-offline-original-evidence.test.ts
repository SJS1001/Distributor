import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { type OfflineOriginalJournalReview } from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  assertCapturedOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
import { journalFixture } from "./stock-journal-fixture.ts";

function setup(t: TestContext, region: "CA" | "US" = "CA", ancestors = 0) {
  const c = journalFixture(t, region);
  let journal = c.approve();
  for (let i = 0; i <= ancestors; i++) {
    const lease = c.j.claim(c.f.actor, journal.id, "write")!;
    c.j.beforeWrite(lease);
    c.j.unresolved(lease, "transport-uncertain");
    if (i === ancestors) break;
    const proof = c.j.recordOriginalCancellationEvidence(
      c.f.actor,
      `proof-${i}`,
      {
        journalId: journal.id,
        requestRef: journal.requestRef,
        reviewHash: c.j.originalCancellationEvidenceReview(
          c.f.actor,
          journal.id,
        ).reviewHash,
        externalRef: `synthetic:final-case-${i}`,
        evidence:
          "Synthetic exact-request final cancellation and no future posting",
        cancellationFinal: true,
        nonPostingVerified: true,
        noLaterPosting: true,
      },
    );
    c.j.cancelOriginalAttempt(c.reviewer, `cancel-${i}`, {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Synthetic independent cancellation",
    });
    const ready = c.j.prepareOriginalRetry(c.f.actor, `retry-${i}`, {
      journalId: journal.id,
      reviewHash: c.j.originalRetryReview(c.f.actor, journal.id).reviewHash,
      reason: "Synthetic retry, separately approved",
    });
    journal = c.j.decide(c.reviewer, `retry-approve-${i}`, {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Independent retry approval",
    });
  }
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    new Date().toISOString(),
  );
  return { ...c, journal };
}
type F = ReturnType<typeof setup>;
function comparator(app: Application) {
  return new StockJournalOfflineOriginalEvidence(
    app.database,
    app.identity,
    app.integration.costs.journals,
  );
}
function native(c: F) {
  return c.f.app.database.transaction(() =>
    c.f.app.integration.costs.journals.readOfflineOriginalInTransaction(
      c.reviewer,
      c.journal.id,
    ),
  );
}
// Independently reproduce the existing cancellation snapshot, not comparator output.
function inputFor(
  p: OfflineOriginalJournalReview,
): OfflineOriginalEvidenceInput {
  const a = p.attempts.find((x) => x.row.id === p.journalId)!,
    d = p.dates.find((x) => x.postingDate === a.row.posting_date)!;
  const snapshot: OfflineOriginalCancellationSnapshot = {
    version: 1,
    orgId: p.orgId,
    journalId: p.journalId,
    reviewHash: a.row.review_hash,
    sourceId: a.row.source_id,
    sourceHash: p.source.file.hash,
    postingDate: a.row.posting_date,
    realm: a.row.realm,
    bindingId: a.row.binding_id,
    requestRef: String(a.references[0]!.request_ref),
    region: p.region,
    currency: p.currency,
    debit: d.debit,
    credit: d.credit,
    historyHash: digest(canonical(a.observations.map((x) => x.hash))),
  };
  return structuredClone({
    version: 1,
    source: p,
    candidate: p,
    providerClaims: [
      {
        profile: "quickbooks-sandbox-original-final-cancellation-unposted-v1",
        outcome: "cancelled-unposted",
        request: { ...snapshot, intentHash: digest(canonical(a.plan.intent)) },
        attestation: {
          journalId: p.journalId,
          requestRef: snapshot.requestRef,
          reviewHash: digest(canonical(snapshot)),
          externalRef: "synthetic:provider-case-1",
          evidence:
            "Synthetic assertion only: exact final cancellation and no future posting",
          cancellationFinal: true,
          nonPostingVerified: true,
          noLaterPosting: true,
        },
      },
    ],
  });
}
function read(c: F, input = inputFor(native(c)), actor = c.reviewer) {
  return c.f.app.database.transaction(() =>
    comparator(c.f.app).captureInTransaction(actor, c.journal.id, input),
  );
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
const invalid = { code: "OFFLINE_ORIGINAL_EVIDENCE" };
function rehash(p: any) {
  const { hash: _, ...facts } = p;
  p.hash = digest(canonical(facts));
}
function tables(c: F) {
  return canonical(
    (["integration", "platform", "inventory"] as const).map((owner) => {
      const s = c.f.app.database.owned(owner);
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          `${owner}_%`,
        )
        .map(({ name }) => [
          name,
          s.all(`SELECT * FROM ${name} ORDER BY rowid`),
        ]);
    }),
  );
}
for (const region of ["CA", "US"] as const)
  test(`${region}: actual owner recapture, independent native cancellation snapshot, purpose hash, no writes`, (t) => {
    const c = setup(t, region),
      p = native(c),
      input = inputFor(p),
      before = tables(c);
    const ordinary = c.j.originalCancellationEvidenceReview(
      c.reviewer,
      c.journal.id,
    );
    const out = c.f.app.database.transaction(() => {
      const s = c.f.app.database.owned("integration"),
        changes = s.get("SELECT total_changes() AS n")!.n;
      const result = comparator(c.f.app).captureInTransaction(
        c.reviewer,
        c.journal.id,
        input,
      );
      assert.equal(s.get("SELECT total_changes() AS n")!.n, changes);
      return result;
    });
    assert.deepEqual(out.cancellationSnapshot, ordinary.snapshot);
    assert.equal(out.claim.attestation.reviewHash, ordinary.reviewHash);
    assert.equal(out.native.currency, region === "CA" ? "CAD" : "USD");
    assert.deepEqual(out.native, p);
    const { hash, ...facts } = out;
    assert.equal(hash, digest(canonical(facts)));
    assert.notEqual(hash, p.hash);
    assert.deepEqual(read(c, input), out);
    assertCapturedOfflineOriginalEvidence(out);
    frozen(out);
    for (const copy of [
      structuredClone(out),
      JSON.parse(JSON.stringify(out)),
      Object.freeze({ ...out }),
    ])
      assert.throws(() => assertCapturedOfflineOriginalEvidence(copy), invalid);
    (input as any).candidate.attempts[0].row.decision_reason = "changed";
    (input as any).providerClaims[0].attestation.evidence = "changed";
    assert.deepEqual(out.native, p);
    assert.throws(() => {
      (out.native.attempts[0]!.plan.intent as any).realmId = "999";
    }, TypeError);
    assert.equal(tables(c), before);
    assert.throws(() => c.f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });
test("CA/USD ordinary native preparation remains refused", (t) => {
  const c = journalFixture(t, "CA", false, undefined, "USD");
  assert.equal(JSON.parse(c.file.bytes).currency, "USD");
  assert.throws(() => c.approve(), { code: "JOURNAL_SOURCE" });
});
test("complete cancelled ancestors and one unknown original leaf remain exact; native projection larger than 64KiB is supported", (t) => {
  const c = setup(t, "CA", 4),
    p = native(c),
    out = read(c, inputFor(p));
  assert(Buffer.byteLength(canonical(p)) > 65536);
  assert.equal(out.native.attempts.length, 5);
  assert.equal(
    out.native.attempts.filter((a) => a.row.state === "cancelled").length,
    4,
  );
  assert.equal(
    out.native.attempts.find((a) => a.row.id === c.journal.id)!.lineage.length,
    4,
  );
  const input = inputFor(p);
  (input as any).source.attempts.pop();
  rehash(input.source);
  assert.throws(() => read(c, input), invalid);
});
for (const [name, change] of [
  [
    "currency",
    (p: any) => {
      p.currency = "USD";
    },
  ],
  [
    "org",
    (p: any) => {
      p.orgId = "foreign";
    },
  ],
  [
    "raw source",
    (p: any) => {
      p.source.file.bytes += " ";
    },
  ],
  [
    "source hash",
    (p: any) => {
      p.source.file.hash = digest("different");
    },
  ],
  [
    "realm",
    (p: any) => {
      p.attempts[0].row.realm = "98765";
    },
  ],
  [
    "binding",
    (p: any) => {
      p.attempts[0].row.binding_id = "foreign";
    },
  ],
  [
    "request reference",
    (p: any) => {
      p.attempts[0].references[0].request_ref = "DJ-000000000000000000";
    },
  ],
  [
    "permission",
    (p: any) => {
      p.attempts[0].permission.authority.realm = "98765";
    },
  ],
  [
    "plan",
    (p: any) => {
      p.attempts[0].plan.input.reason += "changed";
    },
  ],
  [
    "history",
    (p: any) => {
      p.attempts[0].history = [];
    },
  ],
  [
    "extra nested fields",
    (p: any) => {
      p.packet.extra = true;
    },
  ],
  [
    "hold",
    (p: any) => {
      p.hold.snapshot_hash = digest("other hold");
    },
  ],
] as const)
  test(`even matching self-rehashed source/candidate ${name} forgeries fail actual owner comparison`, (t) => {
    const c = setup(t),
      input = inputFor(native(c));
    change(input.source);
    rehash(input.source);
    (input as any).candidate = structuredClone(input.source);
    assert.throws(() => read(c, input), invalid);
  });
test("projection hashes are recomputed; source and candidate may not differ", (t) => {
  const c = setup(t),
    input = inputFor(native(c));
  (input as any).source.hash = digest("unbound");
  assert.throws(() => read(c, input), invalid);
  const x = inputFor(native(c));
  (x as any).candidate.debit++;
  rehash(x.candidate);
  assert.throws(() => read(c, x), invalid);
});
for (const key of [
  "orgId",
  "journalId",
  "reviewHash",
  "sourceId",
  "sourceHash",
  "postingDate",
  "realm",
  "bindingId",
  "requestRef",
  "region",
  "currency",
  "debit",
  "credit",
  "historyHash",
  "intentHash",
])
  test(`exact provider assertion joins ${key}`, (t) => {
    const c = setup(t),
      input = inputFor(native(c)),
      request = input.providerClaims[0].request as any;
    request[key] =
      typeof request[key] === "number" ? request[key] + 1 : "different";
    assert.throws(() => read(c, input), invalid);
  });
for (const state of [
  "lookup-miss",
  "pending",
  "posted",
  "not-found",
  "cancelled",
])
  test(`provider ${state} is not final exact nonposting cancellation`, (t) => {
    const c = setup(t),
      input = inputFor(native(c));
    (input as any).providerClaims[0].outcome = state;
    assert.throws(() => read(c, input), invalid);
  });
for (const key of ["cancellationFinal", "nonPostingVerified", "noLaterPosting"])
  test(`${key} false refuses, true remains only an assertion`, (t) => {
    const c = setup(t),
      input = inputFor(native(c));
    (input as any).providerClaims[0].attestation[key] = false;
    assert.throws(() => read(c, input), {
      code: "JOURNAL_CANCELLATION_EVIDENCE",
    });
  });
for (const key of [
  "journalId",
  "requestRef",
  "reviewHash",
  "externalRef",
  "evidence",
])
  test(`attestation ${key} must be exact and bounded`, (t) => {
    const c = setup(t),
      input = inputFor(native(c));
    (input as any).providerClaims[0].attestation[key] =
      key === "reviewHash"
        ? digest("wrong")
        : key === "requestRef"
          ? "DJ-000000000000000000"
          : key === "journalId"
            ? "other"
            : " ";
    assert.throws(() => read(c, input));
  });
test("missing, multiple, sparse, wrong-profile, extra/missing fields and cyclic assertion structures refuse", (t) => {
  const c = setup(t);
  const changes: ((x: any) => void)[] = [
    (x) => {
      x.providerClaims = [];
    },
    (x) => {
      x.providerClaims.push(x.providerClaims[0]);
    },
    (x) => {
      delete x.providerClaims[0];
    },
    (x) => {
      x.providerClaims[0].profile = "quickbooks-production";
    },
    (x) => {
      x.providerClaims[0].extra = true;
    },
    (x) => {
      delete x.providerClaims[0].request;
    },
    (x) => {
      x.providerClaims[0].request.extra = 1;
    },
    (x) => {
      x.providerClaims[0].attestation.extra = true;
    },
    (x) => {
      x.source = x;
    },
    (x) => {
      x.extra = true;
    },
    (x) => {
      x.version = 2;
    },
    (x) => {
      x.source = null;
    },
    (x) => {
      x.providerClaims[0].attestation.evidence = "bad\0suffix";
    },
    (x) => {
      x.providerClaims[0].attestation.evidence = "\ud800";
    },
    (x) => {
      x.providerClaims[0].request.debit = Infinity;
    },
    (x) => {
      x.source.debit = -0;
    },
  ];
  for (const change of changes) {
    const x = inputFor(native(c));
    change(x);
    assert.throws(() => read(c, x));
  }
});
test("all nested proxies/revoked proxies/accessors, hidden fields, symbols and prototypes are refused with zero traps", (t) => {
  const c = setup(t),
    p = native(c);
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("trap");
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
  const revoked = Proxy.revocable([], { get: trap });
  revoked.revoke();
  const getter = Object.defineProperty({}, "field", {
    enumerable: true,
    get: trap,
  });
  const hidden = Object.defineProperty({}, "field", { value: 1 });
  for (const evil of [
    proxy,
    revoked.proxy,
    getter,
    hidden,
    { [Symbol("hidden")]: 1 },
    Object.create({}),
    new Date(),
    () => trap(),
  ]) {
    for (const path of [
      "root",
      "source",
      "candidate",
      "claim",
      "request",
      "attestation",
      "primitive",
    ]) {
      const x = inputFor(p) as any;
      if (path === "root") assert.throws(() => read(c, evil as any), invalid);
      else {
        if (path === "source" || path === "candidate") x[path] = evil;
        else if (path === "claim") x.providerClaims[0] = evil;
        else if (path === "primitive") x.providerClaims[0].request.debit = evil;
        else x.providerClaims[0][path] = evil;
        assert.throws(() => read(c, x), invalid);
      }
    }
    assert.throws(() => assertCapturedOfflineOriginalEvidence(evil), invalid);
  }
  for (const a of [
    proxy,
    revoked.proxy,
    Object.defineProperty({ ...c.reviewer }, "id", { get: trap }),
  ])
    assert.throws(() => read(c, inputFor(p), a as Actor), invalid);
  c.f.app.database.transaction(() => {
    for (const id of [
      proxy,
      revoked.proxy,
      new String(c.journal.id),
      { toString: trap },
    ])
      assert.throws(
        () =>
          comparator(c.f.app).captureInTransaction(
            c.reviewer,
            id as string,
            inputFor(p),
          ),
        invalid,
      );
  });
  assert.equal(traps, 0);
});
test("capture enforces UTF8, array, depth and aggregate bounds before owner projection reads", (t) => {
  const c = setup(t),
    p = native(c);
  const spy = t.mock.method(c.j, "readOfflineOriginalInTransaction", () => {
    throw Error("should not reach owner");
  });
  const changes: ((x: any) => void)[] = [
    (x) => {
      x.source = "界".repeat(666667);
    },
    (x) => {
      x.source = new Array(8193);
    },
    (x) => {
      let v: any = {};
      x.source = v;
      for (let i = 0; i < 66; i++) {
        v.a = {};
        v = v.a;
      }
    },
    (x) => {
      x.source = Array.from({ length: 9 }, () => "x".repeat(2_000_000));
    },
    (x) => {
      x.source = Object.fromEntries(
        Array.from({ length: 129 }, (_, i) => [`a${i}`, i]),
      );
    },
  ];
  for (const change of changes) {
    const x = inputFor(p);
    change(x);
    assert.throws(() => read(c, x), {
      code: "OFFLINE_ORIGINAL_EVIDENCE_LIMIT",
    });
  }
  assert.equal(spy.mock.callCount(), 0);
  spy.mock.restore();
});
for (const change of [
  "role='support'",
  "active=0",
  "org_id='other'",
  "account_id='buyer'",
])
  test(`fresh finance identity refuses ${change} despite forged actor grants`, (t) => {
    const c = setup(t),
      input = inputFor(native(c));
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          c.f.app.database
            .owned("iam")
            .run(`UPDATE iam_users SET ${change} WHERE id=?`, c.reviewer.id);
          comparator(c.f.app).captureInTransaction(
            { ...c.reviewer, role: "admin", accountId: null },
            c.journal.id,
            input,
          );
        }),
      { code: "FORBIDDEN" },
    );
    assert(read(c, input));
  });
test("fresh password, region, writer and actual raw hold are mandatory", (t) => {
  const c = setup(t),
    input = inputFor(native(c)),
    op = comparator(c.f.app);
  assert.throws(
    () => op.captureInTransaction(c.reviewer, c.journal.id, input),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("iam")
          .run(
            "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
            c.reviewer.id,
          );
        op.captureInTransaction(c.reviewer, c.journal.id, input);
      }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        op.captureInTransaction(c.reviewer, c.journal.id, input);
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_organizations SET region='US' WHERE id=?",
          c.reviewer.orgId,
        );
      op.captureInTransaction(c.reviewer, c.journal.id, input);
    }),
  );
  assert(read(c, input));
});
for (const sql of [
  "DELETE FROM integration_stock_journal_observations",
  "UPDATE integration_stock_journal_observations SET org_id='foreign'",
  "UPDATE integration_stock_journal_observations SET body='{}'",
  "UPDATE integration_stock_journals SET state='posted',external_id='999'",
  "DELETE FROM integration_stock_journal_references",
  "UPDATE integration_stock_journals SET lease_id='active'",
])
  test(`current retained facts recapture refuses ${sql}`, (t) => {
    const c = setup(t),
      input = inputFor(native(c));
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("integration").run(sql);
        comparator(c.f.app).captureInTransaction(
          c.reviewer,
          c.journal.id,
          input,
        );
      }),
    );
    assert(read(c, input));
  });
test("later genuine observation invalidates old assertions without normalizing history", (t) => {
  const c = setup(t),
    input = inputFor(native(c)),
    old = read(c, input);
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const lease = c.j.claim(c.f.actor, c.journal.id, "lookup")!;
  c.j.unresolved(lease, "lookup-miss");
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    old.native.hold.source_completed_at,
  );
  assert.throws(() => read(c, input), invalid);
  const fresh = read(c);
  assert.equal(fresh.native.attempts[0]!.history.length, 2);
  assert.equal(old.native.attempts[0]!.history.length, 1);
  assert.notEqual(fresh.hash, old.hash);
});
test("rollback/reopen conserve all native rows; process-local identity never replaces fresh recapture", (t) => {
  const c = setup(t),
    input = inputFor(native(c)),
    before = tables(c),
    old = read(c, input);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        comparator(c.f.app).captureInTransaction(
          c.reviewer,
          c.journal.id,
          input,
        );
        throw Error("synthetic outer rollback");
      }),
    /synthetic outer rollback/,
  );
  assert.equal(tables(c), before);
  c.f.app.close();
  c.f.app = new Application(c.f.path, "CA", { eventReports: false });
  assert.deepEqual(read(c, input), old);
  assert.equal(tables(c), before);
  assertCapturedOfflineOriginalEvidence(old); // identity is explicitly not freshness
});

test("discarded caller grants still cannot conceal executable or non-data structures", (t) => {
  const c = setup(t),
    input = inputFor(native(c));
  let traps = 0;
  const trap = () => {
    traps++;
    throw Error("trap");
  };
  const proxy = new Proxy([], {
    get: trap,
    ownKeys: trap,
    getPrototypeOf: trap,
  });
  const revoked = Proxy.revocable({}, { get: trap });
  revoked.revoke();
  for (const sites of [
    proxy,
    [revoked.proxy],
    [Object.defineProperty({}, "site", { enumerable: true, get: trap })],
    new Array(1),
  ])
    assert.throws(
      () => read(c, input, { ...c.reviewer, sites } as Actor),
      invalid,
    );
  assert.equal(traps, 0);
});
test("fresh independent permission history invalidates earlier complete projections", (t) => {
  const c = setup(t),
    input = inputFor(native(c));
  c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
  const r = c.f.app.identity.organizationResidency,
    current = r.current(c.f.actor);
  r.choose(c.f.actor, "renew", {
    region: "CA",
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: "12345",
    acknowledgment: "Synthetic renewed permission",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic finance",
      evidenceRef: "synthetic:renew",
    },
  });
  const review = c.j.permissionReview(c.f.actor, c.journal.id);
  const prepared = c.j.preparePermission(c.f.actor, "permission", {
    journalId: c.journal.id,
    reviewHash: review.journal.reviewHash,
    previousPermissionHash: review.previousPermissionHash,
    authority: review.authority,
    mode: review.mode,
    reason: "Synthetic new permission",
  });
  c.j.decidePermission(c.reviewer, "decision", {
    journalId: c.journal.id,
    permissionReviewId: prepared.id,
    permissionReviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic independent review",
  });
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    input.source.hold.source_completed_at,
  );
  assert.throws(() => read(c, input), invalid);
  const fresh = inputFor(native(c));
  const mixed = structuredClone(fresh) as any;
  mixed.source = input.source;
  assert.throws(() => read(c, mixed), invalid);
  const out = read(c, fresh);
  assert.equal(out.native.attempts[0]!.permission.reviews.length, 1);
  assert.equal(out.native.attempts[0]!.permission.mode, "lookup");
});
test("native SQL byte preflight remains before any retained Integration text materialization", (t) => {
  const c = setup(t),
    input = inputFor(native(c));
  c.f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_stock_journals SET plan=? WHERE id=?",
      "界".repeat(666667),
      c.journal.id,
    );
  const execute = c.f.app.database.execute.bind(c.f.app.database);
  let bytes = 0;
  function scan(v: unknown) {
    if (typeof v === "string") bytes += Buffer.byteLength(v);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  }
  const spy = t.mock.method(
    c.f.app.database,
    "execute",
    (
      owner: Parameters<typeof execute>[0],
      fn: Parameters<typeof execute>[1],
    ) => {
      const r = execute(owner, fn);
      if (owner === "integration") scan(r);
      return r;
    },
  );
  assert.throws(() => read(c, input), { code: "OFFLINE_ORIGINAL_LIMIT" });
  assert.equal(bytes, 0);
  spy.mock.restore();
});

test("aggregate serialized escape bytes are bounded before native recapture", (t) => {
  const c = setup(t),
    input = inputFor(native(c)) as any;
  input.source = Array.from({ length: 9 }, () => "\n".repeat(1_000_000));
  const spy = t.mock.method(c.j, "readOfflineOriginalInTransaction", () => {
    throw Error("owner must not run");
  });
  assert.throws(() => read(c, input), {
    code: "OFFLINE_ORIGINAL_EVIDENCE_LIMIT",
  });
  assert.equal(spy.mock.callCount(), 0);
  spy.mock.restore();
});
test("node budget refuses dense small primitives before owner recapture", (t) => {
  const c = setup(t),
    input = inputFor(native(c)) as any;
  input.source = Array.from({ length: 135 }, () => new Array(8192).fill(null));
  const spy = t.mock.method(c.j, "readOfflineOriginalInTransaction", () => {
    throw Error("owner must not run");
  });
  assert.throws(() => read(c, input), {
    code: "OFFLINE_ORIGINAL_EVIDENCE_LIMIT",
  });
  assert.equal(spy.mock.callCount(), 0);
  spy.mock.restore();
});
