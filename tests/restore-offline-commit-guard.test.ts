import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
import {
  offlineTaskBinding,
  type OfflineTaskEnvelopeV1,
} from "../src/server/restore-offline-envelope.ts";
import {
  RestoreOfflineCommitGuard,
  type OfflineCommitHost,
  type OfflineCommitRequest,
} from "../src/server/restore-offline-commit-guard.ts";
import { fixture } from "./fixtures.ts";
const h = (s: string) => digest(`synthetic-commit-guard:${s}`);
const refusal = {
  code: "RESTORE_OFFLINE_COMMIT_GUARD",
  message:
    "Offline commit guard refused; recover by exact durable receipt if the outcome is uncertain.",
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
  return Object.assign(f, { envelope, advance });
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
function refuses(f: Fixture, run: () => unknown) {
  const before = fingerprint(f.path);
  assert.throws(run, refusal);
  assert.equal(fingerprint(f.path), before);
}

for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    test(`${region}/${reports}: real COMMIT completes under synthetic authority/source/candidate interlock`, (t) => {
      const f = setup(t, region, reports),
        input = f.envelope(),
        start = head(f)!;
      let protection = "idle",
        requestedRevocation = false,
        observedCommit = false;
      const events: string[] = [],
        configured = host(f);
      configured.adapter = {
        identity: "synthetic-unqualified-adapter",
        hold(request, commit) {
          assert.equal(request.envelopeBinding, offlineTaskBinding(input));
          assert.ok(
            Object.isFrozen(request) &&
              Object.isFrozen(request.envelope.source.end),
          );
          protection = "held";
          events.push("acquired");
          try {
            commit();
            // A different native connection sees the durable receipt BEFORE the
            // synthetic interlock releases. No callback-only savepoint illusion.
            const observer = new DatabaseSync(f.path, { readOnly: true });
            try {
              assert.equal(
                observer
                  .prepare(
                    "SELECT count(*) AS n FROM platform_offline_receipts",
                  )
                  .get()!.n,
                1,
              );
              observedCommit = true;
              events.push("commit-observed-while-held");
            } finally {
              observer.close();
            }
          } finally {
            protection = requestedRevocation ? "revoked" : "released";
            events.push("released");
          }
        },
        assertHeld() {
          assert.equal(protection, "held");
          events.push("checked");
        },
      };
      configured.operation = (e) => {
        assert.equal(protection, "held");
        requestedRevocation = true; // interlocked until the actual commit completes
        receipt(f, e);
        events.push("receipt");
      };
      const result = guard(f, configured).execute(input);
      assert.deepEqual(result, {
        version: 1,
        status: "committed",
        envelopeBinding: offlineTaskBinding(input),
        resultHash: h("result"),
      });
      assert.ok(Object.isFrozen(result));
      assert.equal(observedCommit, true);
      assert.equal(protection, "revoked");
      assert.deepEqual(events, [
        "acquired",
        "checked",
        "receipt",
        "checked",
        "commit-observed-while-held",
        "released",
      ]);
      assert.equal(head(f)!.anchor.revision, start.anchor.revision + 1);
      assert.ok(f.app.platform.recoveryHold());
      // No replay grant is returned. The old candidate/session cannot write twice.
      refuses(f, () => guard(f).execute(input));
    });

test("absent host remains disabled: no input traps, adapter work or writes", (t) => {
  const f = setup(t);
  let traps = 0;
  const input = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error("private");
      },
    },
  );
  refuses(f, () =>
    new RestoreOfflineCommitGuard(f.app.database, f.app.platform).execute(
      input,
    ),
  );
  assert.equal(traps, 0);
});

for (const field of ["authority", "source", "candidate"] as const)
  for (const boundary of ["entry", "precommit"] as const)
    test(`${field} loss at ${boundary} rolls back exact native receipt/journal`, (t) => {
      const f = setup(t),
        input = f.envelope(),
        c = host(f);
      let calls = 0;
      const resources = { authority: true, source: true, candidate: true };
      c.adapter = {
        ...c.adapter,
        assertHeld() {
          if (++calls === (boundary === "entry" ? 1 : 2))
            resources[field] = false;
          assert.ok(
            resources.authority && resources.source && resources.candidate,
            "private qualified adapter failure",
          );
        },
      };
      refuses(f, () => guard(f, c).execute(input));
      assert.equal(calls, boundary === "entry" ? 1 : 2);
    });

