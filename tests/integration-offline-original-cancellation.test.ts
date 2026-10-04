import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor, type Row } from "../src/server/core.ts";
import type {
  OfflineOriginalJournalReview,
  OfflineOriginalCancellationProof,
} from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
import fs from "node:fs";
import { Store } from "../src/server/database.ts";
import * as bindingFunctions from "../src/server/restore-offline-envelope.ts";
import { IntegrationOfflineOriginalCancellation } from "../src/server/integration-offline-original-cancellation.ts";
import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
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
function captured(c: F) {
  const input = inputFor(native(c));
  return c.f.app.database.transaction(() =>
    comparator(c.f.app).captureInTransaction(c.f.actor, c.journal.id, input),
  );
}
function snapshot(c: F) {
  return canonical(
    (["integration", "platform", "inventory", "billing", "iam"] as const).map(
      (owner) => {
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
      },
    ),
  );
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
function owners(c: F) {
  const a = c.f.app;
  return new IntegrationOfflineOriginalCancellation(
    a.database,
    a.identity,
    a.platform,
    a.integration.costs.journals,
  );
}
const loc = (a: Actor) => ({ id: a.id, orgId: a.orgId });
function prepared(
  t: TestContext,
  region: "CA" | "US" = "CA",
  ancestors = 0,
  afterOpen?: (c: F) => void,
) {
  const c = setup(t, region, ancestors),
    a = c.f.app;
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(c.f.path + suffix))
      fs.chmodSync(c.f.path + suffix, 0o600);
  a.database.transaction(() => {
    const { logicalHash: _, ...candidate } =
      a.database.captureRestoreCandidateInTransaction();
    const generation = parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: digest("synthetic-instance"),
      schemaVersion: SCHEMA_VERSION,
      ...candidate,
      organizations: candidate.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
    a.platform.offline.createGenerationInTransaction(generation, null, []);
    let r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "isolate", sessionId: "synthetic-original-session" },
      [],
    );
    r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "open" },
      [],
    );
    afterOpen?.(c);
  });
  const cap = captured(c);
  const envelope = a.database.transaction(() => {
    const r = a.platform.offline.readInTransaction()!,
      { version: _, schemaVersion: __, ...recovery } = r.state.generation,
      session = r.state.sessions.at(-1)!,
      candidate = a.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(c.f.path, { bigint: true });
    const target = cap.native.attempts.find((a) => a.row.id === c.journal.id)!;
    return {
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "synthetic-original-import",
      preparedBy: c.f.actor.id,
      executorId: c.reviewer.id,
      preparedAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:10:00.000Z",
      recovery,
      session: {
        id: session.id,
        revision: session.revision,
        lineageHash: session.lineageHash,
      },
      candidate: {
        logicalHash: candidate.logicalHash,
        file: { dev: Number(file.dev), ino: Number(file.ino) },
      },
      source: {
        identity: "synthetic-source",
        baseline: {
          logicalHash: digest("baseline"),
          durableCursor: "start",
          auditSequence: 0,
        },
        end: {
          logicalHash: digest("end"),
          durableCursor: "end",
          auditSequence: 1,
        },
        intervalEvidenceHash: digest("interval"),
      },
      task: {
        owner: "integration",
        name: "integration.quickbooks-original-cancelled.import",
        version: 1,
        orgId: c.f.actor.orgId,
        siteIds: [],
        subjectId: c.journal.id,
        expectedRevision: target.observations.at(-1)!.revision,
        expectedStateHash: cap.native.hash,
        payloadHash: digest(canonical(inputFor(cap.native))),
        priorClaim: null,
      },
      evidence: {
        setHash: digest("set"),
        items: [
          {
            reference: "synthetic-evidence",
            sha256: digest("bytes"),
            bytes: 1,
          },
        ],
        qualificationHash: digest("qualification"),
      },
      operations: {
        authorityId: "synthetic-operations",
        revision: 1,
        adapterIdentity: "synthetic-unqualified",
        fenceTokenHash: digest("fence"),
        observationHash: digest("observation"),
      },
      trust: {
        authorityId: "synthetic-trust",
        revision: 1,
        registryHash: digest("registry"),
      },
    };
  });
  return { ...c, cap, envelope };
}
type Prepared = ReturnType<typeof prepared>;
function apply(
  c: Prepared,
  envelope: unknown = c.envelope,
  cap: unknown = c.cap,
  e: unknown = loc(c.f.actor),
  x: unknown = loc(c.reviewer),
) {
  return c.f.app.database.transaction(() =>
    owners(c).applyInTransaction(
      e,
      x,
      envelope,
      cap,
      c.cap.claim.attestation.evidence,
    ),
  );
}
function recover(c: Prepared, record: unknown, envelope: unknown = c.envelope) {
  return c.f.app.database.transaction(() =>
    owners(c).recoverInTransaction(
      loc(c.f.actor),
      loc(c.reviewer),
      envelope,
      record,
    ),
  );
}
for (const region of ["CA", "US"] as const)
  test(`${region}: fixed native cancellation, exact task receipt and independently retained readback`, (t) => {
    const c = prepared(t, region, 1),
      before = c.cap.native,
      result = apply(c);
    frozen(result);
    assert.equal(result.status, "native-owner-application-only");
    assert.equal(result.resultHash, digest(canonical(result.record)));
    assert.equal(result.receipt.resultHash, result.resultHash);
    assert.equal(result.record.payloadHash, c.envelope.task.payloadHash);
    assert.equal(result.proof.proof.evidence.recordedBy, c.f.actor.id);
    assert.equal(result.proof.proof.cancellation.recordedBy, c.reviewer.id);
    assert.equal(
      result.proof.proof.cancellation.body.reason,
      c.cap.claim.attestation.evidence,
    );
    const target = result.proof.attempts.find(
      (a) => a.row.id === c.journal.id,
    )!;
    assert.equal(
      target.observations.length,
      before.attempts.find((a) => a.row.id === c.journal.id)!.observations
        .length + 2,
    );
    for (const key of [
      "source",
      "packet",
      "sourceReservations",
      "policies",
      "dates",
      "hold",
      "debit",
      "credit",
    ] as const)
      assert.deepEqual(result.proof[key], before[key]);
    const stable = snapshot(c);
    const retainedCopy = { ...structuredClone(result.record) };
    const recovered = recover(c, retainedCopy);
    retainedCopy.reason = "caller mutation after readback";
    assert.equal(recovered.record.reason, result.record.reason);
    frozen(recovered);
    assert.equal(recovered.status, "native-owner-recovery-consistency-only");
    assert.deepEqual(recovered.proof, result.proof);
    assert.deepEqual(recovered.receipt, result.receipt);
    assert.equal(snapshot(c), stable);
    c.f.app.database.transaction(() => {
      const s = c.f.app.database.owned("integration"),
        count = s.get("SELECT total_changes() AS n")!.n;
      owners(c).recoverInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
        result.record,
      );
      assert.equal(s.get("SELECT total_changes() AS n")!.n, count);
      assert.equal(
        c.f.app.platform.offline
          .readInTransaction()!
          .state.sessions.at(-1)!
          .history.filter((s) => s.receipt !== null).length,
        1,
      );
    });
    assert.throws(() => apply(c));
    assert.equal(snapshot(c), stable);
    c.f.app.close();
    c.f.app = new Application(c.f.path, region, { eventReports: false });
    assert.deepEqual(recover(c, result.record).proof, result.proof);
    assert.equal(snapshot(c), stable);
    assert.throws(() =>
      c.f.app.integration.costs.journals.prepareOriginalRetry(
        c.f.actor,
        "blocked",
        {
          journalId: c.journal.id,
          reviewHash: digest("x"),
          reason: "synthetic",
        },
      ),
    );
  });
