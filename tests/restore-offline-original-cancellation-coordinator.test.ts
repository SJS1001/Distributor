import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type { OfflineOriginalJournalReview } from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import { PlatformOfflineOriginalCommandReviewReader } from "../src/server/platform-offline-original-command-review.ts";
import {
  RestoreOfflineOriginalCancellationCoordinator,
  type OfflineOriginalCancellationQualification,
  type OfflineOriginalCancellationHost,
} from "../src/server/restore-offline-original-cancellation-coordinator.ts";
import {
  offlineTaskBinding,
  offlineTaskApprovalMessage,
} from "../src/server/restore-offline-envelope.ts";
import { offlineApprovalRosterFingerprint } from "../src/server/restore-offline-approvals.ts";
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
function json(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(json).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + json(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function ready(t: TestContext, region: "CA" | "US" = "CA", ancestors = 0) {
  const f = prepared(t, region, ancestors),
    a = f.f.app;
  const commands = a.database.transaction(() =>
    new PlatformOfflineOriginalCommandReviewReader(
      a.database,
      a.identity,
      a.integration.costs.journals,
    ).getInTransaction(loc(f.f.actor) as Actor, f.journal.id),
  );
  const root = fs.mkdtempSync(join(tmpdir(), "original-coordinator-"));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from(json(inputFor(f.cap.native)));
  fs.writeFileSync(join(root, "original.json"), bytes, { mode: 0o600 });
  const items = [
    {
      reference: "original-evidence",
      sha256: digest(bytes),
      bytes: bytes.length,
    },
  ];
  const manifest = {
    version: 1,
    root,
    files: [{ reference: items[0]!.reference, path: "original.json" }],
  };
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const roster = pairs.map((p, i) => ({
    id: i === 0 ? "finance-signer" : "security-signer",
    role: i === 0 ? ("finance" as const) : ("security" as const),
    personId: "signer-person-" + i,
    publicKey: p.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }));
  const envelope = structuredClone(f.envelope);
  envelope.preparedAt = "2026-10-04T00:00:00.000Z";
  envelope.expiresAt = "2026-10-04T00:10:00.000Z";
  envelope.evidence = {
    setHash: digest(canonical(items)),
    items,
    qualificationHash: digest("synthetic-unqualified"),
  };
  envelope.trust.registryHash = offlineApprovalRosterFingerprint(roster);
  const approvals = roster.map((r, i) => ({
    signerId: r.id,
    role: r.role,
    binding: offlineTaskBinding(envelope),
    signature: sign(
      null,
      Buffer.from(offlineTaskApprovalMessage(envelope, r.id, r.role)),
      pairs[i]!.privateKey,
    ).toString("base64"),
  }));
  const qualification: OfflineOriginalCancellationQualification = {
    purpose:
      "distributor-offline-current-original-cancellation-qualification-v1",
    envelopeBinding: offlineTaskBinding(envelope),
    now: "2026-10-04T00:05:00.000Z",
    trust: envelope.trust,
    roster,
    associations: {
      preparer: { id: envelope.preparedBy, personId: "preparer-person" },
      executor: { id: envelope.executorId, personId: "executor-person" },
      operations: {
        id: envelope.operations.authorityId,
        personId: "operations-person",
      },
    },
    evidence: {
      setHash: envelope.evidence.setHash,
      qualificationHash: envelope.evidence.qualificationHash,
      payloadHash: envelope.task.payloadHash,
      captureHash: f.cap.hash,
      commandReviewHash: commands.factsHash,
      reasonHash: digest(canonical(f.cap.claim.attestation.evidence)),
      provider: "quickbooks",
      mode: "sandbox",
      subjectId: f.journal.id,
      reference: f.cap.claim.attestation.externalRef,
    },
  };
  let held = false,
    calls = 0;
  const state = {
    qualification,
    onRead: (_calls: number) => {},
    cleanupFailure: false,
    heldReads: 0,
  };
  const host: OfflineOriginalCancellationHost = {
    adapter: {
      identity: envelope.operations.adapterIdentity,
      hold(_r, commit) {
        held = true;
        try {
          commit();
        } finally {
          held = false;
        }
        if (state.cleanupFailure) throw Error("synthetic response lost");
      },
      assertHeld() {
        assert(held);
        state.heldReads++;
      },
    },
    readCurrent() {
      state.onRead(++calls);
      return state.qualification;
    },
  };
  const coordinator = new RestoreOfflineOriginalCancellationCoordinator(
    a.database,
    a.identity,
    a.integration.costs.journals,
    a.platform,
    host,
  );
  return {
    ...f,
    envelope,
    manifest,
    approvals,
    root,
    state,
    host,
    coordinator,
    commands,
    pairs,
    roster,
  };
}
type Ready = ReturnType<typeof ready>;
function rebindCandidate(f: Ready) {
  f.envelope.candidate.logicalHash = f.f.app.database.transaction(
    () => f.f.app.database.captureRestoreCandidateInTransaction().logicalHash,
  );
  const binding = offlineTaskBinding(f.envelope);
  f.approvals.forEach((approval, i) => {
    approval.binding = binding;
    approval.signature = sign(
      null,
      Buffer.from(
        offlineTaskApprovalMessage(
          f.envelope,
          approval.signerId,
          approval.role,
        ),
      ),
      f.pairs[i]!.privateKey,
    ).toString("base64");
  });
  (f.state.qualification as any).envelopeBinding = binding;
}
function execute(f: Ready) {
  return f.coordinator.execute(
    f.f.actor,
    f.reviewer,
    f.envelope,
    f.approvals,
    f.manifest,
    "original-evidence",
  );
}
for (const region of ["CA", "US"] as const)
  for (const ancestors of [0, 1])
    test(`signed native original cancellation ${region}, ${ancestors} ancestors`, (t) => {
      const f = ready(t, region, ancestors),
        result = execute(f);
      assert.equal(result.status, "committed");
      assert(f.state.heldReads >= 5);
      const proof = f.f.app.database.transaction(() => cancelledProof(f));
      assert.equal(
        proof.attempts.find((a) => a.row.id === f.journal.id)!.row.state,
        "cancelled",
      );
      assert(
        f.f.app.database.transaction(() =>
          f.f.app.platform.rawRecoveryHoldInTransaction(),
        ),
      );
      assert.throws(() => execute(f));
    });
test("missing static host stays closed", (t) => {
  const f = ready(t),
    a = f.f.app,
    before = snapshot(f);
  const c = new RestoreOfflineOriginalCancellationCoordinator(
    a.database,
    a.identity,
    a.integration.costs.journals,
    a.platform,
  );
  assert.throws(() =>
    c.execute(
      f.f.actor,
      f.reviewer,
      f.envelope,
      f.approvals,
      f.manifest,
      "original-evidence",
    ),
  );
  assert.equal(snapshot(f), before);
});
for (const field of [
  "setHash",
  "qualificationHash",
  "payloadHash",
  "captureHash",
  "commandReviewHash",
  "reasonHash",
  "subjectId",
  "reference",
  "provider",
  "mode",
] as const)
  test(`qualification ${field} mismatch refuses atomically`, (t) => {
    const f = ready(t),
      before = snapshot(f);
    (f.state.qualification.evidence as any)[field] = field.endsWith("Hash")
      ? digest("wrong")
      : "wrong";
    assert.throws(() => execute(f));
    assert.equal(snapshot(f), before);
  });
for (const late of [false, true])
  test(`current qualification changes ${late ? "after" : "before"} owner apply`, (t) => {
    const f = ready(t),
      before = snapshot(f);
    f.state.onRead = () => {
      const observations = f.f.app.database
        .owned("integration")
        .get(
          "SELECT count(*) AS n FROM integration_stock_journal_observations WHERE journal_id=?",
          f.journal.id,
        )!.n as number;
      if (late ? observations > f.envelope.task.expectedRevision : true)
        (f.state.qualification.evidence as any).captureHash = digest("revoked");
    };
    assert.throws(() => execute(f));
    assert.equal(snapshot(f), before);
  });
for (const now of [
  "2026-10-03T23:59:59.999Z",
  "2026-10-04T00:10:00.000Z",
  "invalid",
  "2026-10-04T00:05:00Z",
])
  test(`clock ${now} refuses`, (t) => {
    const f = ready(t),
      before = snapshot(f);
    (f.state.qualification as any).now = now;
    assert.throws(() => execute(f));
    assert.equal(snapshot(f), before);
  });
test("clock moves backward inside signed window", (t) => {
  const f = ready(t),
    before = snapshot(f);
  f.state.onRead = (c) => {
    (f.state.qualification as any).now =
      c === 1 ? "2026-10-04T00:05:00.000Z" : "2026-10-04T00:04:59.999Z";
  };
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
for (const principalName of ["evidence", "cancellation"] as const)
  test(`current ${principalName} grant revocation rolls back`, (t) => {
    const f = ready(t),
      before = snapshot(f);
    f.state.onRead = () => {
      const id = principalName === "evidence" ? f.f.actor.id : f.reviewer.id;
      f.f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET active=0 WHERE id=?", id);
    };
    assert.throws(() => execute(f));
    assert.equal(snapshot(f), before);
  });
test("same principal cannot supply both independent decisions", (t) => {
  const f = ready(t),
    before = snapshot(f);
  assert.throws(() =>
    f.coordinator.execute(
      f.f.actor,
      f.f.actor,
      f.envelope,
      f.approvals,
      f.manifest,
      "original-evidence",
    ),
  );
  assert.equal(f.state.heldReads, 0);
  assert.equal(snapshot(f), before);
});
for (const slot of [
  "evidence",
  "cancellation",
  "envelope",
  "approvals",
  "manifest",
  "reference",
] as const)
  test(`${slot} proxy refused before any trap or host`, (t) => {
    const f = ready(t),
      before = snapshot(f);
    let traps = 0;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error("get");
        },
        getPrototypeOf() {
          traps++;
          throw Error("proto");
        },
        ownKeys() {
          traps++;
          throw Error("keys");
        },
        getOwnPropertyDescriptor() {
          traps++;
          throw Error("descriptor");
        },
      },
    );
    const args: unknown[] = [
      f.f.actor,
      f.reviewer,
      f.envelope,
      f.approvals,
      f.manifest,
      "original-evidence",
    ];
    args[
      [
        "evidence",
        "cancellation",
        "envelope",
        "approvals",
        "manifest",
        "reference",
      ].indexOf(slot)
    ] = proxy;
    assert.throws(() =>
      f.coordinator.execute(
        ...(args as [unknown, unknown, unknown, unknown, unknown, unknown]),
      ),
    );
    assert.equal(traps, 0);
    assert.equal(f.state.heldReads, 0);
    assert.equal(snapshot(f), before);
  });
for (const key of ["x".repeat(161), "\ud800"])
  test("manifest malformed property name refused before host", (t) => {
    const f = ready(t),
      before = snapshot(f);
    (f.manifest as any)[key] = "synthetic";
    assert.throws(() => execute(f));
    assert.equal(f.state.heldReads, 0);
    assert.equal(snapshot(f), before);
  });
test("private bytes changed from signed item refuse atomically", (t) => {
  const f = ready(t),
    before = snapshot(f);
  fs.appendFileSync(join(f.root, "original.json"), " ");
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("missing ordinary decision receipt refuses before offline application", (t) => {
  const f = ready(t);
  f.f.app.database
    .owned("platform")
    .run(
      "DELETE FROM platform_commands WHERE name='accounting.journal.decide'",
    );
  const before = snapshot(f);
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("post-COMMIT cleanup failure reports recovery required with durable native application", (t) => {
  const f = ready(t);
  f.state.cleanupFailure = true;
  const result = execute(f);
  assert.equal(result.status, "committed-recovery-required");
  const proof = f.f.app.database.transaction(() => cancelledProof(f));
  assert.equal(
    proof.attempts.find((a) => a.row.id === f.journal.id)!.row.state,
    "cancelled",
  );
});

function cancelledProof(f: Ready) {
  const rows = f.f.app.database
    .owned("integration")
    .all<{ hash: string }>(
      "SELECT hash FROM integration_stock_journal_observations WHERE journal_id=? ORDER BY revision DESC LIMIT 2",
      f.journal.id,
    );
  return f.j.readOfflineOriginalCancellationInTransaction(
    f.reviewer,
    f.journal.id,
    rows[1]!.hash,
    rows[0]!.hash,
  );
}
for (const principalName of ["evidence", "cancellation"] as const)
  test(`previously revoked ${principalName} principal refuses fresh IAM`, (t) => {
    const f = ready(t),
      id = principalName === "evidence" ? f.f.actor.id : f.reviewer.id;
    f.f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET active=0 WHERE id=?", id);
    rebindCandidate(f);
    const before = snapshot(f);
    assert.throws(() => execute(f), { code: "RESTORE_OFFLINE_COMMIT_GUARD" });
    assert(f.state.heldReads > 0);
    assert.equal(snapshot(f), before);
  });
for (const ownerName of [
  "database",
  "identity",
  "journals",
  "platform",
] as const)
  test(`replaced ${ownerName} method refuses before callback and host`, (t) => {
    const f = ready(t),
      a = f.f.app;
    const owner =
      ownerName === "database"
        ? a.database
        : ownerName === "identity"
          ? a.identity
          : ownerName === "journals"
            ? a.integration.costs.journals
            : a.platform;
    const name =
      ownerName === "database"
        ? "requireTransaction"
        : ownerName === "identity"
          ? "currentActor"
          : ownerName === "journals"
            ? "readOfflineOriginalInTransaction"
            : "rawRecoveryHoldInTransaction";
    let calls = 0;
    Object.defineProperty(owner, name, {
      configurable: true,
      get() {
        calls++;
        throw Error("substituted getter");
      },
    });
    try {
      assert.throws(() => execute(f), {
        code: "RESTORE_OFFLINE_ORIGINAL_CANCELLATION_COORDINATOR",
      });
      assert.equal(calls, 0);
      assert.equal(f.state.heldReads, 0);
    } finally {
      Reflect.deleteProperty(owner, name);
    }
  });
for (const late of [false, true])
  test(`changed owner association refuses without getter execution, late=${late}`, (t) => {
    const f = ready(t),
      owner = f.f.app.identity;
    const original = Object.getOwnPropertyDescriptor(owner, "database")!;
    let calls = 0;
    const replace = () =>
      Object.defineProperty(owner, "database", {
        configurable: true,
        get() {
          calls++;
          throw Error("foreign owner association");
        },
      });
    const before = snapshot(f);
    if (late) f.state.onRead = replace;
    else replace();
    try {
      assert.throws(() => execute(f));
      assert.equal(calls, 0);
      assert.equal(snapshot(f), before);
    } finally {
      Object.defineProperty(owner, "database", original);
    }
  });
test("nested original coordinator entry poisons outer transaction even when host swallows refusal", (t) => {
  const f = ready(t),
    before = snapshot(f);
  let nested = false;
  f.state.onRead = () => {
    if (!nested) {
      nested = true;
      assert.throws(() => execute(f));
    }
  };
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("mutating caller envelope, approvals and manifest after capture cannot alter signed attempt", (t) => {
  const f = ready(t);
  f.state.onRead = (c) => {
    if (c === 1) {
      f.envelope.task.payloadHash = digest("caller mutation");
      f.approvals[0]!.signature = "wrong";
      f.manifest.root = "/nonexistent";
    }
  };
  assert.equal(execute(f).status, "committed");
});
test("bad signature refuses before any owner application", (t) => {
  const f = ready(t),
    before = snapshot(f);
  f.approvals[0]!.signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("missing decision request preimage blocks fixed coordinator without guessed historical request", (t) => {
  const f = ready(t),
    s = f.f.app.database.owned("platform");
  s.run(
    "UPDATE platform_commands SET hash=? WHERE name='accounting.journal.decide'",
    digest("unretained-raw-request"),
  );
  s.run(
    "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.decide'",
    canonical({ requestHash: digest("unretained-raw-request") }),
  );
  const commands = f.f.app.database.transaction(() =>
    new PlatformOfflineOriginalCommandReviewReader(
      f.f.app.database,
      f.f.app.identity,
      f.j,
    ).getInTransaction(loc(f.f.actor) as Actor, f.journal.id),
  );
  assert(commands.blockers.includes("DECISION_REQUEST_PREIMAGE_NOT_RETAINED"));
  (f.state.qualification.evidence as any).commandReviewHash =
    commands.factsHash;
  rebindCandidate(f);
  const before = snapshot(f);
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
