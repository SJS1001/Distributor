import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import { RESTORE_OFFLINE_SCHEMA } from "../src/server/restore-offline-schema.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import type { OfflineStorageSnapshot } from "../src/server/restore-offline-storage.ts";
import {
  parseOfflineRecoveryGeneration,
  type OfflinePhaseTransition,
} from "../src/server/restore-offline-phase.ts";
import { fixture } from "./fixtures.ts";
const h = (label: string) => digest(`synthetic:${label}`),
  refusal = { code: "RESTORE_OFFLINE_STORAGE" };
function setup(
  t: TestContext,
  eventReports = false,
  region: "CA" | "US" = "CA",
) {
  const f = fixture(t, { eventReports }, region);
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(f.path + suffix)) chmodSync(f.path + suffix, 0o600);
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(h("snapshot"), "2026-10-01T00:00:00.000Z"),
  );
  const generation = (id = "instance-a") =>
    f.app.database.transaction(() => {
      const { logicalHash: _logical, ...binding } =
        f.app.database.captureRestoreCandidateInTransaction();
      return parseOfflineRecoveryGeneration({
        version: 1,
        instanceId: h(id),
        schemaVersion: SCHEMA_VERSION,
        ...binding,
        organizations: binding.organizations.map(({ id, currency }) => ({
          id,
          currency,
        })),
      });
    });
  const create = (
    id = "instance-a",
    expected: OfflineStorageSnapshot["anchor"] | null = null,
  ) =>
    f.app.database.transaction(() =>
      f.app.platform.offline.createGenerationInTransaction(
        generationOutside(id),
        expected,
        [],
      ),
    );
  // Capture generation in the same transaction, never nest writer transactions.
  const generationOutside = (id: string) => {
    const { logicalHash: _logical, ...binding } =
      f.app.database.captureRestoreCandidateInTransaction();
    return parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: h(id),
      schemaVersion: SCHEMA_VERSION,
      ...binding,
      organizations: binding.organizations.map(({ id, currency }) => ({
        id,
        currency,
      })),
    });
  };
  const read = () =>
    f.app.database.transaction(() =>
      f.app.platform.offline.readInTransaction(),
    );
  const step = (
    s: OfflineStorageSnapshot,
    op: OfflinePhaseTransition,
    releases: unknown = s.state.releases,
  ) =>
    f.app.database.transaction(() =>
      f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        op,
        releases,
      ),
    );
  const open = () =>
    step(step(create(), { kind: "isolate", sessionId: "session-a" }), {
      kind: "open",
    });
  const receipt = (suffix = "a") => ({
    owner: "inventory",
    orgId: f.actor.orgId,
    taskName: "synthetic.reconcile",
    requestId: `request-${suffix}`,
    binding: h(`binding-${suffix}`),
    payloadHash: h(`payload-${suffix}`),
    beforeCandidateHash: h(`before-${suffix}`),
    resultHash: h(`result-${suffix}`),
  });
  return Object.assign(f, { generation, create, read, step, open, receipt });
}
function raw<T>(path: string, fn: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function rows(path: string) {
  return raw(path, (db) =>
    Object.fromEntries(
      RESTORE_OFFLINE_SCHEMA.filter((s) => s.type === "table").map((s) => [
        s.name,
        db.prepare(`SELECT * FROM ${s.name} ORDER BY rowid`).all(),
      ]),
    ),
  );
}
function mutateRetained(path: string, table: string, sql: string) {
  raw(path, (db) => {
    const guards = RESTORE_OFFLINE_SCHEMA.filter(
      (s) => s.type === "trigger" && s.tbl_name === table,
    );
    db.exec("BEGIN");
    for (const guard of guards) db.exec(`DROP TRIGGER ${guard.name}`);
    db.exec(sql);
    for (const guard of guards) db.exec(guard.sql);
    db.exec("COMMIT");
  });
}

for (const reports of [false, true])
  for (const region of ["CA", "US"] as const)
    test(`${region}/${reports}: Platform initializes empty storage; explicit generation/session/receipts survive restart`, (t) => {
      const f = setup(t, reports, region);
      assert.equal(f.read(), null);
      let s = f.open();
      s = f.step(s, { kind: "record-task", receipt: f.receipt() });
      s = f.step(s, { kind: "drain" });
      s = f.step(s, { kind: "close" });
      assert.equal(s.anchor.revision, 6);
      assert.equal(s.state.sessions[0]!.phase, "closed");
      assert.equal(
        f.read()!.state.sessions[0]!.history[2]!.receipt!.resultHash,
        f.receipt().resultHash,
      );
      const before = rows(f.path);
      f.app.close();
      f.app = new Application(f.path, region, { eventReports: reports });
      assert.deepEqual(f.read(), s);
      assert.deepEqual(rows(f.path), before);
      assert.throws(() => f.app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
      assert.equal("authorized" in s, false);
    });

test("all storage methods require the caller's existing native transaction and reject owner-scope escape", (t) => {
  const f = setup(t),
    gen = f.generation();
  for (const attempt of [
    () => f.app.platform.offline.readInTransaction(),
    () => f.app.platform.offline.createGenerationInTransaction(gen, null, []),
    () =>
      f.app.platform.offline.transitionInTransaction(
        gen,
        {},
        { kind: "open" },
        [],
      ),
  ])
    assert.throws(attempt, { code: "TRANSACTION" });
  f.app.database.transaction(() => {
    assert.throws(
      () =>
        f.app.database.execute("inventory", () =>
          f.app.platform.offline.readInTransaction(),
        ),
      { code: "TRANSACTION" },
    );
    assert.throws(() =>
      f.app.database
        .owned("inventory")
        .run(
          "INSERT INTO platform_offline_generations VALUES(?,?,?,?)",
          h("x"),
          1,
          "{}",
          h("bad"),
        ),
    );
  });
  assert.equal(f.read(), null);
});

test("two native connections compare the exact retained head and stale CAS cannot append anything", (t) => {
  const f = setup(t),
    s = f.create(),
    other = new Application(f.path, "CA", { eventReports: false });
  try {
    const stale = other.database.transaction(() =>
      other.platform.offline.readInTransaction(),
    )!;
    const advanced = f.step(s, { kind: "isolate", sessionId: "session-a" }),
      before = rows(f.path);
    assert.throws(
      () =>
        other.database.transaction(() =>
          other.platform.offline.transitionInTransaction(
            stale.state.generation,
            stale.anchor,
            { kind: "isolate", sessionId: "competitor" },
            [],
          ),
        ),
      refusal,
    );
    assert.deepEqual(rows(f.path), before);
    assert.deepEqual(
      other.database.transaction(() =>
        other.platform.offline.readInTransaction(),
      ),
      advanced,
    );
    assert.throws(
      () =>
        other.database.transaction(() =>
          other.platform.offline.createGenerationInTransaction(
            stale.state.generation,
            null,
            [],
          ),
        ),
      refusal,
    );
  } finally {
    other.close();
  }
});

test("late head failure rolls back journal, receipt reservation and other native writes atomically", (t) => {
  const f = setup(t),
    s = f.open(),
    before = rows(f.path),
    store = f.app.database.owned("platform"),
    auditBefore = store.all("SELECT * FROM platform_audit");
  const original = store.run;
  // Intercept Store's shared prototype only at the final native head CAS.
  const proto = Object.getPrototypeOf(store) as typeof store;
  const hook = t.mock.method(
    proto,
    "run",
    function (
      this: typeof store,
      sql: string,
      ...params: Parameters<typeof store.run> extends [string, ...infer P]
        ? P
        : never
    ) {
      if (sql.startsWith("UPDATE platform_offline_head"))
        throw new Error("synthetic late storage failure");
      return original.call(this, sql, ...params);
    },
  );
  try {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          f.app.platform.audit(
            f.actor,
            "SyntheticBeforeOffline",
            "synthetic",
            {},
          );
          f.app.platform.offline.transitionInTransaction(
            s.state.generation,
            s.anchor,
            { kind: "record-task", receipt: f.receipt() },
            [],
          );
        }),
      /synthetic late storage failure/,
    );
  } finally {
    hook.mock.restore();
  }
  assert.deepEqual(rows(f.path), before);
  assert.deepEqual(store.all("SELECT * FROM platform_audit"), auditBefore);
  assert.deepEqual(f.read(), s);
  assert.equal(
    f.step(s, { kind: "record-task", receipt: f.receipt() }).anchor.revision,
    s.anchor.revision + 1,
  );
});

