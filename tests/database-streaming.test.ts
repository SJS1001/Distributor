import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../src/server/database.ts";

test("owned row visitors retain authorization, bind inputs and restore ownership after nested reads", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  const inventory = db.owned("inventory"),
    integration = db.owned("integration");
  inventory.migrate(
    "CREATE TABLE inventory_example(n INTEGER PRIMARY KEY) STRICT;",
  );
  integration.migrate(
    "CREATE TABLE integration_example(n INTEGER PRIMARY KEY) STRICT;",
  );
  for (const n of [1, 2, 3])
    inventory.run("INSERT INTO inventory_example VALUES(?)", n);
  integration.run("INSERT INTO integration_example VALUES(8)");
  const seen: number[] = [];
  inventory.visit<{ n: number }>(
    "SELECT n FROM inventory_example WHERE n>? ORDER BY n",
    [1],
    ({ n }) => {
      seen.push(n);
      assert.equal(
        integration.get<{ n: number }>("SELECT n FROM integration_example")!.n,
        8,
      );
      assert.throws(
        () => inventory.get("SELECT n FROM integration_example"),
        /prohibited|authorized/,
      );
    },
  );
  assert.deepEqual(seen, [2, 3]);
  assert.throws(
    () => inventory.visit("SELECT * FROM integration_example", [], () => {}),
    /prohibited|authorized/,
  );
  assert.throws(
    () =>
      db.execute("integration", (raw) => {
        inventory.visit("SELECT n FROM inventory_example", [], () => {});
        return raw.prepare("SELECT n FROM inventory_example").get();
      }),
    /prohibited|authorized/,
  );
});

test("row visitor failures finalize the statement and preserve transaction rollback", (t) => {
  const db = new Database(":memory:");
  t.after(() => db.close());
  const store = db.owned("inventory");
  store.migrate(
    "CREATE TABLE inventory_example(n INTEGER PRIMARY KEY) STRICT;",
  );
  for (const n of [1, 2, 3])
    store.run("INSERT INTO inventory_example VALUES(?)", n);
  const failure = new Error("Synthetic visitor failure");
  assert.throws(
    () =>
      db.transaction(() => {
        store.run("INSERT INTO inventory_example VALUES(4)");
        store.visit<{ n: number }>(
          "SELECT n FROM inventory_example ORDER BY n",
          [],
          ({ n }) => {
            if (n === 2) throw failure;
          },
        );
      }),
    failure,
  );
  const seen: number[] = [];
  store.visit<{ n: number }>(
    "SELECT n FROM inventory_example ORDER BY n",
    [],
    ({ n }) => seen.push(n),
  );
  assert.deepEqual(seen, [1, 2, 3]);
  assert.throws(
    () =>
      store.visit("SELECT n FROM inventory_example", [], () =>
        Promise.resolve(),
      ),
    { code: "ITERATION" },
  );
  store.migrate("DROP TABLE inventory_example");
  assert.equal(
    store.get("SELECT name FROM sqlite_master WHERE name='inventory_example'"),
    undefined,
  );
});
