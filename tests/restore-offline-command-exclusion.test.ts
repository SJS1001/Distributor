import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import {
  parseOfflineRecoveryGeneration,
  type OfflinePhaseTransition,
} from "../src/server/restore-offline-phase.ts";
import type { OfflineStorageSnapshot } from "../src/server/restore-offline-storage.ts";
import {
  restoreApprovalMessage,
  type RestoreDossier,
} from "../src/server/restore-review.ts";
import {
  restoreReleaseApprovalMessage,
  type RestoreActivationAdapter,
  type RestoreControl,
  type RestoreReleaseInput,
  type RestoreRelease,
} from "../src/server/restore-activation.ts";
import type { RestoreEvidenceManifest } from "../src/server/restore-evidence.ts";
import { providerNames } from "../src/shared/provider-choices.ts";
import { fixture } from "./fixtures.ts";
const hash = (label: string) => digest(`synthetic-exclusion:${label}`);
function privateFiles(f: ReturnType<typeof fixture>) {
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(f.path + suffix)) chmodSync(f.path + suffix, 0o600);
}
function nativePhase(f: ReturnType<typeof fixture>) {
  const offline = f.app.platform.offline;
  const read = () =>
    f.app.database.transaction(() => offline.readInTransaction());
  const create = () =>
    f.app.database.transaction(() => {
      const { logicalHash: _logical, ...candidate } =
        f.app.database.captureRestoreCandidateInTransaction();
      const generation = parseOfflineRecoveryGeneration({
        version: 1,
        instanceId: hash("instance"),
        schemaVersion: SCHEMA_VERSION,
        ...candidate,
        organizations: candidate.organizations.map(({ id, currency }) => ({
          id,
          currency,
        })),
      });
      return offline.createGenerationInTransaction(
        generation,
        null,
        f.app.platform.restore.offlineReleaseHistoryInTransaction().releases,
      );
    });
  const step = (s: OfflineStorageSnapshot, op: OfflinePhaseTransition) =>
    f.app.database.transaction(() =>
      offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        op,
        f.app.platform.restore.offlineReleaseHistoryInTransaction().releases,
      ),
    );
  const start = () =>
    step(create(), { kind: "isolate", sessionId: "exclusion-session" });
  const open = () => step(start(), { kind: "open" });
  const close = () => step(step(open(), { kind: "drain" }), { kind: "close" });
  return { read, create, step, start, open, close };
}
function setup(t: TestContext, region: "CA" | "US" = "CA") {
  const f = fixture(t, {}, region);
  privateFiles(f);
  const saved = f.app.catalog.create(f.actor, "exclusion-cached", {
    sku: "BOUNDARY",
    name: "Synthetic boundary",
    serialized: false,
    unitPrice: 100,
    taxBasisPoints: 0,
  });
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(hash("snapshot"), "2026-10-03T00:00:00.000Z"),
  );
  return Object.assign(f, nativePhase(f), { saved });
}
function rows(f: ReturnType<typeof fixture>) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    return canonical(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
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
function command(f: ReturnType<typeof fixture>, cached = false) {
  return f.app.catalog.create(
    f.actor,
    cached ? "exclusion-cached" : "exclusion-new",
    {
      sku: cached ? "BOUNDARY" : "BOUNDARY-NEW",
      name: "Synthetic boundary",
      serialized: false,
      unitPrice: 100,
      taxBasisPoints: 0,
    },
  );
}
function refuseConserved(f: ReturnType<typeof fixture>, run: () => unknown) {
  const before = rows(f);
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  assert.equal(
    rows(f),
    before,
    "refusal must conserve every retained/native row",
  );
  assert.ok(error, "retained offline phase must refuse normal access");
  assert.ok(
    [
      "RESTORE_OFFLINE_EXCLUSION",
      "RESTORE_OFFLINE_STORAGE",
      "RESTORE_OFFLINE_PHASE",
    ].includes((error as { code?: string }).code ?? ""),
    `refusal must reach the retained phase boundary, got ${(error as { code?: string }).code}`,
  );
}
function releaseSetup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  eventReports = false,
) {
  const f = fixture(t, { eventReports }, region);
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
  const candidate = f.app.database.transaction(() =>
    f.app.database.captureRestoreCandidateInTransaction(),
  );
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

// Synthetic retained release, genuine dossier and real Ed25519 approvals. It is
// seeded as already-retained intent, not claimed as a successful prepare/release.
function retainedRelease(t: TestContext, region: "CA" | "US" = "CA") {
  const s = releaseSetup(t, region);
  const f = s.f;
  privateFiles(f);
  const stat = statSync(f.path, { bigint: true });
  const r: RestoreRelease = {
    version: 1,
    id: s.input.id,
    revision: 1,
    state: "prepared",
    phase: "prepared",
    inputHash: digest(canonical(s.input)),
    dossier: s.input.dossier,
    approvals: s.input.approvals,
    evidenceSetHash: hash("evidence-set"),
    adapter: s.adapter.identity,
    binding: hash("release-binding"),
    file: { dev: String(stat.dev), ino: String(stat.ino) },
    at: s.now(),
    history: [{ state: "prepared", phase: "prepared", at: s.now() }],
  };
  r.releaseApprovals = s.releaseApprovals(r.binding);
  const retain = () => {
    const raw = canonical(r);
    f.app.database
      .owned("platform")
      .run(
        "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
        r.id,
        r.state,
        r.revision,
        raw,
        digest(raw),
      );
  };
  return { ...s, phase: nativePhase(f), release: r, retain };
}
for (const region of ["CA", "US"] as const) {
  for (const phase of [
    "generation-only",
    "isolated",
    "open",
    "draining",
    "invalidated",
  ] as const)
    for (const cached of [false, true])
      test(`${region} ${phase} excludes ${cached ? "cached" : "new"} real Catalog command and conserves rows`, (t) => {
        const f = setup(t, region);
        if (phase === "generation-only") f.create();
        else if (phase === "isolated") f.start();
        else {
          const s = f.open();
          if (phase === "draining") f.step(s, { kind: "drain" });
          if (phase === "invalidated")
            f.step(s, { kind: "invalidate", reason: "authority-lost" });
        }
        refuseConserved(f, () => command(f, cached));
        assert.throws(() => f.app.platform.assertProviderAccess());
      });
  test(`${region} uninitialized history and valid closed phase retain ordinary command compatibility without provider rights`, (t) => {
    const f = setup(t, region);
    assert.equal(command(f, true).id, f.saved.id);
    f.close();
    assert.equal(command(f, true).id, f.saved.id);
    assert.ok(command(f).id);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });
  test(`${region} retained open exclusion survives restart on same actual storage/writer`, (t) => {
    const f = setup(t, region);
    f.open();
    f.app.close();
    f.app = new Application(f.path, region);
    refuseConserved(f, () => command(f, true));
  });
}
for (const corruption of [
  "head-json",
  "missing-head",
  "raw-generation",
  "missing-hold",
])
  test(`normal command fails closed on ${corruption} rather than treating it as empty`, (t) => {
    const f = setup(t);
    f.close();
    const p = f.app.database.owned("platform");
    if (corruption === "head-json")
      p.run("UPDATE platform_offline_head SET state='{}'");
    if (corruption === "missing-head")
      p.run("DELETE FROM platform_offline_head");
    if (corruption === "raw-generation")
      p.run("UPDATE platform_recovery SET snapshot_hash=?", hash("different"));
    if (corruption === "missing-hold") p.run("DELETE FROM platform_recovery");
    refuseConserved(f, () => command(f, true));
    assert.throws(() => f.app.platform.assertProviderAccess());
  });
test("command guard uses its fixed constructor storage despite public read-method substitution", (t) => {
  const f = setup(t);
  f.open();
  t.mock.method(f.app.platform.offline, "readInTransaction", () => null);
  refuseConserved(f, () => command(f));
});
for (const cached of [false, true])
  test(`ordinary ${cached ? "cached" : "new"} command rechecks phase after authorization callback`, (t) => {
    const f = setup(t);
    f.close();
    const before = rows(f);
    if (cached)
      f.app.platform.command(
        f.actor,
        "synthetic.callback",
        "callback-key",
        {},
        () => {},
        () => ({ id: "receipt" }),
      );
    const settled = rows(f);
    assert.throws(() =>
      f.app.platform.command(
        f.actor,
        "synthetic.callback",
        cached ? "callback-key" : "other-key",
        {},
        () => {
          const s = f.app.platform.offline.readInTransaction()!;
          f.app.platform.offline.transitionInTransaction(
            s.state.generation,
            s.anchor,
            { kind: "isolate", sessionId: "late-session" },
            [],
          );
        },
        () => ({ id: "should-not-run" }),
      ),
    );
    assert.equal(rows(f), settled);
    assert.ok(before.length);
  });
test("ordinary perform callback cannot commit a newly opened maintenance session with its command", (t) => {
  const f = setup(t);
  f.close();
  refuseConserved(f, () =>
    f.app.platform.command(
      f.actor,
      "synthetic.perform",
      "perform",
      {},
      () => {},
      () => {
        const s = f.app.platform.offline.readInTransaction()!;
        f.app.platform.offline.transitionInTransaction(
          s.state.generation,
          s.anchor,
          { kind: "isolate", sessionId: "late-perform" },
          [],
        );
        return { id: "should-not-commit" };
      },
    ),
  );
});
test("command result serialization cannot hide a newly isolated maintenance session", (t) => {
  const f = setup(t);
  f.close();
  refuseConserved(f, () =>
    f.app.platform.command(
      f.actor,
      "synthetic.serialization",
      "serialization",
      {},
      () => {},
      () => ({
        toJSON() {
          const s = f.app.platform.offline.readInTransaction()!;
          f.app.platform.offline.transitionInTransaction(
            s.state.generation,
            s.anchor,
            { kind: "isolate", sessionId: "serialization" },
            [],
          );
          return { id: "must-not-commit" };
        },
      }),
    ),
  );
});
for (const region of ["CA", "US"] as const)
  for (const method of ["prepare", "activate", "approveRelease"] as const)
    test(`${region} OPEN offline phase refuses ${method} before cached return/proof/write/control`, (t) => {
      const s = retainedRelease(t, region);
      s.phase.open();
      s.retain();
      refuseConserved(s.f, () =>
        method === "prepare"
          ? s.f.app.platform.restore.prepare(s.input)
          : method === "activate"
            ? s.f.app.platform.restore.activate(s.input)
            : s.f.app.platform.restore.approveRelease(
                s.release.id,
                s.releaseApprovals(s.release.binding),
              ),
      );
      assert.deepEqual(s.calls, []);
    });
for (const method of ["fence", "routeCandidate", "routeSource"] as const)
  test(`actual retained release control ${method} refuses active maintenance before adapter IO`, (t) => {
    const s = retainedRelease(t);
    s.phase.open();
    s.retain();
    refuseConserved(s.f, () =>
      (
        s.f.app.platform.restore as unknown as {
          call(method: string, release: RestoreRelease): void;
        }
      ).call(method, s.release),
    );
    assert.deepEqual(s.calls, []);
  });
test("rollback keeps safety stop available without approvals while excluding observe/source routing in OPEN phase", (t) => {
  const s = retainedRelease(t);
  s.phase.open();
  s.retain();
  s.revoke();
  assert.throws(() => s.f.app.platform.restore.rollback(s.release.id), {
    code: "RESTORE_OFFLINE_EXCLUSION",
  });
  assert.deepEqual(s.calls, ["stop"]);
  const r = s.f.app.platform.restore.get(s.release.id);
  assert.equal(r.phase, "stopping");
  assert.equal(r.state, "forward-held");
  assert.equal(s.phase.read()!.state.sessions.at(-1)!.phase, "open");
});
test("retained history cannot conceal substitution of a previously retained native release", (t) => {
  const s = retainedRelease(t);
  s.retain();
  s.phase.create();
  const forged = { ...s.release, binding: hash("changed-binding") };
  const raw = canonical(forged);
  s.f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_restore_releases SET record=?,hash=? WHERE id=?",
      raw,
      digest(raw),
      forged.id,
    );
  refuseConserved(s.f, () =>
    (
      s.f.app.platform.restore as unknown as {
        call(method: string, release: RestoreRelease): void;
      }
    ).call("routeCandidate", forged),
  );
  assert.deepEqual(s.calls, []);
});

