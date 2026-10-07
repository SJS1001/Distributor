import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { schemaFingerprint, SCHEMA_VERSION } from "../src/server/schema.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import frozen from "./schema-version-twenty-nine.json" with { type: "json" };
function raw<T>(path: string, fn: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
for (const profile of frozen.profiles)
  test(`frozen schema29 upgrades additively to current preserving every existing fact; reports=${profile.eventReports}`, async (t) => {
    const f = fixture(t, { eventReports: profile.eventReports });
    const order = accept(f);
    ship(f, order.id);
    f.app.catalog.setProductMsrp(f.actor, "migration-msrp", {
      productId: f.product,
      msrpCents: 15000,
      revision: 0,
      reason: "Synthetic migration evidence",
    });
    const note = f.app.notes.add(f.actor, "migration-note", {
      kind: "customer",
      recordId: f.buyer,
      body: "Historical staff annotation",
    });
    const reviewerUser = f.app.identity.createUser(
      f.actor,
      "migration-reviewer",
      {
        name: "Reviewer",
        email: "reviewer@example.test",
        password: "synthetic-reviewer-password",
        role: "commercial",
        sites: [],
      },
    );
    const reviewer = f.app.identity.currentActor({
      ...f.actor,
      id: reviewerUser.id,
    });
    const verified = f.app.notes.verify(reviewer, "migration-verify", {
      kind: "customer",
      recordId: f.buyer,
      noteId: note.id,
    });
    const accessory = f.app.catalog.create(f.actor, "migration-accessory", {
      sku: "ACC-1",
      name: "Synthetic accessory",
      serialized: false,
      unitPrice: 2500,
      taxBasisPoints: 1300,
    }).id;
    const source = join(f.path, "..", "source29.db"),
      target = join(f.path, "..", "target30.db");
    const tables = profile.schema
      .filter((o) => o.type === "table" && o.name !== "platform_schema_version")
      .map((o) => o.name);
    const rows = (path: string) =>
      raw(path, (db) =>
        Object.fromEntries(
          tables.map((table) => [
            table,
            db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
          ]),
        ),
      );
    const seed = rows(f.path);
    raw(source, (db) => {
      // Import the frozen table set in name order, then validate every relationship.
      db.exec("PRAGMA foreign_keys=OFF");
      for (const o of profile.schema.filter((o) => o.type === "table"))
        db.exec(o.sql);
      for (const table of tables)
        for (const row of seed[table]!) {
          const keys = Object.keys(row);
          db.prepare(
            `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          ).run(...(Object.values(row) as SQLInputValue[]));
        }
      for (const o of profile.schema.filter((o) => o.type !== "table"))
        db.exec(o.sql);
      db.exec("PRAGMA foreign_keys=ON");
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(schemaFingerprint(db), profile.hash);
      db.prepare(
        "INSERT INTO platform_schema_version VALUES(1,29,?,?,?,?)",
      ).run(
        profile.hash,
        Number(profile.eventReports),
        "CA",
        "2026-10-05T00:00:00.000Z",
      );
    });
    const bytes = readFileSync(source),
      before = rows(source);
    assert.deepEqual(before, seed);
    assert.equal(inspectSchema(source).version, 29);
    assert.throws(
      () =>
        new Application(source, "CA", { eventReports: profile.eventReports }),
      { code: "SCHEMA_UPGRADE_REQUIRED" },
    );
    assert.deepEqual(readFileSync(source), bytes);
    const receipt = await upgradeSchema(source, target, profile.hash, "CA");
    assert.equal(receipt.sourceVersion, 29);
    assert.equal(receipt.version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 33);
    assert.deepEqual(rows(target), before);
    assert.equal(inspectSchema(target).kind, "current");
    assert.equal(
      inspectSchema(target).initializedAt,
      "2026-10-05T00:00:00.000Z",
    );
    raw(target, (db) => {
      for (const table of [
        "catalog_product_addon_sets",
        "catalog_product_addons",
      ])
        assert.equal(
          db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n,
          0,
        );
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        db.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
    });
    const app = new Application(target, "CA", {
      eventReports: profile.eventReports,
    });
    try {
      assert.equal(
        app.notes.list(f.actor, { kind: "customer", recordId: f.buyer })
          .items[0]!.id,
        note.id,
      );
      assert.deepEqual(
        app.notes.list(f.actor, { kind: "customer", recordId: f.buyer })
          .items[0],
        verified,
      );
      assert.throws(
        () =>
          app.database
            .owned("notes")
            .run("UPDATE notes_records SET body='altered'"),
        /append-only/,
      );
      assert.throws(
        () =>
          app.database.owned("notes").run("DELETE FROM notes_verifications"),
        /append-only/,
      );
      const addons = app.catalog.setProductAddons(f.actor, "after-upgrade", {
        productId: f.product,
        addonIds: [accessory],
        revision: 0,
        reason: "Synthetic add-on after upgrade",
      });
      assert.deepEqual(
        app.catalog.productAddons(f.actor, f.product).addons.map((a) => a.id),
        [accessory],
      );
      assert.equal(addons.revision, 1);
      const contact = app.identity.contacts.save(f.actor, "after-upgrade", {
        accountId: f.buyer,
        expectedRevision: 0,
        name: "New contact",
        title: "",
        email: "",
        phone: "",
        archived: false,
      });
      assert.equal(
        app.identity.contacts.list(f.actor, f.buyer).items[0]!.id,
        contact.id,
      );
    } finally {
      app.close();
    }
    assert.deepEqual(readFileSync(source), bytes);
  });
