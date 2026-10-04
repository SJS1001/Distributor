import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor, type Row } from "../src/server/core.ts";
import type {
  OfflineOriginalJournalReview,
  OfflineOriginalCancellationProof,
} from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
import fs from "node:fs";
import { Store } from "../src/server/database.ts";
import * as bindingFunctions from "../src/server/restore-offline-envelope.ts";
import { IntegrationOfflineOriginalCancellation } from "../src/server/integration-offline-original-cancellation.ts";
import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
function setup(t: TestContext, region: "CA" | "US" = "CA", ancestors = 0) {
  const c = journalFixture(t, region);
  let journal = c.approve();
  for (let i = 0; i <= ancestors; i++) {
    const lease = c.j.claim(c.f.actor, journal.id, "write")!;
    c.j.beforeWrite(lease);
    c.j.unresolved(lease, "transport-uncertain");
    if (i === ancestors) break;
    const proof = c.j.recordOriginalCancellationEvidence(
      c.f.actor,
      `proof-${i}`,
      {
        journalId: journal.id,
        requestRef: journal.requestRef,
        reviewHash: c.j.originalCancellationEvidenceReview(
          c.f.actor,
          journal.id,
        ).reviewHash,
        externalRef: `synthetic:final-case-${i}`,
        evidence:
          "Synthetic exact-request final cancellation and no future posting",
        cancellationFinal: true,
        nonPostingVerified: true,
        noLaterPosting: true,
      },
    );
    c.j.cancelOriginalAttempt(c.reviewer, `cancel-${i}`, {
      journalId: journal.id,
      requestRef: journal.requestRef,
      evidenceHash: proof.evidence.evidenceHash,
      reason: "Synthetic independent cancellation",
    });
    const ready = c.j.prepareOriginalRetry(c.f.actor, `retry-${i}`, {
      journalId: journal.id,
      reviewHash: c.j.originalRetryReview(c.f.actor, journal.id).reviewHash,
      reason: "Synthetic retry, separately approved",
    });
    journal = c.j.decide(c.reviewer, `retry-approve-${i}`, {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Independent retry approval",
    });
  }
  c.f.app.platform.isolateRestore(
    digest("synthetic-backup"),
    new Date().toISOString(),
  );
  return { ...c, journal };
}
type F = ReturnType<typeof setup>;
function comparator(app: Application) {
  return new StockJournalOfflineOriginalEvidence(
    app.database,
    app.identity,
    app.integration.costs.journals,
  );
}
function native(c: F) {
  return c.f.app.database.transaction(() =>
    c.f.app.integration.costs.journals.readOfflineOriginalInTransaction(
      c.reviewer,
      c.journal.id,
    ),
  );
}
// Independently reproduce the existing cancellation snapshot, not comparator output.
function inputFor(
  p: OfflineOriginalJournalReview,
): OfflineOriginalEvidenceInput {
  const a = p.attempts.find((x) => x.row.id === p.journalId)!,
    d = p.dates.find((x) => x.postingDate === a.row.posting_date)!;
  const snapshot: OfflineOriginalCancellationSnapshot = {
    version: 1,
    orgId: p.orgId,
    journalId: p.journalId,
    reviewHash: a.row.review_hash,
    sourceId: a.row.source_id,
    sourceHash: p.source.file.hash,
    postingDate: a.row.posting_date,
    realm: a.row.realm,
    bindingId: a.row.binding_id,
    requestRef: String(a.references[0]!.request_ref),
    region: p.region,
    currency: p.currency,
    debit: d.debit,
    credit: d.credit,
    historyHash: digest(canonical(a.observations.map((x) => x.hash))),
  };
  return structuredClone({
    version: 1,
    source: p,
    candidate: p,
    providerClaims: [
      {
        profile: "quickbooks-sandbox-original-final-cancellation-unposted-v1",
        outcome: "cancelled-unposted",
        request: { ...snapshot, intentHash: digest(canonical(a.plan.intent)) },
        attestation: {
          journalId: p.journalId,
          requestRef: snapshot.requestRef,
          reviewHash: digest(canonical(snapshot)),
          externalRef: "synthetic:provider-case-1",
          evidence:
            "Synthetic assertion only: exact final cancellation and no future posting",
          cancellationFinal: true,
          nonPostingVerified: true,
          noLaterPosting: true,
        },
      },
    ],
  });
}
function captured(c: F) {
  const input = inputFor(native(c));
  return c.f.app.database.transaction(() =>
    comparator(c.f.app).captureInTransaction(c.f.actor, c.journal.id, input),
  );
}
function snapshot(c: F) {
  return canonical(
    (["integration", "platform", "inventory", "billing", "iam"] as const).map(
      (owner) => {
        const s = c.f.app.database.owned(owner);
        return s
          .all<{ name: string }>(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
            `${owner}_%`,
          )
          .map(({ name }) => [
            name,
            s.all(`SELECT * FROM ${name} ORDER BY rowid`),
          ]);
      },
    ),
  );
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
function owners(c: F) {
  const a = c.f.app;
  return new IntegrationOfflineOriginalCancellation(
    a.database,
    a.identity,
    a.platform,
    a.integration.costs.journals,
  );
}
const loc = (a: Actor) => ({ id: a.id, orgId: a.orgId });
function prepared(
  t: TestContext,
  region: "CA" | "US" = "CA",
  ancestors = 0,
  afterOpen?: (c: F) => void,
) {
  const c = setup(t, region, ancestors),
    a = c.f.app;
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(c.f.path + suffix))
      fs.chmodSync(c.f.path + suffix, 0o600);
  a.database.transaction(() => {
    const { logicalHash: _, ...candidate } =
      a.database.captureRestoreCandidateInTransaction();
    const generation = parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: digest("synthetic-instance"),
      schemaVersion: SCHEMA_VERSION,
      ...candidate,
      organizations: candidate.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
    a.platform.offline.createGenerationInTransaction(generation, null, []);
    let r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "isolate", sessionId: "synthetic-original-session" },
      [],
    );
    r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "open" },
      [],
    );
    afterOpen?.(c);
  });
  const cap = captured(c);
  const envelope = a.database.transaction(() => {
    const r = a.platform.offline.readInTransaction()!,
      { version: _, schemaVersion: __, ...recovery } = r.state.generation,
      session = r.state.sessions.at(-1)!,
      candidate = a.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(c.f.path, { bigint: true });
    const target = cap.native.attempts.find((a) => a.row.id === c.journal.id)!;
    return {
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "synthetic-original-import",
      preparedBy: c.f.actor.id,
      executorId: c.reviewer.id,
      preparedAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:10:00.000Z",
      recovery,
      session: {
        id: session.id,
        revision: session.revision,
        lineageHash: session.lineageHash,
      },
      candidate: {
        logicalHash: candidate.logicalHash,
        file: { dev: Number(file.dev), ino: Number(file.ino) },
      },
      source: {
        identity: "synthetic-source",
        baseline: {
          logicalHash: digest("baseline"),
          durableCursor: "start",
          auditSequence: 0,
        },
        end: {
          logicalHash: digest("end"),
          durableCursor: "end",
          auditSequence: 1,
        },
        intervalEvidenceHash: digest("interval"),
      },
      task: {
        owner: "integration",
        name: "integration.quickbooks-original-cancelled.import",
        version: 1,
        orgId: c.f.actor.orgId,
        siteIds: [],
        subjectId: c.journal.id,
        expectedRevision: target.observations.at(-1)!.revision,
        expectedStateHash: cap.native.hash,
        payloadHash: digest(canonical(inputFor(cap.native))),
        priorClaim: null,
      },
      evidence: {
        setHash: digest("set"),
        items: [
          {
            reference: "synthetic-evidence",
            sha256: digest("bytes"),
            bytes: 1,
          },
        ],
        qualificationHash: digest("qualification"),
      },
      operations: {
        authorityId: "synthetic-operations",
        revision: 1,
        adapterIdentity: "synthetic-unqualified",
        fenceTokenHash: digest("fence"),
        observationHash: digest("observation"),
      },
      trust: {
        authorityId: "synthetic-trust",
        revision: 1,
        registryHash: digest("registry"),
      },
    };
  });
  return { ...c, cap, envelope };
}
type Prepared = ReturnType<typeof prepared>;
function apply(
  c: Prepared,
  envelope: unknown = c.envelope,
  cap: unknown = c.cap,
  e: unknown = loc(c.f.actor),
  x: unknown = loc(c.reviewer),
) {
  return c.f.app.database.transaction(() =>
    owners(c).applyInTransaction(
      e,
      x,
      envelope,
      cap,
      c.cap.claim.attestation.evidence,
    ),
  );
}
function recover(c: Prepared, record: unknown, envelope: unknown = c.envelope) {
  return c.f.app.database.transaction(() =>
    owners(c).recoverInTransaction(
      loc(c.f.actor),
      loc(c.reviewer),
      envelope,
      record,
    ),
  );
}
const table = "integration_offline_original_cancellations";
function retained(c: Prepared, envelope: unknown = c.envelope) {
  return c.f.app.database.transaction(() =>
    owners(c).recoverRetainedInTransaction(
      loc(c.f.actor),
      loc(c.reviewer),
      envelope,
    ),
  );
}
// Corrupt synthetic bytes while restoring EXACT frozen DDL before owner reads.
// This is not an application mutation path or a bypass in production code.
function tamper(c: Prepared, sql: string, ...args: SQLInputValue[]) {
  const db = new DatabaseSync(c.f.path);
  try {
    const triggers = db
      .prepare(
        "SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=?",
      )
      .all(table);
    db.exec(
      "PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON; BEGIN",
    );
    for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`);
    db.prepare(sql).run(...args);
    for (const t of triggers) db.exec(String(t.sql));
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}
for (const region of ["CA", "US"] as const)
  test(`${region}: retained-only restart recovery, exact durable envelope and immutable preimage`, (t) => {
    const c = prepared(t, region, 1);
    const applied = apply(c);
    const stored = c.f.app.database
      .owned("integration")
      .get(`SELECT * FROM ${table}`)!;
    assert.equal(stored.envelope, canonical(c.envelope));
    assert.equal(stored.envelope_hash, digest(canonical(c.envelope)));
    assert.equal(stored.record, canonical(applied.record));
    assert.equal(stored.record_hash, applied.resultHash);
    const before = snapshot(c);
    c.f.app.close();
    c.f.app = new Application(c.f.path, region, { eventReports: false });
    // No returned record/capture is supplied to recovery after native reopen.
    const found = retained(c);
    frozen(found);
    assert.deepEqual(found.record, applied.record);
    assert.deepEqual(found.proof, applied.proof);
    assert.deepEqual(found.receipt, applied.receipt);
    c.f.app.database.transaction(() => {
      const s = c.f.app.database.owned("integration"),
        n = s.get("SELECT total_changes() AS n")!.n;
      owners(c).recoverRetainedInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
      );
      assert.equal(s.get("SELECT total_changes() AS n")!.n, n);
    });
    assert.equal(snapshot(c), before);
    assert.throws(() => apply(c));
    assert.equal(snapshot(c), before);
  });
for (const mutation of ["UPDATE", "DELETE", "REPLACE"])
  test(`durable provenance denies ${mutation}`, (t) => {
    const c = prepared(t);
    apply(c);
    const before = snapshot(c);
    const sql =
      mutation === "UPDATE"
        ? `UPDATE ${table} SET record=record`
        : mutation === "DELETE"
          ? `DELETE FROM ${table}`
          : `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`;
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          c.f.app.database.owned("integration").run(sql),
        ),
      /append-only/,
    );
    assert.equal(snapshot(c), before);
    assert.doesNotThrow(() => retained(c));
  });
for (const change of [
  "DELETE FROM integration_offline_original_cancellations",
  "UPDATE integration_offline_original_cancellations SET record_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
  "UPDATE integration_offline_original_cancellations SET envelope_hash='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
  "UPDATE integration_offline_original_cancellations SET binding='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
  "UPDATE integration_offline_original_cancellations SET org_id='foreign'",
  "UPDATE integration_offline_original_cancellations SET journal_id='orphan'",
  "UPDATE integration_offline_original_cancellations SET request_id='changed'",
  "UPDATE integration_offline_original_cancellations SET record='{}'",
  "UPDATE integration_offline_original_cancellations SET envelope='{}'",
  "UPDATE integration_offline_original_cancellations SET record=record||' '",
  "UPDATE integration_offline_original_cancellations SET envelope=envelope||' '",
])
  test(`retained recovery refuses missing/altered provenance: ${change}`, (t) => {
    const c = prepared(t),
      result = apply(c);
    tamper(c, change);
    const before = snapshot(c);
    assert.throws(() => retained(c), {
      code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
    });
    assert.throws(() => recover(c, result.record), {
      code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
    });
    assert.equal(snapshot(c), before);
  });
for (const [column, value] of [
  ["record", "é".repeat(8193)],
  ["envelope", "é".repeat(2097153)],
  ["record", '{"x":"a\0b"}'],
  ["envelope", '{"x":"a\0b"}'],
  ["record", '{"x":' + "[".repeat(4097) + "0" + "]".repeat(4097) + "}"],
] as const)
  test(`preflight refuses ${column} bytes/NUL/complexity BEFORE blob materialization (${value.length})`, (t) => {
    const c = prepared(t);
    apply(c);
    tamper(c, `UPDATE ${table} SET ${column}=?`, value);
    const before = snapshot(c),
      all = Store.prototype.all;
    let materialized = false;
    Store.prototype.all = function <T extends Row = Row>(
      this: Store,
      sql: string,
      ...args: SQLInputValue[]
    ): T[] {
      if (sql.includes("AS envelope_bytes")) materialized = true;
      return all.call(this, sql, ...args) as T[];
    };
    try {
      assert.throws(() => retained(c), {
        code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
      });
    } finally {
      Store.prototype.all = all;
    }
    assert.equal(materialized, false);
    assert.equal(snapshot(c), before);
  });
for (const column of ["record", "envelope"])
  test(`stored ${column} escaped surrogate and invalid UTF-8 refuse`, (t) => {
    const c = prepared(t);
    apply(c);
    const source = String(
      c.f.app.database
        .owned("integration")
        .get(`SELECT ${column} AS v FROM ${table}`)!.v,
    );
    const data = JSON.parse(source);
    if (column === "record") data.reason = "\ud800";
    else data.source.identity = "\ud800";
    tamper(c, `UPDATE ${table} SET ${column}=?`, JSON.stringify(data));
    assert.throws(() => retained(c), {
      code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
    });
    tamper(
      c,
      `UPDATE ${table} SET ${column}=CAST(x'7B2278223A22EDA080227D' AS TEXT)`,
    );
    assert.throws(() => retained(c));
  });
for (const who of ["evidence", "cancellation"] as const)
  for (const change of [
    "active=0",
    "role='support'",
    "org_id='foreign'",
    "account_id='buyer'",
    "password",
  ])
    test(`retained-only current ${who} ${change} refuses and rolls back`, (t) => {
      const c = prepared(t);
      apply(c);
      const before = snapshot(c);
      assert.throws(() =>
        c.f.app.database.transaction(() => {
          const s = c.f.app.database.owned("iam"),
            a = who === "evidence" ? c.f.actor : c.reviewer;
          if (change === "password")
            s.run(
              "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
              a.id,
            );
          else s.run(`UPDATE iam_users SET ${change} WHERE id=?`, a.id);
          owners(c).recoverRetainedInTransaction(
            loc(c.f.actor),
            loc(c.reviewer),
            c.envelope,
          );
        }),
      );
      assert.equal(snapshot(c), before);
    });
test("retained-only writer/hold required and hostile locators/envelopes are inert", (t) => {
  const c = prepared(t);
  apply(c);
  const before = snapshot(c),
    op = owners(c);
  assert.throws(
    () =>
      op.recoverRetainedInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
      ),
    { code: "TRANSACTION" },
  );
  let hits = 0;
  const trap = () => {
      hits++;
      throw Error("trap");
    },
    p = new Proxy(
      {},
      {
        get: trap,
        ownKeys: trap,
        getPrototypeOf: trap,
        getOwnPropertyDescriptor: trap,
      },
    ),
    q = Proxy.revocable({}, {});
  q.revoke();
  for (const bad of [
    p,
    q.proxy,
    {
      get id() {
        return trap();
      },
    },
    Object.assign(Object.create({}), loc(c.f.actor)),
    { ...loc(c.f.actor), [Symbol("bad")]: "x" },
  ])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        op.recoverRetainedInTransaction(bad, loc(c.reviewer), c.envelope),
      ),
    );
  for (const bad of [
    p,
    q.proxy,
    {
      get task() {
        return trap();
      },
    },
  ])
    assert.throws(() => retained(c, bad));
  assert.equal(hits, 0);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
      op.recoverRetainedInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
      );
    }),
  );
  assert.equal(snapshot(c), before);
});
for (const excess of ["count", "aggregate"] as const)
  test(`complete ${excess} bound refuses before JSON checks or blob reads`, (t) => {
    const c = prepared(t);
    apply(c);
    const db = new DatabaseSync(c.f.path);
    try {
      db.exec("PRAGMA foreign_keys=OFF; BEGIN");
      const original = db.prepare(`SELECT * FROM ${table}`).get()!;
      const n = excess === "count" ? 1024 : 8;
      const envelope =
        excess === "count"
          ? original.envelope!
          : JSON.stringify({ x: "é".repeat(1048576) });
      const insert = db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?)`);
      for (let i = 0; i < n; i++)
        insert.run(
          `synthetic-orphan-${i}`,
          "synthetic-foreign",
          `request-${i}`,
          digest(`binding-${i}`),
          envelope,
          digest(String(envelope)),
          original.record!,
          original.record_hash!,
        );
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    const before = snapshot(c),
      get = Store.prototype.get,
      all = Store.prototype.all;
    let parsed = false,
      materialized = false;
    Store.prototype.get = function <T extends Row = Row>(
      this: Store,
      sql: string,
      ...args: SQLInputValue[]
    ): T | undefined {
      if (sql.includes("json_valid")) parsed = true;
      return get.call(this, sql, ...args) as T | undefined;
    };
    Store.prototype.all = function <T extends Row = Row>(
      this: Store,
      sql: string,
      ...args: SQLInputValue[]
    ): T[] {
      if (sql.includes("AS envelope_bytes")) materialized = true;
      return all.call(this, sql, ...args) as T[];
    };
    try {
      assert.throws(() => retained(c), {
        code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
      });
    } finally {
      Store.prototype.get = get;
      Store.prototype.all = all;
    }
    assert.equal(parsed, false);
    assert.equal(materialized, false);
    assert.equal(snapshot(c), before);
  });