test("requires actual enclosing writer for both methods", (t) => {
  const c = prepared(t),
    op = owners(c);
  assert.throws(
    () =>
      op.applyInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
        c.cap,
        c.cap.claim.attestation.evidence,
      ),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () =>
      op.recoverInTransaction(loc(c.f.actor), loc(c.reviewer), c.envelope, {}),
    { code: "TRANSACTION" },
  );
});
for (const field of [
  "subjectId",
  "orgId",
  "payloadHash",
  "expectedStateHash",
  "expectedRevision",
  "priorClaim",
  "siteIds",
  "name",
  "version",
])
  test(`envelope exact ${field} binding refuses`, (t) => {
    const c = prepared(t),
      envelope = structuredClone(c.envelope),
      task = envelope.task as Record<string, unknown>,
      before = snapshot(c);
    task[field] =
      field === "expectedRevision" || field === "version"
        ? 99
        : field === "siteIds"
          ? ["site"]
          : field === "priorClaim"
            ? {
                operationId: "x",
                tokenHash: digest("x"),
                revision: 1,
                stateHash: digest("x"),
              }
            : field.endsWith("Hash")
              ? digest("different")
              : "different";
    assert.throws(() => apply(c, envelope));
    assert.equal(snapshot(c), before);
  });
for (const field of ["preparedBy", "executorId", "requestId"])
  test(`stale envelope ${field} cannot recover a receipt`, (t) => {
    const c = prepared(t),
      result = apply(c),
      before = snapshot(c),
      envelope = { ...c.envelope, [field]: "different" };
    assert.throws(() => recover(c, result.record, envelope));
    assert.equal(snapshot(c), before);
  });
