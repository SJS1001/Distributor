import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import type { OfflineReleaseHistory } from "../src/server/restore-offline-phase.ts";

// Native SQLite fixtures are deliberately unqualified journal data, not signed
// dossiers. Corruption is introduced only through the Platform-owned store.
function retained(
  id: string,
  phases: OfflineReleaseHistory["phase"][] = ["prepared", "superseded"],
) {
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
function put(
  app: Application,
  r: ReturnType<typeof retained>,
  raw = canonical(r),
) {
  app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
      r.id,
      r.state,
      r.revision,
      raw,
      digest(raw),
    );
}
function hold(app: Application, label = "baseline") {
  app.platform.isolateRestore(
    digest(`synthetic:${label}`),
    "2026-10-03T00:00:00.000Z",
  );
}
function review(app: Application) {
  return app.database.transaction(() =>
    app.platform.restore.offlineReleaseHistoryInTransaction(),
  );
}
function fingerprint(app: Application) {
  const platform = app.database.owned("platform");
  return digest(
    canonical({
      rows: platform.all(
        "SELECT id,state,revision,hash FROM platform_restore_releases ORDER BY id",
      ),
      hold: platform.all("SELECT * FROM platform_recovery"),
      commands: platform.all(
        "SELECT * FROM platform_commands ORDER BY org_id,actor_id,name,key",
      ),
      audit: platform.all("SELECT * FROM platform_audit ORDER BY id"),
      clock: platform.all("SELECT * FROM platform_audit_clock"),
      events: platform.all("SELECT * FROM platform_events ORDER BY id"),
    }),
  );
}

for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const) {
  test(`${region}/${currency}: complete 1000-row history includes last unresolved release without touching hold or audit`, (t) => {
    const f = fixture(t, {}, region, currency);
    hold(f.app);
    f.app.database.transaction(() => {
      for (let i = 0; i < 999; i++)
        put(f.app, retained(`terminal-${String(i).padStart(4, "0")}`));
      put(f.app, retained("zz-unresolved", ["prepared", "fencing"]));
    });
    const before = fingerprint(f.app),
      r = review(f.app);
    assert.equal(r.releases.length, 1000);
    assert.equal(r.releases.at(-1)!.id, "zz-unresolved");
    assert.equal(r.classification.barrier, "control-intent-retained");
    assert.equal(r.classification.releaseCount, 1000);
    assert.deepEqual(Object.keys(r).sort(), ["classification", "releases"]);
    assert.equal(fingerprint(f.app), before);
    assert.equal(f.app.platform.restore.permits(), false);
  });
}

test("real isolate writer appends a digest-consistent supersession in the same transaction and rollback retains the old generation", (t) => {
  const f = fixture(t);
  hold(f.app);
  put(
    f.app,
    retained("active", [
      "prepared",
      "fencing",
      "fenced",
      "routing",
      "released",
    ]),
  );
  const original = review(f.app),
    before = fingerprint(f.app);
  const oldHold = f.app.database
    .owned("platform")
    .get("SELECT * FROM platform_recovery");
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        hold(f.app, "next");
        const r =
          f.app.platform.restore.offlineReleaseHistoryInTransaction()
            .releases[0]!;
        assert.equal(r.state, "superseded");
        assert.equal(r.revision, 6);
        assert.deepEqual(r.history.slice(0, -1), original.releases[0]!.history);
        assert.equal(r.history.at(-1)!.at, original.releases[0]!.at);
        const row = f.app.database
          .owned("platform")
          .get(
            "SELECT record,hash FROM platform_restore_releases WHERE id='active'",
          )!;
        assert.equal(row.hash, digest(String(row.record)));
        assert.equal(JSON.parse(String(row.record)).revision, r.revision);
        assert.equal(
          f.app.database
            .owned("platform")
            .get("SELECT snapshot_hash FROM platform_recovery")!.snapshot_hash,
          digest("synthetic:next"),
        );
        throw new Error("synthetic rollback after native isolation");
      }),
    /synthetic rollback after native isolation/,
  );
  assert.equal(fingerprint(f.app), before);
  assert.deepEqual(
    f.app.database.owned("platform").get("SELECT * FROM platform_recovery"),
    oldHold,
  );
  assert.deepEqual(review(f.app), original);
  f.app.database.transaction(() => hold(f.app, "next"));
  const committed = review(f.app);
  assert.equal(committed.releases[0]!.state, "superseded");
  assert.equal(committed.classification.barrier, "control-intent-retained");
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(review(f.app), committed);
  assert.equal(f.app.platform.restore.permits(), false);
});