test("global request identity and binding remain reserved across closed sessions and generations", (t) => {
  const f = setup(t);
  let s = f.open();
  s = f.step(s, { kind: "record-task", receipt: f.receipt() });
  s = f.step(s, { kind: "drain" });
  s = f.step(s, { kind: "close" });
  s = f.step(f.step(s, { kind: "isolate", sessionId: "session-b" }), {
    kind: "open",
  });
  const duplicate = { ...f.receipt(), binding: h("different-binding") },
    before = rows(f.path);
  assert.throws(
    () => f.step(s, { kind: "record-task", receipt: duplicate }),
    refusal,
  );
  assert.deepEqual(rows(f.path), before);
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(
      h("new-snapshot"),
      "2026-10-02T00:00:00.000Z",
    ),
  );
  s = f.create("instance-b", s.anchor);
  s = f.step(f.step(s, { kind: "isolate", sessionId: "session-c" }), {
    kind: "open",
  });
  for (const receipt of [
    duplicate,
    { ...f.receipt("b"), binding: f.receipt().binding },
  ])
    assert.throws(() => f.step(s, { kind: "record-task", receipt }), refusal);
  assert.equal(Object.values(rows(f.path))[0]!.length, 2);
});

test("copied or swapped generation bindings refuse native writes; rotation retains historical sessions", (t) => {
  const f = setup(t),
    original = f.open(),
    before = rows(f.path);
  for (const field of ["instanceId", "snapshotHash", "schemaHash"] as const) {
    const gen = { ...original.state.generation, [field]: h(`wrong-${field}`) };
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.platform.offline.transitionInTransaction(
            gen,
            original.anchor,
            { kind: "drain" },
            [],
          ),
        ),
      refusal,
    );
  }
  assert.throws(() => f.create("instance-b", original.anchor), refusal);
  assert.deepEqual(rows(f.path), before);
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(
      h("new-snapshot"),
      "2026-10-02T00:00:00.000Z",
    ),
  );
  assert.throws(() => f.step(original, { kind: "drain" }), refusal);
  const next = f.create("instance-b", original.anchor);
  assert.equal(next.state.sessions.length, 0);
  assert.equal(rows(f.path).platform_offline_journal!.length, 4);
  assert.equal(rows(f.path).platform_offline_generations!.length, 2);
  assert.deepEqual(f.read(), next);
});