test("explicit reason must equal the signed assertion text", (t) => {
  const c = prepared(t),
    changed = inputFor(c.cap.native);
  changed.providerClaims[0].attestation.evidence =
    "Different synthetic cancellation reason";
  const cap = c.f.app.database.transaction(() =>
    comparator(c.f.app).captureInTransaction(c.f.actor, c.journal.id, changed),
  );
  const before = snapshot(c);
  assert.throws(() => apply(c, c.envelope, cap));
  assert.equal(snapshot(c), before);
});
for (const who of ["evidence", "cancellation"] as const)
  for (const change of [
    "role='support'",
    "active=0",
    "org_id='other'",
    "account_id='buyer'",
    "password",
  ])
    test(`fresh ${who} authority refuses ${change} with complete rollback`, (t) => {
      const c = prepared(t),
        actor = who === "evidence" ? c.f.actor : c.reviewer,
        before = snapshot(c);
      assert.throws(() =>
        c.f.app.database.transaction(() => {
          const s = c.f.app.database.owned("iam");
          if (change === "password")
            s.run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              actor.id,
            );
          else s.run(`UPDATE iam_users SET ${change} WHERE id=?`, actor.id);
          owners(c).applyInTransaction(
            loc(c.f.actor),
            loc(c.reviewer),
            c.envelope,
            c.cap,
            c.cap.claim.attestation.evidence,
          );
        }),
      );
      assert.equal(snapshot(c), before);
    });
test("same principal, missing raw hold and stale phase refuse without changes", (t) => {
  const c = prepared(t),
    before = snapshot(c);
  assert.throws(() =>
    apply(c, c.envelope, c.cap, loc(c.f.actor), loc(c.f.actor)),
  );
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
      owners(c).applyInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
        c.cap,
        c.cap.claim.attestation.evidence,
      );
    }),
  );
  const envelope = structuredClone(c.envelope);
  envelope.candidate.logicalHash = digest("stale");
  assert.throws(() => apply(c, envelope), {
    code: "RESTORE_OFFLINE_NATIVE_PHASE",
  });
  assert.equal(snapshot(c), before);
});
for (const variant of ["clone", "proxy", "revoked", "getter"])
  test(`capture ${variant} refuses before owner hooks or input traps`, (t) => {
    const c = prepared(t),
      before = snapshot(c);
    let hits = 0;
    const trap = () => {
      hits++;
      throw Error("trap");
    };
    const p = Proxy.revocable(c.cap, {
      get: trap,
      ownKeys: trap,
      getPrototypeOf: trap,
      getOwnPropertyDescriptor: trap,
    });
    let input: unknown = structuredClone(c.cap);
    if (variant === "proxy" || variant === "revoked") {
      input = p.proxy;
      if (variant === "revoked") p.revoke();
    }
    if (variant === "getter")
      input = {
        get native() {
          return trap();
        },
      };
    const original = c.f.app.identity.currentActor;
    c.f.app.identity.currentActor = () => {
      hits++;
      throw Error("owner hook");
    };
    try {
      assert.throws(() => apply(c, c.envelope, input), {
        code: "OFFLINE_ORIGINAL_EVIDENCE",
      });
    } finally {
      c.f.app.identity.currentActor = original;
    }
    assert.equal(hits, 0);
    assert.equal(snapshot(c), before);
  });
