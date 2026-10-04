import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor, type Row } from "../src/server/core.ts";
import { Store } from "../src/server/database.ts";
import { PlatformOfflineOriginalLeaseCommandReviewReader } from "../src/server/platform-offline-original-lease-command-review.ts";
import {
  IntegrationOfflineOriginalLeaseRetirement,
  ORIGINAL_LEASE_TASK,
  originalLeaseTaskLimits,
} from "../src/server/integration-offline-original-lease-retirement.ts";
import {
  INTEGRATION_OFFLINE_ORIGINAL_LEASE_INITIALIZE_DDL as ddl,
  ORIGINAL_LEASE_PROVENANCE_TABLE as table,
} from "../src/server/integration-offline-original-lease-schema.ts";
import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
} from "../src/server/restore-offline-envelope.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
// Synthetic native journal ownership fixtures. No provider I/O or real finance approval.
import { DatabaseSync } from "node:sqlite";
import { fixture, syntheticDisclosure } from "./fixtures.ts";
import {
  setup as costSetup,
  policy,
  input as correctionInput,
} from "./cost-correction-fixture.ts";
import type {
  JournalDeliveryInput,
  JournalLease,
} from "../src/server/stock-journal-delivery.ts";
import { stockJournalReceiver } from "../src/server/stock-journal-delivery.ts";
import type { EffectResult } from "../src/server/integration.ts";
function journalFixture(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  correction = false,
  movementDates?: readonly string[],
  currency?: "CAD" | "USD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  if (movementDates) {
    const db = new DatabaseSync(f.path);
    try {
      const movements = db
        .prepare(
          "SELECT m.id FROM inventory_movements m JOIN inventory_cost_sequences s ON s.movement_id=m.id AND s.org_id=m.org_id ORDER BY s.sequence",
        )
        .all();
      if (movements.length !== movementDates.length)
        throw Error("Select one fixture date per movement");
      movements.forEach((movement, i) =>
        db
          .prepare("UPDATE inventory_movements SET created_at=? WHERE id=?")
          .run(`${movementDates[i]}T12:00:00.000Z`, String(movement.id)),
      );
    } finally {
      db.close();
    }
  }
  const { original, reviewer } = costSetup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "journal-policy", { ...policy(), closedThrough: null });
  const r = f.app.identity.organizationResidency;
  const { provider: _provider, ...terms } = syntheticDisclosure(
    f.app,
    "quickbooks",
  );
  r.publish(f.actor, "journal-terms", terms);
  const current = r.current(f.actor);
  r.choose(f.actor, "journal-choice", {
    region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: "12345",
    acknowledgment: "Synthetic organization exception",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic finance",
      evidenceRef: "synthetic:ledger",
    },
  });
  const authority = r.permission(f.actor, "12345");
  const selected = correction
    ? (() => {
        const ready = c.prepare(f.actor, "journal-correction", {
          ...correctionInput(original),
          receiverRef: stockJournalReceiver("12345"),
        });
        return c.decide(reviewer, "journal-correction-approved", {
          correctionId: ready.id,
          reviewHash: ready.reviewHash,
          decision: "approve",
          reason: "Synthetic separate finance review",
        });
      })()
    : original;
  const file = correction
    ? c.download(f.actor, selected.id)
    : f.app.integration.costs.download(f.actor, original.id);
  const make = (
    leg: JournalDeliveryInput["leg"] = correction ? "reversal" : "original",
    attemptId: string | null = null,
  ): JournalDeliveryInput => {
    const document = JSON.parse(file.bytes),
      rows = leg === "original" ? document.report.journal : document[leg];
    return {
      sourceId: selected.id,
      sourceHash: file.hash,
      leg,
      postingDate: rows[0].date,
      attemptId,
      bindingId: "synthetic-org-binding",
      realm: "12345",
      policyRevision: 1,
      authority,
      accounts: [
        ...new Set<string>(rows.map((row: { account: string }) => row.account)),
      ].map((sourceAccount, i) => ({
        sourceAccount,
        accountId: String(10 + i),
      })),
      reason: "Synthetic exact journal/company/account review",
    };
  };
  const j = f.app.integration.costs.journals;
  const approve = (selection = make(), key = "journal") => {
    const ready = j.prepare(f.actor, key + "-prepare", selection);
    return j.decide(reviewer, key + "-approve", {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Synthetic independent delivery approval",
    });
  };
  return { f, original, reviewer, c, j, make, approve, selected, file };
}