test("raw hold insertion and removal are seen on the same writer, while rolled-back hold does not authorize a later read", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        hold(f.app);
        assert.deepEqual(
          f.app.platform.restore.offlineReleaseHistoryInTransaction().releases,
          [],
        );
        throw new Error("rollback initial hold");
      }),
    /rollback initial hold/,
  );
  assert.throws(() => review(f.app), { code: "RECOVERY_HOLD" });
  hold(f.app);
  const before = fingerprint(f.app);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        f.app.database.owned("platform").run("DELETE FROM platform_recovery");
        f.app.platform.restore.offlineReleaseHistoryInTransaction();
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(fingerprint(f.app), before);
  assert.deepEqual(review(f.app).releases, []);
});

test("64 MiB aggregate boundary is exact and excess refuses before any JSON parse", (t) => {
  const f = fixture(t);
  hold(f.app);
  const limit = 8 * 1024 * 1024;
  f.app.database.transaction(() => {
    for (let i = 0; i < 8; i++) {
      const r = retained(`large-${i}`);
      // Extra dossier-shaped data is outside the projection contract. Padding
      // lives in valid JSON; every body is exactly the permitted UTF8 size.
      const empty = canonical({ ...r, syntheticUnprojectedPadding: "" });
      const raw = canonical({
        ...r,
        syntheticUnprojectedPadding: "x".repeat(
          limit - Buffer.byteLength(empty),
        ),
      });
      assert.equal(Buffer.byteLength(raw), limit);
      put(f.app, r, raw);
    }
  });
  const parse = JSON.parse;
  let calls = 0;
  const spy = t.mock.method(
    JSON,
    "parse",
    (...args: Parameters<typeof JSON.parse>) => {
      calls++;
      return parse(...args);
    },
  );
  try {
    const exact = review(f.app);
    assert.equal(exact.releases.length, 8);
    assert.equal(calls, 8);
    assert.equal(
      canonical(exact).includes("syntheticUnprojectedPadding"),
      false,
    );
    put(f.app, retained("overflow"));
    calls = 0;
    const before = fingerprint(f.app);
    assert.throws(() => review(f.app), {
      code: "RESTORE_STATE",
      message: "Offline review requires complete bounded release history.",
    });
    assert.equal(calls, 0);
    assert.equal(fingerprint(f.app), before);
  } finally {
    spy.mock.restore();
  }
});

test("UTF8 aggregate budget refuses many individually valid bodies before decoding even the first record", (t) => {
  const f = fixture(t);
  hold(f.app);
  // Nine bodies are each under 8 MiB and together exceed 64 MiB. UTF16 length
  // alone is under the total budget, so counting characters would be unsafe.
  const padding = "€".repeat(2500000);
  let totalBytes = 0,
    totalChars = 0;
  f.app.database.transaction(() => {
    for (let i = 0; i < 9; i++) {
      const r = retained(`unicode-${i}`),
        raw = canonical({ ...r, syntheticUnprojectedPadding: padding });
      assert.ok(Buffer.byteLength(raw) < 8 * 1024 * 1024);
      totalBytes += Buffer.byteLength(raw);
      totalChars += raw.length;
      put(f.app, r, raw);
    }
  });
  assert.ok(totalBytes > 64 * 1024 * 1024);
  assert.ok(totalChars < 64 * 1024 * 1024);
  let calls = 0;
  const parse = JSON.parse;
  const spy = t.mock.method(
    JSON,
    "parse",
    (...args: Parameters<typeof JSON.parse>) => {
      calls++;
      return parse(...args);
    },
  );
  try {
    assert.throws(() => review(f.app), {
      code: "RESTORE_STATE",
      message: "Offline review requires complete bounded release history.",
    });
    assert.equal(calls, 0);
  } finally {
    spy.mock.restore();
  }
});

