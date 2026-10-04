import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { canonical, digest, type Actor, type Row } from "../src/server/core.ts";
import {
  PlatformOfflineOriginalLeaseCommandReviewReader,
  originalLeaseCommandReviewLimits,
} from "../src/server/platform-offline-original-lease-command-review.ts";
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
function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  ancestors = 0,
  dispatched = true,
  lookup = false,
  reports = false,
) {
  const c = journalFixture(t, region, false, undefined, undefined, reports);
  let journal = c.approve();
  for (let i = 0; i <= ancestors; i++) {
    const lease = c.j.claim(c.f.actor, journal.id, "write")!;
    if (dispatched || i < ancestors) c.j.beforeWrite(lease);
    if (i === ancestors && !lookup) break;
    c.j.unresolved(lease, "transport-uncertain");
    if (i === ancestors) {
      c.j.claim(c.f.actor, journal.id, "lookup");
      break;
    }
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
function reader(c: F) {
  return new PlatformOfflineOriginalLeaseCommandReviewReader(
    c.f.app.database,
    c.f.app.identity,
    c.f.app.integration.costs.journals,
  );
}
function read(c: F, actor: Actor = c.reviewer) {
  return c.f.app.database.transaction(() =>
    reader(c).getInTransaction(actor, c.journal.id),
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
function freeze(v: unknown) {
  if (v && typeof v === "object") {
    assert(Object.isFrozen(v));
    Object.values(v).forEach(freeze);
  }
}
function alter(c: F, sql: string, ...args: (string | number)[]) {
  const db = new DatabaseSync(c.f.path);
  try {
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}
for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    for (const dispatched of [false, true])
      for (const lookup of [false, true])
        test(`${region} reports=${reports} dispatched=${dispatched} lookup=${lookup}: actual complete read only lease audit closure`, (t) => {
          const c = setup(t, region, 0, dispatched, lookup, reports),
            before = snapshot(c),
            r = read(c);
          assert.equal(snapshot(c), before);
          freeze(r);
          assert.equal(canonical(read(c)), canonical(r));
          const { factsHash, ...body } = r;
          assert.equal(factsHash, digest(canonical(body)));
          assert.equal(
            r.purpose,
            "distributor-platform-offline-original-lease-command-review-v1",
          );
          const native = c.f.app.database.transaction(() =>
            c.j.readOfflineLeaseRetirementInTransaction(
              c.reviewer,
              c.journal.id,
            ),
          );
          assert.equal(r.nativeReviewHash, native.hash);
          assert(
            !r.blockers.includes("running-native-owner-projection-required"),
          );
          const a = r.attempts.find((a) => a.journalId === c.journal.id)!;
          assert.equal(a.currentLease!.dispatched, dispatched ? 1 : 0);
          assert.equal(a.currentLease!.mode, lookup ? "lookup" : "write");
          assert.equal(
            a.leaseAudits.filter(
              (a) => a.action === "accounting.journal.claimed",
            ).length,
            lookup ? 2 : 1,
          );
          assert.equal(a.prepare.preimage.status, "matched");
          assert.equal(a.decision!.preimage.status, "matched");
          assert(
            r.blockers.includes("CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT"),
          );
          assert.throws(() => {
            (a.currentLease as { id: string }).id = "changed";
          }, TypeError);
          assert.equal(snapshot(c), before);
        });
for (const region of ["CA", "US"] as const)
  test(`${region}: cancelled ancestors and permanent request history join`, (t) => {
    const c = setup(t, region, 2),
      r = read(c);
    assert.equal(r.attempts.length, 3);
    assert.equal(r.attempts.filter((a) => a.cancellation).length, 2);
    assert.equal(r.attempts.filter((a) => a.currentLease).length, 1);
  });
test("actual enclosing writer, raw hold and readonly rollback/reopen", (t) => {
  const c = setup(t),
    r = reader(c),
    before = snapshot(c),
    initial = read(c);
  assert.throws(() => r.getInTransaction(c.reviewer, c.journal.id), {
    code: "TRANSACTION",
  });
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        r.getInTransaction(c.reviewer, c.journal.id);
        throw Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(snapshot(c), before);
  assert.throws(() =>
    c.f.app.database.transaction(() => {
      c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
      r.getInTransaction(c.reviewer, c.journal.id);
    }),
  );
  c.f.app.close();
  c.f.app = new Application(c.f.path, "CA", { eventReports: false });
  assert.equal(canonical(read(c)), canonical(initial));
  assert.equal(snapshot(c), before);
});
for (const change of [
  "role='support'",
  "active=0",
  "org_id='foreign'",
  "account_id='buyer'",
])
  test(`fresh actor refuses ${change}`, (t) => {
    const c = setup(t);
    alter(c, `UPDATE iam_users SET ${change} WHERE id=?`, c.reviewer.id);
    assert.throws(
      () => read(c, { ...c.reviewer, role: "admin", accountId: null }),
      { code: "FORBIDDEN" },
    );
  });
test("password change and foreign locator refusal precede corrupt retained scans", (t) => {
  const c = setup(t);
  alter(
    c,
    "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-04T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    c.reviewer.id,
  );
  alter(c, "UPDATE platform_commands SET result='malformed'");
  assert.throws(() => read(c), { code: "PASSWORD_CHANGE_REQUIRED" });
  assert.throws(() => read(c, { ...c.reviewer, orgId: "foreign" }), {
    code: "FORBIDDEN",
  });
});
test("primitive and actor hostile descriptors reject without invoking traps", (t) => {
  const c = setup(t),
    r = reader(c),
    before = snapshot(c);
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
  for (const bad of [
    p,
    revoked.proxy,
    Object.assign(Object.create({}), c.reviewer),
    Object.defineProperty({ ...c.reviewer }, "role", {
      get() {
        calls++;
        return "admin";
      },
    }),
    Object.defineProperty({ ...c.reviewer }, "hidden", { value: 1 }),
    { ...c.reviewer, [Symbol()]: 1 },
    { ...c.reviewer, sites: new Array(2) },
  ])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        r.getInTransaction(bad as Actor, c.journal.id),
      ),
    );
  for (const id of [p, revoked.proxy, {}, null, "a".repeat(161), "bad\0"])
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        r.getInTransaction(c.reviewer, id as string),
      ),
    );
  assert.equal(calls, 0);
  assert.equal(snapshot(c), before);
});
for (const change of [
  "lease_id='other'",
  "lease_actor='other'",
  "lease_started=9007199254740000",
  "lease_mode='lookup'",
  "dispatched=1",
  "source_id='other'",
  "review_hash='bad'",
  "plan='{}'",
])
  test(`native current identity corruption ${change} refuses`, (t) => {
    const c = setup(t, "CA", 0, false);
    alter(
      c,
      `UPDATE integration_stock_journals SET ${change} WHERE id=?`,
      c.journal.id,
    );
    assert.throws(() => read(c));
  });
for (const action of ["claimed", "dispatched", "observed"])
  test(`missing ${action} audit refuses complete native join`, (t) => {
    const c = setup(t, "CA", 0, true, true);
    alter(
      c,
      "DELETE FROM platform_audit WHERE action=?",
      "accounting.journal." + action,
    );
    assert.throws(() => read(c));
  });
for (const detail of [
  { leaseId: "other", mode: "write", reviewHash: "0".repeat(64) },
  { leaseId: "other" },
  {},
])
  test(`malformed claim detail ${canonical(detail)}`, (t) => {
    const c = setup(t);
    alter(
      c,
      "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.claimed'",
      canonical(detail),
    );
    assert.throws(() => read(c));
  });
test("matching corrupted request hash and command audit cannot replace actual preparation input", (t) => {
  const c = setup(t),
    hash = "a".repeat(64);
  alter(
    c,
    "UPDATE platform_commands SET hash=? WHERE name='accounting.journal.prepare'",
    hash,
  );
  alter(
    c,
    "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.prepare'",
    canonical({ requestHash: hash }),
  );
  assert.throws(() => read(c));
});
test("decision unretained original request stays explicitly blocked", (t) => {
  const c = setup(t),
    hash = "a".repeat(64);
  alter(
    c,
    "UPDATE platform_commands SET hash=? WHERE name='accounting.journal.decide'",
    hash,
  );
  alter(
    c,
    "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.decide'",
    canonical({ requestHash: hash }),
  );
  assert(read(c).blockers.includes("DECISION_REQUEST_PREIMAGE_NOT_RETAINED"));
});
for (const change of [
  "org_id='foreign'",
  "reference='orphan'",
  "action='accounting.journal.other'",
])
  test(`scope or unclassified audit ${change} cannot yield unblocked claim`, (t) => {
    const c = setup(t);
    alter(
      c,
      `UPDATE platform_audit SET ${change} WHERE action='accounting.journal.claimed'`,
    );
    assert.throws(() => read(c));
  });
test("unsupported journal event is explicit blocker", (t) => {
  const c = setup(t);
  c.f.app.database.transaction(() =>
    c.f.app.platform.event(
      c.f.actor,
      "accounting.journal.synthetic",
      c.journal.id,
      { journalId: c.journal.id },
    ),
  );
  assert(read(c).blockers.includes("JOURNAL_EVENT_PREIMAGE_NOT_RETAINED"));
});
for (const bad of [
  "'" + "界".repeat(22000) + "'",
  "CAST(x'ff' AS TEXT)",
  "char(0)||'bad'",
  "'" + "[".repeat(513) + "0" + "]".repeat(513) + "'",
])
  test(`preflight invalid UTF8/NUL/bytes/JSON ${bad.slice(0, 30)}`, (t) => {
    const c = setup(t);
    alter(
      c,
      `UPDATE platform_commands SET result=${bad} WHERE name='accounting.journal.prepare'`,
    );
    assert.throws(() => read(c));
  });
test("global foreign oversized row is refused before selected string materialization", (t) => {
  const c = setup(t);
  alter(
    c,
    "INSERT INTO platform_commands SELECT 'foreign',actor_id,'foreign','foreign',hash,?,created_at FROM platform_commands LIMIT 1",
    JSON.stringify({ x: "界".repeat(22000) }),
  );
  const all = Store.prototype.all;
  let materialized = false;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...args: Parameters<typeof all> extends [string, ...infer R] ? R : never
  ) {
    if (sql.includes("CAST(") && sql.includes("FROM platform_"))
      materialized = true;
    return all.call(this, sql, ...args) as T[];
  };
  try {
    assert.throws(() => read(c), {
      code: "OFFLINE_ORIGINAL_LEASE_COMMAND_LIMIT",
    });
    assert.equal(materialized, false);
  } finally {
    Store.prototype.all = all;
  }
});
test("global count excess has no pagination escape", (t) => {
  const c = setup(t);
  const d = new DatabaseSync(c.f.path);
  try {
    const insert = d.prepare(
      "INSERT INTO platform_commands SELECT 'foreign',actor_id,'foreign',?,hash,'{}',created_at FROM platform_commands LIMIT 1",
    );
    d.exec("BEGIN");
    for (let i = 0; i <= originalLeaseCommandReviewLimits.commands; i++)
      insert.run("extra-" + i);
    d.exec("COMMIT");
  } finally {
    d.close();
  }
  assert.throws(() => read(c), {
    code: "OFFLINE_ORIGINAL_LEASE_COMMAND_LIMIT",
  });
});
test("global aggregate byte excess is refused", (t) => {
  const c = setup(t);
  const d = new DatabaseSync(c.f.path);
  try {
    const insert = d.prepare(
      "INSERT INTO platform_commands SELECT 'foreign',actor_id,'foreign',?,hash,?,created_at FROM platform_commands LIMIT 1",
    );
    d.exec("BEGIN");
    for (let i = 0; i < 150; i++)
      insert.run("extra-" + i, JSON.stringify({ x: "x".repeat(60000) }));
    d.exec("COMMIT");
  } finally {
    d.close();
  }
  assert.throws(() => read(c), {
    code: "OFFLINE_ORIGINAL_LEASE_COMMAND_LIMIT",
  });
});
test("owner substitution refuses before executable hook", (t) => {
  const c = setup(t);
  let calls = 0;
  Object.defineProperty(c.j, "readOfflineLeaseRetirementInTransaction", {
    value: () => {
      calls++;
      throw Error("hook");
    },
    configurable: true,
  });
  assert.throws(() => reader(c));
  assert.equal(calls, 0);
  delete (c.j as unknown as Record<string, unknown>)
    .readOfflineLeaseRetirementInTransaction;
  const other = setup(t);
  assert.throws(
    () =>
      new PlatformOfflineOriginalLeaseCommandReviewReader(
        c.f.app.database,
        c.f.app.identity,
        other.j,
      ),
  );
});