for (const attack of [
  "head-hash",
  "head-revision",
  "head-state",
  "journal-hash",
  "journal-deletion",
  "generation",
  "receipt-hash",
  "receipt-deletion",
] as const)
  test(`durable read refuses ${attack} instead of trusting a plausible head`, (t) => {
    const f = setup(t);
    const s = f.step(f.open(), { kind: "record-task", receipt: f.receipt() });
    if (attack === "head-hash")
      raw(f.path, (db) =>
        db.exec("UPDATE platform_offline_head SET state_hash='damaged'"),
      );
    if (attack === "head-revision")
      raw(f.path, (db) =>
        db.exec("UPDATE platform_offline_head SET revision=2"),
      );
    if (attack === "head-state")
      raw(f.path, (db) =>
        db
          .prepare("UPDATE platform_offline_head SET state=?")
          .run(canonical({ ...s.state, sessions: [] })),
      );
    if (attack === "journal-hash")
      mutateRetained(
        f.path,
        "platform_offline_journal",
        "UPDATE platform_offline_journal SET hash='damaged' WHERE revision=2",
      );
    if (attack === "journal-deletion")
      mutateRetained(
        f.path,
        "platform_offline_journal",
        "DELETE FROM platform_offline_journal WHERE revision=2",
      );
    if (attack === "generation")
      mutateRetained(
        f.path,
        "platform_offline_generations",
        "UPDATE platform_offline_generations SET generation_hash='damaged'",
      );
    if (attack === "receipt-hash")
      mutateRetained(
        f.path,
        "platform_offline_receipts",
        "UPDATE platform_offline_receipts SET hash='damaged'",
      );
    if (attack === "receipt-deletion")
      mutateRetained(
        f.path,
        "platform_offline_receipts",
        "DELETE FROM platform_offline_receipts",
      );
    assert.throws(() => f.read(), refusal);
  });

