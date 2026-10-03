import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import {
  parseOfflineRecoveryGeneration,
  type OfflinePhaseTransition,
} from "../src/server/restore-offline-phase.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
  type OfflineTaskEnvelopeV1,
} from "../src/server/restore-offline-envelope.ts";
import {
  RestoreOfflineCommitGuard,
  type OfflineCommitHost,
} from "../src/server/restore-offline-commit-guard.ts";
import { fixture } from "./fixtures.ts";
const h = (s: string) => digest(`synthetic-commit-recovery:${s}`);
const refusal = {
  code: "RESTORE_OFFLINE_COMMIT_RECOVERY",
  message: "Exact offline task receipt recovery refused.",
};
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  reports = false,
  phase: "absent" | "generation" | "isolated" | "open" = "open",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(h("snapshot"), "2026-10-01T00:00:00.000Z"),
  );
  const generation = () => {
    const { logicalHash: _logical, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    return parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: h("instance"),
      schemaVersion: SCHEMA_VERSION,
      ...candidate,
      organizations: candidate.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
  };
  const advance = (op: OfflinePhaseTransition) =>
    f.app.database.transaction(() => {
      const s = f.app.platform.offline.readInTransaction()!;
      return f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        op,
        s.state.releases,
      );
    });
  if (phase !== "absent")
    f.app.database.transaction(() =>
      f.app.platform.offline.createGenerationInTransaction(
        generation(),
        null,
        [],
      ),
    );
  if (phase === "isolated" || phase === "open")
    advance({ kind: "isolate", sessionId: "synthetic-session" });
  if (phase === "open") advance({ kind: "open" });
  const envelope = () =>
    f.app.database.transaction(() => {
      const state = f.app.platform.offline.readInTransaction(),
        g = state?.state.generation ?? generation();
      const {
        version: _version,
        schemaVersion: _schemaVersion,
        ...recovery
      } = g;
      const s = state?.state.sessions.at(-1),
        candidate = f.app.database.captureRestoreCandidateInTransaction(),
        file = fs.lstatSync(f.path, { bigint: true });
      assert.ok(
        file.dev <= BigInt(Number.MAX_SAFE_INTEGER) &&
          file.ino <= BigInt(Number.MAX_SAFE_INTEGER),
      );
      return {
        version: 1,
        purpose: "distributor-restore-offline-task-v1",
        requestId: "synthetic-request",
        preparedBy: "synthetic-external-preparer",
        executorId: "synthetic-external-executor",
        preparedAt: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-01T00:10:00.000Z",
        recovery: structuredClone(recovery),
        session: {
          id: s?.id ?? "absent",
          revision: s?.revision ?? 0,
          lineageHash: s?.lineageHash ?? h("absent"),
        },
        candidate: {
          logicalHash: candidate.logicalHash,
          file: { dev: Number(file.dev), ino: Number(file.ino) },
        },
        source: {
          identity: "synthetic-source",
          baseline: {
            logicalHash: h("baseline"),
            durableCursor: "synthetic-start",
            auditSequence: 0,
          },
          end: {
            logicalHash: h("end"),
            durableCursor: "synthetic-end",
            auditSequence: 1,
          },
          intervalEvidenceHash: h("interval"),
        },
        task: {
          name: "synthetic.unknown-task",
          version: 1,
          owner: "synthetic-owner",
          orgId: f.actor.orgId,
          siteIds: [f.w1],
          subjectId: "synthetic-sensitive-subject",
          expectedRevision: 0,
          expectedStateHash: h("state"),
          payloadHash: h("payload"),
          priorClaim: null,
        },
        evidence: {
          setHash: h("set"),
          items: [
            {
              reference: "synthetic-private-evidence",
              sha256: h("bytes"),
              bytes: 1,
            },
          ],
          qualificationHash: h("qualification"),
        },
        operations: {
          authorityId: "synthetic-operations",
          revision: 1,
          adapterIdentity: "synthetic-unqualified-adapter",
          fenceTokenHash: h("fence"),
          observationHash: h("observation"),
        },
        trust: {
          authorityId: "synthetic-trust",
          revision: 1,
          registryHash: h("registry"),
        },
      };
    });
  return Object.assign(f, { envelope, advance });
}
type Fixture = ReturnType<typeof setup>;
function receipt(f: Fixture, envelope: OfflineTaskEnvelopeV1) {
  f.app.database.requireTransaction();
  const s = f.app.platform.offline.readInTransaction()!;
  f.app.platform.offline.transitionInTransaction(
    s.state.generation,
    s.anchor,
    {
      kind: "record-task",
      receipt: {
        owner: envelope.task.owner,
        orgId: envelope.task.orgId,
        taskName: envelope.task.name,
        requestId: envelope.requestId,
        binding: offlineTaskBinding(envelope),
        payloadHash: envelope.task.payloadHash,
        beforeCandidateHash: envelope.candidate.logicalHash,
        resultHash: h("result"),
      },
    },
    [],
  );
}
function head(f: Fixture) {
  return f.app.database.transaction(() =>
    f.app.platform.offline.readInTransaction(),
  );
}
type MutableHost = {
  -readonly [K in keyof OfflineCommitHost]: OfflineCommitHost[K];
};
function host(f: Fixture): MutableHost {
  let holding = false;
  return {
    task: {
      owner: "synthetic-owner",
      name: "synthetic.unknown-task",
      version: 1,
    },
    adapter: {
      identity: "synthetic-unqualified-adapter",
      hold(_request, commit) {
        assert.equal(holding, false);
        holding = true;
        try {
          commit();
        } finally {
          holding = false;
        }
      },
      assertHeld() {
        assert.equal(holding, true);
      },
    },
    operation(envelope, phase) {
      assert.equal(phase.envelopeBinding, offlineTaskBinding(envelope));
      receipt(f, envelope);
    },
  };
}
function guard(f: Fixture, h: OfflineCommitHost = host(f)) {
  return new RestoreOfflineCommitGuard(f.app.database, f.app.platform, h);
}