test("lookup permission replacement commands join exact observation preimages", (t) => {
  const c = journalFixture(t),
    journal = c.approve();
  const first = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(first);
  c.j.unresolved(first, "transport-uncertain");
  const residency = c.f.app.identity.organizationResidency,
    current = residency.current(c.f.actor);
  residency.choose(c.f.actor, "renew", {
    region: "CA",
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: "12345",
    acknowledgment: "Synthetic renewed exception",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic finance",
      evidenceRef: "synthetic:renewal",
    },
  });
  const review = c.j.permissionReview(c.f.actor, journal.id);
  const permission = c.j.preparePermission(c.f.actor, "replace-permission", {
    journalId: journal.id,
    reviewHash: review.journal.reviewHash,
    previousPermissionHash: review.previousPermissionHash,
    authority: review.authority,
    mode: review.mode,
    reason: "Synthetic replacement",
  });
  c.j.decidePermission(c.reviewer, "approve-permission", {
    journalId: journal.id,
    permissionReviewId: permission.id,
    permissionReviewHash: permission.reviewHash,
    decision: "approve",
    reason: "Synthetic separate approval",
  });
  c.j.claim(c.f.actor, journal.id, "lookup");
  c.f.app.platform.isolateRestore(
    digest("permission fixture"),
    new Date().toISOString(),
  );
  const f = { ...c, journal },
    r = read(f);
  assert.equal(r.attempts[0]!.permissions.length, 2);
  assert(
    r.attempts[0]!.permissions.every((p) => p.preimage.status === "matched"),
  );
  alter(
    f,
    "UPDATE platform_commands SET hash=? WHERE name='accounting.journal.permission.prepare'",
    "a".repeat(64),
  );
  alter(
    f,
    "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.permission.prepare'",
    canonical({ requestHash: "a".repeat(64) }),
  );
  assert.throws(() => read(f));
});
test("unjoined other-journal history is blocked, never assigned guessed lineage", (t) => {
  const c = setup(t);
  c.f.app.database.transaction(() =>
    c.f.app.platform.audit(c.f.actor, "accounting.journal.claimed", "orphan", {
      leaseId: "unjoined",
      mode: "write",
      reviewHash: "a".repeat(64),
    }),
  );
  assert(read(c).blockers.includes("OTHER_JOURNAL_AUDITS_NOT_OWNER_JOINED"));
});
test("duplicate claim identity on other journal refuses", (t) => {
  const c = setup(t),
    r = read(c),
    lease = r.attempts[0]!.currentLease!;
  c.f.app.database.transaction(() =>
    c.f.app.platform.audit(c.f.actor, "accounting.journal.claimed", "orphan", {
      leaseId: lease.id,
      mode: "write",
      reviewHash: c.journal.reviewHash,
    }),
  );
  assert.throws(() => read(c));
});
test("unjoined arbitrary command with selected native identity is blocked", (t) => {
  const c = setup(t);
  alter(
    c,
    "INSERT INTO platform_commands SELECT org_id,actor_id,'different.command','extra',hash,?,created_at FROM platform_commands LIMIT 1",
    JSON.stringify({ journalId: c.journal.id }),
  );
  assert(read(c).blockers.includes("COMMAND_PREIMAGE_NOT_OWNER_JOINED"));
});
test("foreign renamed audit still cannot hide selected native identity", (t) => {
  const c = setup(t);
  alter(
    c,
    "INSERT INTO platform_audit SELECT 'foreign-audit','foreign',actor_id,'renamed','unrelated',?,created_at FROM platform_audit LIMIT 1",
    canonical({ journalId: c.journal.id }),
  );
  assert.throws(() => read(c));
});
test("escaped foreign unknown tenancy refuses without materializing its bytes", (t) => {
  const c = setup(t);
  alter(
    c,
    "INSERT INTO platform_commands SELECT 'foreign',actor_id,'renamed','extra',hash,?,created_at FROM platform_commands LIMIT 1",
    '{"journalId":"\\u0061"}',
  );
  assert.throws(() => read(c));
});
test("selected audit unknown fields and duplicate observations refuse", (t) => {
  const c = setup(t, "CA", 0, true, true);
  alter(
    c,
    "UPDATE platform_audit SET detail=? WHERE action='accounting.journal.observed'",
    canonical({ revision: 1, hash: "a".repeat(64), extra: true }),
  );
  assert.throws(() => read(c));
});
test("reentry is refused and current authority is checked after retained reads", (t) => {
  const c = setup(t),
    r = reader(c),
    original = Store.prototype.all,
    before = snapshot(c);
  let calls = 0,
    reentered = false;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...args: Parameters<typeof original> extends [string, ...infer R]
      ? R
      : never
  ): T[] {
    if (sql.includes("FROM platform_commands") && sql.includes("CAST(")) {
      calls++;
      if (calls === 1) {
        assert.throws(() => r.getInTransaction(c.reviewer, c.journal.id));
        reentered = true;
        c.f.app.database
          .owned("iam")
          .run("UPDATE iam_users SET role='support' WHERE id=?", c.reviewer.id);
      }
    }
    return original.call(this, sql, ...args) as T[];
  };
  try {
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          r.getInTransaction(c.reviewer, c.journal.id),
        ),
      { code: "FORBIDDEN" },
    );
    assert(reentered);
  } finally {
    Store.prototype.all = original;
  }
  assert.equal(snapshot(c), before);
});
test("late second native recapture detects an altered lease and outer rollback conserves all rows", (t) => {
  const c = setup(t),
    r = reader(c),
    original = Store.prototype.all,
    before = snapshot(c);
  let scans = 0;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...args: Parameters<typeof original> extends [string, ...infer R]
      ? R
      : never
  ): T[] {
    const rows = original.call(this, sql, ...args) as T[];
    if (sql.includes("FROM platform_audit_order WHERE org_id")) {
      scans++;
      if (scans === 2)
        c.f.app.database
          .owned("integration")
          .run(
            "UPDATE integration_stock_journals SET lease_started=lease_started-1 WHERE id=?",
            c.journal.id,
          );
    }
    return rows;
  };
  try {
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        r.getInTransaction(c.reviewer, c.journal.id),
      ),
    );
    assert.equal(scans, 2);
  } finally {
    Store.prototype.all = original;
  }
  assert.equal(snapshot(c), before);
});
test("raw hold absent is checked before hostile Platform materialization", (t) => {
  const c = setup(t);
  alter(c, "DELETE FROM platform_recovery");
  alter(c, "UPDATE platform_commands SET result='invalid-json'");
  assert.throws(() => read(c), { code: "OFFLINE_ORIGINAL_LEASE_COMMAND" });
});

