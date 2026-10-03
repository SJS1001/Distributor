import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { canonical, digest } from "../src/server/core.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
import { RESTORE_OFFLINE_SCHEMA } from "../src/server/restore-offline-schema.ts";
import type { OfflineStorageSnapshot } from "../src/server/restore-offline-storage.ts";
import {
  parseOfflineRecoveryGeneration,
  type OfflinePhaseTransition,
} from "../src/server/restore-offline-phase.ts";
import { fixture } from "./fixtures.ts";

const h = (s: string) => digest(`synthetic-storage-boundary:${s}`);
const storageRefusal = { code: "RESTORE_OFFLINE_STORAGE" };
const tableNames = RESTORE_OFFLINE_SCHEMA.filter((o) => o.type === "table").map(
  (o) => o.name,
);
function setup(t: TestContext, region: "CA" | "US" = "CA") {
  const f = fixture(t, { eventReports: false }, region);
  for (const suffix of ["", "-wal", "-shm"])
    if (existsSync(f.path + suffix)) chmodSync(f.path + suffix, 0o600);
  const isolate = (label: string) =>
    f.app.database.transaction(() =>
      f.app.platform.isolateRestore(h(label), "2026-10-01T00:00:00.000Z"),
    );
  isolate("initial");
  const generation = (id: string) => {
    const { logicalHash: _logical, ...binding } =
      f.app.database.captureRestoreCandidateInTransaction();
    return parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: h(id),
      schemaVersion: SCHEMA_VERSION,
      ...binding,
      organizations: binding.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
  };
  const create = (
    id = "instance-a",
    expected: OfflineStorageSnapshot["anchor"] | null = null,
  ) =>
    f.app.database.transaction(() =>
      f.app.platform.offline.createGenerationInTransaction(
        generation(id),
        expected,
        [],
      ),
    );
  const step = (s: OfflineStorageSnapshot, op: OfflinePhaseTransition) =>
    f.app.database.transaction(() =>
      f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        op,
        s.state.releases,
      ),
    );
  const opened = () =>
    step(step(create(), { kind: "isolate", sessionId: "a" }), { kind: "open" });
  const read = () =>
    f.app.database.transaction(() =>
      f.app.platform.offline.readInTransaction(),
    );
  const receipt = (id = "a") => ({
    owner: "inventory",
    orgId: f.actor.orgId,
    taskName: "synthetic.reconcile",
    requestId: `request-${id}`,
    binding: h(`binding-${id}`),
    payloadHash: h(`payload-${id}`),
    beforeCandidateHash: h(`candidate-${id}`),
    resultHash: h(`result-${id}`),
  });
  const reopen = () => {
    f.app.close();
    f.app = new Application(f.path, region, { eventReports: false });
  };
  return Object.assign(f, {
    isolate,
    generation,
    create,
    step,
    opened,
    read,
    receipt,
    reopen,
  });
}
function raw<T>(path: string, callback: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}
function retained(path: string) {
  return raw(path, (db) =>
    Object.fromEntries(
      tableNames.map((name) => [
        name,
        db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
      ]),
    ),
  );
}
// Deliberate damaged-file fixtures only: bypass a guard, corrupt one retained cell,
// then restore its exact DDL. Valid workflows below always use native methods.
function damage(path: string, table: string, sql: string) {
  raw(path, (db) => {
    const guards = RESTORE_OFFLINE_SCHEMA.filter(
      (o) => o.type === "trigger" && o.tbl_name === table,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const g of guards) db.exec(`DROP TRIGGER ${g.name}`);
      db.exec(sql);
      for (const g of guards) db.exec(g.sql);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}
function noPayloadReads(t: TestContext) {
  let calls = 0;
  const all = Store.prototype.all,
    visit = Store.prototype.visit,
    get = Store.prototype.get;
  t.mock.method(
    Store.prototype,
    "get",
    function (this: Store, ...args: Parameters<Store["get"]>) {
      if (/SELECT \* FROM platform_offline_/i.test(args[0])) calls++;
      return get.apply(this, args);
    },
  );
  t.mock.method(
    Store.prototype,
    "all",
    function (this: Store, ...args: Parameters<Store["all"]>) {
      if (/SELECT \* FROM platform_offline_/i.test(args[0])) calls++;
      return all.apply(this, args);
    },
  );
  t.mock.method(
    Store.prototype,
    "visit",
    function (this: Store, ...args: Parameters<Store["visit"]>) {
      if (/SELECT \* FROM platform_offline_/i.test(args[0])) calls++;
      return visit.apply(this, args);
    },
  );
  return () =>
    assert.equal(
      calls,
      0,
      "must refuse before loading any retained payload row",
    );
}

// These remain RED if INSERT OR REPLACE silently deletes/reinserts immutable rows.
// No dropped triggers, PRAGMA changes or raw connection are used for the attack.
for (const table of [
  "platform_offline_generations",
  "platform_offline_journal",
  "platform_offline_receipts",
])
  test(`append-only guard must refuse native INSERT OR REPLACE of ${table}`, (t) => {
    const f = setup(t);
    f.step(f.opened(), { kind: "record-task", receipt: f.receipt() });
    const store = f.app.database.owned("platform"),
      before = retained(f.path);
    const row = store.get(`SELECT * FROM ${table} ORDER BY rowid LIMIT 1`)!;
    const replacement = {
      ...row,
      [table.endsWith("generations") ? "generation_hash" : "hash"]:
        h("replacement"),
    };
    f.app.database.transaction(() => {
      assert.throws(
        () =>
          store.run(
            `INSERT OR REPLACE INTO ${table}(${Object.keys(replacement).join(",")}) VALUES(${Object.keys(
              replacement,
            )
              .map(() => "?")
              .join(",")})`,
            ...(Object.values(replacement) as SQLInputValue[]),
          ),
        /append-only/,
        "immutable row replacement must be refused at the SQL write, not merely detected by a later replay",
      );
    });
    assert.deepEqual(retained(f.path), before);
  });

test("receipt binding uniqueness cannot be used by REPLACE to evict another task's reservation", (t) => {
  const f = setup(t);
  let s = f.opened();
  s = f.step(s, { kind: "record-task", receipt: f.receipt("a") });
  s = f.step(s, { kind: "record-task", receipt: f.receipt("b") });
  const store = f.app.database.owned("platform"),
    rows = store.all(
      "SELECT * FROM platform_offline_receipts ORDER BY revision",
    ),
    before = retained(f.path);
  const replacement = { ...rows[1]!, binding: rows[0]!.binding };
  f.app.database.transaction(() =>
    assert.throws(
      () =>
        store.run(
          `INSERT OR REPLACE INTO platform_offline_receipts(${Object.keys(replacement).join(",")}) VALUES(${Object.keys(
            replacement,
          )
            .map(() => "?")
            .join(",")})`,
          ...(Object.values(replacement) as SQLInputValue[]),
        ),
      /append-only/,
    ),
  );
  assert.deepEqual(retained(f.path), before);
});

for (const region of ["CA", "US"] as const)
  test(`${region}: every expected anchor field is checked across native connections and duplicate winner is not replayed as a fresh task`, (t) => {
    const f = setup(t, region),
      s = f.opened(),
      other = new Application(f.path, region, { eventReports: false });
    try {
      const stale = other.database.transaction(() =>
        other.platform.offline.readInTransaction(),
      )!;
      const before = retained(f.path);
      for (const patch of [
        { instanceId: h("other") },
        { revision: s.anchor.revision + 1 },
        { stateHash: h("other") },
        { journalHash: h("other") },
      ]) {
        assert.throws(
          () =>
            other.database.transaction(() =>
              other.platform.offline.transitionInTransaction(
                stale.state.generation,
                { ...stale.anchor, ...patch },
                { kind: "drain" },
                [],
              ),
            ),
          storageRefusal,
        );
        assert.deepEqual(retained(f.path), before);
      }
      const winner = f.step(s, { kind: "record-task", receipt: f.receipt() });
      assert.throws(
        () =>
          other.database.transaction(() =>
            other.platform.offline.transitionInTransaction(
              stale.state.generation,
              stale.anchor,
              { kind: "record-task", receipt: f.receipt("competitor") },
              [],
            ),
          ),
        storageRefusal,
      );
      const current = other.database.transaction(() =>
        other.platform.offline.readInTransaction(),
      )!;
      assert.deepEqual(current, winner);
      assert.throws(
        () =>
          other.database.transaction(() =>
            other.platform.offline.transitionInTransaction(
              current.state.generation,
              current.anchor,
              {
                kind: "record-task",
                receipt: { ...f.receipt(), binding: h("new-binding") },
              },
              [],
            ),
          ),
        { code: "RESTORE_OFFLINE_PHASE" },
      );
      assert.deepEqual(f.read(), winner);
      assert.equal(retained(f.path).platform_offline_receipts!.length, 1);
    } finally {
      other.close();
    }
  });

for (const target of [
  "archived-generation",
  "archived-journal",
  "archived-receipt",
  "authentic-old-head",
] as const)
  test(`complete replay checks ${target} after a newer generation is current`, (t) => {
    const f = setup(t);
    let old = f.step(f.opened(), { kind: "record-task", receipt: f.receipt() });
    old = f.step(f.step(old, { kind: "drain" }), { kind: "close" });
    f.isolate("next");
    const current = f.create("instance-b", old.anchor);
    assert.deepEqual(f.read(), current);
    if (target === "archived-generation")
      damage(
        f.path,
        "platform_offline_generations",
        "UPDATE platform_offline_generations SET generation_hash='damaged' WHERE created_revision=1",
      );
    if (target === "archived-journal")
      damage(
        f.path,
        "platform_offline_journal",
        "UPDATE platform_offline_journal SET previous_hash='damaged' WHERE revision=2",
      );
    if (target === "archived-receipt")
      damage(
        f.path,
        "platform_offline_receipts",
        `UPDATE platform_offline_receipts SET instance_id='${current.anchor.instanceId}'`,
      );
    if (target === "authentic-old-head")
      f.app.database
        .owned("platform")
        .run(
          "UPDATE platform_offline_head SET instance_id=?,revision=?,state=?,state_hash=?,journal_hash=? WHERE id=1",
          old.anchor.instanceId,
          old.anchor.revision,
          canonical(old.state),
          old.anchor.stateHash,
          old.anchor.journalHash,
        );
    assert.throws(() => f.read(), storageRefusal);
    assert.throws(
      () => f.step(current, { kind: "isolate", sessionId: "unsafe" }),
      storageRefusal,
    );
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  });

test("terminal invalidation keeps task reservations across restart and a raw generation change", (t) => {
  const f = setup(t);
  let old = f.step(f.opened(), { kind: "record-task", receipt: f.receipt() });
  old = f.step(old, { kind: "invalidate", reason: "authority-lost" });
  f.reopen();
  assert.deepEqual(f.read(), old);
  f.isolate("new-cutoff");
  // Reading a copied historical generation remains possible; it conveys no authority.
  assert.deepEqual(f.read(), old);
  assert.throws(
    () => f.step(old, { kind: "isolate", sessionId: "wrong-generation" }),
    storageRefusal,
  );
  let current = f.create("instance-b", old.anchor);
  current = f.step(
    f.step(current, { kind: "isolate", sessionId: "new-session" }),
    { kind: "open" },
  );
  const before = retained(f.path);
  for (const receipt of [
    { ...f.receipt(), binding: h("fresh-binding") },
    { ...f.receipt("different-request"), binding: f.receipt().binding },
  ])
    assert.throws(
      () => f.step(current, { kind: "record-task", receipt }),
      storageRefusal,
    );
  assert.deepEqual(retained(f.path), before);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

test("a returned immutable snapshot is not a commit receipt after its native transaction rolls back", (t) => {
  const f = setup(t),
    old = f.opened(),
    before = retained(f.path);
  let uncommitted: OfflineStorageSnapshot | undefined;
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        uncommitted = f.app.platform.offline.transitionInTransaction(
          old.state.generation,
          old.anchor,
          { kind: "record-task", receipt: f.receipt() },
          [],
        );
        assert.ok(
          Object.isFrozen(
            uncommitted.state.sessions[0]!.history.at(-1)!.receipt,
          ),
        );
        throw Error("synthetic failure after all storage writes");
      }),
    /synthetic failure after all storage writes/,
  );
  assert.ok(uncommitted);
  assert.deepEqual(retained(f.path), before);
  f.reopen();
  assert.deepEqual(f.read(), old);
  assert.throws(() => f.step(uncommitted!, { kind: "drain" }), storageRefusal);
  const committed = f.step(old, { kind: "record-task", receipt: f.receipt() });
  assert.equal(committed.anchor.revision, old.anchor.revision + 1);
  assert.equal(retained(f.path).platform_offline_receipts!.length, 1);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

test("foreign native owners cannot read, rewrite or delete offline provenance through nested SQL", (t) => {
  const f = setup(t),
    s = f.step(f.opened(), { kind: "record-task", receipt: f.receipt() }),
    before = retained(f.path);
  for (const owner of ["inventory", "billing", "integration"] as const) {
    const store = f.app.database.owned(owner);
    f.app.database.transaction(() => {
      for (const sql of [
        "DELETE FROM platform_offline_receipts",
        "UPDATE platform_offline_head SET revision=revision",
        "INSERT INTO platform_offline_journal SELECT * FROM platform_offline_journal",
        "WITH stolen AS (SELECT state FROM platform_offline_head) SELECT * FROM stolen",
      ])
        assert.throws(
          () => store.run(sql),
          /not authorized|access to .+ is prohibited/,
        );
      assert.throws(
        () =>
          f.app.database.execute(owner, () =>
            f.app.platform.offline.transitionInTransaction(
              s.state.generation,
              s.anchor,
              { kind: "drain" },
              [],
            ),
          ),
        { code: "TRANSACTION" },
      );
    });
  }
  assert.deepEqual(retained(f.path), before);
  assert.deepEqual(f.read(), s);
});

for (const target of ["generations", "journal"] as const)
  test(`${target} count bounds precede every retained payload materialization`, (t) => {
    const f = setup(t),
      verify = noPayloadReads(t);
    raw(f.path, (db) => {
      if (target === "generations")
        db.exec(
          "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<65) INSERT INTO platform_offline_generations SELECT printf('%064x',i),i,'{}','bad' FROM n",
        );
      else {
        db.prepare(
          "INSERT INTO platform_offline_generations VALUES(?,?,?,?)",
        ).run(h("seed"), 1, "{}", "bad");
        db.prepare(
          "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<1001) INSERT INTO platform_offline_journal SELECT i,?,'{}','bad','bad','bad' FROM n",
        ).run(h("seed"));
      }
    });
    assert.throws(() => f.read(), {
      ...storageRefusal,
      message: "Offline storage history limit exceeded.",
    });
    verify();
  });

test("UTF-8 field size rather than JavaScript characters is bounded before materialization", (t) => {
  const f = setup(t);
  f.create();
  const value = "é".repeat(2 * 1024 ** 2 + 1);
  assert.ok(
    value.length < 4 * 1024 ** 2 && Buffer.byteLength(value) > 4 * 1024 ** 2,
  );
  f.app.database
    .owned("platform")
    .run("UPDATE platform_offline_head SET state=?", value);
  const verify = noPayloadReads(t);
  assert.throws(() => f.read(), {
    ...storageRefusal,
    message: "Offline retained field limit exceeded.",
  });
  verify();
});

test("aggregate bytes across legal-sized cells refuse before generation/journal JSON materialization", (t) => {
  const f = setup(t);
  raw(f.path, (db) =>
    db.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<17) INSERT INTO platform_offline_generations SELECT printf('%064x',i),i,CAST(zeroblob(4194304) AS TEXT),'bad' FROM n",
    ),
  );
  const verify = noPayloadReads(t);
  assert.throws(() => f.read(), {
    ...storageRefusal,
    message: "Offline retained byte limit exceeded.",
  });
  verify();
});

test("binding reservation is global across owner labels while task identity remains its exact scoped tuple", (t) => {
  const f = setup(t);
  let s = f.step(f.opened(), { kind: "record-task", receipt: f.receipt() });
  s = f.step(f.step(s, { kind: "drain" }), { kind: "close" });
  f.isolate("next-owner");
  s = f.create("instance-b", s.anchor);
  s = f.step(f.step(s, { kind: "isolate", sessionId: "b" }), { kind: "open" });
  const before = retained(f.path);
  assert.throws(
    () =>
      f.step(s, {
        kind: "record-task",
        receipt: { ...f.receipt(), owner: "billing" },
      }),
    storageRefusal,
  );
  assert.deepEqual(retained(f.path), before);
  // Different scoped identity plus genuinely distinct binding is a storage fact,
  // not a grant for Billing to mutate anything or a claim Billing was called.
  s = f.step(s, {
    kind: "record-task",
    receipt: {
      ...f.receipt(),
      owner: "billing",
      binding: h("billing-binding"),
    },
  });
  assert.equal(retained(f.path).platform_offline_receipts!.length, 2);
  assert.equal(s.status, "retained-offline-state");
  assert.equal("authorized" in s, false);
  assert.throws(() => f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});

test("failed initial journal insert rolls back the generation reservation and permits exact retry after restart", (t) => {
  const f = setup(t),
    before = retained(f.path),
    original = Store.prototype.run;
  const hook = t.mock.method(
    Store.prototype,
    "run",
    function (this: Store, ...args: Parameters<Store["run"]>) {
      if (args[0].startsWith("INSERT INTO platform_offline_journal"))
        throw Error("synthetic initial journal failure");
      return original.apply(this, args);
    },
  );
  try {
    assert.throws(() => f.create(), /synthetic initial journal failure/);
  } finally {
    hook.mock.restore();
  }
  assert.deepEqual(retained(f.path), before);
  f.reopen();
  assert.equal(f.read(), null);
  const committed = f.create();
  assert.equal(committed.anchor.instanceId, h("instance-a"));
  assert.equal(committed.anchor.revision, 1);
  assert.deepEqual(f.read(), committed);
});

for (const region of ["CA", "US"] as const)
  test(`${region}: mandatory recursive-delete guards survive native PRAGMA refusal, separate connections and reopen`, (t) => {
    const f = setup(t, region);
    const state = f.step(f.opened(), {
      kind: "record-task",
      receipt: f.receipt(),
    });
    const before = retained(f.path);
    const schemaBefore = raw(f.path, (db) =>
      db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
        )
        .all(),
    );
    const second = new Application(f.path, region, { eventReports: false });
    const verify = (app: Application) => {
      for (const owner of ["platform", "migration", "inventory"] as const) {
        // Exercise ordinary owner methods and the lower-level native callback.
        // None may change this mandatory private-connection setting.
        const store = app.database.owned(owner);
        for (const change of [
          () => store.run("PRAGMA recursive_triggers=OFF"),
          () => store.migrate("PRAGMA main.recursive_triggers(0)"),
          () =>
            app.database.execute(owner, (db) =>
              db.exec("PRAGMA recursive_triggers=0"),
            ),
        ]) {
          assert.throws(change, /not authorized/);
          app.database.transaction(() =>
            assert.throws(change, /not authorized/),
          );
        }
      }
      const store = app.database.owned("platform");
      app.database.transaction(() => {
        for (const table of [
          "platform_offline_generations",
          "platform_offline_journal",
          "platform_offline_receipts",
        ]) {
          const row = store.get(
            `SELECT * FROM ${table} ORDER BY rowid LIMIT 1`,
          )!;
          // Even a byte-identical REPLACE must run the immutable DELETE guard.
          assert.throws(
            () =>
              store.run(
                `REPLACE INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(
                  row,
                )
                  .map(() => "?")
                  .join(",")})`,
                ...(Object.values(row) as SQLInputValue[]),
              ),
            /append-only/,
          );
        }
        assert.deepEqual(app.platform.offline.readInTransaction(), state);
      });
      assert.deepEqual(retained(f.path), before);
      assert.throws(() => app.platform.assertProviderAccess(), {
        code: "RECOVERY_HOLD",
      });
    };
    try {
      verify(f.app);
      verify(second);
      f.reopen();
      verify(f.app);
      verify(second);
      assert.deepEqual(
        raw(f.path, (db) =>
          db
            .prepare(
              "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
            )
            .all(),
        ),
        schemaBefore,
      );
    } finally {
      second.close();
    }
  });