test("malformed version or head among valid terminals refuses the entire result, leaving all evidence unchanged", (t) => {
  const f = fixture(t);
  hold(f.app);
  put(f.app, retained("a-valid"));
  put(f.app, retained("z-valid"));
  const store = f.app.database.owned("platform");
  const original = retained("m-corrupt");
  for (const change of [
    { version: 2 },
    { id: "different-id" },
    { revision: "2" },
    { state: "rolled-back" },
  ]) {
    put(f.app, original, canonical({ ...original, ...change }));
    const before = fingerprint(f.app);
    assert.throws(() => review(f.app), {
      code: "RESTORE_STATE",
      message: "Retained release journal cannot be decoded consistently.",
    });
    assert.equal(fingerprint(f.app), before);
    store.run("DELETE FROM platform_restore_releases WHERE id=?", original.id);
  }
  assert.equal(review(f.app).releases.length, 2);
});

test("projection detached before a later committed native supersession remains immutable and is not a live authority", (t) => {
  const f = fixture(t);
  hold(f.app);
  put(f.app, retained("active", ["prepared"]));
  const old = review(f.app),
    pinned = canonical(old);
  f.app.database.transaction(() => hold(f.app, "different-generation"));
  const next = review(f.app);
  assert.equal(next.releases[0]!.state, "superseded");
  assert.equal(old.releases[0]!.state, "prepared");
  assert.equal(canonical(old), pinned);
  assert.notStrictEqual(next.releases[0], old.releases[0]);
  assert.throws(
    () => Object.assign(old.classification, { barrier: "no-recorded-release" }),
    TypeError,
  );
  assert.throws(
    () => Object.assign(old.releases[0]!.history[0]!, { state: "released" }),
    TypeError,
  );
  assert.equal(f.app.platform.restore.permits(), false);
  assert.equal(next.classification.barrier, "prepared-release-retained");
});

test("foreign and platform SQL callbacks cannot turn the history method into an owner-scope escape", (t) => {
  const f = fixture(t);
  hold(f.app);
  put(f.app, retained("retained"));
  const before = fingerprint(f.app);
  f.app.database.transaction(() => {
    for (const owner of ["integration", "billing", "platform"] as const) {
      f.app.database.execute(owner, () => {
        assert.throws(
          () => f.app.platform.restore.offlineReleaseHistoryInTransaction(),
          { code: "TRANSACTION" },
        );
      });
    }
    for (const owner of ["integration", "billing"] as const) {
      assert.throws(() =>
        f.app.database
          .owned(owner)
          .all("SELECT record FROM platform_restore_releases"),
      );
      assert.throws(() =>
        f.app.database
          .owned(owner)
          .run("UPDATE platform_restore_releases SET hash='forged'"),
      );
      assert.throws(() =>
        f.app.database.owned(owner).run("DELETE FROM platform_recovery"),
      );
    }
    assert.equal(
      f.app.platform.restore.offlineReleaseHistoryInTransaction().releases
        .length,
      1,
    );
  });
  assert.equal(fingerprint(f.app), before);
});

test("a second connection cannot write between preflight and decoding, and sees only committed retained history", (t) => {
  const f = fixture(t);
  hold(f.app);
  put(f.app, retained("base"));
  const observer = new DatabaseSync(f.path, { timeout: 0 });
  t.after(() => observer.close());
  f.app.database.transaction(() => {
    put(f.app, retained("uncommitted"));
    assert.equal(
      observer
        .prepare("SELECT count(*) AS count FROM platform_restore_releases")
        .get()!.count,
      1,
    );
    assert.throws(() => observer.exec("BEGIN IMMEDIATE"), /locked/);
    assert.equal(
      f.app.platform.restore.offlineReleaseHistoryInTransaction().releases
        .length,
      2,
    );
  });
  assert.equal(
    observer
      .prepare("SELECT count(*) AS count FROM platform_restore_releases")
      .get()!.count,
    2,
  );
  assert.equal(review(f.app).releases.length, 2);
});