for (const method of ["fence", "routeCandidate", "routeSource"] as const)
  test(`release ${method} rechecks complete phase after current-trust callback damage before control`, (t) => {
    const s = retainedRelease(t);
    s.phase.close();
    s.retain();
    const trust = s.trust();
    s.f.app.platform.restore.configure(
      s.adapter,
      () => {
        s.f.app.database
          .owned("platform")
          .run("UPDATE platform_offline_head SET state='{}'");
        return trust;
      },
      s.now,
    );
    refuseConserved(s.f, () =>
      (
        s.f.app.platform.restore as unknown as {
          call(method: string, release: RestoreRelease): void;
        }
      ).call(method, s.release),
    );
    assert.deepEqual(s.calls, []);
  });
test("closed offline phase keeps canonical approved native control available under original gates", (t) => {
  const s = retainedRelease(t);
  s.phase.close();
  s.retain();
  (
    s.f.app.platform.restore as unknown as {
      call(method: string, release: RestoreRelease): void;
    }
  ).call("fence", s.release);
  assert.deepEqual(s.calls, ["fence"]);
});

for (const method of ["fence", "routeCandidate", "routeSource"] as const)
  test(`release ${method} refuses committed maintenance damage after external control`, (t) => {
    const s = retainedRelease(t);
    s.phase.close();
    s.retain();
    s.adapter[method] = () => {
      s.calls.push(method);
      s.f.app.database.transaction(() =>
        s.f.app.database
          .owned("platform")
          .run("UPDATE platform_offline_head SET state='{}'"),
      );
    };
    assert.throws(() =>
      (
        s.f.app.platform.restore as unknown as {
          call(method: string, release: RestoreRelease): void;
        }
      ).call(method, s.release),
    );
    assert.deepEqual(s.calls, [method]);
    assert.equal(
      s.f.app.database
        .owned("platform")
        .get("SELECT state FROM platform_offline_head")!.state,
      "{}",
    );
    assert.equal(s.f.app.platform.restore.get(s.release.id).revision, 1);
  });