test("CA/USD retains the native QuickBooks original profile refusal", (t) => {
  const c = journalFixture(t, "CA", false, undefined, "USD");
  assert.throws(() => c.approve());
});
test("permanent request reference corruption refuses without repairing or inventing it", (t) => {
  const c = setup(t);
  alter(
    c,
    "UPDATE integration_stock_journal_references SET request_ref='DJ-000000000000000000' WHERE journal_id=?",
    c.journal.id,
  );
  assert.throws(() => read(c));
});
test("late raw hold removal refuses and enclosing writer restores original rows", (t) => {
  const c = setup(t),
    r = reader(c),
    original = Store.prototype.all,
    before = snapshot(c);
  let reached = false;
  Store.prototype.all = function <T extends Row = Row>(
    sql: string,
    ...args: Parameters<typeof original> extends [string, ...infer R]
      ? R
      : never
  ): T[] {
    const rows = original.call(this, sql, ...args) as T[];
    if (!reached && sql.includes("FROM platform_audit_order WHERE org_id")) {
      reached = true;
      c.f.app.database.owned("platform").run("DELETE FROM platform_recovery");
    }
    return rows;
  };
  try {
    assert.throws(() =>
      c.f.app.database.transaction(() =>
        r.getInTransaction(c.reviewer, c.journal.id),
      ),
    );
    assert(reached);
  } finally {
    Store.prototype.all = original;
  }
  assert.equal(snapshot(c), before);
});

