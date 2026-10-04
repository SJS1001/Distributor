import { SCHEMA_VERSION } from "../src/server/schema.ts";
import versionSixteen from "./schema-version-sixteen.json" with { type: "json" };
import versionFifteen from "./schema-version-fifteen.json" with { type: "json" };
import versionFourteen from "./schema-version-fourteen.json" with { type: "json" };
import versionThirteen from "./schema-version-thirteen.json" with { type: "json" };
import versionTwelve from "./schema-version-twelve.json" with { type: "json" };
import versionEleven from "./schema-version-eleven.json" with { type: "json" };
import versionTen from "./schema-version-ten.json" with { type: "json" };
import versionNine from "./schema-version-nine.json" with { type: "json" };
import { approvedCorrection, outcomeInput } from "./cost-correction-fixture.ts";
import versionEight from "./schema-version-eight.json" with { type: "json" };
import versionSeven from "./schema-version-seven.json" with { type: "json" };
import versionSix from "./schema-version-six.json" with { type: "json" };
import versionFive from "./schema-version-five.json" with { type: "json" };
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../src/server/application.ts";
import { Database, Store } from "../src/server/database.ts";
import { inspectSchema, upgradeSchema } from "../src/server/schema-upgrade.ts";
import { fixture, accept, ship, syntheticDisclosure } from "./fixtures.ts";
import baseline from "../src/server/schema-baseline.json" with { type: "json" };

import versionTwo from "./schema-version-two.json" with { type: "json" };
import versionFour from "./schema-version-four.json" with { type: "json" };
import versionThree from "./schema-version-three.json" with { type: "json" };

// Frozen at published d6f8818; independent literal schema-17 additions/hashes.
const versionSeventeen = {
  hashes: {
    enabled: "d5b701319d5933f2357392e90a0ce48dedf0f78540237fd473de4e05d1206f41",
    disabled:
      "338cd156fd11a564935dae8c1f7afb34ee0cbb2547f1f98a97e37c91fb020d1c",
  },
  additions: [
    {
      type: "table",
      name: "inventory_quantity_corrections",
      tbl_name: "inventory_quantity_corrections",
      sql: "CREATE TABLE inventory_quantity_corrections(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,unit_id TEXT NOT NULL,reference TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','reviewed','rejected')),record TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(org_id,reference)) STRICT",
    },
    {
      type: "index",
      name: "inventory_quantity_pending",
      tbl_name: "inventory_quantity_corrections",
      sql: "CREATE UNIQUE INDEX inventory_quantity_pending ON inventory_quantity_corrections(org_id,unit_id) WHERE state='ready'",
    },
    {
      type: "table",
      name: "platform_restore_releases",
      tbl_name: "platform_restore_releases",
      sql: "CREATE TABLE platform_restore_releases(id TEXT PRIMARY KEY,state TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),record TEXT NOT NULL,hash TEXT NOT NULL) STRICT",
    },
    {
      type: "index",
      name: "platform_restore_single_release",
      tbl_name: "platform_restore_releases",
      sql: "CREATE UNIQUE INDEX platform_restore_single_release ON platform_restore_releases((1)) WHERE state NOT IN('rolled-back','superseded')",
    },
  ],
};
// Frozen literal public 30ebbf4 profile; never imported from current DDL.
const versionEighteen = {
  hashes: {
    enabled: "18310a051c7e1d3e278e11251cd1cdc417517148e61aa45a42d39fab96cd07b8",
    disabled:
      "66885390969e98b27ea19044f4e7b3cc399518fb50c9196962d2293f4569d942",
  },
  additions: [
    {
      type: "table",
      name: "platform_offline_generations",
      tbl_name: "platform_offline_generations",
      sql: "CREATE TABLE platform_offline_generations(instance_id TEXT PRIMARY KEY,created_revision INTEGER NOT NULL UNIQUE CHECK(created_revision>0),generation TEXT NOT NULL,generation_hash TEXT NOT NULL) STRICT",
    },
    {
      type: "table",
      name: "platform_offline_journal",
      tbl_name: "platform_offline_journal",
      sql: "CREATE TABLE platform_offline_journal(revision INTEGER PRIMARY KEY CHECK(revision>0),instance_id TEXT NOT NULL REFERENCES platform_offline_generations(instance_id),record TEXT NOT NULL,previous_hash TEXT NOT NULL,state_hash TEXT NOT NULL,hash TEXT NOT NULL) STRICT",
    },
    {
      type: "table",
      name: "platform_offline_head",
      tbl_name: "platform_offline_head",
      sql: "CREATE TABLE platform_offline_head(id INTEGER PRIMARY KEY CHECK(id=1),instance_id TEXT NOT NULL REFERENCES platform_offline_generations(instance_id),revision INTEGER NOT NULL REFERENCES platform_offline_journal(revision),state TEXT NOT NULL,state_hash TEXT NOT NULL,journal_hash TEXT NOT NULL) STRICT",
    },
    {
      type: "table",
      name: "platform_offline_receipts",
      tbl_name: "platform_offline_receipts",
      sql: "CREATE TABLE platform_offline_receipts(owner TEXT NOT NULL,org_id TEXT NOT NULL,task_name TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,instance_id TEXT NOT NULL REFERENCES platform_offline_generations(instance_id),session_id TEXT NOT NULL,revision INTEGER NOT NULL UNIQUE REFERENCES platform_offline_journal(revision),record TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(owner,org_id,task_name,request_id)) STRICT",
    },
    {
      type: "trigger",
      name: "platform_offline_generations_no_update",
      tbl_name: "platform_offline_generations",
      sql: "CREATE TRIGGER platform_offline_generations_no_update BEFORE UPDATE ON platform_offline_generations BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "platform_offline_generations_no_delete",
      tbl_name: "platform_offline_generations",
      sql: "CREATE TRIGGER platform_offline_generations_no_delete BEFORE DELETE ON platform_offline_generations BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "platform_offline_journal_no_update",
      tbl_name: "platform_offline_journal",
      sql: "CREATE TRIGGER platform_offline_journal_no_update BEFORE UPDATE ON platform_offline_journal BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "platform_offline_journal_no_delete",
      tbl_name: "platform_offline_journal",
      sql: "CREATE TRIGGER platform_offline_journal_no_delete BEFORE DELETE ON platform_offline_journal BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "platform_offline_receipts_no_update",
      tbl_name: "platform_offline_receipts",
      sql: "CREATE TRIGGER platform_offline_receipts_no_update BEFORE UPDATE ON platform_offline_receipts BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "platform_offline_receipts_no_delete",
      tbl_name: "platform_offline_receipts",
      sql: "CREATE TRIGGER platform_offline_receipts_no_delete BEFORE DELETE ON platform_offline_receipts BEGIN SELECT RAISE(ABORT,'Offline provenance is append-only'); END",
    },
  ],
};
// Frozen literal public 30ebbf4 profile; never imported from current DDL.
const versionNineteen = {
  hashes: {
    enabled: "78ae9e9a3b784a506d5be099aeb9884e86c783c432944dc6a7e46b7c11ae0521",
    disabled:
      "787d1fd08ff0508d06f017ffbd449e610a295b81d24178d6969e5408602a02c5",
  },
  additions: [
    {
      type: "table",
      name: "integration_offline_failed_refunds",
      tbl_name: "integration_offline_failed_refunds",
      sql: "CREATE TABLE integration_offline_failed_refunds(effect_id TEXT PRIMARY KEY REFERENCES integration_effects(id),org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 65536),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),UNIQUE(org_id,request_id)) STRICT",
    },
    {
      type: "trigger",
      name: "integration_offline_failed_refunds_no_update",
      tbl_name: "integration_offline_failed_refunds",
      sql: "CREATE TRIGGER integration_offline_failed_refunds_no_update BEFORE UPDATE ON integration_offline_failed_refunds BEGIN SELECT RAISE(ABORT,'Offline refund provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "integration_offline_failed_refunds_no_delete",
      tbl_name: "integration_offline_failed_refunds",
      sql: "CREATE TRIGGER integration_offline_failed_refunds_no_delete BEFORE DELETE ON integration_offline_failed_refunds BEGIN SELECT RAISE(ABORT,'Offline refund provenance is append-only'); END",
    },
  ],
};
// Frozen exact published f1583c3 schema-20 identities, independent of v21 DDL.
const versionTwenty = {
  hashes: {
    enabled: "7fd45cbd7a88edbdf10b3f2b1daa220706d9eb5af20f32cfad99291b5e0a3ed5",
    disabled:
      "f1f0d63fb11f4f56c4ec7941f234dadbabac18ff5e3686e5282cf6ed125b1162",
  },
  additions: [
    {
      type: "table",
      name: "integration_offline_original_cancellations",
      tbl_name: "integration_offline_original_cancellations",
      sql: "CREATE TABLE integration_offline_original_cancellations(journal_id TEXT PRIMARY KEY REFERENCES integration_stock_journals(id),org_id TEXT NOT NULL,request_id TEXT NOT NULL,binding TEXT NOT NULL UNIQUE,envelope TEXT NOT NULL CHECK(length(CAST(envelope AS BLOB)) BETWEEN 1 AND 4194304),envelope_hash TEXT NOT NULL CHECK(length(envelope_hash)=64),record TEXT NOT NULL CHECK(length(CAST(record AS BLOB)) BETWEEN 1 AND 16384),record_hash TEXT NOT NULL CHECK(length(record_hash)=64),UNIQUE(org_id,request_id)) STRICT",
    },
    {
      type: "trigger",
      name: "integration_offline_original_cancellations_no_update",
      tbl_name: "integration_offline_original_cancellations",
      sql: "CREATE TRIGGER integration_offline_original_cancellations_no_update BEFORE UPDATE ON integration_offline_original_cancellations BEGIN SELECT RAISE(ABORT,'Offline original provenance is append-only'); END",
    },
    {
      type: "trigger",
      name: "integration_offline_original_cancellations_no_delete",
      tbl_name: "integration_offline_original_cancellations",
      sql: "CREATE TRIGGER integration_offline_original_cancellations_no_delete BEFORE DELETE ON integration_offline_original_cancellations BEGIN SELECT RAISE(ABORT,'Offline original provenance is append-only'); END",
    },
  ],
};
const metadata = "platform_schema_version";
// Independent historical DDL and literal fingerprints; do not derive this fixture
// from the new schema inspector or current module constructors.
const versionOneDDL =
  "CREATE TABLE platform_schema_version (singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,schema_hash TEXT NOT NULL,event_reports INTEGER NOT NULL CHECK(event_reports IN(0,1)),region TEXT NOT NULL CHECK(region IN('CA','US')),initialized_at TEXT NOT NULL) STRICT";
