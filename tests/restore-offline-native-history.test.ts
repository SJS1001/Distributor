import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import type { OfflineReleaseHistory } from "../src/server/restore-offline-phase.ts";

// Synthetic retained native journal fixtures, never external effect evidence.
function retained(id: string, phases: OfflineReleaseHistory["phase"][]) {
  const history = phases.map((phase, i) => ({
    state: phase,
    phase,
    at: 1000 + i,
  }));
  return {
    version: 1,
    id,
    binding: digest(id),
    revision: history.length,
    ...history.at(-1)!,
    history,
  };
}
function write(app: Application, record: ReturnType<typeof retained>) {
  const raw = canonical(record);
  app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
      record.id,
      record.state,
      record.revision,
      raw,
      digest(raw),
    );
}
function hold(app: Application) {
  app.platform.isolateRestore(
    digest("synthetic-snapshot"),
    "2026-10-03T00:00:00.000Z",
  );
}
function review(app: Application) {
  return app.database.transaction(() =>
    app.platform.restore.offlineReleaseHistoryInTransaction(),
  );
}

test("native offline history requires an existing writer transaction and a raw recovery generation", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.app.platform.restore.offlineReleaseHistoryInTransaction(),
    { code: "TRANSACTION" },
  );
  assert.throws(() => review(f.app), { code: "RECOVERY_HOLD" });
  hold(f.app);
  const r = review(f.app);
  assert.deepEqual(r.releases, []);
  assert.equal(r.classification.barrier, "no-recorded-release");
  assert.equal(r.classification.effects, "not-established");
  assert.equal("authorized" in r, false);
});

test("complete native history retains terminal control intent across restart despite current returning null", (t) => {
  const f = fixture(t);
  hold(f.app);
  write(
    f.app,
    retained("release-a", [
      "prepared",
      "fencing",
      "fenced",
      "stopping",
      "returning",
      "rolled-back",
    ]),
  );
  write(f.app, retained("release-b", ["prepared", "superseded"]));
  assert.equal(f.app.platform.restore.current(), null);
  const first = review(f.app);
  assert.equal(first.releases.length, 2);
  assert.equal(first.classification.barrier, "control-intent-retained");
  assert.equal(first.classification.effects, "not-established");
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(review(f.app), first);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.releases));
  assert.ok(
    Object.isFrozen(first.releases[0]) &&
      Object.isFrozen(first.releases[0]!.history[0]),
  );
  assert.throws(() => first.releases[0]!.history.pop(), TypeError);
  assert.deepEqual(review(f.app), first);
});

test("native projection observes uncommitted owner changes but a later caller failure rolls them back", (t) => {
  const f = fixture(t);
  hold(f.app);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        write(f.app, retained("pending", ["prepared"]));
        const r = f.app.platform.restore.offlineReleaseHistoryInTransaction();
        assert.equal(r.releases[0]!.id, "pending");
        assert.equal(r.classification.barrier, "prepared-release-retained");
        throw new Error("synthetic late caller failure");
      }),
    /synthetic late caller failure/,
  );
  assert.deepEqual(review(f.app).releases, []);
});

test("complete history rejects an independently rehashed impossible or truncated native journal", (t) => {
  const f = fixture(t);
  hold(f.app);
  const store = f.app.database.owned("platform");
  for (const change of [
    (r: ReturnType<typeof retained>) => {
      r.revision++;
    },
    (r: ReturnType<typeof retained>) => {
      r.history[1]!.phase = "released";
      r.history[1]!.state = "released";
    },
    (r: ReturnType<typeof retained>) => {
      r.binding = "bad";
    },
  ]) {
    const record = retained("malformed", ["prepared", "superseded"]);
    change(record);
    write(f.app, record);
    assert.throws(() => review(f.app), { code: "RESTORE_OFFLINE_PHASE" });
    store.run("DELETE FROM platform_restore_releases WHERE id=?", record.id);
  }
});

test("native offline history refuses stored digest and head mismatches before returning facts", (t) => {
  const f = fixture(t);
  hold(f.app);
  const r = retained("head", ["prepared"]);
  write(f.app, r);
  const store = f.app.database.owned("platform");
  store.run(
    "UPDATE platform_restore_releases SET hash=? WHERE id=?",
    digest("different"),
    r.id,
  );
  assert.throws(() => review(f.app), { code: "RESTORE_STATE" });
  store.run(
    "UPDATE platform_restore_releases SET hash=?,revision=? WHERE id=?",
    digest(canonical(r)),
    2,
    r.id,
  );
  assert.throws(() => review(f.app), { code: "RESTORE_STATE" });
});

test("malformed retained JSON fails with a bounded owner error instead of disclosing record bytes", (t) => {
  const f = fixture(t);
  hold(f.app);
  const store = f.app.database.owned("platform");
  for (const raw of ['{"private-fixture-marker":', "null", "[]"]) {
    store.run(
      "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
      "broken",
      "prepared",
      1,
      raw,
      digest(raw),
    );
    assert.throws(
      () => review(f.app),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "RESTORE_STATE");
        assert.doesNotMatch((error as Error).message, /private-fixture-marker/);
        return true;
      },
    );
    store.run("DELETE FROM platform_restore_releases WHERE id=?", "broken");
  }
});

test("native complete-history bound refuses a 1001st terminal record instead of returning a page", (t) => {
  const f = fixture(t);
  hold(f.app);
  f.app.database.transaction(() => {
    for (let i = 0; i < 1001; i++)
      write(f.app, retained(`terminal-${i}`, ["prepared", "superseded"]));
  });
  assert.throws(() => review(f.app), { code: "RESTORE_STATE" });
});

test("native history refuses oversized UTF8 bodies before decoding the record set", (t) => {
  const f = fixture(t);
  hold(f.app);
  const raw = "€".repeat(3 * 1024 * 1024);
  assert.ok(
    raw.length < 8 * 1024 * 1024 && Buffer.byteLength(raw) > 8 * 1024 * 1024,
  );
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
      "oversized",
      "prepared",
      1,
      raw,
      digest(raw),
    );
  assert.throws(() => review(f.app), { code: "RESTORE_STATE" });
});

test("release owner authorizer prevents foreign-module journal writes used to fabricate absence", (t) => {
  const f = fixture(t);
  hold(f.app);
  write(f.app, retained("terminal", ["prepared", "superseded"]));
  assert.throws(() =>
    f.app.database
      .owned("integration")
      .run("DELETE FROM platform_restore_releases"),
  );
  assert.equal(review(f.app).releases.length, 1);
});