for (const where of ["actor", "envelope", "record"])
  test(`strict ${where}: normal/revoked proxies, getters, hidden and symbol fields never execute`, (t) => {
    const c = prepared(t),
      applied = where === "record" ? apply(c) : null,
      before = snapshot(c);
    let hits = 0;
    const trap = () => {
      hits++;
      throw Error("trap");
    };
    const good =
      where === "actor"
        ? loc(c.f.actor)
        : where === "envelope"
          ? c.envelope
          : applied!.record;
    const p = Proxy.revocable(good, {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
      }),
      revoked = Proxy.revocable(good, {});
    revoked.revoke();
    const key = Object.keys(good)[0]!;
    const getter = { ...good };
    Object.defineProperty(getter, key, { enumerable: true, get: trap });
    const hidden = { ...good };
    Object.defineProperty(hidden, "hidden", { value: "x", enumerable: false });
    const symbol = { ...good, [Symbol("extra")]: "x" };
    for (const input of [
      p.proxy,
      revoked.proxy,
      getter,
      hidden,
      symbol,
      Object.assign(Object.create({}), good),
    ]) {
      assert.throws(() =>
        where === "actor"
          ? apply(c, c.envelope, c.cap, input)
          : where === "envelope"
            ? apply(c, input)
            : recover(c, input),
      );
      assert.equal(hits, 0);
      assert.equal(snapshot(c), before);
    }
  });
for (const field of [
  "reason",
  "captureHash",
  "nativeBeforeHash",
  "nativeAfterHash",
  "auditsAfterHash",
  "phaseHash",
  "nativeJoinHash",
  "evidenceHash",
  "cancellationHash",
  "binding",
  "payloadHash",
  "evidenceActorId",
  "journalId",
])
  test(`recovery rejects altered retained preimage ${field}`, (t) => {
    const c = prepared(t),
      result = apply(c),
      before = snapshot(c);
    const r = {
      ...result.record,
      [field]:
        field.endsWith("Hash") || field === "binding"
          ? digest("different")
          : "different",
    };
    assert.throws(() => recover(c, r));
    assert.equal(snapshot(c), before);
  });
test("bounded preimage and missing preimage never infer replay permission", (t) => {
  const c = prepared(t),
    result = apply(c),
    before = snapshot(c);
  for (const reason of [
    "x".repeat(2001),
    "é".repeat(1001),
    "a\0b",
    "\ud800",
    " padded ",
  ])
    assert.throws(() => recover(c, { ...result.record, reason }));
  assert.throws(() => recover(c, undefined));
  assert.equal(snapshot(c), before);
});
for (const fault of [
  "evidence observation",
  "cancellation observation",
  "state",
  "audit",
  "receipt",
  "second authority refresh",
])
  test(`late real owner fault at ${fault} rolls back ALL writes`, (t) => {
    const c = prepared(t),
      before = snapshot(c),
      run = Store.prototype.run;
    let hit = false,
      observations = 0;
    Store.prototype.run = function (sql, ...parameters) {
      const r = run.call(this, sql, ...parameters);
      if (sql.startsWith("INSERT INTO integration_stock_journal_observations"))
        observations++;
      const fail =
        (fault === "evidence observation" &&
          observations === 1 &&
          sql.startsWith(
            "INSERT INTO integration_stock_journal_observations",
          )) ||
        (fault === "cancellation observation" &&
          observations === 2 &&
          sql.startsWith(
            "INSERT INTO integration_stock_journal_observations",
          )) ||
        (fault === "state" &&
          sql.startsWith(
            "UPDATE integration_stock_journals SET state='cancelled'",
          )) ||
        (fault === "audit" &&
          sql.startsWith("INSERT INTO platform_audit VALUES")) ||
        ((fault === "receipt" || fault === "second authority refresh") &&
          sql.startsWith("INSERT INTO platform_offline_receipts"));
      if (fail) {
        hit = true;
        if (fault === "second authority refresh")
          c.f.app.database
            .owned("iam")
            .run("UPDATE iam_users SET active=0 WHERE id=?", c.reviewer.id);
        else throw Error("synthetic late owner failure");
      }
      return r;
    };
    try {
      assert.throws(
        () => apply(c),
        fault === "second authority refresh"
          ? { code: "FORBIDDEN" }
          : /synthetic late owner failure/,
      );
    } finally {
      Store.prototype.run = run;
    }
    assert.equal(hit, true, "fault must actually occur after its native write");
    assert.equal(snapshot(c), before);
  });