test("late owner exception rolls back durable head, receipt and journal; no raw error escapes", (t) => {
  const f = setup(t),
    c = host(f),
    input = f.envelope();
  c.operation = (e) => {
    receipt(f, e);
    throw Error(`private ${f.path} raw evidence`);
  };
  refuses(f, () => guard(f, c).execute(input));
});

for (const abuse of ["zero", "args", "recursive", "caught-precommit"] as const)
  test(`${abuse} callback protocol cannot mutate native storage`, (t) => {
    const f = setup(t),
      c = host(f),
      input = f.envelope();
    let saved: () => void;
    c.adapter = {
      identity: c.adapter.identity,
      assertHeld() {},
      hold(_r, run) {
        saved = run;
        if (abuse === "zero") return;
        if (abuse === "args") {
          assert.throws(
            () => (run as (...a: unknown[]) => void)(true),
            refusal,
          );
          return;
        }
        if (abuse === "caught-precommit") {
          try {
            run();
          } catch {}
          return;
        }
        run();
      },
    };
    if (abuse === "recursive")
      c.operation = (e) => {
        receipt(f, e);
        assert.throws(() => saved(), refusal);
      };
    if (abuse === "caught-precommit")
      c.operation = (e) => {
        receipt(f, e);
        throw Error("private");
      };
    refuses(f, () => guard(f, c).execute(input));
  });

for (const abuse of ["throw", "twice", "thenable", "value"] as const)
  test(`postcommit ${abuse} returns committed-recovery-required with a bounded exact receipt`, (t) => {
    const f = setup(t),
      c = host(f),
      input = f.envelope();
    let trap = 0;
    c.adapter = {
      identity: c.adapter.identity,
      assertHeld() {},
      hold(_r, run) {
        run();
        if (abuse === "throw") throw Error(`private ${f.path}`);
        if (abuse === "twice") {
          assert.throws(run, refusal);
          return;
        }
        if (abuse === "thenable")
          return {
            get then() {
              trap++;
              throw Error("private");
            },
          } as never;
        return true as never;
      },
    };
    const result = guard(f, c).execute(input);
    assert.deepEqual(result, {
      version: 1,
      status: "committed-recovery-required",
      envelopeBinding: offlineTaskBinding(input),
      resultHash: h("result"),
    });
    assert.equal(trap, 0);
    assert.ok(Object.isFrozen(result));
    const db = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM platform_offline_receipts").get()!
          .n,
        1,
      );
    } finally {
      db.close();
    }
  });

test("retained callback refuses after success, failure and during a later attempt", (t) => {
  const f = setup(t),
    input = f.envelope(),
    c = host(f);
  let saved: () => void = () => assert.fail();
  c.adapter = {
    identity: c.adapter.identity,
    assertHeld() {},
    hold(_r, run) {
      saved = run;
      run();
    },
  };
  assert.equal(guard(f, c).execute(input).status, "committed");
  refuses(f, saved);
  const old = saved,
    next = f.envelope();
  next.requestId = "second-request";
  c.operation = (e) => {
    assert.throws(old, refusal);
    receipt(f, e);
  };
  assert.equal(guard(f, c).execute(next).status, "committed");
  refuses(f, old);
  c.adapter = {
    identity: c.adapter.identity,
    assertHeld() {},
    hold(_r, run) {
      saved = run;
    },
  };
  refuses(f, () => guard(f, c).execute(f.envelope()));
  refuses(f, saved);
});