// The source packet is part of the exact running-lease native scope. Its
// ordinary cost receipts need their own retained preimages, not a name filter.
test("source packet prepare and approve receipts have exact owning joins", (t) => {
  const c = setup(t),
    before = snapshot(c),
    r = read(c);
  assert.equal(snapshot(c), before);
  assert(!r.blockers.includes("COMMAND_PREIMAGE_NOT_OWNER_JOINED"));
  const source = (
    r as unknown as {
      sourceCommands: {
        packetId: string;
        prepare: { requestHash: string; payload: unknown };
        decision: { requestHash: string; payload: unknown };
      };
    }
  ).sourceCommands;
  assert.equal(source.packetId, c.original.id);
  assert.equal(
    source.prepare.requestHash,
    digest(canonical(source.prepare.payload)),
  );
  assert.equal(
    source.decision.requestHash,
    digest(canonical(source.decision.payload)),
  );
  assert(r.blockers.includes("CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT"));
});
for (const sql of [
  "DELETE FROM platform_commands WHERE name='accounting.cost.prepare'",
  "DELETE FROM platform_commands WHERE name='accounting.cost.decide'",
  "DELETE FROM platform_audit_order WHERE audit_id IN (SELECT id FROM platform_audit WHERE action='accounting.cost.prepared')",
  "UPDATE platform_commands SET hash=printf('%064d',0) WHERE name='accounting.cost.prepare'",
  "UPDATE platform_commands SET hash=printf('%064d',0) WHERE name='accounting.cost.decide'",
  "UPDATE platform_audit SET detail='{}' WHERE action='accounting.cost.decided'",
  "UPDATE platform_commands SET result=json_set(result,'$.controls.closingValue',99) WHERE name='accounting.cost.prepare'",
  "UPDATE platform_commands SET result=json_set(result,'$.decisionReason','changed') WHERE name='accounting.cost.decide'",
])
  test("source receipt corruption refuses without writes: " + sql, (t) => {
    const c = setup(t);
    alter(c, sql);
    const before = snapshot(c);
    assert.throws(() => read(c));
    assert.equal(snapshot(c), before);
  });