test("real preexisting request collision refuses after native cancellation and rolls it back", (t) => {
  const c = prepared(t, "CA", 0, (c) => {
      const r = c.f.app.platform.offline.readInTransaction()!;
      c.f.app.platform.offline.transitionInTransaction(
        r.state.generation,
        r.anchor,
        {
          kind: "record-task",
          receipt: {
            owner: "integration",
            orgId: c.f.actor.orgId,
            taskName: "integration.quickbooks-original-cancelled.import",
            requestId: "synthetic-original-import",
            binding: digest("prior-binding"),
            payloadHash: digest("prior-payload"),
            beforeCandidateHash: digest("prior-candidate"),
            resultHash: digest("prior-result"),
          },
        },
        [],
      );
    }),
    before = snapshot(c),
    run = Store.prototype.run;
  let nativeWritten = false;
  Store.prototype.run = function (sql, ...parameters) {
    const r = run.call(this, sql, ...parameters);
    if (
      sql.startsWith("UPDATE integration_stock_journals SET state='cancelled'")
    )
      nativeWritten = true;
    return r;
  };
  try {
    assert.throws(() => apply(c), /receipt identity or binding was reused/i);
  } finally {
    Store.prototype.run = run;
  }
  assert.equal(nativeWritten, true);
  assert.equal(snapshot(c), before);
});
test("outer caller fault after exact returned receipt rolls back everything", (t) => {
  const c = prepared(t),
    before = snapshot(c);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        owners(c).applyInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          c.envelope,
          c.cap,
          c.cap.claim.attestation.evidence,
        );
        throw Error("outer rollback");
      }),
    /outer rollback/,
  );
  assert.equal(snapshot(c), before);
  assert.equal(apply(c).status, "native-owner-application-only");
});
test("explicit reason refuses unbound, oversized and trapped primitive inputs before hooks", (t) => {
  const c = prepared(t),
    before = snapshot(c);
  let hits = 0;
  const p = Proxy.revocable(
      {},
      {
        get() {
          hits++;
          throw Error("trap");
        },
      },
    ),
    q = Proxy.revocable({}, {});
  q.revoke();
  const original = c.f.app.identity.currentActor;
  for (const reason of [
    p.proxy,
    q.proxy,
    "é".repeat(1001),
    "a\0b",
    {
      toString() {
        hits++;
        return "x";
      },
    },
  ]) {
    c.f.app.identity.currentActor = () => {
      hits++;
      throw Error("hook");
    };
    try {
      assert.throws(
        () =>
          c.f.app.database.transaction(() =>
            owners(c).applyInTransaction(
              loc(c.f.actor),
              loc(c.reviewer),
              c.envelope,
              c.cap,
              reason,
            ),
          ),
        { code: "OFFLINE_ORIGINAL_CANCELLATION_TASK" },
      );
    } finally {
      c.f.app.identity.currentActor = original;
    }
    assert.equal(hits, 0);
  }
  assert.throws(() =>
    c.f.app.database.transaction(() =>
      owners(c).applyInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
        c.cap,
        "Unbound reason",
      ),
    ),
  );
  assert.equal(snapshot(c), before);
});
for (const sql of [
  "DELETE FROM integration_stock_journal_observations WHERE revision=2",
  "UPDATE integration_stock_journal_observations SET body='{}' WHERE revision=3",
  "UPDATE integration_stock_journal_observations SET org_id='foreign' WHERE revision=2",
  "UPDATE integration_stock_journal_observations SET recorded_by='different' WHERE revision=2",
  "DELETE FROM integration_stock_journal_references",
  "UPDATE integration_stock_journals SET lease_id='active'",
  "UPDATE integration_stock_journals SET external_id='posted'",
  "UPDATE integration_stock_journals SET state='unknown'",
])
  test(`recovery independently refuses owner corruption: ${sql}`, (t) => {
    const c = prepared(t),
      result = apply(c),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("integration").run(sql);
        owners(c).recoverInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          c.envelope,
          result.record,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
for (const sql of [
  "UPDATE platform_audit SET detail='{}' WHERE action='accounting.journal.observed'",
  "UPDATE platform_audit SET actor_id='different' WHERE action='accounting.journal.observed'",
  "DELETE FROM platform_audit_order WHERE audit_id IN (SELECT id FROM platform_audit WHERE action='accounting.journal.observed')",
  "UPDATE platform_audit_order SET org_id='foreign'",
  "DELETE FROM platform_recovery",
  "UPDATE platform_offline_head SET state='{}'",
])
  test(`recovery independently refuses Platform corruption: ${sql}`, (t) => {
    const c = prepared(t),
      result = apply(c),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned("platform").run(sql);
        owners(c).recoverInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          c.envelope,
          result.record,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
for (const who of ["evidence", "cancellation"] as const)
  test(`retained recovery refreshes current ${who} principal`, (t) => {
    const c = prepared(t),
      result = apply(c),
      before = snapshot(c);
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          c.f.app.database
            .owned("iam")
            .run(
              "UPDATE iam_users SET active=0 WHERE id=?",
              who === "evidence" ? c.f.actor.id : c.reviewer.id,
            );
          owners(c).recoverInTransaction(
            loc(c.f.actor),
            loc(c.reviewer),
            c.envelope,
            result.record,
          );
        }),
      { code: "FORBIDDEN" },
    );
    assert.equal(snapshot(c), before);
  });
test("missing task receipt never authorizes replay of an ordinary native cancellation", (t) => {
  const c = prepared(t);
  const proof = c.f.app.database.transaction(() =>
    c.j.applyOfflineOriginalCancellationInTransaction(
      c.f.actor,
      c.reviewer,
      c.cap,
      c.cap.claim.attestation.evidence,
    ),
  );
  const record = {
    version: 1,
    purpose: "distributor-integration-offline-original-cancellation-result-v1",
    status: "native-owner-only",
    reason: c.cap.claim.attestation.evidence,
    requestId: c.envelope.requestId,
    orgId: c.f.actor.orgId,
    journalId: c.journal.id,
    evidenceActorId: c.f.actor.id,
    cancellationActorId: c.reviewer.id,
    binding: digest("unknown"),
    payloadHash: c.envelope.task.payloadHash,
    nativeBeforeHash: c.cap.native.hash,
    captureHash: c.cap.hash,
    nativeJoinHash: digest("unknown"),
    phaseHash: digest("unknown"),
    evidenceHash: proof.proof.evidence.evidenceHash,
    cancellationHash: proof.proof.cancellation.hash,
    nativeAfterHash: proof.hash,
    auditsAfterHash: digest("unknown"),
  };
  const { offlineTaskBinding } = bindingFunctions;
  record.binding = offlineTaskBinding(c.envelope);
  const before = snapshot(c);
  assert.throws(() => recover(c, record));
  assert.throws(() => apply(c));
  assert.equal(snapshot(c), before);
});
for (const [owner, sql] of [
  ["integration", "UPDATE integration_stock_journals SET plan='{}'"],
  ["integration", "DELETE FROM integration_stock_journal_references"],
  [
    "platform",
    "UPDATE platform_audit SET detail='{}' WHERE action='accounting.journal.observed'",
  ],
] as const)
  test(`fresh join refuses ${owner} corruption even with current candidate digest`, (t) => {
    const c = prepared(t),
      before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned(owner).run(sql);
        const e = structuredClone(c.envelope);
        e.candidate.logicalHash =
          c.f.app.database.captureRestoreCandidateInTransaction().logicalHash;
        owners(c).applyInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          e,
          c.cap,
          c.cap.claim.attestation.evidence,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
test("bounded Platform audit preflight refuses UTF-8 excess before selecting text", (t) => {
  const c = prepared(t),
    result = apply(c),
    before = snapshot(c),
    all = Store.prototype.all;
  let materialized = false;
  Store.prototype.all = function <T extends Row = Row>(
    this: Store,
    sql: string,
    ...args: SQLInputValue[]
  ): T[] {
    if (sql.startsWith("SELECT a.id,a.org_id,a.actor_id,a.action"))
      materialized = true;
    return all.call(this, sql, ...args) as T[];
  };
  try {
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          c.f.app.database
            .owned("platform")
            .run(
              "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.observed'",
              "é".repeat(32769),
            );
          owners(c).recoverInTransaction(
            loc(c.f.actor),
            loc(c.reviewer),
            c.envelope,
            result.record,
          );
        }),
      { code: "OFFLINE_ORIGINAL_AUDIT" },
    );
  } finally {
    Store.prototype.all = all;
  }
  assert.equal(materialized, false);
  assert.equal(snapshot(c), before);
});
test("retained readback rejects additional observation audits instead of filtering away history", (t) => {
  const c = prepared(t),
    result = apply(c),
    before = snapshot(c);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.f.app.platform.audit(
        c.f.actor,
        "accounting.journal.observed",
        c.journal.id,
        {
          revision: result.proof.proof.cancellation.revision,
          hash: result.record.cancellationHash,
        },
      );
      owners(c).recoverInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
        result.record,
      );
    }),
  );
  assert.equal(snapshot(c), before);
});