for (const other of [false, true])
  test(`reentry ${other ? "through another guard" : "on same guard"} poisons outer attempt even when caught`, (t) => {
    const f = setup(t),
      input = f.envelope(),
      c = host(f);
    let g: RestoreOfflineCommitGuard;
    c.operation = (e) => {
      receipt(f, e);
      assert.throws(() => (other ? guard(f) : g).execute(e), refusal);
    };
    g = guard(f, c);
    refuses(f, () => g.execute(input));
  });

for (const place of ["hold", "assertHeld", "operation"] as const)
  test(`async ${place} is refused at configuration without invoking it`, (t) => {
    const f = setup(t),
      c = host(f);
    let invoked = false;
    const asyncFn = async () => {
      invoked = true;
    };
    const bad =
      place === "operation"
        ? { ...c, operation: asyncFn }
        : { ...c, adapter: { ...c.adapter, [place]: asyncFn } };
    refuses(f, () => guard(f, bad));
    assert.equal(invoked, false);
  });

for (const place of ["operation", "assertHeld"] as const)
  test(`non-void/thenable ${place} refuses without reading then or retaining a permit`, (t) => {
    const f = setup(t),
      c = host(f),
      input = f.envelope();
    let traps = 0;
    const result = {
      get then() {
        traps++;
        throw Error("private");
      },
    };
    if (place === "operation")
      c.operation = (e) => {
        receipt(f, e);
        return result as never;
      };
    else
      c.adapter = {
        ...c.adapter,
        assertHeld() {
          return result as never;
        },
      };
    refuses(f, () => guard(f, c).execute(input));
    assert.equal(traps, 0);
  });

test("strict input is detached before host entry; operator callbacks/proxies/accessors never run", (t) => {
  const f = setup(t),
    c = host(f),
    input = f.envelope();
  let traps = 0,
    seen = "";
  c.adapter = {
    identity: c.adapter.identity,
    assertHeld() {},
    hold(request, run) {
      seen = request.envelope.requestId;
      input.requestId = "mutated-original";
      input.task.subjectId = "mutated";
      assert.throws(() => {
        (request.envelope.task as { subjectId: string }).subjectId = "changed";
      });
      run();
    },
  };
  const original = offlineTaskBinding(input),
    result = guard(f, c).execute(input);
  assert.equal(seen, "synthetic-request");
  assert.equal(result.envelopeBinding, original);
  const fresh = f.envelope();
  const proxy = new Proxy(fresh, {
    getPrototypeOf() {
      traps++;
      return Object.prototype;
    },
  });
  refuses(f, () => guard(f).execute(proxy));
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  refuses(f, () => guard(f).execute(revoked.proxy));
  Object.defineProperty(fresh, "source", {
    enumerable: true,
    get() {
      traps++;
      return {};
    },
  });
  refuses(f, () => guard(f).execute(fresh));
  assert.equal(traps, 0);
});

test("trusted configuration is detached and descriptor-only; supplied enabled/proof fields do not qualify", (t) => {
  const f = setup(t),
    c = host(f),
    input = f.envelope();
  let traps = 0;
  const g = guard(f, c);
  (c.task as { name: string }).name = "different";
  c.operation = () => assert.fail("mutated configuration executed");
  assert.equal(g.execute(input).status, "committed");
  const accessor = { ...host(f) };
  Object.defineProperty(accessor, "adapter", {
    get() {
      traps++;
      return {};
    },
  });
  refuses(f, () => guard(f, accessor));
  assert.equal(traps, 0);
  refuses(f, () =>
    guard(f, { ...host(f), enabled: true } as OfflineCommitHost),
  );
  refuses(f, () =>
    guard(f, {
      ...host(f),
      adapter: { ...host(f).adapter, proof: h("claimed") },
    } as OfflineCommitHost),
  );
});

for (const field of ["owner", "name", "version", "adapter"] as const)
  test(`unconfigured ${field} cannot select another host procedure`, (t) => {
    const f = setup(t),
      c = host(f),
      input = f.envelope();
    let invoked = false;
    if (field === "version") input.task.version++;
    else if (field === "adapter")
      input.operations.adapterIdentity = "different";
    else input.task[field] = "different";
    c.adapter = {
      ...c.adapter,
      hold() {
        invoked = true;
      },
    };
    refuses(f, () => guard(f, c).execute(input));
    assert.equal(invoked, false);
  });

