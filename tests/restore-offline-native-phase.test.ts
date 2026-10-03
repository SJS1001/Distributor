import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { Database } from "../src/server/database.ts";
import { Platform } from "../src/server/platform.ts";
import { canonical, digest } from "../src/server/core.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import {
  parseOfflineRecoveryGeneration,
  type OfflinePhaseTransition,
} from "../src/server/restore-offline-phase.ts";
import { offlineTaskBinding } from "../src/server/restore-offline-envelope.ts";
import { RestoreOfflineNativePhase } from "../src/server/restore-offline-native-phase.ts";
import { fixture } from "./fixtures.ts";

const h = (s: string) => digest(`synthetic-native-phase:${s}`);
const refusal = {
  code: "RESTORE_OFFLINE_NATIVE_PHASE",
  message: "Offline envelope does not match the current native open phase.",
};
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  reports = false,
  phase: "absent" | "generation" | "isolated" | "open" = "open",
) {
  const f = fixture(t, { eventReports: reports }, region);
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
  const review = (input: unknown) =>
    f.app.database.transaction(() =>
      f.app.restoreOfflineNativePhase.reviewInTransaction(input),
    );
  return Object.assign(f, { envelope, review, advance });
}
function fingerprint(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
      )
      .all();
    return digest(
      canonical(
        tables.map((t) => [
          t.name,
          db
            .prepare(
              `SELECT * FROM "${String(t.name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
      ),
    );
  } finally {
    db.close();
  }
}
function totalChanges(db: Database) {
  return db.owned("platform").get("SELECT total_changes() AS n")!.n;
}
function rejectUnchanged(f: ReturnType<typeof setup>, input: unknown) {
  const before = fingerprint(f.path),
    changes = totalChanges(f.app.database);
  assert.throws(() => f.review(input), refusal);
  assert.equal(totalChanges(f.app.database), changes);
  assert.equal(fingerprint(f.path), before);
}
function receipt(f: ReturnType<typeof setup>) {
  return {
    owner: "synthetic-owner",
    orgId: f.actor.orgId,
    taskName: "synthetic.record",
    requestId: "synthetic-other",
    binding: h("task"),
    payloadHash: h("payload"),
    beforeCandidateHash: h("before"),
    resultHash: h("result"),
  };
}
function putRelease(app: Application, points: [string, string][]) {
  const history = points.map(([state, phase], i) => ({
    state,
    phase,
    at: 1000 + i,
  }));
  const r = {
    version: 1,
    id: "synthetic-release",
    binding: h("release"),
    revision: history.length,
    ...history.at(-1)!,
    history,
  };
  const record = canonical(r);
  app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
      r.id,
      r.state!,
      r.revision,
      record,
      digest(record),
    );
}

for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`${region}/${reports}: actual OPEN phase matches complete candidate without writes, authority or raw output`, (t) => {
      const f = setup(t, region, reports),
        input = f.envelope(),
        before = fingerprint(f.path),
        changes = totalChanges(f.app.database);
      const r = f.review(input);
      assert.equal(r.status, "native-phase-consistency-only");
      assert.equal(r.envelopeBinding, offlineTaskBinding(input));
      assert.equal(r.candidateHash, input.candidate.logicalHash);
      assert.equal(r.session.revision, input.session.revision);
      assert.equal(r.session.lineageHash, input.session.lineageHash);
      assert.ok(
        Object.isFrozen(r) &&
          Object.isFrozen(r.storage) &&
          Object.isFrozen(r.session) &&
          Object.isFrozen(r.requiredChecks),
      );
      assert.deepEqual(
        Object.keys(r).sort(),
        [
          "version",
          "status",
          "envelopeBinding",
          "candidateHash",
          "storage",
          "session",
          "requiredChecks",
        ].sort(),
      );
      for (const secret of [
        f.path,
        input.preparedBy,
        input.executorId,
        input.task.orgId,
        input.task.subjectId,
        input.evidence.items[0]!.reference,
      ])
        assert.equal(JSON.stringify(r).includes(secret), false);
      assert.equal(totalChanges(f.app.database), changes);
      assert.equal(fingerprint(f.path), before);
      // Historical dates and unknown task names remain structural data only.
      assert.ok(
        r.requiredChecks.includes(
          "current-signatures-clock-trust-and-revocation",
        ),
      );
      assert.ok(
        r.requiredChecks.includes(
          "static-owner-task-payload-and-claim-validation",
        ),
      );
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
      input.session.lineageHash = h("caller-mutation");
      assert.notEqual(r.session.lineageHash, input.session.lineageHash);
      rejectUnchanged(f, input);
    });

test("restart and a second real application connection read the same reviewed state", (t) => {
  const f = setup(t),
    input = f.envelope(),
    original = f.review(input);
  f.app.close();
  f.app = new Application(f.path, "CA", { eventReports: false });
  assert.deepEqual(f.review(input), original);
  const other = new Application(f.path, "CA", { eventReports: false });
  try {
    assert.deepEqual(
      other.database.transaction(() =>
        new RestoreOfflineNativePhase(
          other.database,
          other.platform,
        ).reviewInTransaction(input),
      ),
      original,
    );
  } finally {
    other.close();
  }
});

test("no writer transaction, foreign owner scope and mismatched native instances cannot supply a review", (t) => {
  const f = setup(t),
    g = setup(t),
    input = f.envelope(),
    review = new RestoreOfflineNativePhase(f.app.database, f.app.platform),
    before = fingerprint(f.path);
  assert.throws(() => review.reviewInTransaction(input), {
    code: "TRANSACTION",
  });
  f.app.database.transaction(() =>
    assert.throws(
      () =>
        f.app.database.execute("inventory", () =>
          review.reviewInTransaction(input),
        ),
      { code: "TRANSACTION" },
    ),
  );
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        new RestoreOfflineNativePhase(
          f.app.database,
          g.app.platform,
        ).reviewInTransaction(input),
      ),
    refusal,
  );
  assert.equal(fingerprint(f.path), before);
  assert.throws(
    () => new RestoreOfflineNativePhase(f.app.database, {} as Platform),
    refusal,
  );
});

for (const phase of ["absent", "generation", "isolated"] as const)
  test(`${phase}: retained OPEN session is required, without automatic initialization`, (t) => {
    const f = setup(t, "CA", false, phase);
    rejectUnchanged(f, f.envelope());
  });
for (const phase of ["draining", "closed", "invalidated"] as const)
  test(`${phase}: a previously reviewed OPEN envelope is refused`, (t) => {
    const f = setup(t),
      input = f.envelope();
    if (phase === "invalidated")
      f.advance({ kind: "invalidate", reason: "operator-abandoned" });
    else {
      f.advance({ kind: "drain" });
      if (phase === "closed") f.advance({ kind: "close" });
    }
    rejectUnchanged(f, input);
    rejectUnchanged(f, f.envelope());
  });

test("uninitialized file-less Database cannot be promoted by structural envelope data", (t) => {
  const f = setup(t),
    db = new Database(":memory:"),
    platform = new Platform(db);
  try {
    assert.throws(
      () =>
        db.transaction(() =>
          new RestoreOfflineNativePhase(db, platform).reviewInTransaction(
            f.envelope(),
          ),
        ),
      refusal,
    );
  } finally {
    db.close();
  }
});

type Envelope = ReturnType<ReturnType<typeof setup>["envelope"]>;
const changes: Record<string, (e: Envelope) => void> = {
  "session id": (e) => {
    e.session.id = "foreign-session";
  },
  "session revision": (e) => {
    e.session.revision++;
  },
  "session lineage": (e) => {
    e.session.lineageHash = h("wrong-lineage");
  },
  instance: (e) => {
    e.recovery.instanceId = h("other-instance");
  },
  snapshot: (e) => {
    e.recovery.snapshotHash = h("other-snapshot");
  },
  schema: (e) => {
    e.recovery.schemaHash = h("other-schema");
  },
  "source cutoff": (e) => {
    e.recovery.sourceCompletedAt = "2026-09-30T00:00:00.000Z";
  },
  "restored date": (e) => {
    e.recovery.restoredAt = "2026-10-01T12:00:00.000Z";
  },
  region: (e) => {
    e.recovery.region = "US";
  },
  "organization currency": (e) => {
    e.recovery.organizations = [
      ...e.recovery.organizations.map((o) => ({
        ...o,
        currency: "USD" as const,
      })),
    ];
  },
  candidate: (e) => {
    e.candidate.logicalHash = h("foreign-candidate");
  },
  device: (e) => {
    e.candidate.file.dev++;
  },
  inode: (e) => {
    e.candidate.file.ino++;
  },
};
for (const [name, change] of Object.entries(changes))
  test(`rejects ${name} mismatch with zero writes`, (t) => {
    const f = setup(t),
      input = f.envelope();
    change(input);
    rejectUnchanged(f, input);
  });

test("a newer OPEN revision defeats stale CAS; an uncommitted native row change defeats stale candidate binding", (t) => {
  const f = setup(t),
    old = f.envelope();
  f.advance({ kind: "record-task", receipt: receipt(f) });
  rejectUnchanged(f, old);
  const fresh = f.envelope();
  f.review(fresh);
  const before = fingerprint(f.path);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run(
            "UPDATE iam_organizations SET name=? WHERE id=?",
            "Synthetic changed candidate",
            f.actor.orgId,
          );
        const count = totalChanges(f.app.database);
        assert.throws(
          () =>
            new RestoreOfflineNativePhase(
              f.app.database,
              f.app.platform,
            ).reviewInTransaction(fresh),
          refusal,
        );
        assert.equal(totalChanges(f.app.database), count);
        throw Error("synthetic rollback");
      }),
    /synthetic rollback/,
  );
  assert.equal(fingerprint(f.path), before);
});

test("copied retained session is historical when the raw generation changes, even with a refreshed candidate hash", (t) => {
  const f = setup(t),
    input = f.envelope();
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(
      h("changed-hold"),
      "2026-10-02T00:00:00.000Z",
    ),
  );
  rejectUnchanged(f, input);
  const refreshed = f.envelope();
  rejectUnchanged(f, refreshed);
  f.app.database.transaction(() =>
    f.app.database.owned("platform").run("DELETE FROM platform_recovery"),
  );
  rejectUnchanged(f, refreshed);
});

const histories: [string, [string, string][]][] = [
  ["prepared", [["prepared", "prepared"]]],
  [
    "fencing",
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
    ],
  ],
  [
    "held",
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["held", "fencing"],
    ],
  ],
  [
    "superseded",
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["held", "fencing"],
      ["superseded", "superseded"],
    ],
  ],
  [
    "rolled-back",
    [
      ["prepared", "prepared"],
      ["stopping", "stopping"],
      ["returning", "returning"],
      ["rolled-back", "rolled-back"],
    ],
  ],
];
for (const [label, points] of histories)
  test(`${label}: native release history omitted from offline state still refuses; candidate hash alone cannot hide it`, (t) => {
    const f = setup(t),
      input = f.envelope();
    f.app.database.transaction(() => putRelease(f.app, points));
    if (label === "superseded" || label === "rolled-back")
      assert.equal(f.app.platform.restore.current(), null);
    assert.equal(
      f.envelope().candidate.logicalHash,
      input.candidate.logicalHash,
      "release rows are excluded from the candidate hash by the existing native contract",
    );
    const current = t.mock.method(f.app.platform.restore, "current", () => {
      throw Error("must not use filtered current release");
    });
    try {
      rejectUnchanged(f, input);
      assert.equal(current.mock.callCount(), 0);
    } finally {
      current.mock.restore();
    }
  });

test("a release appended after pinned capture is caught by the final complete history recheck", (t) => {
  const f = setup(t),
    input = f.envelope(),
    before = fingerprint(f.path),
    original = f.app.database.captureRestoreCandidateInTransaction;
  const hook = t.mock.method(
    f.app.database,
    "captureRestoreCandidateInTransaction",
    function (this: Database) {
      const result = original.call(this);
      putRelease(f.app, histories[3]![1]);
      return result;
    },
  );
  try {
    assert.throws(() => f.review(input), refusal);
    assert.equal(hook.mock.callCount(), 1);
  } finally {
    hook.mock.restore();
  }
  assert.equal(
    fingerprint(f.path),
    before,
    "outer transaction rolls back synthetic late release",
  );
});

test("strict envelopes refuse getter/proxy paths without executing traps", (t) => {
  const f = setup(t),
    valid = f.envelope();
  let traps = 0;
  const revocable = Proxy.revocable(valid, {
    get() {
      traps++;
      throw Error("trap");
    },
    ownKeys() {
      traps++;
      throw Error("trap");
    },
    getPrototypeOf() {
      traps++;
      throw Error("trap");
    },
  });
  rejectUnchanged(f, revocable.proxy);
  revocable.revoke();
  rejectUnchanged(f, revocable.proxy);
  const getter = { ...valid };
  Object.defineProperty(getter, "candidate", {
    enumerable: true,
    get() {
      traps++;
      throw Error("getter");
    },
  });
  rejectUnchanged(f, getter);
  assert.equal(traps, 0);
  rejectUnchanged(f, { ...valid, candidatePath: f.path });
});

for (const timing of ["before", "after-capture"] as const)
  test(`replacement ${timing} cannot rebind an opened native Database to copied bytes`, (t) => {
    const f = setup(t),
      input = f.envelope(),
      saved = f.path + ".original";
    const replace = () => {
      fs.renameSync(f.path, saved);
      fs.copyFileSync(saved, f.path);
      fs.chmodSync(f.path, 0o600);
    };
    const restore = () => {
      if (fs.existsSync(saved)) {
        fs.unlinkSync(f.path);
        fs.renameSync(saved, f.path);
      }
    };
    let hook: ReturnType<typeof t.mock.method> | undefined;
    if (timing === "before") {
      replace();
      const stat = fs.lstatSync(f.path, { bigint: true });
      input.candidate.file = { dev: Number(stat.dev), ino: Number(stat.ino) };
    } else {
      const original = f.app.database.captureRestoreCandidateInTransaction;
      hook = t.mock.method(
        f.app.database,
        "captureRestoreCandidateInTransaction",
        function (this: Database) {
          const result = original.call(this);
          replace();
          return result;
        },
      );
    }
    try {
      assert.throws(() => f.review(input), refusal);
    } finally {
      hook?.mock.restore();
      restore();
    }
  });

for (const field of ["dev", "ino"] as const)
  test(`unsafe bigint ${field} is refused before capture instead of rounding file identity`, (t) => {
    const f = setup(t),
      input = f.envelope(),
      original = fs.lstatSync;
    const capture = t.mock.method(
      f.app.database,
      "captureRestoreCandidateInTransaction",
      () => {
        throw Error("unsafe identity must be rejected first");
      },
    );
    const hook = t.mock.method(fs, "lstatSync", ((
      ...args: Parameters<typeof fs.lstatSync>
    ) => {
      const stat = original(...args);
      if (args[0] === f.path && (args[1] as { bigint?: boolean })?.bigint)
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
          [field]: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        });
      return stat;
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    try {
      assert.throws(() => f.review(input), refusal);
      assert.equal(capture.mock.callCount(), 0);
    } finally {
      hook.mock.restore();
      capture.mock.restore();
      syncBuiltinESMExports();
    }
  });

test("a changed native OPEN session after candidate capture cannot return the earlier lineage", (t) => {
  const f = setup(t),
    input = f.envelope(),
    before = fingerprint(f.path),
    original = f.app.database.captureRestoreCandidateInTransaction;
  const hook = t.mock.method(
    f.app.database,
    "captureRestoreCandidateInTransaction",
    function (this: Database) {
      const candidate = original.call(this);
      hook.mock.restore();
      const state = f.app.platform.offline.readInTransaction()!;
      f.app.platform.offline.transitionInTransaction(
        state.state.generation,
        state.anchor,
        { kind: "record-task", receipt: receipt(f) },
        [],
      );
      return candidate;
    },
  );
  try {
    assert.throws(() => f.review(input), refusal);
  } finally {
    hook.mock.restore();
  }
  assert.equal(fingerprint(f.path), before);
});

test("a syntactically complete foreign organization scope and an extra organization never match native generation", (t) => {
  const f = setup(t),
    input = f.envelope();
  input.recovery.organizations = [
    { id: "synthetic-foreign-org", currency: "CAD" },
  ];
  input.task.orgId = "synthetic-foreign-org";
  rejectUnchanged(f, input);
  const extra = f.envelope();
  extra.recovery.organizations = [
    ...extra.recovery.organizations,
    { id: "zz-extra-org", currency: "CAD" },
  ];
  rejectUnchanged(f, extra);
});

test("retained release corruption and missing candidate pathname are redacted with no review writes", (t) => {
  const f = setup(t),
    input = f.envelope();
  f.app.database.transaction(() => {
    putRelease(f.app, histories[3]![1]);
    f.app.database
      .owned("platform")
      .run(
        "UPDATE platform_restore_releases SET hash=?",
        h("corrupted-release"),
      );
  });
  rejectUnchanged(f, input);
  const saved = f.path + ".saved";
  fs.renameSync(f.path, saved);
  try {
    assert.throws(() => f.review(input), refusal);
  } finally {
    fs.renameSync(saved, f.path);
  }
});