test("append-only SQL guards reject ordinary updates/deletes and STRICT tables reject invalid types", (t) => {
  const f = setup(t);
  f.step(f.open(), { kind: "record-task", receipt: f.receipt() });
  const before = rows(f.path);
  for (const table of [
    "platform_offline_generations",
    "platform_offline_journal",
    "platform_offline_receipts",
  ])
    for (const operation of ["DELETE", "UPDATE"])
      raw(f.path, (db) => {
        assert.throws(
          () =>
            db.exec(
              operation === "DELETE"
                ? `DELETE FROM ${table}`
                : `UPDATE ${table} SET ${table.endsWith("generations") ? "generation_hash=generation_hash" : "hash=hash"}`,
            ),
          /append-only/,
        );
      });
  raw(f.path, (db) =>
    assert.throws(() =>
      db.exec("UPDATE platform_offline_head SET revision='invalid'"),
    ),
  );
  assert.deepEqual(rows(f.path), before);
});

test("normal/revoked proxy or accessor input cannot execute traps or change storage", (t) => {
  const f = setup(t),
    s = f.open(),
    before = rows(f.path);
  let traps = 0;
  for (const kind of [
    "generation",
    "anchor",
    "transition",
    "releases",
  ] as const)
    for (const revoked of [false, true]) {
      const value =
        kind === "generation"
          ? s.state.generation
          : kind === "anchor"
            ? s.anchor
            : kind === "transition"
              ? { kind: "drain" }
              : [];
      const wrapped = Proxy.revocable(value, {
        get() {
          traps++;
          throw new Error("trap");
        },
        getPrototypeOf() {
          traps++;
          throw new Error("trap");
        },
        ownKeys() {
          traps++;
          throw new Error("trap");
        },
      });
      if (revoked) wrapped.revoke();
      assert.throws(() =>
        f.app.database.transaction(() =>
          f.app.platform.offline.transitionInTransaction(
            kind === "generation" ? wrapped.proxy : s.state.generation,
            kind === "anchor" ? wrapped.proxy : s.anchor,
            kind === "transition" ? wrapped.proxy : { kind: "drain" },
            kind === "releases" ? wrapped.proxy : [],
          ),
        ),
      );
    }
  assert.equal(traps, 0);
  assert.deepEqual(rows(f.path), before);
});

test("native generation creation rejects foreign schema/region/organization/source bindings and leaves no authority", (t) => {
  const f = setup(t),
    gen = f.generation(),
    before = rows(f.path);
  for (const patch of [
    { schemaVersion: SCHEMA_VERSION - 1 },
    { schemaHash: h("foreign-schema") },
    { region: "US" },
    { organizations: [{ id: "foreign-org", currency: "CAD" }] },
    { sourceCompletedAt: "2026-09-30T00:00:00.000Z" },
    { restoredAt: "2026-10-02T00:00:00.000Z" },
    { snapshotHash: h("foreign-snapshot") },
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.platform.offline.createGenerationInTransaction(
            { ...gen, ...patch },
            null,
            [],
          ),
        ),
      refusal,
    );
  assert.deepEqual(rows(f.path), before);
  assert.equal(f.read(), null);
});