for (const phase of ["absent", "generation", "isolated"] as const)
  test(`${phase} native phase refuses inside actual writer`, (t) => {
    const f = setup(t, "CA", false, phase),
      input = f.envelope();
    refuses(f, () => guard(f).execute(input));
  });

test("stale OPEN revision and phase drift before callback refuse before owner invocation", (t) => {
  const f = setup(t),
    input = f.envelope();
  f.advance({
    kind: "record-task",
    receipt: {
      owner: input.task.owner,
      orgId: input.task.orgId,
      taskName: input.task.name,
      requestId: "older-task",
      binding: h("older"),
      payloadHash: h("p"),
      beforeCandidateHash: h("c"),
      resultHash: h("r"),
    },
  });
  refuses(f, () => guard(f).execute(input));
  const fresh = f.envelope(),
    c = host(f);
  let owner = false;
  c.operation = () => {
    owner = true;
  };
  c.adapter = {
    identity: c.adapter.identity,
    assertHeld() {},
    hold(_r, run) {
      f.advance({ kind: "drain" });
      const drained = fingerprint(f.path);
      assert.throws(run, refusal);
      assert.equal(fingerprint(f.path), drained);
    },
  };
  assert.throws(() => guard(f, c).execute(fresh), refusal);
  assert.equal(owner, false);
});

for (const drift of [
  "no-receipt",
  "wrong-receipt",
  "extra-receipt",
  "drain",
  "generation",
] as const)
  test(`${drift} during owner operation fails exact final phase/receipt conservation`, (t) => {
    const f = setup(t),
      input = f.envelope(),
      c = host(f);
    c.operation = (e) => {
      if (drift === "no-receipt") return;
      if (drift === "wrong-receipt") {
        receipt(f, { ...e, requestId: "wrong" });
        return;
      }
      receipt(f, e);
      const s = f.app.platform.offline.readInTransaction()!;
      if (drift === "extra-receipt") receipt(f, { ...e, requestId: "another" });
      if (drift === "drain")
        f.app.platform.offline.transitionInTransaction(
          s.state.generation,
          s.anchor,
          { kind: "drain" },
          [],
        );
      if (drift === "generation")
        f.app.platform.isolateRestore(h("changed"), "2026-10-02T00:00:00.000Z");
    };
    refuses(f, () => guard(f, c).execute(input));
  });

test("changed complete candidate refuses and replaced file during operation rolls back original connection", (t) => {
  const f = setup(t),
    stale = f.envelope();
  f.app.database.transaction(() =>
    f.app.database
      .owned("iam")
      .run(
        "UPDATE iam_organizations SET name=? WHERE id=?",
        "synthetic changed",
        f.actor.orgId,
      ),
  );
  refuses(f, () => guard(f).execute(stale));
  const fresh = f.envelope(),
    c = host(f),
    moved = f.path + ".held";
  const before = fingerprint(f.path);
  c.operation = (e) => {
    receipt(f, e);
    fs.renameSync(f.path, moved);
    fs.copyFileSync(moved, f.path);
  };
  try {
    assert.throws(() => guard(f, c).execute(fresh), refusal);
  } finally {
    fs.rmSync(f.path);
    fs.renameSync(moved, f.path);
  }
  assert.equal(fingerprint(f.path), before);
});

test("nested caller transaction is refused without committing or discarding caller work", (t) => {
  const f = setup(t),
    input = f.envelope(),
    before = fingerprint(f.path);
  const c = host(f);
  let acquired = 0;
  c.adapter = {
    ...c.adapter,
    hold() {
      acquired++;
    },
  };
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database
          .owned("iam")
          .run(
            "UPDATE iam_organizations SET name=? WHERE id=?",
            "pending owner work",
            f.actor.orgId,
          );
        assert.throws(() => guard(f, c).execute(input), refusal);
        assert.equal(
          f.app.database
            .owned("iam")
            .get(
              "SELECT name FROM iam_organizations WHERE id=?",
              f.actor.orgId,
            )!.name,
          "pending owner work",
        );
        throw Error("rollback caller fixture");
      }),
    /rollback caller fixture/,
  );
  assert.equal(fingerprint(f.path), before);
  assert.equal(acquired, 0);
});