for (const collision of ["foreign binding", "same-org request"] as const)
  test(`complete collision selection refuses ${collision} without foreign preimage materialization`, (t) => {
    const c = prepared(t);
    apply(c);
    const p = c.f.app.database
      .owned("integration")
      .get(`SELECT * FROM ${table}`)!;
    tamper(c, `DELETE FROM ${table}`);
    const db = new DatabaseSync(c.f.path);
    try {
      const journal = db
        .prepare("SELECT * FROM integration_stock_journals WHERE id=?")
        .get(c.journal.id)!;
      journal.id = "synthetic-other-journal";
      journal.state = "rejected";
      if (collision === "foreign binding")
        journal.org_id! = "synthetic-foreign";
      const keys = Object.keys(journal);
      db.prepare(
        `INSERT INTO integration_stock_journals(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
      ).run(...keys.map((k) => journal[k]!));
      db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?)`).run(
        journal.id,
        journal.org_id!,
        p.request_id!,
        collision === "foreign binding" ? p.binding! : digest("other-binding"),
        p.envelope!,
        p.envelope_hash!,
        p.record!,
        p.record_hash!,
      );
    } finally {
      db.close();
    }
    const before = snapshot(c),
      all = Store.prototype.all;
    let materialized = false;
    Store.prototype.all = function <T extends Row = Row>(
      this: Store,
      sql: string,
      ...args: SQLInputValue[]
    ): T[] {
      if (sql.includes("AS envelope_bytes")) materialized = true;
      return all.call(this, sql, ...args) as T[];
    };
    try {
      assert.throws(() => retained(c), {
        code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
      });
    } finally {
      Store.prototype.all = all;
    }
    assert.equal(materialized, false);
    assert.equal(snapshot(c), before);
  });