for (const phase of ["isolated", "draining", "invalidated"] as const)
  for (const method of ["prepare", "activate"] as const)
    test(`${phase} phase refuses retained ${method} without release/audit effects`, (t) => {
      const s = retainedRelease(t);
      if (phase === "isolated") s.phase.start();
      else {
        const open = s.phase.open();
        s.phase.step(
          open,
          phase === "draining"
            ? { kind: "drain" }
            : { kind: "invalidate", reason: "evidence-changed" },
        );
      }
      s.retain();
      refuseConserved(s.f, () =>
        method === "prepare"
          ? s.f.app.platform.restore.prepare(s.input)
          : s.f.app.platform.restore.activate(s.input),
      );
      assert.deepEqual(s.calls, []);
    });
for (const region of ["CA", "US"] as const)
  test(`${region} fresh release prepare is excluded before evidence work or release insertion`, (t) => {
    const s = releaseSetup(t, region);
    const phase = nativePhase(s.f);
    phase.open();
    refuseConserved(s.f, () => s.f.app.platform.restore.prepare(s.input));
    assert.deepEqual(s.calls, []);
    assert.equal(
      s.f.app.database
        .owned("platform")
        .get("SELECT count(*) AS n FROM platform_restore_releases")!.n,
      0,
    );
  });