for (const terminal of ["prepared", "superseded", "rolled-back"] as const)
  test(`retained ${terminal} release blocks opening and cannot disappear on generation rotation`, (t) => {
    const f = setup(t),
      points =
        terminal === "prepared"
          ? [["prepared", "prepared"]]
          : terminal === "superseded"
            ? [
                ["prepared", "prepared"],
                ["fencing", "fencing"],
                ["held", "fencing"],
                ["superseded", "superseded"],
              ]
            : [
                ["prepared", "prepared"],
                ["stopping", "stopping"],
                ["returning", "returning"],
                ["rolled-back", "rolled-back"],
              ];
    const history = points.map(([state, phase], i) => ({
      state,
      phase,
      // Native hold() retains the prior phase timestamp.
      at: terminal === "superseded" && state === "held" ? 1001 : 1000 + i,
    }));
    const releases = [
      {
        id: "synthetic-release",
        binding: h("release"),
        revision: history.length,
        ...history.at(-1)!,
        history,
      },
    ];
    let s = f.open();
    assert.throws(
      () => f.step(s, { kind: "record-task", receipt: f.receipt() }, releases),
      { code: "RESTORE_OFFLINE_PHASE" },
    );
    s = f.step(s, { kind: "invalidate", reason: "release-observed" }, releases);
    f.app.database.transaction(() =>
      f.app.platform.isolateRestore(h("rotated"), "2026-10-02T00:00:00.000Z"),
    );
    const gen = f.generation("instance-b"),
      before = rows(f.path);
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.platform.offline.createGenerationInTransaction(
            gen,
            s.anchor,
            [],
          ),
        ),
      refusal,
    );
    assert.deepEqual(rows(f.path), before);
    s = f.app.database.transaction(() =>
      f.app.platform.offline.createGenerationInTransaction(
        gen,
        s.anchor,
        releases,
      ),
    );
    assert.throws(
      () => f.step(s, { kind: "isolate", sessionId: "cannot-reopen" }),
      { code: "RESTORE_OFFLINE_PHASE" },
    );
    assert.deepEqual(f.read(), s);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("stored generation, task and anchor are detached from caller mutation; accessor anchors never execute", (t) => {
  const f = setup(t),
    parsed = f.generation(),
    gen = {
      ...parsed,
      organizations: parsed.organizations.map((o) => ({ ...o })),
    };
  let s = f.app.database.transaction(() =>
    f.app.platform.offline.createGenerationInTransaction(gen, null, []),
  );
  gen.organizations[0]!.id = "caller-mutated";
  s = f.step(f.step(s, { kind: "isolate", sessionId: "a" }), { kind: "open" });
  const receipt = f.receipt(),
    expected = { ...s.anchor };
  s = f.step(s, { kind: "record-task", receipt });
  receipt.resultHash = h("caller-changed");
  expected.stateHash = h("changed-anchor");
  assert.deepEqual(f.read(), s);
  assert.notEqual(
    s.state.sessions[0]!.history.at(-1)!.receipt!.resultHash,
    receipt.resultHash,
  );
  assert.ok(
    Object.isFrozen(s) &&
      Object.isFrozen(s.anchor) &&
      Object.isFrozen(s.state.sessions),
  );
  let invoked = false;
  const bad = { ...s.anchor };
  Object.defineProperty(bad, "revision", {
    enumerable: true,
    get() {
      invoked = true;
      throw Error("getter");
    },
  });
  assert.throws(
    () =>
      f.app.database.transaction(() =>
        f.app.platform.offline.transitionInTransaction(
          s.state.generation,
          bad,
          { kind: "drain" },
          [],
        ),
      ),
    refusal,
  );
  assert.equal(invoked, false);
  assert.deepEqual(f.read(), s);
});

test("oversized durable text is refused by byte preflight before historical parsing", (t) => {
  const f = setup(t);
  f.create();
  raw(f.path, (db) =>
    db.exec(
      "UPDATE platform_offline_head SET state=CAST(zeroblob(4194305) AS TEXT)",
    ),
  );
  assert.throws(() => f.read(), {
    code: "RESTORE_OFFLINE_STORAGE",
    message: "Offline retained field limit exceeded.",
  });
});