function recover(f: Fixture, input: unknown, actor = f.actor) {
  return f.app.database.transaction(() =>
    f.app.restoreOfflineCommitRecovery.getInTransaction(actor, input),
  );
}
function tables(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .map((row) => [
          row.name,
          db
            .prepare(
              `SELECT * FROM "${String(row.name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
    );
  } finally {
    db.close();
  }
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const) {
  for (const reports of [false, true]) {
    test(`${region}/${currency}/${reports}: recover durable lost response after reopen without reapplying task`, (t) => {
      const f = setup(t, region, reports, "open", currency);
      const input = f.envelope();
      const config = host(f);
      const hold = config.adapter.hold;
      config.adapter = {
        ...config.adapter,
        hold(request, commit) {
          hold(request, commit);
          throw new Error("synthetic lost response after COMMIT");
        },
      };
      const committed = guard(f, config).execute(input);
      assert.equal(committed.status, "committed-recovery-required");
      assert.throws(
        () =>
          f.app.database.transaction(() =>
            f.app.restoreOfflineNativePhase.reviewInTransaction(input),
          ),
        { code: "RESTORE_OFFLINE_NATIVE_PHASE" },
      );
      const before = tables(f.path);
      f.app.close();
      f.app = new Application(f.path, region, { eventReports: reports });
      const found = recover(f, input);
      assert.equal(found.status, "retained-task-receipt-consistency-only");
      assert.equal(found.receipt?.resultHash, committed.resultHash);
      assert.equal(found.envelopeBinding, committed.envelopeBinding);
      assert.equal(
        found.receipt?.beforeCandidateHash,
        input.candidate.logicalHash,
      );
      assert.equal(found.session.revision, input.session.revision + 1);
      assert.ok(
        Object.isFrozen(found) &&
          Object.isFrozen(found.receipt) &&
          Object.isFrozen(found.requiredChecks) &&
          Object.isFrozen(found.storage) &&
          Object.isFrozen(found.session),
      );
      assert.deepEqual(recover(f, input), found);
      assert.equal(tables(f.path), before);
    });
  }
}
test("absence is a historical classification, never a retry or execution permit", (t) => {
  const f = setup(t);
  const input = f.envelope();
  const before = tables(f.path);
  const found = recover(f, input);
  assert.equal(found.status, "no-retained-task-receipt");
  assert.equal(found.receipt, null);
  assert.ok(
    found.requiredChecks.includes(
      "separate-current-execution-or-release-permit",
    ),
  );
  assert.equal(tables(f.path), before);
});
test("later tasks and orderly phase closure preserve the exact earlier receipt", (t) => {
  const f = setup(t);
  const input = f.envelope();
  const first = guard(f).execute(input);
  const next = { ...f.envelope(), requestId: "synthetic-later-task" };
  guard(f).execute(next);
  f.advance({ kind: "drain" });
  f.advance({ kind: "close" });
  const found = recover(f, input);
  assert.equal(found.receipt?.resultHash, first.resultHash);
  assert.equal(found.receipt?.requestId, input.requestId);
  assert.equal(found.session.revision, input.session.revision + 4);
});
for (const field of [
  "request",
  "payload",
  "beforeHash",
  "session",
  "lineage",
  "generation",
  "file",
  "task",
  "evidence",
] as const) {
  test(`exact recovery refuses substituted ${field} without native changes`, (t) => {
    const f = setup(t);
    const input = f.envelope();
    guard(f).execute(input);
    const altered = structuredClone(input);
    switch (field) {
      case "request":
        altered.requestId = "synthetic-other-request";
        break;
      case "payload":
        altered.task.payloadHash = h("other-payload");
        break;
      case "beforeHash":
        altered.candidate.logicalHash = h("other-candidate");
        break;
      case "session":
        altered.session.id = "synthetic-other-session";
        break;
      case "lineage":
        altered.session.lineageHash = h("other-lineage");
        break;
      case "generation":
        altered.recovery.instanceId = h("other-instance");
        break;
      case "file":
        altered.candidate.file.ino += 1;
        break;
      case "task":
        altered.task.name = "synthetic.other-task";
        break;
      case "evidence":
        altered.evidence.qualificationHash = h("other-qualification");
        break;
    }
    const before = tables(f.path);
    if (field === "request" || field === "task") {
      // Different request identity has no matching historical receipt; it is
      // explicitly NOT a safe-to-retry or task execution decision.
      assert.equal(recover(f, altered).status, "no-retained-task-receipt");
    } else assert.throws(() => recover(f, altered), refusal);
    assert.equal(tables(f.path), before);
  });
}
test("fresh native IAM refuses stale role, inactive user, password change and cross-org actors", (t) => {
  const f = setup(t);
  const input = f.envelope();
  guard(f).execute(input);
  const db = new DatabaseSync(f.path);
  try {
    for (const sql of [
      "UPDATE iam_users SET role='warehouse' WHERE id=?",
      "UPDATE iam_users SET active=0 WHERE id=?",
    ]) {
      db.prepare(sql).run(f.actor.id);
      assert.throws(() => recover(f, input), refusal);
      db.prepare("UPDATE iam_users SET role='admin',active=1 WHERE id=?").run(
        f.actor.id,
      );
    }
    db.prepare(
      "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    ).run(f.actor.id);
    assert.throws(() => recover(f, input), refusal);
    db.prepare(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    ).run(f.actor.id);
    assert.throws(
      () => recover(f, input, { ...f.actor, orgId: "synthetic-other-org" }),
      refusal,
    );
    assert.equal(
      recover(f, input).status,
      "retained-task-receipt-consistency-only",
    );
  } finally {
    db.close();
  }
});
for (const damage of ["receipt", "journal", "head"] as const) {
  test(`complete retained storage refuses ${damage} corruption`, (t) => {
    const f = setup(t);
    const input = f.envelope();
    guard(f).execute(input);
    const db = new DatabaseSync(f.path);
    try {
      const table = `platform_offline_${damage === "receipt" ? "receipts" : damage}`;
      for (const row of db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?",
        )
        .all(table))
        db.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`);
      db.exec(
        damage === "receipt"
          ? "DELETE FROM platform_offline_receipts"
          : damage === "journal"
            ? "UPDATE platform_offline_journal SET hash='0000000000000000000000000000000000000000000000000000000000000000' WHERE revision=1"
            : "UPDATE platform_offline_head SET state_hash='0000000000000000000000000000000000000000000000000000000000000000'",
      );
      const before = tables(f.path);
      assert.throws(() => recover(f, input), refusal);
      assert.equal(tables(f.path), before);
    } finally {
      db.close();
    }
  });
}
test("rollback leaves no durable task receipt and reader performs no writes", (t) => {
  const f = setup(t);
  const input = f.envelope();
  const config = host(f);
  config.operation = (e) => {
    receipt(f, e);
    throw new Error("synthetic owner rollback");
  };
  assert.throws(() => guard(f, config).execute(input), {
    code: "RESTORE_OFFLINE_COMMIT_GUARD",
  });
  const before = tables(f.path);
  assert.equal(recover(f, input).receipt, null);
  assert.equal(tables(f.path), before);
});
test("transaction required; hostile data accessors are never evaluated", (t) => {
  const f = setup(t);
  const input = f.envelope();
  assert.throws(
    () => f.app.restoreOfflineCommitRecovery.getInTransaction(f.actor, input),
    { code: "TRANSACTION" },
  );
  let calls = 0;
  Object.defineProperty(input, "requestId", {
    get() {
      calls++;
      throw new Error("private secret");
    },
    enumerable: true,
  });
  assert.throws(() => recover(f, input), refusal);
  assert.equal(calls, 0);
});