test("initialization SAVEPOINT scope is refused before adapter acquisition", (t) => {
  const f = setup(t),
    db = new Database(f.path + ".empty"),
    c = host(f);
  let acquired = 0;
  c.adapter = {
    ...c.adapter,
    hold() {
      acquired++;
    },
  };
  try {
    assert.throws(
      () =>
        db.initializeSchema("CA", false, () => {
          const platform = new Platform(db);
          assert.throws(
            () =>
              new RestoreOfflineCommitGuard(db, platform, c).execute(
                f.envelope(),
              ),
            refusal,
          );
          throw Error("end initialization fixture");
        }),
      /end initialization fixture/,
    );
    assert.equal(acquired, 0);
  } finally {
    db.close();
  }
});

test("deferred callback from a normal promise-returning adapter has no live transaction capability", async (t) => {
  const f = setup(t),
    c = host(f),
    input = f.envelope();
  let late: Promise<void> | undefined,
    attempted = false;
  c.adapter = {
    ...c.adapter,
    hold(_request, run) {
      late = Promise.resolve().then(() => {
        attempted = true;
        assert.throws(run, refusal);
      });
      return late as never;
    },
  };
  refuses(f, () => guard(f, c).execute(input));
  const before = fingerprint(f.path);
  await late;
  assert.equal(attempted, true);
  assert.equal(fingerprint(f.path), before);
});

test("committed receipt survives restart; uncertain cleanup never grants a second write", (t) => {
  const f = setup(t),
    c = host(f),
    input = f.envelope();
  c.adapter = {
    identity: c.adapter.identity,
    assertHeld() {},
    hold(_r, run) {
      run();
      throw Error("cleanup unavailable");
    },
  };
  assert.equal(
    guard(f, c).execute(input).status,
    "committed-recovery-required",
  );
  const reopened = new Application(f.path, "CA");
  try {
    const s = reopened.database.transaction(() =>
      reopened.platform.offline.readInTransaction(),
    )!;
    assert.equal(
      s.state.sessions.at(-1)!.history.at(-1)!.receipt!.binding,
      offlineTaskBinding(input),
    );
    const prior = fingerprint(f.path);
    assert.throws(
      () =>
        new RestoreOfflineCommitGuard(
          reopened.database,
          reopened.platform,
          host(f),
        ).execute(input),
      refusal,
    );
    assert.equal(fingerprint(f.path), prior);
  } finally {
    reopened.close();
  }
});

for (const terminal of ["superseded", "rolled-back"] as const)
  test(`a native ${terminal} release appended during the owner operation cannot commit`, (t) => {
    const f = setup(t),
      c = host(f),
      input = f.envelope();
    c.operation = (e) => {
      receipt(f, e);
      const history = [
        { state: "prepared", phase: "prepared", at: 1000 },
        { state: "fencing", phase: "fenceSource-intent", at: 1001 },
        { state: "held", phase: "fenceSource-held", at: 1002 },
        { state: terminal, phase: terminal, at: 1003 },
      ];
      const row = {
        version: 1,
        id: "synthetic-release",
        binding: h("release"),
        revision: history.length,
        ...history.at(-1),
        history,
      };
      const body = canonical(row);
      // Synthetic native history fixture; no control adapter or release action.
      f.app.database
        .owned("platform")
        .run(
          "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
          row.id,
          row.state!,
          row.revision,
          body,
          digest(body),
        );
      const complete =
        f.app.platform.restore.offlineReleaseHistoryInTransaction();
      assert.equal(complete.releases.length, 1);
      assert.equal(complete.classification.barrier, "control-intent-retained");
    };
    refuses(f, () => guard(f, c).execute(input));
  });