const loc = (a: Actor) => ({ id: a.id, orgId: a.orgId });
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  reports = false,
  dispatched = false,
  lookup = false,
  orphan = false,
) {
  const c = journalFixture(t, region, false, undefined, undefined, reports),
    journal = c.approve();
  let lease = c.j.claim(c.f.actor, journal.id, "write")!;
  if (dispatched) c.j.beforeWrite(lease);
  if (lookup) {
    c.j.unresolved(lease, "transport-uncertain");
    lease = c.j.claim(c.f.actor, journal.id, "lookup")!;
  }
  c.f.app.platform.isolateRestore(
    digest("synthetic copied original"),
    new Date().toISOString(),
  );
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(c.f.path + suffix))
      fs.chmodSync(c.f.path + suffix, 0o600);
  const a = c.f.app;
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
      { kind: "isolate", sessionId: "lease-session" },
      [],
    );
    r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "open" },
      [],
    );
  });
  const before = a.database.transaction(() =>
      c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, journal.id),
    ),
    r = before.attempts.find((a) => a.row.id === journal.id)!.row;
  const payload = {
    journalId: journal.id,
    orgId: c.f.actor.orgId,
    leaseId: lease.leaseId,
    leaseActor: lease.actor.id,
    leaseStarted: lease.started,
    leaseMode: lease.mode,
    dispatched: r.dispatched,
    requestRef: journal.requestRef,
    sourceId: r.source_id,
    sourceHash: before.source.file.hash,
    attemptId: r.attempt_id,
    reviewHash: r.review_hash,
    expectedFactsHash: before.hash,
  };
  const envelope = a.database.transaction(() => {
    const retained = a.platform.offline.readInTransaction()!,
      {
        version: _,
        schemaVersion: __,
        ...recovery
      } = retained.state.generation,
      session = retained.state.sessions.at(-1)!,
      candidate = a.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(c.f.path, { bigint: true });
    return parseOfflineTaskEnvelope({
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "retire-original",
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
          logicalHash: digest("base"),
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
        name: ORIGINAL_LEASE_TASK,
        version: 1,
        orgId: c.f.actor.orgId,
        siteIds: [],
        subjectId: journal.id,
        expectedRevision:
          before.attempts
            .find((a) => a.row.id === journal.id)!
            .observations.at(-1)?.revision ?? 0,
        expectedStateHash: before.hash,
        payloadHash: digest(canonical(payload)),
        priorClaim: {
          operationId: journal.id,
          tokenHash: digest(lease.leaseId),
          revision:
            before.attempts
              .find((a) => a.row.id === journal.id)!
              .observations.at(-1)?.revision ?? 0,
          stateHash: before.hash,
        },
      },
      evidence: {
        setHash: digest("set"),
        items: [],
        qualificationHash: digest("qualification"),
      },
      operations: {
        authorityId: "synthetic-host",
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
    });
  });
  if (orphan)
    a.database.transaction(() => {
      const state = a.platform.offline.readInTransaction()!;
      a.platform.offline.transitionInTransaction(
        state.state.generation,
        state.anchor,
        {
          kind: "record-task",
          receipt: {
            owner: "integration",
            taskName: ORIGINAL_LEASE_TASK,
            orgId: c.f.actor.orgId,
            requestId: envelope.requestId,
            binding: offlineTaskBinding(envelope),
            payloadHash: envelope.task.payloadHash,
            beforeCandidateHash: envelope.candidate.logicalHash,
            resultHash: digest("orphan"),
          },
        },
        [],
      );
    });
  // Explicit test install only. No production initializer/migration wiring here.
  a.database.owned("integration").migrate(ddl);
  return { ...c, journal, lease, before, payload, envelope, reports, region };
}
type F = ReturnType<typeof setup>;
function task(c: F) {
  const a = c.f.app;
  return new IntegrationOfflineOriginalLeaseRetirement(
    a.database,
    a.identity,
    a.platform,
    a.integration.costs.journals,
  );
}
function apply(
  c: F,
  payload: unknown = c.payload,
  envelope: unknown = c.envelope,
  p: unknown = loc(c.f.actor),
  x: unknown = loc(c.reviewer),
) {
  return c.f.app.database.transaction(() =>
    task(c).applyInTransaction(p, x, envelope, payload),
  );
}
function recover(c: F, envelope: unknown = c.envelope) {
  return c.f.app.database.transaction(() =>
    task(c).recoverRetainedInTransaction(
      loc(c.f.actor),
      loc(c.reviewer),
      envelope,
    ),
  );
}
function snapshot(c: F) {
  const d = new DatabaseSync(c.f.path);
  try {
    return canonical(
      d
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((r) => [
          r.name,
          d.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`).all(),
        ]),
    );
  } finally {
    d.close();
  }
}
function alter(c: F, sql: string, ...args: (string | number)[]) {
  const d = new DatabaseSync(c.f.path);
  try {
    d.exec(
      "PRAGMA foreign_keys=OFF;PRAGMA recursive_triggers=ON;PRAGMA ignore_check_constraints=ON",
    );
    d.prepare(sql).run(...args);
  } finally {
    d.close();
  }
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
// These meaningful successful-flow assertions intentionally remain red on the
// excluded schema19 profile. Root's schema22 integration must make them pass;
// no fingerprint override or fake candidate/Platform port is installed here.
for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    for (const dispatched of [false, true])
      for (const lookup of [false, true])
        test(`${region} reports=${reports} dispatched=${dispatched} lookup=${lookup}: exact native task and restart recovery`, (t) => {
          const c = setup(t, region, reports, dispatched, lookup);
          const commands = c.f.app.database.transaction(() =>
            new PlatformOfflineOriginalLeaseCommandReviewReader(
              c.f.app.database,
              c.f.app.identity,
              c.j,
            ).getInTransaction(loc(c.f.actor) as Actor, c.journal.id),
          );
          assert.deepEqual(commands.blockers, [
            "CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT",
            "SOURCE_PROVIDER_AND_CURRENT_COMMIT_AUTHORITY_NOT_QUALIFIED",
            "HISTORICAL_RECEIPTS_ARE_NOT_EXTERNAL_PROVENANCE",
            "SOURCE_COMPLETENESS_UNQUALIFIED",
            "CURRENT_EXTERNAL_AUTHORITY_REQUIRED",
            "RECOVERY_HOLD_RETAINED",
          ]);
          const result = apply(c);
          frozen(result);
          assert.equal(result.status, "native-owner-application-provisional");
          assert.equal(result.resultHash, digest(canonical(result.record)));
          assert.equal(result.record.nativeBeforeHash, c.before.hash);
          assert.equal(
            result.record.observation.body.cause,
            "restore-interrupted",
          );
          assert(
            result.requiredChecks.includes(
              "CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT",
            ),
          );
          const a = result.after.attempts.find(
            (a) => a.row.id === c.journal.id,
          )!;
          assert.equal(a.row.state, "unknown");
          assert.equal(a.row.dispatched, dispatched ? 1 : 0);
          assert.equal(
            canonical(result.after.source),
            canonical(c.before.source),
          );
          assert.equal(
            canonical(result.after.sourceReservations),
            canonical(c.before.sourceReservations),
          );
          const rows = c.f.app.database
            .owned("integration")
            .all(`SELECT * FROM ${table}`);
          assert.equal(rows.length, 1);
          assert.equal(rows[0]!.record_hash, result.resultHash);
          assert.equal(rows[0]!.envelope, canonical(c.envelope));
          const before = snapshot(c);
          assert.throws(() => apply(c));
          assert.equal(snapshot(c), before);
          c.f.app.close();
          c.f.app = new Application(c.f.path, region, {
            eventReports: reports,
          });
          const replay = recover(c);
          assert.equal(canonical(replay.record), canonical(result.record));
          assert.equal(replay.receipt.resultHash, result.resultHash);
          assert.equal(snapshot(c), before);
          assert.throws(
            () =>
              c.f.app.integration.costs.journals.claim(
                c.f.actor,
                c.journal.id,
                "write",
              ),
            { code: "RECOVERY_HOLD" },
          );
        });
test("existing exact schema guard refuses unwired extension without native writes", (t) => {
  const c = setup(t),
    before = snapshot(c);
  // This is a baseline prerequisite receipt, not a permanent expected refusal
  // after shared schema wiring. No successful import claim follows from it.
  if (Number(SCHEMA_VERSION) === 19) {
    assert.throws(() => apply(c), { code: "RESTORE_OFFLINE_NATIVE_PHASE" });
    assert.equal(snapshot(c), before);
  } else assert.equal(apply(c).status, "native-owner-application-provisional");
});
test("actual writer requirement and original copied lease refusal remain", (t) => {
  const c = setup(t),
    r = task(c),
    before = snapshot(c);
  assert.throws(
    () =>
      r.applyInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
        c.payload,
      ),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () =>
      r.recoverRetainedInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
      ),
    { code: "TRANSACTION" },
  );
  assert.throws(
    () => c.j.unresolved(structuredClone(c.lease), "transport-uncertain"),
    { code: "JOURNAL_LEASE" },
  );
  assert.equal(snapshot(c), before);
});
for (const which of ["preparer", "executor"] as const)
  for (const change of [
    "role='support'",
    "active=0",
    "org_id='foreign'",
    "account_id='buyer'",
  ])
    test(`current ${which} ${change} refuses before candidate scan`, (t) => {
      const c = setup(t),
        who = which === "preparer" ? c.f.actor : c.reviewer;
      alter(c, `UPDATE iam_users SET ${change} WHERE id=?`, who.id);
      const before = snapshot(c);
      assert.throws(() => apply(c));
      assert.throws(() => recover(c));
      assert.equal(snapshot(c), before);
    });
for (const which of ["preparer", "executor"] as const)
  test(`current ${which} password change refuses`, (t) => {
    const c = setup(t),
      who = which === "preparer" ? c.f.actor : c.reviewer;
    alter(
      c,
      "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-04T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
      who.id,
    );
    assert.throws(() => apply(c), { code: "OFFLINE_ORIGINAL_LEASE_TASK" });
  });
test("same principal and missing hold refuse", (t) => {
  const c = setup(t);
  assert.throws(() =>
    apply(c, c.payload, c.envelope, loc(c.f.actor), loc(c.f.actor)),
  );
  alter(c, "DELETE FROM platform_recovery");
  assert.throws(() => apply(c), { code: "OFFLINE_ORIGINAL_LEASE_TASK" });
});
test("hostile payload, locators and envelope invoke zero traps before native hooks", (t) => {
  const c = setup(t);
  let calls = 0;
  const p = new Proxy(
    {},
    {
      get() {
        calls++;
        throw Error("trap");
      },
      ownKeys() {
        calls++;
        throw Error("trap");
      },
      getPrototypeOf() {
        calls++;
        throw Error("trap");
      },
      getOwnPropertyDescriptor() {
        calls++;
        throw Error("trap");
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const value of [
    p,
    revoked.proxy,
    { ...c.payload, extra: 1 },
    Object.defineProperty({ ...c.payload }, "leaseId", {
      get() {
        calls++;
        return "bad";
      },
    }),
    Object.defineProperty({ ...c.payload }, "hidden", { value: 1 }),
    { ...c.payload, [Symbol()]: 1 },
    { ...c.payload, leaseId: "x".repeat(100000) },
    { ...c.payload, leaseStarted: -0 },
    { ...c.payload, sourceHash: p },
    Object.assign(Object.create({}), c.payload),
  ])
    assert.throws(() => apply(c, value));
  for (const bad of [
    p,
    revoked.proxy,
    { ...loc(c.f.actor), role: "admin" },
    Object.defineProperty(loc(c.f.actor), "id", {
      get() {
        calls++;
        return "bad";
      },
    }),
  ])
    assert.throws(() => apply(c, c.payload, c.envelope, bad));
  assert.throws(() => apply(c, c.payload, p));
  assert.throws(() => apply(c, c.payload, { ...c.envelope, task: p }));
  assert.equal(calls, 0);
});
test("schema is STRICT and append only; no constructor DDL", (t) => {
  const c = setup(t),
    s = c.f.app.database.owned("integration"),
    before = snapshot(c);
  task(c);
  assert.equal(snapshot(c), before);
  const insert = `INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
  const values = [
    c.journal.id,
    c.f.actor.orgId,
    "request",
    "b".repeat(64),
    "a".repeat(64),
    "{}",
    "{}",
    "a".repeat(64),
    "a".repeat(64),
    "a".repeat(64),
    "a".repeat(64),
  ];
  s.run(insert, ...values);
  for (const sql of [
    `UPDATE ${table} SET request_id='changed'`,
    `DELETE FROM ${table}`,
    `INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`,
  ])
    assert.throws(() => s.run(sql), /append-only/);
  assert.throws(() =>
    s.run(
      insert,
      c.journal.id,
      c.f.actor.orgId,
      "request",
      "b".repeat(64),
      "a".repeat(64),
      "{}",
      new Uint8Array([1]),
      "a".repeat(64),
      "a".repeat(64),
      "a".repeat(64),
      "a".repeat(64),
    ),
  );
});
function fakeRow(c: F, record: string, envelope = canonical(c.envelope)) {
  alter(
    c,
    `INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    c.journal.id,
    c.f.actor.orgId,
    "request",
    "b".repeat(64),
    "a".repeat(64),
    envelope,
    record,
    "a".repeat(64),
    "a".repeat(64),
    "a".repeat(64),
    "a".repeat(64),
  );
}
for (const raw of [
  '{"x":"\\ud800"}',
  '{"x":"\\u0000"}',
  "{}",
  '{"x":1,"x":2}',
  " ".repeat(50) + "{}",
  "[".repeat(8193) + "0" + "]".repeat(8193),
])
  test(`malformed retained preimages refuse ${raw.slice(0, 32)}`, (t) => {
    const c = setup(t);
    fakeRow(c, raw);
    const before = snapshot(c);
    assert.throws(() => recover(c));
    assert.equal(snapshot(c), before);
  });
test("fatal UTF8 and literal NUL are refused before JSON claims", (t) => {
  for (const bad of ["CAST(x'ff' AS TEXT)", "char(0)||'{}'"]) {
    const c = setup(t);
    fakeRow(c, "{}");
    alter(c, `DROP TRIGGER ${table}_no_update`);
    alter(c, `UPDATE ${table} SET record=${bad}`);
    assert.throws(() => recover(c));
  }
});
test("stored row byte excess refuses before materialization", (t) => {
  const c = setup(t);
  fakeRow(
    c,
    JSON.stringify({ x: "界".repeat(350000) }),
    JSON.stringify({ x: "界".repeat(350000) }),
  );
  const all = Store.prototype.all;
  let read = false;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...args: Parameters<typeof all> extends [string, ...infer R] ? R : never
  ): T[] {
    if (sql.includes(`FROM ${table}`)) read = true;
    return all.call(this, sql, ...args) as T[];
  };
  try {
    assert.throws(() => recover(c));
    assert.equal(read, false);
  } finally {
    Store.prototype.all = all;
  }
});
test("owner substitutions are refused before hook execution", (t) => {
  const c = setup(t);
  let calls = 0;
  Object.defineProperty(c.j, "retireOfflineOriginalLeaseInTransaction", {
    value: () => {
      calls++;
      throw Error("hook");
    },
    configurable: true,
  });
  assert.throws(() => task(c));
  assert.equal(calls, 0);
  delete (c.j as unknown as Record<string, unknown>)
    .retireOfflineOriginalLeaseInTransaction;
  const other = setup(t);
  assert.throws(
    () =>
      new IntegrationOfflineOriginalLeaseRetirement(
        c.f.app.database,
        c.f.app.identity,
        c.f.app.platform,
        other.j,
      ),
  );
});

test("complete global provenance count refuses before row materialization", (t) => {
  const c = setup(t),
    d = new DatabaseSync(c.f.path);
  try {
    d.exec("PRAGMA foreign_keys=OFF;BEGIN");
    const q = d.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i <= originalLeaseTaskLimits.rows; i++)
      q.run(
        "journal-" + i,
        "foreign",
        "request-" + i,
        digest("binding" + i),
        digest("generation"),
        "{}",
        "{}",
        digest("record"),
        digest("before"),
        digest("after"),
        digest("observation"),
      );
    d.exec("COMMIT");
  } finally {
    d.close();
  }
  assert.throws(() => recover(c), {
    code: "OFFLINE_ORIGINAL_LEASE_TASK_LIMIT",
  });
});
test("complete global aggregate bytes refuses rather than selecting one small row", (t) => {
  const c = setup(t),
    d = new DatabaseSync(c.f.path);
  try {
    d.exec("PRAGMA foreign_keys=OFF;BEGIN");
    const q = d.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < 120; i++)
      q.run(
        "journal-" + i,
        "foreign",
        "request-" + i,
        digest("binding" + i),
        digest("generation"),
        "{}",
        JSON.stringify({ x: "界".repeat(200000) }),
        digest("record"),
        digest("before"),
        digest("after"),
        digest("observation"),
      );
    d.exec("COMMIT");
  } finally {
    d.close();
  }
  assert.throws(() => recover(c), {
    code: "OFFLINE_ORIGINAL_LEASE_TASK_LIMIT",
  });
});
test("current-generation corresponding receipt with missing provenance refuses", (t) => {
  const c = setup(t, "CA", false, false, false, true);
  assert.throws(() => recover(c), { code: "OFFLINE_ORIGINAL_LEASE_TASK" });
});
test("same task reentry refuses before another phase review", (t) => {
  const c = setup(t),
    r = task(c),
    all = Store.prototype.all;
  let reached = false;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...args: Parameters<typeof all> extends [string, ...infer R] ? R : never
  ): T[] {
    if (!reached && sql.includes("platform_offline")) {
      reached = true;
      assert.throws(
        () =>
          r.recoverRetainedInTransaction(
            loc(c.f.actor),
            loc(c.reviewer),
            c.envelope,
          ),
        { code: "OFFLINE_ORIGINAL_LEASE_TASK" },
      );
    }
    return all.call(this, sql, ...args) as T[];
  };
  try {
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        r.recoverRetainedInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          c.envelope,
        ),
      ),
    );
    assert(reached);
  } finally {
    Store.prototype.all = all;
  }
});
for (const boundary of [
  "native-observation",
  "native-audit",
  "provenance",
  "platform-receipt",
  "authority-after-provenance",
] as const)
  test(`late ${boundary} fault must actually be reached and roll back all writes`, (t) => {
    const c = setup(t),
      before = snapshot(c),
      run = Store.prototype.run;
    let reached = false;
    const needle =
      boundary === "native-observation"
        ? "INSERT INTO integration_stock_journal_observations"
        : boundary === "native-audit"
          ? "INSERT INTO platform_audit"
          : boundary === "platform-receipt"
            ? "INSERT INTO platform_offline_receipts"
            : `INSERT INTO ${table}`;
    Store.prototype.run = function (
      sql: string,
      ...args: Parameters<typeof run> extends [string, ...infer R] ? R : never
    ) {
      const result = run.call(this, sql, ...args);
      if (sql.includes(needle)) {
        reached = true;
        if (boundary === "authority-after-provenance")
          run.call(
            c.f.app.database.owned("iam"),
            "UPDATE iam_users SET active=0 WHERE id=?",
            c.reviewer.id,
          );
        else throw Error("synthetic late failure");
      }
      return result;
    };
    try {
      assert.throws(() => apply(c));
      assert(reached, "must reach actual owner write before fault");
    } finally {
      Store.prototype.run = run;
    }
    assert.equal(snapshot(c), before);
  });
for (const field of [
  "leaseId",
  "sourceHash",
  "requestRef",
  "expectedFactsHash",
] as const)
  test(`changed ${field} refuses after valid phase at exact native binding`, (t) => {
    const c = setup(t),
      p = {
        ...c.payload,
        [field]: field.endsWith("Hash")
          ? "a".repeat(64)
          : field === "requestRef"
            ? "DJ-" + "a".repeat(18)
            : "wrong-lease",
      },
      e = structuredClone(c.envelope);
    const changedEnvelope = {
      ...e,
      task: { ...e.task, payloadHash: digest(canonical(p)) },
    };
    assert.throws(() => apply(c, p, changedEnvelope), {
      code: "OFFLINE_ORIGINAL_LEASE_TASK",
    });
  });
test("retained rehashed result cannot replace the actual Platform receipt", (t) => {
  const c = setup(t);
  apply(c);
  alter(c, `DROP TRIGGER ${table}_no_update`);
  const d = new DatabaseSync(c.f.path);
  try {
    const row = d.prepare(`SELECT record FROM ${table}`).get()!;
    const r = JSON.parse(String(row.record));
    r.phaseHash = digest("forged");
    const raw = canonical(r);
    d.prepare(`UPDATE ${table} SET record=?,record_hash=?`).run(
      raw,
      digest(raw),
    );
  } finally {
    d.close();
  }
  assert.throws(() => recover(c));
});
test("retained envelope tampering is refused", (t) => {
  const c = setup(t);
  apply(c);
  alter(c, `DROP TRIGGER ${table}_no_update`);
  alter(
    c,
    `UPDATE ${table} SET envelope=?`,
    canonical({ ...c.envelope, requestId: "different" }),
  );
  assert.throws(() => recover(c));
});

for (const change of [
  "lease_id='replacement'",
  "dispatched=1-dispatched",
  "review_hash='corrupt'",
])
  test(`retained native ${change} refuses recovery without changing provenance`, (t) => {
    const c = setup(t);
    apply(c);
    const before = snapshot(c);
    assert.throws(() =>
      c.f.app.database.transaction(() => {
        c.f.app.database
          .owned("integration")
          .run(
            `UPDATE integration_stock_journals SET ${change} WHERE id=?`,
            c.journal.id,
          );
        task(c).recoverRetainedInTransaction(
          loc(c.f.actor),
          loc(c.reviewer),
          c.envelope,
        );
      }),
    );
    assert.equal(snapshot(c), before);
  });
test("retained observation audit corruption refuses recovery", (t) => {
  const c = setup(t);
  apply(c);
  const before = snapshot(c);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.f.app.database
        .owned("platform")
        .run(
          "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.observed' AND reference=?",
          canonical({ revision: 1, hash: digest("wrong") }),
          c.journal.id,
        );
      task(c).recoverRetainedInTransaction(
        loc(c.f.actor),
        loc(c.reviewer),
        c.envelope,
      );
    }),
  );
  assert.equal(snapshot(c), before);
});
test("removing retained provenance leaves an orphan receipt and cannot authorize replay", (t) => {
  const c = setup(t);
  apply(c);
  alter(c, `DROP TRIGGER ${table}_no_delete`);
  alter(c, `DELETE FROM ${table}`);
  assert.throws(() => recover(c), { code: "OFFLINE_ORIGINAL_LEASE_TASK" });
  assert.throws(() => apply(c));
});
test("recovery uses durable record after original mutable payload is lost", (t) => {
  const c = setup(t);
  apply(c);
  const before = snapshot(c);
  c.payload.leaseId = "lost-original-input";
  c.payload.sourceHash = digest("changed-input");
  const recovered = recover(c);
  assert.notEqual(recovered.record.payload.leaseId, c.payload.leaseId);
  assert.equal(recovered.record.payload.sourceHash, c.before.source.file.hash);
  assert.equal(snapshot(c), before);
});