const versionOneHashes = {
  enabled: "3f71c82beebdec3b77f73b1fd42a1b40fda31d068411fca007ff304272260df6",
  disabled: "3211e34356f19967e025451a7299201e274cdc4a3cf15ccc8a5a892d94301221",
};
function frozenVersionOne(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  const rows = snapshot(source);
  const profile = baseline.schemas.find(
    (p) => p.eventReports === eventReports,
  )!;
  raw(destination, (db) => {
    // Reconstruct rows in manifest order while checking all references at commit.
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of profile.schema.filter((o) => o.type === "table"))
      db.exec(object.sql!);
    for (const object of profile.schema.filter((o) => o.type === "table")) {
      const records = rows[object.name]!;
      for (const record of records) {
        const columns = Object.keys(record),
          quoted = columns.map((name) => `"${name.replaceAll('"', '""')}"`);
        db.prepare(
          `INSERT INTO "${object.name}" (${quoted.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((name) => record[name]!));
      }
    }
    for (const object of profile.schema.filter((o) => o.type !== "table"))
      db.exec(object.sql!);
    db.exec(versionOneDDL);
    db.prepare("INSERT INTO platform_schema_version VALUES(1,1,?,?,?,?)").run(
      eventReports ? versionOneHashes.enabled : versionOneHashes.disabled,
      Number(eventReports),
      region,
      "2026-09-30T12:34:56.000Z",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionTwo(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionOne(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionTwo.additions) {
      db.exec(object.sql);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((name) => `"${name}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((name) => record[name]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=2,schema_hash=?",
    ).run(
      eventReports ? versionTwo.hashes.enabled : versionTwo.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionThree(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionTwo(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionThree.additions.filter((entry) => entry.type === "table"),
      ...versionThree.additions.filter((entry) => entry.type !== "table"),
    ]) {
      db.exec(object.sql!);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=3,schema_hash=?",
    ).run(
      eventReports ? versionThree.hashes.enabled : versionThree.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionFour(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionThree(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionFour.additions) {
      db.exec(object.sql!);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=4,schema_hash=?",
    ).run(
      eventReports ? versionFour.hashes.enabled : versionFour.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionFive(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionFour(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionFive.additions) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=5,schema_hash=?",
    ).run(
      eventReports ? versionFive.hashes.enabled : versionFive.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionSix(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionFive(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionSix.additions) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=6,schema_hash=?",
    ).run(
      eventReports ? versionSix.hashes.enabled : versionSix.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionSeven(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionSix(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionSeven.additions) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=7,schema_hash=?",
    ).run(
      eventReports ? versionSeven.hashes.enabled : versionSeven.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionEight(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionSeven(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionEight.additions) {
      db.exec(object.sql);
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=8,schema_hash=?",
    ).run(
      eventReports ? versionEight.hashes.enabled : versionEight.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionNine(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionEight(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionNine.additions) db.exec(object.sql);
    for (const object of versionNine.additions) {
      if (object.type !== "table") continue;
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=9,schema_hash=?",
    ).run(
      eventReports ? versionNine.hashes.enabled : versionNine.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionTen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionNine(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionTen.additions.filter((o) => o.type === "table"),
      ...versionTen.additions.filter((o) => o.type !== "table"),
    ])
      db.exec(object.sql);
    for (const object of versionTen.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=10,schema_hash=?",
    ).run(
      eventReports ? versionTen.hashes.enabled : versionTen.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionEleven(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionTen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionEleven.additions.filter((o) => o.type === "table"),
      ...versionEleven.additions.filter((o) => o.type !== "table"),
    ])
      db.exec(object.sql);
    for (const object of versionEleven.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=11,schema_hash=?",
    ).run(
      eventReports
        ? versionEleven.hashes.enabled
        : versionEleven.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionTwelve(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionEleven(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionTwelve.additions.filter((o) => o.type === "table"),
      ...versionTwelve.additions.filter((o) => o.type !== "table"),
    ])
      db.exec(object.sql);
    for (const object of versionTwelve.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=12,schema_hash=?",
    ).run(
      eventReports
        ? versionTwelve.hashes.enabled
        : versionTwelve.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionThirteen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionTwelve(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionThirteen.additions.filter((o) => o.type === "table"),
      ...versionThirteen.additions.filter((o) => o.type !== "table"),
    ])
      db.exec(object.sql);
    for (const object of versionThirteen.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=13,schema_hash=?",
    ).run(
      eventReports
        ? versionThirteen.hashes.enabled
        : versionThirteen.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionFourteen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionThirteen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of [
      ...versionFourteen.additions.filter((o) => o.type === "table"),
      ...versionFourteen.additions.filter((o) => o.type !== "table"),
    ])
      db.exec(object.sql);
    for (const object of versionFourteen.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=14,schema_hash=?",
    ).run(
      eventReports
        ? versionFourteen.hashes.enabled
        : versionFourteen.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionFifteen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionFourteen(source, destination, eventReports, region);
  raw(destination, (db) => {
    db.exec("BEGIN");
    db.exec(`DROP INDEX ${versionFifteen.drop}`);
    for (const object of versionFifteen.additions) db.exec(object.sql);
    db.prepare(
      "UPDATE platform_schema_version SET version=15,schema_hash=?",
    ).run(
      eventReports
        ? versionFifteen.hashes.enabled
        : versionFifteen.hashes.disabled,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.exec("COMMIT");
  });
}
function frozenVersionSixteen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionFifteen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN");
    for (const object of versionSixteen.additions) db.exec(object.sql);
    for (const object of versionSixteen.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=16,schema_hash=?",
    ).run(
      eventReports
        ? versionSixteen.hashes.enabled
        : versionSixteen.hashes.disabled,
    );
    db.exec("COMMIT");
  });
}
function frozenVersionSeventeen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionSixteen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN");
    for (const object of versionSeventeen.additions) db.exec(object.sql);
    for (const object of versionSeventeen.additions.filter(
      (o) => o.type === "table",
    )) {
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    db.prepare(
      "UPDATE platform_schema_version SET version=17,schema_hash=?",
    ).run(
      eventReports
        ? versionSeventeen.hashes.enabled
        : versionSeventeen.hashes.disabled,
    );
    db.exec("COMMIT");
  });
}
function frozenVersionEighteen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionSeventeen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionEighteen.additions.filter(
      (o) => o.type === "table",
    )) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    for (const object of versionEighteen.additions.filter(
      (o) => o.type !== "table",
    ))
      db.exec(object.sql);
    db.prepare(
      "UPDATE platform_schema_version SET version=18,schema_hash=?",
    ).run(
      eventReports
        ? versionEighteen.hashes.enabled
        : versionEighteen.hashes.disabled,
    );
    db.exec("COMMIT");
  });
}
function frozenVersionNineteen(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionEighteen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionNineteen.additions.filter(
      (o) => o.type === "table",
    )) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    for (const object of versionNineteen.additions.filter(
      (o) => o.type !== "table",
    ))
      db.exec(object.sql);
    db.prepare(
      "UPDATE platform_schema_version SET version=19,schema_hash=?",
    ).run(
      eventReports
        ? versionNineteen.hashes.enabled
        : versionNineteen.hashes.disabled,
    );
    db.exec("COMMIT");
  });
}
function frozenVersionTwenty(
  source: string,
  destination: string,
  eventReports: boolean,
  region: "CA" | "US",
) {
  frozenVersionNineteen(source, destination, eventReports, region);
  const rows = snapshot(source);
  raw(destination, (db) => {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON");
    for (const object of versionTwenty.additions.filter(
      (o) => o.type === "table",
    )) {
      db.exec(object.sql);
      for (const record of rows[object.name]!) {
        const columns = Object.keys(record);
        db.prepare(
          `INSERT INTO "${object.name}" (${columns.map((n) => `"${n}"`).join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
        ).run(...columns.map((n) => record[n]!));
      }
    }
    for (const object of versionTwenty.additions.filter(
      (o) => o.type !== "table",
    ))
      db.exec(object.sql);
    db.prepare(
      "UPDATE platform_schema_version SET version=20,schema_hash=?",
    ).run(
      eventReports
        ? versionTwenty.hashes.enabled
        : versionTwenty.hashes.disabled,
    );
    db.exec("COMMIT");
  });
}
function directory(t: { after: (fn: () => void) => void }) {
  const path = mkdtempSync(join(tmpdir(), "distributor-schema-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function raw<T>(path: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function schema(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name",
    )
    .all();
}
function hash(path: string) {
  return raw(path, (db) =>
    createHash("sha256")
      .update(JSON.stringify(schema(db)))
      .digest("hex"),
  );
}
function snapshot(path: string) {
  return raw(path, (db) =>
    Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .filter((r) => r.name !== metadata)
        .map((r) => [
          String(r.name),
          db
            .prepare(
              `SELECT * FROM "${String(r.name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
    ),
  );
}
function legacy(path: string) {
  raw(path, (db) =>
    db.exec(
      `DROP TABLE integration_offline_canada_post_members; DROP TABLE integration_offline_original_cancellations; DROP TABLE integration_offline_failed_refunds; DROP TABLE platform_offline_head; DROP TABLE platform_offline_receipts; DROP TABLE platform_offline_journal; DROP TABLE platform_offline_generations; DROP TABLE platform_restore_releases; DROP TABLE inventory_quantity_corrections; DROP TABLE inventory_valuation_policies; DROP TABLE inventory_valuations; DROP TABLE inventory_valuation_positions; DROP TABLE inventory_value_effects; DROP TABLE inventory_value_splits; DROP TABLE integration_ledger_revocations; DROP TABLE integration_ledger_authorizations; DROP TABLE integration_stock_journal_observations; DROP TABLE integration_stock_journal_references; DROP TABLE integration_stock_journals; DROP TABLE iam_ledger_choices; DROP TABLE iam_ledger_disclosure_current; DROP TABLE iam_ledger_disclosures; DROP TABLE integration_cost_retry_outcomes; DROP TABLE integration_cost_retry_references; DROP TABLE integration_cost_correction_retries; DROP TABLE integration_cost_correction_outcomes; DROP TABLE integration_cost_correction_references; DROP TABLE integration_cost_corrections; DROP TABLE integration_cost_policies; DROP TABLE procurement_supplier_changes; DROP TABLE fulfillment_coverage; DROP TABLE warranty_claim_coverage; DROP TABLE integration_credit_cancellations; DROP TABLE integration_credential_revocations; DROP TABLE integration_canada_post_members; DROP TABLE integration_canada_post_groups; DROP TABLE ${metadata}`,
    ),
  );
}
function conservedUpgrade(
  path: string,
  before: ReturnType<typeof snapshot>,
  sourceVersion = 1,
) {
  const after = snapshot(path);
  for (const name of [
    "integration_offline_canada_post_members",
    "integration_offline_original_cancellations",
    "integration_offline_failed_refunds",
    "platform_offline_head",
    "platform_offline_receipts",
    "platform_offline_journal",
    "platform_offline_generations",
    "platform_restore_releases",
    "inventory_quantity_corrections",
    "inventory_valuation_policies",
    "inventory_valuations",
    "inventory_valuation_positions",
    "inventory_value_effects",
    "inventory_value_splits",
    "integration_ledger_revocations",
    "integration_ledger_authorizations",
    "integration_stock_journal_observations",
    "integration_stock_journal_references",
    "integration_stock_journals",
    "iam_ledger_choices",
    "iam_ledger_disclosure_current",
    "iam_ledger_disclosures",
    "integration_canada_post_groups",
    "integration_canada_post_members",
    "integration_credential_revocations",
    "integration_credit_cancellations",
    "warranty_claim_coverage",
    "fulfillment_coverage",
    "procurement_supplier_changes",
    "integration_cost_retry_outcomes",
    "integration_cost_retry_references",
    "integration_cost_correction_retries",
    "integration_cost_correction_outcomes",
    "integration_cost_correction_references",
    "integration_cost_policies",
    "integration_cost_corrections",
  ]) {
    if (
      sourceVersion >= 20 &&
      name === "integration_offline_original_cancellations"
    )
      continue;
    if (sourceVersion >= 19 && name === "integration_offline_failed_refunds")
      continue;
    if (sourceVersion >= 18 && name.startsWith("platform_offline_")) continue;
    if (
      sourceVersion >= 17 &&
      ["platform_restore_releases", "inventory_quantity_corrections"].includes(
        name,
      )
    )
      continue;
    if (
      sourceVersion >= 16 &&
      (name.startsWith("inventory_valuation") ||
        name.startsWith("inventory_value_"))
    )
      continue;
    if (sourceVersion >= 14 && name === "integration_ledger_revocations")
      continue;
    if (sourceVersion >= 13 && name === "integration_ledger_authorizations")
      continue;
    if (sourceVersion >= 12 && name.startsWith("integration_stock_journal"))
      continue;
    if (sourceVersion >= 11 && name.startsWith("iam_ledger_")) continue;
    if (sourceVersion >= 2 && name.startsWith("integration_canada_post"))
      continue;
    if (sourceVersion >= 3 && name === "integration_credential_revocations")
      continue;
    if (sourceVersion >= 4 && name === "integration_credit_cancellations")
      continue;
    if (sourceVersion >= 5 && name === "warranty_claim_coverage") continue;
    if (sourceVersion >= 6 && name === "fulfillment_coverage") continue;
    if (sourceVersion >= 7 && name === "procurement_supplier_changes") continue;
    if (
      sourceVersion >= 8 &&
      ["integration_cost_policies", "integration_cost_corrections"].includes(
        name,
      )
    )
      continue;
    if (
      sourceVersion >= 9 &&
      [
        "integration_cost_correction_outcomes",
        "integration_cost_correction_references",
      ].includes(name)
    )
      continue;
    if (
      sourceVersion >= 10 &&
      [
        "integration_cost_retry_outcomes",
        "integration_cost_retry_references",
        "integration_cost_correction_retries",
      ].includes(name)
    )
      continue;
    assert.deepEqual(
      after[name],
      [],
      "upgrade must add only empty group storage",
    );
    delete after[name];
  }
  assert.deepEqual(after, before);
}
function child(t: { after: (fn: () => void) => void }) {
  const c = fork(new URL("./schema-upgrade-child.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  c.stderr?.on("data", (data) => (stderr += String(data)));
  t.after(() => c.kill());
  return { c, stderr: () => stderr };
}
function reply(c: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("Child IPC deadline exceeded"));
    }, 20000);
    const message = (m: unknown) => {
      cleanup();
      resolve(m);
    };
    const exit = (code: number | null) => {
      cleanup();
      reject(Error(`Child exited before IPC: ${code}`));
    };
    function cleanup() {
      clearTimeout(timer);
      c.off("message", message);
      c.off("exit", exit);
    }
    c.once("message", message);
    c.once("exit", exit);
  });
}

test("blank initialization publishes one version receipt atomically; restart preserves its bytes", (t) => {
  const path = join(directory(t), "fresh.db");
  const app = new Application(path);
  app.close();
  const receipt = raw(path, (db) =>
    db.prepare(`SELECT * FROM ${metadata}`).all(),
  );
  assert.equal(receipt.length, 1);
  const before = hash(path);
  const restarted = new Application(path);
  restarted.close();
  assert.equal(hash(path), before);
  assert.deepEqual(
    raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
  assert.doesNotThrow(() => inspectSchema(path));
});

for (const sourceVersion of [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
])
  for (const region of ["CA", "US"] as const)
    for (const eventReports of [false, true])
      test(`independent version-${sourceVersion} ${region}/${eventReports} fixture requires explicit upgrade and preserves native records, sessions and ciphertext`, async (t) => {
        const security = {
          eventReports,
          providerEncryptionKey: "ab".repeat(32),
        };
        const f = fixture(t, security, region);
        if (sourceVersion >= 8) {
          const { c, reviewer, approved } = approvedCorrection(f);
          if (sourceVersion >= 9)
            c.observe(
              reviewer,
              "historical-cancelled",
              outcomeInput(f, approved.id, "reversal", {
                outcome: "cancelled-unposted",
                evidence: "Synthetic historical cancellation",
              }),
            );
          if (sourceVersion >= 10) {
            const state = c.outcomes(f.actor, approved.id),
              leg = state.legs.find((entry) => entry.leg === "reversal")!;
            const prepared = c.prepareRetry(f.actor, "historical-retry", {
              correctionId: approved.id,
              contentHash: state.contentHash,
              leg: "reversal",
              previousAttemptId: leg.attemptId,
              previousRevision: leg.current!.revision,
              previousEvidenceHash: leg.current!.evidenceHash,
              policyRevision: state.policyRevision,
              externalRef: "synthetic-historical-retry",
              reason:
                "Synthetic independently confirmed historical non-posting",
            });
            c.decideRetry(reviewer, "historical-retry-approved", {
              retryId: prepared.id,
              reviewHash: prepared.reviewHash,
              decision: "approve",
              reason: "Synthetic independent historical review",
            });
          }
        }
        if (sourceVersion >= 11) {
          const r = f.app.identity.organizationResidency;
          const { provider: _provider, ...terms } = syntheticDisclosure(
            f.app,
            "quickbooks",
          );
          r.publish(f.actor, "historical-ledger-terms", terms);
          const current = r.current(f.actor);
          r.choose(f.actor, "historical-ledger-choice", {
            region,
            revision: current.choice.revision,
            mode: "provider-exception",
            realm: "12345",
            acknowledgment: "Synthetic historical organization exception",
            acceptance: {
              disclosureId: current.terms!.id,
              disclosureHash: current.terms!.hash,
              representative: "Synthetic finance",
              evidenceRef: "synthetic:ledger",
            },
          });
        }
        if (sourceVersion >= 13) {
          const binding = {
            id: "synthetic-historical-organization",
            orgId: f.actor.orgId,
            workerUserId: f.actor.id,
            realm: "12345",
            clientId: "synthetic-client",
            redirectUri: "http://127.0.0.1:3000/organization-callback",
          };
          f.app.providerCredentials.ledger.authorization.begin(
            binding,
            0,
            f.app.identity.organizationResidency.permission(
              f.actor,
              binding.realm,
            ),
          );
        }
        const nativeShipment = ship(f, accept(f).id);
        const invoice = nativeShipment.invoiceId;
        // Versions before six could not retain shipment policy.
        if (sourceVersion < 6)
          f.app.database
            .owned("fulfillment")
            .run(
              "DELETE FROM fulfillment_coverage WHERE shipment_id=?",
              nativeShipment.id,
            );
        const historicalClaim = f.app.warranty.submit(
          f.actor,
          "historical-claim",
          {
            accountId: f.buyer,
            unitId: f.app.inventory.trace(f.actor, "S1").unit.id,
            type: "warranty",
            issue: "Synthetic historical warranty",
            evidence: "Synthetic frozen previous-version evidence",
          },
        );
        const session = f.app.identity.login(
          "admin@example.test",
          "long-test-only-password",
        );
        const binding = {
          id: "synthetic-v1-binding",
          orgId: f.actor.orgId,
          workerUserId: f.actor.id,
          realm: "1234",
          clientId: "synthetic-v1-client",
        };
        f.app.providerCredentials.install(binding, 0, {
          accessToken: "synthetic-v1-access",
          refreshToken: "synthetic-v1-refresh",
          accessExpiresAt: Date.now() + 3600000,
          refreshExpiresAt: Date.now() + 86400000,
        });
        const dir = directory(t),
          source = join(dir, `v${sourceVersion}.db`),
          destination = join(dir, "upgraded-v11.db");
        if (sourceVersion >= 2) {
          // Retain a locally prepared group, without claiming a provider response.
          f.app.database
            .owned("integration")
            .run(
              "INSERT INTO integration_canada_post_groups VALUES(?,?,?,?,?,?,'prepared',NULL,NULL,NULL,NULL,NULL,?)",
              "synthetic-retained-group",
              f.actor.orgId,
              f.w1,
              "a".repeat(64),
              "synthetic-group",
              "b".repeat(64),
              "2026-09-30T12:34:56.000Z",
            );
        }
        if (sourceVersion >= 3) {
          f.app.database
            .owned("integration")
            .run(
              "INSERT INTO integration_credential_revocations VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,?)",
              "synthetic-retained-revocation",
              f.actor.orgId,
              binding.id,
              f.actor.id,
              f.buyer,
              binding.realm,
              binding.clientId,
              1,
              2,
              1,
              "unknown",
              1790812800000,
              "Synthetic retained operator evidence",
            );
        }
        (sourceVersion === 1
          ? frozenVersionOne
          : sourceVersion === 2
            ? frozenVersionTwo
            : sourceVersion === 3
              ? frozenVersionThree
              : sourceVersion === 4
                ? frozenVersionFour
                : sourceVersion === 5
                  ? frozenVersionFive
                  : sourceVersion === 6
                    ? frozenVersionSix
                    : sourceVersion === 7
                      ? frozenVersionSeven
                      : sourceVersion === 8
                        ? frozenVersionEight
                        : sourceVersion === 9
                          ? frozenVersionNine
                          : sourceVersion === 10
                            ? frozenVersionTen
                            : sourceVersion === 11
                              ? frozenVersionEleven
                              : sourceVersion === 12
                                ? frozenVersionTwelve
                                : sourceVersion === 13
                                  ? frozenVersionThirteen
                                  : sourceVersion === 14
                                    ? frozenVersionFourteen
                                    : sourceVersion === 15
                                      ? frozenVersionFifteen
                                      : sourceVersion === 16
                                        ? frozenVersionSixteen
                                        : sourceVersion === 17
                                          ? frozenVersionSeventeen
                                          : sourceVersion === 18
                                            ? frozenVersionEighteen
                                            : sourceVersion === 19
                                              ? frozenVersionNineteen
                                              : frozenVersionTwenty)(
          f.path,
          source,
          eventReports,
          region,
        );
        const before = snapshot(source),
          receipt = inspectSchema(source),
          sourceBytes = readFileSync(source);
        assert.equal(receipt.kind, "previous");
        assert.equal(receipt.version, sourceVersion);
        assert.equal(
          receipt.schemaHash,
          eventReports
            ? (sourceVersion === 1
                ? versionOneHashes
                : sourceVersion === 2
                  ? versionTwo.hashes
                  : sourceVersion === 3
                    ? versionThree.hashes
                    : sourceVersion === 4
                      ? versionFour.hashes
                      : sourceVersion === 5
                        ? versionFive.hashes
                        : sourceVersion === 6
                          ? versionSix.hashes
                          : sourceVersion === 7
                            ? versionSeven.hashes
                            : sourceVersion === 8
                              ? versionEight.hashes
                              : sourceVersion === 9
                                ? versionNine.hashes
                                : sourceVersion === 10
                                  ? versionTen.hashes
                                  : sourceVersion === 11
                                    ? versionEleven.hashes
                                    : sourceVersion === 12
                                      ? versionTwelve.hashes
                                      : sourceVersion === 13
                                        ? versionThirteen.hashes
                                        : sourceVersion === 14
                                          ? versionFourteen.hashes
                                          : sourceVersion === 15
                                            ? versionFifteen.hashes
                                            : sourceVersion === 16
                                              ? versionSixteen.hashes
                                              : sourceVersion === 17
                                                ? versionSeventeen.hashes
                                                : sourceVersion === 18
                                                  ? versionEighteen.hashes
                                                  : sourceVersion === 19
                                                    ? versionNineteen.hashes
                                                    : versionTwenty.hashes
              ).enabled
            : (sourceVersion === 1
                ? versionOneHashes
                : sourceVersion === 2
                  ? versionTwo.hashes
                  : sourceVersion === 3
                    ? versionThree.hashes
                    : sourceVersion === 4
                      ? versionFour.hashes
                      : sourceVersion === 5
                        ? versionFive.hashes
                        : sourceVersion === 6
                          ? versionSix.hashes
                          : sourceVersion === 7
                            ? versionSeven.hashes
                            : sourceVersion === 8
                              ? versionEight.hashes
                              : sourceVersion === 9
                                ? versionNine.hashes
                                : sourceVersion === 10
                                  ? versionTen.hashes
                                  : sourceVersion === 11
                                    ? versionEleven.hashes
                                    : sourceVersion === 12
                                      ? versionTwelve.hashes
                                      : sourceVersion === 13
                                        ? versionThirteen.hashes
                                        : sourceVersion === 14
                                          ? versionFourteen.hashes
                                          : sourceVersion === 15
                                            ? versionFifteen.hashes
                                            : sourceVersion === 16
                                              ? versionSixteen.hashes
                                              : sourceVersion === 17
                                                ? versionSeventeen.hashes
                                                : sourceVersion === 18
                                                  ? versionEighteen.hashes
                                                  : sourceVersion === 19
                                                    ? versionNineteen.hashes
                                                    : versionTwenty.hashes
              ).disabled,
        );
        let constructors = 0;
        const original = Store.prototype.migrate;
        const mock = t.mock.method(
          Store.prototype,
          "migrate",
          function (this: Store, sql: string) {
            constructors++;
            return original.call(this, sql);
          },
        );
        assert.throws(() => new Application(source, region, security), {
          code: "SCHEMA_UPGRADE_REQUIRED",
        });
        mock.mock.restore();
        assert.equal(
          constructors,
          0,
          "previous stores reject before any module constructor writes",
        );
        const upgraded = await upgradeSchema(
          source,
          destination,
          receipt.schemaHash,
          region,
        );
        assert.equal(upgraded.sourceVersion, sourceVersion);
        assert.equal(upgraded.version, SCHEMA_VERSION);
        const inspection = inspectSchema(destination);
        assert.equal(inspection.kind, "current");
        assert.equal(inspection.version, SCHEMA_VERSION);
        assert.equal(inspection.initializedAt, receipt.initializedAt);
        assert.equal(inspection.eventReports, eventReports);
        conservedUpgrade(destination, before, sourceVersion);
        assert.deepEqual(readFileSync(source), sourceBytes);
        assert.deepEqual(inspectSchema(source), receipt);
        const clone = new Application(destination, region, security);
        try {
          assert.deepEqual(
            clone.fulfillment.shipmentCoverage(f.actor, nativeShipment.id),
            sourceVersion >= 6
              ? f.app.fulfillment.shipmentCoverage(f.actor, nativeShipment.id)
              : null,
          );
          assert.equal(
            clone.warranty.coverage(
              f.actor,
              f.app.inventory.trace(f.actor, "S1").unit.id,
              f.buyer,
            ).source,
            sourceVersion >= 6
              ? "shipment_policy"
              : "current_provisional_policy",
          );
          assert.deepEqual(
            clone.warranty.claimCoverage(f.actor, historicalClaim.id),
            sourceVersion >= 5
              ? f.app.warranty.claimCoverage(f.actor, historicalClaim.id)
              : {
                  claimId: historicalClaim.id,
                  coverageEnd: historicalClaim.coverageEnd,
                  snapshot: null,
                  coveragePolicyApproved: false,
                  eligibility: "requires_review",
                },
          );
          assert.deepEqual(
            clone.identity.session(session.token),
            f.app.identity.session(session.token),
          );
          assert.deepEqual(
            clone.providerCredentials.status(binding),
            f.app.providerCredentials.status(binding),
          );
          assert.equal(clone.billing.invoices(f.actor)[0]!.id, invoice);
          assert.deepEqual(
            clone.inventory.stock(f.actor),
            f.app.inventory.stock(f.actor),
          );
        } finally {
          clone.close();
        }
        conservedUpgrade(destination, before, sourceVersion);
      });

test("version-one receipt lies and partial new schema reject without mutation or publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=2"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    ["region", "UPDATE platform_schema_version SET region='US'"],
    [
      "partial",
      "CREATE TABLE integration_canada_post_groups(id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `${name}.db`),
      destination = join(dir, `${name}-dest.db`);
    frozenVersionOne(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const before = snapshot(source),
      sourceBytes = readFileSync(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(snapshot(source), before);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-two receipt lies and partial revocation schema reject without changing the source or publishing a clone", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=3"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE integration_credential_revocations(id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `${name}.db`),
      destination = join(dir, `${name}-destination.db`);
    frozenVersionTwo(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const sourceBytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-three receipt lies and partial cancellation schema reject without changing the source or publishing a clone", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=4"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE integration_credit_cancellations(effect_id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `v3-${name}.db`),
      destination = join(dir, `v3-${name}-destination.db`);
    frozenVersionThree(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const sourceBytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), sourceBytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-five receipt lies and partial shipment coverage schema reject unchanged without publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=6"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE fulfillment_coverage(shipment_id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `v5-${name}.db`),
      destination = join(dir, `v5-${name}-destination.db`);
    frozenVersionFive(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const bytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), bytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("late migration failure rolls back every DDL and receipt and releases the lock for retry", (t) => {
  const path = join(directory(t), "failed.db"),
    original = Store.prototype.migrate;
  let injected = false;
  const mock = t.mock.method(
    Store.prototype,
    "migrate",
    function (this: Store, sql: string) {
      original.call(this, sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS report_events")) {
        injected = true;
        assert.ok(
          this.all(
            "SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
          ).length >= 150,
          "failure must occur after the late schema DDL",
        );
        throw Error("Synthetic late initialization failure");
      }
    },
  );
  assert.throws(
    () => new Application(path),
    /Synthetic late initialization failure/,
  );
  mock.mock.restore();
  assert.equal(injected, true);
  assert.deepEqual(raw(path, schema), []);
  const retry = new Application(path);
  retry.close();
  assert.equal(
    raw(path, (db) =>
      db.prepare(`SELECT count(*) AS n FROM ${metadata}`).get(),
    )!.n,
    1,
  );
});

test("OS kill at the late initialization IPC barrier leaves no partial schema or receipt and permits restart", async (t) => {
  const path = join(directory(t), "killed.db"),
    { c, stderr } = child(t);
  const paused = reply(c);
  c.send({ action: "kill-init", path });
  const barrier = await paused;
  assert.equal(barrier.paused, true, stderr());
  assert.ok(
    barrier.objects >= 150,
    "kill must occur after late uncommitted DDL",
  );
  const exited = new Promise((resolve) => c.once("exit", resolve));
  c.kill("SIGKILL");
  await exited;
  assert.deepEqual(raw(path, schema), []);
  const app = new Application(path);
  app.close();
  assert.doesNotThrow(() => inspectSchema(path));
});

test("startup fails closed on unversioned, damaged, unknown and future schemas without repair", (t) => {
  const dir = directory(t);
  for (const [name, damage] of [
    ["unversioned", `DROP TABLE ${metadata}`],
    ["drift", "DROP TABLE report_events"],
    ["unknown", "CREATE TABLE unrelated_secret(value TEXT)"],
    ["hidden-name", "CREATE TABLE sqliteXprivate(value TEXT)"],
    ["missing-metadata", `DELETE FROM ${metadata}`],
  ]) {
    const path = join(dir, `${name}.db`),
      app = new Application(path);
    app.close();
    // Choose an actual owned table rather than assuming report storage spelling.
    raw(path, (db) =>
      db.exec(
        name === "drift"
          ? `DROP TABLE ${String(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'report_%' LIMIT 1").get()!.name)}`
          : damage!,
      ),
    );
    const before = hash(path),
      data = snapshot(path);
    assert.throws(() => new Application(path), name);
    assert.equal(hash(path), before);
    assert.deepEqual(snapshot(path), data);
  }
  const path = join(dir, "future.db"),
    app = new Application(path);
  app.close();
  raw(path, (db) => {
    const columns = db.prepare(`PRAGMA table_info(${metadata})`).all();
    const version = columns.find((c) => /version/.test(String(c.name)))!;
    db.prepare(`UPDATE ${metadata} SET "${version.name}"=999`).run();
  });
  const before = hash(path),
    receipt = raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all());
  assert.throws(() => new Application(path));
  assert.equal(hash(path), before);
  assert.deepEqual(
    raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
});

test("outer rollback and async callbacks preserve atomicity; owned transaction bypass fails closed", (t) => {
  const db = new Database(join(directory(t), "transactions.db"));
  t.after(() => db.close());
  const store = db.owned("platform");
  assert.throws(
    () =>
      db.transaction(() => {
        store.migrate("CREATE TABLE platform_synthetic(id INTEGER)");
        store.run("INSERT INTO platform_synthetic VALUES(1)");
        throw Error("outer failure");
      }),
    /outer failure/,
  );
  assert.equal(raw(db.path, schema).length, 0);
  assert.throws(() => db.transaction(() => Promise.resolve()), /Async/);
  for (const sql of ["COMMIT", "ROLLBACK", "BEGIN", "SAVEPOINT bypass"])
    assert.throws(
      () => db.transaction(() => store.migrate(sql)),
      /authorized|prohibited/,
    );
  db.transaction(() =>
    store.migrate("CREATE TABLE platform_retry(id INTEGER)"),
  );
});

test("reviewed previous baseline clone preserves all business rows, committed WAL, money, receipts, sessions and audit cursors; repeat source remains unchanged", async (t) => {
  const security = { providerEncryptionKey: "ab".repeat(32) };
  const f = fixture(t, security),
    invoice = ship(f, accept(f).id).invoiceId;
  const session = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const binding = {
    id: "synthetic-upgrade-binding",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-upgrade-client",
  };
  f.app.providerCredentials.install(binding, 0, {
    accessToken: "synthetic-upgrade-access",
    refreshToken: "synthetic-upgrade-refresh",
    accessExpiresAt: Date.now() + 3600000,
    refreshExpiresAt: Date.now() + 86400000,
  });
  for (let i = 0; i < 45; i++)
    f.app.platform.audit(f.actor, "SyntheticUpgradeAudit", `audit-${i}`, { i });
  const cursor = f.app.platform.auditPage(f.actor).next;
  assert.ok(cursor);
  const value = f.app.inventory
    .stock(f.actor)
    .reduce((sum, unit) => sum + unit.cost * unit.quantity, 0);
  // Keep the application connection open: committed business writes remain in WAL.
  legacy(f.path);
  assert.ok(existsSync(f.path + "-wal"));
  assert.ok(statSync(f.path + "-wal").size > 32);
  const sourceSchema = hash(f.path),
    before = snapshot(f.path);
  assert.equal(
    sourceSchema,
    "2f59fa00cb3465911850fd224e4f4f5ad1d5874ff9f56fc1058fe787bc3c3157",
    "source must match the frozen previous release profile",
  );
  const sourceBytes = readFileSync(f.path),
    walBytes = readFileSync(f.path + "-wal");
  const dest = join(directory(t), "upgraded.db");
  assert.doesNotThrow(() => inspectSchema(f.path));
  await upgradeSchema(f.path, dest, sourceSchema, "CA");
  conservedUpgrade(dest, before);
  assert.equal(hash(f.path), sourceSchema);
  assert.deepEqual(snapshot(f.path), before);
  assert.deepEqual(readFileSync(f.path), sourceBytes);
  assert.deepEqual(readFileSync(f.path + "-wal"), walBytes);
  assert.equal(statSync(dest).mode & 0o777, 0o600);
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(dest + suffix))
      assert.equal(statSync(dest + suffix).mode & 0o777, 0o600);
  const upgraded = new Application(dest, "CA", security);
  try {
    assert.deepEqual(
      upgraded.identity.session(session.token),
      f.app.identity.session(session.token),
    );
    assert.deepEqual(
      upgraded.providerCredentials.status(binding),
      f.app.providerCredentials.status(binding),
    );
    assert.equal(upgraded.billing.invoices(f.actor)[0]!.id, invoice);
    assert.equal(
      upgraded.inventory
        .stock(f.actor)
        .reduce((sum, unit) => sum + unit.cost * unit.quantity, 0),
      value,
    );
    if (cursor)
      assert.deepEqual(
        upgraded.platform.auditPage(f.actor, cursor),
        f.app.platform.auditPage(f.actor, cursor),
      );
  } finally {
    upgraded.close();
  }
  const repeat = join(directory(t), "repeat.db");
  await upgradeSchema(f.path, repeat, sourceSchema, "CA");
  conservedUpgrade(repeat, before);
  const current = join(directory(t), "current.db");
  const receipt = raw(dest, (db) =>
    db.prepare(`SELECT * FROM ${metadata}`).all(),
  );
  await upgradeSchema(dest, current, hash(dest), "CA");
  assert.deepEqual(snapshot(current), snapshot(dest));
  assert.deepEqual(
    raw(current, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
});

test("eventReports false/true/false transitions preserve stored projection data and restart receipt", (t) => {
  const path = join(directory(t), "reports.db");
  let app = new Application(path, "CA", { eventReports: false });
  app.close();
  app = new Application(path, "CA", { eventReports: true });
  const actor = app.identity.bootstrap(
    "Synthetic reports",
    "report@example.test",
    "long-test-only-password",
    "CAD",
  );
  app.inventory.createWarehouse(actor, "warehouse", {
    name: "Synthetic report warehouse",
  });
  app.database.transaction(() =>
    app.platform.event(actor, "SyntheticUpgradeFact", "report-data", {
      count: 1,
    }),
  );
  assert.equal(
    app.eventDelivery.tick("event-report", { enabled: true }).completed,
    1,
  );
  app.close();
  const rows = snapshot(path),
    reports = Object.fromEntries(
      Object.entries(rows).filter(([name]) => name.startsWith("report_")),
    );
  assert.ok(
    Object.values(reports).some((value) => (value as unknown[]).length > 0),
  );
  const receipt = raw(path, (db) =>
    db.prepare(`SELECT * FROM ${metadata}`).all(),
  );
  app = new Application(path, "CA", { eventReports: false });
  app.close();
  assert.deepEqual(snapshot(path), rows);
  assert.deepEqual(
    raw(path, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
    receipt,
  );
  app = new Application(path, "CA", { eventReports: true });
  app.close();
  assert.deepEqual(snapshot(path), rows);
});

test("upgrade rejects changed hash, region mismatch, unknown schema and malformed metadata with no destination or staging leftovers", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  f.app.close();
  const before = snapshot(f.path),
    fingerprint = hash(f.path);
  for (const [name, expected, region] of [
    ["hash", "0".repeat(64), "CA"],
    ["region", fingerprint, "US"],
  ] as const) {
    await assert.rejects(
      upgradeSchema(f.path, join(dir, name + ".db"), expected, region),
    );
    assert.deepEqual(readdirSync(dir), []);
    assert.deepEqual(snapshot(f.path), before);
    assert.equal(hash(f.path), fingerprint);
  }
  for (const [name, sql] of [
    ["unknown", "CREATE TABLE foreign_private(payload TEXT)"],
    ["malformed", `DELETE FROM ${metadata}`],
  ] as const) {
    const source = join(dir, name + ".db");
    // Use an approved clone to prepare a synthetic rejection source.
    await upgradeSchema(f.path, source, fingerprint, "CA");
    raw(source, (db) => db.exec(sql));
    const schemaBefore = hash(source),
      dataBefore = snapshot(source);
    const filesBefore = readdirSync(dir);
    assert.throws(() => inspectSchema(source));
    await assert.rejects(
      upgradeSchema(source, join(dir, name + "-dest.db"), schemaBefore, "CA"),
    );
    assert.deepEqual(readdirSync(dir), filesBefore);
    assert.equal(hash(source), schemaBefore);
    assert.deepEqual(snapshot(source), dataBefore);
  }
  // fixture owns closing; replace the already closed connection with a supported restart.
  f.app = new Application(f.path);
});

test("existing destination, orphan sidecars and symlinks fail without clobbering bytes", async (t) => {
  const f = fixture(t),
    dir = directory(t),
    fingerprint = hash(f.path);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const dest = join(dir, `exists${suffix || "-main"}.db`),
      obstacle = dest + suffix;
    writeFileSync(obstacle, "synthetic private obstacle");
    await assert.rejects(upgradeSchema(f.path, dest, fingerprint, "CA"));
    assert.equal(readFileSync(obstacle, "utf8"), "synthetic private obstacle");
    if (suffix) assert.equal(existsSync(dest), false);
  }
  const target = join(dir, "target"),
    dest = join(dir, "symlink.db");
  writeFileSync(target, "synthetic symlink target");
  symlinkSync(target, dest);
  await assert.rejects(upgradeSchema(f.path, dest, fingerprint, "CA"));
  assert.equal(readFileSync(target, "utf8"), "synthetic symlink target");
  const linkedSource = join(dir, "source-link.db");
  symlinkSync(f.path, linkedSource);
  await assert.rejects(
    upgradeSchema(
      linkedSource,
      join(dir, "source-link-dest.db"),
      fingerprint,
      "CA",
    ),
  );
  assert.equal(existsSync(join(dir, "source-link-dest.db")), false);
});

test("IPC-released independent clone publishers produce exactly one destination and one success", async (t) => {
  const f = fixture(t),
    dir = directory(t),
    destination = join(dir, "winner.db"),
    source = f.path,
    fingerprint = hash(source),
    before = snapshot(source);
  const children = [child(t), child(t)];
  const ready = children.map(({ c }) => {
    const p = reply(c);
    c.send({ action: "ready" });
    return p;
  });
  assert.ok((await Promise.all(ready)).every((r) => r.ready));
  const outcomes = children.map(({ c }) => {
    const p = reply(c);
    c.send({ action: "upgrade", source, destination, hash: fingerprint });
    return p;
  });
  const result = await Promise.all(outcomes);
  assert.equal(result.filter((r) => r.ok).length, 1, JSON.stringify(result));
  assert.equal(result.filter((r) => !r.ok).length, 1);
  assert.deepEqual(snapshot(destination), before);
  assert.deepEqual(snapshot(source), before);
  assert.deepEqual(
    readdirSync(dir).filter((name) => !name.startsWith("winner.db")),
    [],
  );
});

test("schema CLI help/inspect succeed, malformed usage fails and private paths stay redacted", (t) => {
  const f = fixture(t);
  function cli(args: string[]) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx", "src/server/schema-cli.ts", ...args],
      { encoding: "utf8" },
    );
  }
  const help = cli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  const inspected = cli(["inspect", f.path]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.doesNotThrow(() => JSON.parse(inspected.stdout));
  for (const args of [[], ["upgrade"], ["inspect", f.path, "extra"]])
    assert.notEqual(cli(args).status, 0);
  const privatePath = join(directory(t), "private-customer-secret.db"),
    failed = cli(["inspect", privatePath]);
  assert.notEqual(failed.status, 0);
  assert.equal((failed.stdout + failed.stderr).includes(privatePath), false);
  assert.equal(existsSync(privatePath), false);
});

test("version receipt lies and malformed receipt schema are rejected unchanged by startup and clone inspection", async (t) => {
  const dir = directory(t);
  for (const [name, sql] of [
    ["hash", `UPDATE ${metadata} SET schema_hash='${"0".repeat(64)}'`],
    ["profile", `UPDATE ${metadata} SET event_reports=0`],
    ["timestamp", `UPDATE ${metadata} SET initialized_at='not-a-date'`],
    [
      "impossible-day",
      `UPDATE ${metadata} SET initialized_at='2026-02-30T12:00:00.000Z'`,
    ],
    [
      "invalid-leap-day",
      `UPDATE ${metadata} SET initialized_at='2025-02-29T12:00:00.000Z'`,
    ],
    ["receipt-region", `UPDATE ${metadata} SET region='US'`],
    ["receipt-schema", `ALTER TABLE ${metadata} ADD COLUMN unexpected TEXT`],
  ]) {
    const source = join(dir, name + ".db"),
      app = new Application(source);
    app.identity.bootstrap(
      "Synthetic metadata",
      "metadata@example.test",
      "long-test-only-password",
      "CAD",
    );
    app.close();
    raw(source, (db) => db.exec(sql!));
    const fingerprint = hash(source),
      before = snapshot(source),
      receipt = raw(source, (db) =>
        db.prepare(`SELECT * FROM ${metadata}`).all(),
      );
    assert.throws(() => new Application(source), name);
    assert.throws(() => inspectSchema(source), name);
    const dest = join(dir, name + "-dest.db");
    await assert.rejects(upgradeSchema(source, dest, fingerprint, "CA"));
    assert.equal(existsSync(dest), false);
    assert.equal(hash(source), fingerprint);
    assert.deepEqual(snapshot(source), before);
    assert.deepEqual(
      raw(source, (db) => db.prepare(`SELECT * FROM ${metadata}`).all()),
      receipt,
    );
    assert.equal(
      readdirSync(dir).some((n) => n.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("frozen reports-disabled previous profile upgrades independently with report data absent", async (t) => {
  const dir = directory(t),
    source = join(dir, "disabled.db"),
    dest = join(dir, "disabled-clone.db");
  const app = new Application(source, "US", { eventReports: false });
  const actor = app.identity.bootstrap(
    "Synthetic US disabled",
    "us@example.test",
    "long-test-only-password",
    "USD",
  );
  app.inventory.createWarehouse(actor, "us-warehouse", {
    name: "Synthetic US warehouse",
  });
  app.close();
  legacy(source);
  const fingerprint = hash(source);
  assert.equal(
    fingerprint,
    "7ee77d2cf55922c6ba7d93360af7e7af8715fc81ef4bac964a9a07c4371b023e",
  );
  const before = snapshot(source),
    inspection = inspectSchema(source);
  assert.equal(inspection.eventReports, false);
  assert.equal(inspection.region, "US");
  await assert.rejects(upgradeSchema(source, dest, fingerprint, "CA"));
  assert.equal(existsSync(dest), false);
  const receipt = await upgradeSchema(source, dest, fingerprint, "US");
  assert.equal(receipt.eventReports, false);
  assert.equal(receipt.region, "US");
  conservedUpgrade(dest, before);
  assert.deepEqual(snapshot(source), before);
  assert.equal(hash(source), fingerprint);
  const clone = new Application(dest, "US", { eventReports: false });
  assert.equal(clone.identity.organization(actor).currency, "USD");
  clone.close();
  assert.throws(() => new Application(dest, "CA", { eventReports: false }));
});

test("upgrade requires an organization and rejects unsafe destination parent directories without staging", async (t) => {
  const dir = directory(t),
    source = join(dir, "unbootstrapped.db");
  const empty = new Application(source);
  empty.close();
  await assert.rejects(
    upgradeSchema(source, join(dir, "empty-clone.db"), hash(source), "CA"),
  );
  assert.equal(existsSync(join(dir, "empty-clone.db")), false);
  const f = fixture(t),
    parentLink = join(dir, "linked-parent");
  symlinkSync(dir, parentLink);
  await assert.rejects(
    upgradeSchema(
      f.path,
      join(parentLink, "linked-clone.db"),
      hash(f.path),
      "CA",
    ),
  );
  assert.equal(existsSync(join(dir, "linked-clone.db")), false);
  assert.equal(
    readdirSync(dir).some((n) => n.startsWith(".schema-upgrade-")),
    false,
  );
});

test("a real leap-day receipt remains valid across inspection, startup and clone", async (t) => {
  const f = fixture(t),
    dest = join(directory(t), "leap.db");
  raw(f.path, (db) =>
    db
      .prepare(`UPDATE ${metadata} SET initialized_at=?`)
      .run("2024-02-29T12:00:00.000Z"),
  );
  const before = inspectSchema(f.path);
  assert.equal(before.initializedAt, "2024-02-29T12:00:00.000Z");
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(inspectSchema(f.path), before);
  await upgradeSchema(f.path, dest, before.schemaHash, "CA");
  assert.deepEqual(inspectSchema(dest), before);
});

test("a sqlite-prefix lookalike table cannot hide schema drift from inspection or startup", async (t) => {
  const f = fixture(t),
    dest = join(directory(t), "lookalike.db");
  raw(f.path, (db) =>
    db.exec("CREATE TABLE sqliteXunexpected(value TEXT) STRICT"),
  );
  const before = snapshot(f.path),
    fingerprint = hash(f.path);
  assert.throws(() => inspectSchema(f.path), { code: "SCHEMA_DRIFT" });
  assert.throws(() => new Application(f.path), { code: "SCHEMA_DRIFT" });
  await assert.rejects(upgradeSchema(f.path, dest, fingerprint, "CA"), {
    code: "SCHEMA_DRIFT",
  });
  assert.equal(existsSync(dest), false);
  assert.deepEqual(snapshot(f.path), before);
  assert.equal(hash(f.path), fingerprint);
});

test("failed optional report installation preserves existing facts and version receipt for retry", (t) => {
  const path = join(directory(t), "optional.db"),
    app = new Application(path, "CA", { eventReports: false });
  app.identity.bootstrap(
    "Synthetic optional",
    "optional@example.test",
    "long-test-only-password",
    "CAD",
  );
  app.close();
  const before = snapshot(path),
    receipt = inspectSchema(path),
    original = Store.prototype.migrate;
  const mock = t.mock.method(
    Store.prototype,
    "migrate",
    function (this: Store, sql: string) {
      original.call(this, sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS report_events"))
        throw Error("Synthetic report install failure");
    },
  );
  assert.throws(
    () => new Application(path),
    /Synthetic report install failure/,
  );
  mock.mock.restore();
  assert.deepEqual(snapshot(path), before);
  assert.deepEqual(inspectSchema(path), receipt);
  new Application(path).close();
  assert.equal(inspectSchema(path).eventReports, true);
  const after = snapshot(path);
  delete after.report_events;
  assert.deepEqual(after, before);
});

test("initialization rejects caught transaction failures and arbitrary thenables without retained writes", (t) => {
  const dir = directory(t);
  for (const failure of ["caught", "thenable"]) {
    const path = join(dir, failure + ".db"),
      db = new Database(path);
    assert.throws(
      () =>
        db.initializeSchema("CA", false, () => {
          db.owned("platform").migrate(
            "CREATE TABLE platform_test(value TEXT) STRICT",
          );
          if (failure === "caught") {
            try {
              db.transaction(() => {
                db.owned("platform").run(
                  "INSERT INTO platform_test VALUES('rollback')",
                );
                throw Error("Synthetic constructor failure");
              });
            } catch {}
            return undefined;
          }
          return { then() {} };
        }),
      { code: failure === "caught" ? "SCHEMA_INITIALIZATION" : "TRANSACTION" },
    );
    db.close();
    assert.deepEqual(raw(path, schema), []);
    new Application(path).close();
  }
});

test("version-ten receipt lies and partial organization consent layouts reject without mutation or clone publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=12"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE iam_ledger_choices(org_id TEXT PRIMARY KEY) STRICT",
    ],
    [
      "partial-head",
      "CREATE TABLE iam_ledger_disclosure_current(org_id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, `${name}.db`),
      destination = join(dir, `${name}-dest.db`);
    frozenVersionTen(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const before = snapshot(source),
      bytes = readFileSync(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(snapshot(source), before);
    assert.deepEqual(readFileSync(source), bytes);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

test("version-eleven partial journal ownership and lying version receipts reject without mutation or publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["lying-version", "UPDATE platform_schema_version SET version=12"],
    [
      "partial-journal",
      "CREATE TABLE integration_stock_journals(id TEXT PRIMARY KEY) STRICT",
    ],
    [
      "partial-reference",
      "CREATE TABLE integration_stock_journal_references(org_id TEXT PRIMARY KEY) STRICT",
    ],
    [
      "partial-observation",
      "CREATE TABLE integration_stock_journal_observations(journal_id TEXT PRIMARY KEY) STRICT",
    ],
  ]) {
    const source = join(dir, name + ".db"),
      destination = join(dir, name + "-destination.db");
    frozenVersionEleven(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql!));
    const rows = snapshot(source),
      bytes = readFileSync(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(
      upgradeSchema(source, destination, hash(source), "CA"),
    );
    assert.equal(existsSync(destination), false);
    assert.deepEqual(snapshot(source), rows);
    assert.deepEqual(readFileSync(source), bytes);
  }
});

for (const name of [
  "integration_stock_journal_source",
  "integration_stock_journal_external",
])
  test(`missing ${name} eligibility/identity constraint rejects startup and clone unchanged`, async (t) => {
    const f = fixture(t),
      dir = directory(t),
      destination = join(dir, "missing-index.db");
    raw(f.path, (db) => db.exec(`DROP INDEX ${name}`));
    const rows = snapshot(f.path),
      bytes = readFileSync(f.path);
    assert.throws(() => new Application(f.path));
    await assert.rejects(
      upgradeSchema(f.path, destination, hash(f.path), "CA"),
    );
    assert.deepEqual(snapshot(f.path), rows);
    assert.deepEqual(readFileSync(f.path), bytes);
    assert.equal(existsSync(destination), false);
  });

test("version-thirteen receipt lies and partial organization revocation storage reject without source mutation or clone publication", async (t) => {
  const f = fixture(t),
    dir = directory(t);
  for (const [name, sql] of [
    ["version", "UPDATE platform_schema_version SET version=14"],
    [
      "hash",
      `UPDATE platform_schema_version SET schema_hash='${"0".repeat(64)}'`,
    ],
    [
      "partial",
      "CREATE TABLE integration_ledger_revocations(id TEXT PRIMARY KEY) STRICT",
    ],
  ] as const) {
    const source = join(dir, `v13-${name}.db`),
      destination = join(dir, `v13-${name}-destination.db`);
    frozenVersionThirteen(f.path, source, true, "CA");
    raw(source, (db) => db.exec(sql));
    const bytes = readFileSync(source),
      before = snapshot(source),
      fingerprint = hash(source);
    assert.throws(() => inspectSchema(source));
    assert.throws(() => new Application(source));
    await assert.rejects(upgradeSchema(source, destination, fingerprint, "CA"));
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readFileSync(source), bytes);
    assert.deepEqual(snapshot(source), before);
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith(".schema-upgrade-")),
      false,
    );
  }
});

// Authenticated synthetic old archive: restore must not implicitly migrate v20.
import { createCipheriv } from "node:crypto";
import { restoreBackup, createBackup } from "../src/server/recovery.ts";
for (const region of ["CA", "US"] as const)
  for (const eventReports of [false, true])
    test(`${region} reports=${eventReports}: frozen v20 encrypted restore refuses implicit v21 upgrade unchanged`, async (t) => {
      const f = fixture(
          t,
          { eventReports },
          region,
          region === "CA" ? "CAD" : "USD",
        ),
        dir = directory(t),
        source = join(dir, "old20.db"),
        target = join(dir, "restore.db"),
        archive = join(dir, "old20.enc");
      frozenVersionTwenty(f.path, source, eventReports, region);
      const raw = readFileSync(source),
        key = Buffer.alloc(32, 9),
        iv = Buffer.alloc(12, 7);
      const manifest = {
        version: 1,
        region,
        completedAt: "2026-10-04T00:00:00.000Z",
        snapshotHash: createHash("sha256").update(raw).digest("hex"),
        schemaHash: eventReports
          ? versionTwenty.hashes.enabled
          : versionTwenty.hashes.disabled,
        bytes: raw.length,
        iv: iv.toString("hex"),
      };
      const header = Buffer.from(JSON.stringify(manifest)),
        length = Buffer.alloc(4);
      length.writeUInt32BE(header.length);
      const prefix = Buffer.concat([Buffer.from("DISTBKP1"), length, header]),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(prefix);
      const encrypted = Buffer.concat([
        prefix,
        cipher.update(raw),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      writeFileSync(archive, encrypted, { mode: 0o600 });
      await assert.rejects(restoreBackup(archive, target, region, key), {
        code: "RECOVERY_SCHEMA",
      });
      await assert.rejects(
        createBackup(source, join(dir, "new.enc"), region, key),
        { code: "RECOVERY_SCHEMA" },
      );
      assert.deepEqual(readFileSync(archive), encrypted);
      assert.deepEqual(readFileSync(source), raw);
      assert.equal(existsSync(target), false);
      assert.equal(
        readdirSync(dir).some((x) => x.startsWith(".recovery-")),
        false,
      );
      key.fill(0);
    });