test("same native connection refuses swapped candidate pathname even with a forged new inode", (t) => {
  const f = setup(t);
  const input = f.envelope();
  guard(f).execute(input);
  const other = f.path + ".substitute";
  const original = f.path + ".original";
  fs.copyFileSync(f.path, other);
  fs.renameSync(f.path, original);
  fs.renameSync(other, f.path);
  try {
    const substituted = structuredClone(input);
    const file = fs.lstatSync(f.path, { bigint: true });
    substituted.candidate.file = {
      dev: Number(file.dev),
      ino: Number(file.ino),
    };
    assert.throws(() => recover(f, input));
    assert.throws(() => recover(f, substituted));
  } finally {
    fs.renameSync(f.path, other);
    fs.renameSync(original, f.path);
    fs.unlinkSync(other);
  }
});
test("new restore hold refuses obsolete generation rather than treating absence as retryable", (t) => {
  const f = setup(t);
  const input = f.envelope();
  guard(f).execute(input);
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(
      h("new-snapshot"),
      "2026-10-02T00:00:00.000Z",
    ),
  );
  const before = tables(f.path);
  assert.throws(() => recover(f, input), refusal);
  assert.equal(tables(f.path), before);
});

test("receipt in a later session cannot satisfy the original pre-commit lineage", (t) => {
  const f = setup(t);
  const input = f.envelope();
  guard(f).execute({ ...input, requestId: "synthetic-earlier-different-task" });
  f.app.database.transaction(() => receipt(f, parseOfflineTaskEnvelope(input)));
  const before = tables(f.path);
  assert.throws(() => recover(f, input), refusal);
  assert.equal(tables(f.path), before);
});
test("a later open session preserves earlier exact historical receipt without changing authorization", (t) => {
  const f = setup(t);
  const input = f.envelope();
  guard(f).execute(input);
  f.advance({ kind: "drain" });
  f.advance({ kind: "close" });
  f.advance({ kind: "isolate", sessionId: "synthetic-second-session" });
  f.advance({ kind: "open" });
  const before = tables(f.path);
  const found = recover(f, input);
  assert.equal(found.status, "retained-task-receipt-consistency-only");
  assert.equal(found.session.id, input.session.id);
  assert.ok(
    found.requiredChecks.includes(
      "separate-current-execution-or-release-permit",
    ),
  );
  assert.equal(tables(f.path), before);
});