for (const [owner, sql] of [
  [
    "integration",
    "UPDATE integration_stock_journal_observations SET body='{}' WHERE revision=3",
  ],
  [
    "platform",
    "UPDATE platform_audit SET actor_id='changed' WHERE action='accounting.journal.observed'",
  ],
  ["platform", "UPDATE platform_offline_head SET state_hash='changed'"],
] as const)
  test(`retained-only proof also rejects changed ${owner} outcome/history`, (t) => {
    const c = prepared(t);
    apply(c);
    const before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database.owned(owner).run(sql);
        owners(c).recoverRetainedInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          c.envelope,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
test("retained recovery refuses missing exact Platform receipt, never recreates it", (t) => {
  const c = prepared(t);
  apply(c);
  const db = new DatabaseSync(c.f.path);
  try {
    const ddl = String(
      db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE name='platform_offline_receipts_no_delete'",
        )
        .get()!.sql,
    );
    db.exec(
      "BEGIN; DROP TRIGGER platform_offline_receipts_no_delete; DELETE FROM platform_offline_receipts",
    );
    db.exec(ddl);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  const before = snapshot(c);
  assert.throws(() => retained(c));
  assert.equal(snapshot(c), before);
});
test("same canonical hashes cannot conceal changed signed envelope/root evidence", (t) => {
  const c = prepared(t);
  apply(c);
  const before = snapshot(c);
  for (const field of ["source", "evidence", "trust"] as const) {
    const e = structuredClone(c.envelope);
    if (field === "source") e.source.intervalEvidenceHash = digest("changed");
    if (field === "evidence") e.evidence.setHash = digest("changed");
    if (field === "trust") e.trust.registryHash = digest("changed");
    assert.throws(() => retained(c, e));
    assert.equal(snapshot(c), before);
  }
});
test("final retained readback corruption after the receipt rolls back every owner write", (t) => {
  const c = prepared(t),
    before = snapshot(c),
    run = Store.prototype.run;
  let receiptWritten = false;
  Store.prototype.run = function (sql, ...args) {
    if (
      sql.startsWith("INSERT INTO integration_offline_original_cancellations")
    )
      args[6] = String(args[6]) + " ";
    const r = run.call(this, sql, ...args);
    if (sql.startsWith("INSERT INTO platform_offline_receipts"))
      receiptWritten = true;
    return r;
  };
  try {
    assert.throws(() => apply(c), {
      code: "OFFLINE_ORIGINAL_CANCELLATION_TASK",
    });
  } finally {
    Store.prototype.run = run;
  }
  assert.equal(receiptWritten, true);
  assert.equal(snapshot(c), before);
});