test("closed-to-open-to-closed authorization callback cannot hide a changed maintenance revision", (t) => {
  const f = setup(t);
  f.close();
  refuseConserved(f, () =>
    f.app.platform.command(
      f.actor,
      "synthetic.revision",
      "revision",
      {},
      () => {
        const offline = f.app.platform.offline;
        let s = offline.readInTransaction()!;
        for (const op of [
          { kind: "isolate", sessionId: "same-end-phase" },
          { kind: "open" },
          { kind: "drain" },
          { kind: "close" },
        ] as const)
          s = offline.transitionInTransaction(
            s.state.generation,
            s.anchor,
            op,
            [],
          );
        assert.equal(s.state.sessions.at(-1)!.phase, "closed");
      },
      () => ({ id: "not-committed" }),
    ),
  );
});
test("public Platform offline alias cannot substitute another history for its constructor-paired guard", (t) => {
  const f = setup(t);
  f.open();
  Object.defineProperty(f.app.platform, "offline", {
    value: { readInTransaction: () => null },
  });
  refuseConserved(f, () => command(f, true));
});
test("closed phase supplies no release authority after trust revocation", (t) => {
  const s = retainedRelease(t);
  s.phase.close();
  s.retain();
  s.revoke();
  const before = rows(s.f);
  assert.throws(() =>
    (
      s.f.app.platform.restore as unknown as {
        call(method: string, release: RestoreRelease): void;
      }
    ).call("routeCandidate", s.release),
  );
  assert.deepEqual(s.calls, []);
  assert.equal(rows(s.f), before);
});
test("adapter observation callback damage rolls back and refuses before any forward routing", (t) => {
  const s = retainedRelease(t);
  s.phase.close();
  s.retain();
  const observe = s.adapter.observe;
  s.adapter.observe = (control) => {
    s.calls.push("observe");
    s.f.app.database
      .owned("platform")
      .run("UPDATE platform_offline_head SET state='{}'");
    return observe(control);
  };
  refuseConserved(s.f, () =>
    s.f.app.database.transaction(() =>
      (
        s.f.app.platform.restore as unknown as {
          observe(release: RestoreRelease): unknown;
        }
      ).observe(s.release),
    ),
  );
  assert.deepEqual(s.calls, ["observe"]);
});

test("standalone observation refuses committed maintenance damage without reviving authority", (t) => {
  const s = retainedRelease(t);
  s.phase.close();
  s.retain();
  const observe = s.adapter.observe;
  s.adapter.observe = (control) => {
    s.calls.push("observe");
    s.f.app.database.transaction(() =>
      s.f.app.database
        .owned("platform")
        .run("UPDATE platform_offline_head SET state='{}'"),
    );
    return observe(control);
  };
  assert.throws(() =>
    (
      s.f.app.platform.restore as unknown as {
        observe(release: RestoreRelease): unknown;
      }
    ).observe(s.release),
  );
  assert.deepEqual(s.calls, ["observe"]);
  assert.equal(
    s.f.app.database
      .owned("platform")
      .get("SELECT state FROM platform_offline_head")!.state,
    "{}",
  );
  assert.equal(s.f.app.platform.restore.permits(), false);
});
