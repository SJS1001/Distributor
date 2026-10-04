import { Store } from "../src/server/database.ts";
import type { SQLInputValue } from "node:sqlite";
import type { Row } from "../src/server/core.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import {
  PlatformOfflineOriginalCommandReviewReader,
  originalCommandReviewLimits,
} from "../src/server/platform-offline-original-command-review.ts";
import { journalFixture } from "./stock-journal-fixture.ts";
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
function reader(c: F) {
  return new PlatformOfflineOriginalCommandReviewReader(
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
for (const region of ["CA", "US"] as const)
  for (const ancestors of [0, 1, 2])
    test(`${region}: complete native receipts for ${ancestors} cancelled ancestors`, (t) => {
      const c = setup(t, region, ancestors),
        r = read(c);
      assert.equal(r.attempts.length, ancestors + 1);
      assert(
        r.attempts.every(
          (a) =>
            a.prepare.preimage.status === "matched" &&
            a.decision?.preimage.status === "matched",
        ),
      );
      assert.equal(r.attempts.filter((a) => a.cancellation).length, ancestors);
      const { factsHash, ...body } = r;
      assert.equal(factsHash, digest(canonical(body)));
      assert.deepEqual(read(c), r);
    });
const invalid = { code: "OFFLINE_ORIGINAL_COMMAND" },
  limit = { code: "OFFLINE_ORIGINAL_COMMAND_LIMIT" };
function platform(c: F) {
  return c.f.app.database.owned("platform");
}
function snapshot(c: F) {
  return canonical(
    ["platform", "integration", "inventory", "billing", "iam"].map((o) => {
      const s = c.f.app.database.owned(o as "platform");
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          `${o}_%`,
        )
        .map((r) => [r.name, s.all(`SELECT * FROM ${r.name} ORDER BY rowid`)]);
    }),
  );
}
function frozen(x: unknown) {
  if (x && typeof x === "object") {
    assert(Object.isFrozen(x));
    Object.values(x).forEach(frozen);
  }
}
function mutateReceipt(
  c: F,
  name: string,
  mutate: (row: Record<string, unknown>, result: Record<string, any>) => void,
) {
  const s = platform(c),
    row = s.get(
      "SELECT * FROM platform_commands WHERE name=? ORDER BY created_at LIMIT 1",
      name,
    )!;
  const result = JSON.parse(String(row.result));
  mutate(row, result);
  s.run(
    "UPDATE platform_commands SET actor_id=?,name=?,key=?,hash=?,result=?,created_at=? WHERE org_id=? AND actor_id=? AND name=? AND key=?",
    row.actor_id as string,
    row.name as string,
    row.key as string,
    row.hash as string,
    JSON.stringify(result),
    row.created_at as string,
    c.f.actor.orgId,
    row.actor_id as string,
    name,
    row.key as string,
  );
}
for (const [name, defect] of [
  ["accounting.journal.prepare", "missing prepare"],
  ["accounting.journal.decide", "missing approve"],
  ["accounting.journal.cancel-original", "missing cancellation"],
  ["accounting.journal.original-retry.prepare", "missing retry"],
  ["accounting.journal.original-cancellation.evidence", "missing evidence"],
] as const)
  test(defect + " refuses without native writes", (t) => {
    const c = setup(t, "CA", 1);
    platform(c).run("DELETE FROM platform_commands WHERE name=?", name);
    const before = snapshot(c);
    assert.throws(() => read(c), invalid);
    assert.equal(snapshot(c), before);
  });
for (const name of [
  "accounting.journal.prepare",
  "accounting.journal.decide",
  "accounting.journal.original-retry.prepare",
  "accounting.journal.cancel-original",
  "accounting.journal.original-cancellation.evidence",
])
  test(`extra paired ${name} receipt refuses`, (t) => {
    const c = setup(t, "CA", 1),
      s = platform(c),
      row = s.get(
        "SELECT * FROM platform_commands WHERE name=? LIMIT 1",
        name,
      )!;
    s.run(
      "INSERT INTO platform_commands SELECT org_id,actor_id,name,'extra-key',hash,result,created_at FROM platform_commands WHERE org_id=? AND actor_id=? AND name=? AND key=?",
      row.org_id!,
      row.actor_id!,
      row.name!,
      row.key!,
    );
    s.run(
      "INSERT INTO platform_audit VALUES('extra-audit',?,?,?,?,?,?)",
      row.org_id!,
      row.actor_id!,
      name,
      "extra-key",
      canonical({ requestHash: row.hash }),
      row.created_at!,
    );
    assert.throws(() => read(c), invalid);
  });
for (const [label, modify] of [
  [
    "wrong receipt journal",
    (r: any) => {
      r.id = "orphan-journal";
    },
  ],
  [
    "wrong source",
    (r: any) => {
      r.sourceId = "other-source";
    },
  ],
  [
    "changed exact plan",
    (r: any) => {
      r.plan.input.reason = "changed";
    },
  ],
  [
    "wrong request reference",
    (r: any) => {
      r.requestRef = "DJ-000000000000000000";
    },
  ],
  [
    "wrong current state in immutable ready receipt",
    (r: any) => {
      r.state = "unknown";
    },
  ],
  [
    "unknown result field",
    (r: any) => {
      r.injected = "not-native";
    },
  ],
] as const)
  test(label, (t) => {
    const c = setup(t);
    mutateReceipt(c, "accounting.journal.prepare", (_r, r) => modify(r));
    assert.throws(() => read(c), invalid);
  });
for (const defect of [
  "command hash",
  "paired prepare hash",
  "malformed result",
  "duplicate JSON field",
  "deep JSON",
  "audit detail",
  "missing audit",
  "duplicate audit",
  "missing order",
  "cross-org order",
  "orphan order",
  "clock behind",
  "reverse sequence",
  "foreign receipt",
  "foreign audit",
  "unsupported extra journal command",
] as const)
  test(defect, (t) => {
    const c = setup(t),
      s = platform(c),
      r = s.get(
        "SELECT * FROM platform_commands WHERE name='accounting.journal.prepare'",
      )!;
    const a = s.get(
      "SELECT * FROM platform_audit WHERE action=? AND reference=?",
      r.name!,
      r.key!,
    )!;
    switch (defect) {
      case "command hash":
        s.run("UPDATE platform_commands SET hash='bad' WHERE name=?", r.name!);
        break;
      case "paired prepare hash":
        s.run(
          "UPDATE platform_commands SET hash=? WHERE name=?",
          "a".repeat(64),
          r.name!,
        );
        s.run(
          "UPDATE platform_audit SET detail=? WHERE id=?",
          canonical({ requestHash: "a".repeat(64) }),
          a.id!,
        );
        break;
      case "malformed result":
        s.run("UPDATE platform_commands SET result='{' WHERE name=?", r.name!);
        break;
      case "duplicate JSON field":
        s.run(
          "UPDATE platform_commands SET result=? WHERE name=?",
          String(r.result).replace("{", '{"id":"lost",'),
          r.name!,
        );
        break;
      case "deep JSON":
        s.run(
          "UPDATE platform_commands SET result=? WHERE name=?",
          '{"deep":' + "[".repeat(60) + "0" + "]".repeat(60) + "}",
          r.name!,
        );
        break;
      case "audit detail":
        s.run("UPDATE platform_audit SET detail='{}' WHERE id=?", a.id!);
        break;
      case "missing audit":
        s.run("DELETE FROM platform_audit_order WHERE audit_id=?", a.id!);
        s.run("DELETE FROM platform_audit WHERE id=?", a.id!);
        break;
      case "duplicate audit":
        s.run(
          "INSERT INTO platform_audit SELECT 'extra-audit',org_id,actor_id,action,reference,detail,created_at FROM platform_audit WHERE id=?",
          a.id!,
        );
        break;
      case "missing order":
        s.run("DELETE FROM platform_audit_order WHERE audit_id=?", a.id!);
        break;
      case "cross-org order":
        s.run(
          "UPDATE platform_audit_order SET org_id='foreign' WHERE audit_id=?",
          a.id!,
        );
        break;
      case "orphan order":
        s.run("UPDATE platform_audit SET org_id='foreign' WHERE id=?", a.id!);
        break;
      case "clock behind":
        s.run("UPDATE platform_audit_clock SET sequence=0");
        break;
      case "reverse sequence": {
        const other = s.get(
          "SELECT id FROM platform_audit WHERE action='accounting.journal.decide'",
        )!;
        const first = s.get(
          "SELECT sequence FROM platform_audit_order WHERE audit_id=?",
          a.id!,
        )!;
        const last = s.get(
          "SELECT sequence FROM platform_audit_order WHERE audit_id=?",
          other.id!,
        )!;
        s.run(
          "UPDATE platform_audit_order SET sequence=99999 WHERE audit_id=?",
          a.id!,
        );
        s.run(
          "UPDATE platform_audit_order SET sequence=? WHERE audit_id=?",
          first.sequence!,
          other.id!,
        );
        s.run(
          "UPDATE platform_audit_order SET sequence=? WHERE audit_id=?",
          last.sequence!,
          a.id!,
        );
        break;
      }
      case "foreign receipt":
        s.run(
          "INSERT INTO platform_commands SELECT 'foreign',actor_id,name,key,hash,result,created_at FROM platform_commands WHERE name=?",
          r.name!,
        );
        break;
      case "foreign audit":
        s.run(
          "INSERT INTO platform_audit SELECT 'foreign-audit','foreign',actor_id,action,reference,detail,created_at FROM platform_audit WHERE id=?",
          a.id!,
        );
        break;
      case "unsupported extra journal command":
        s.run(
          "INSERT INTO platform_commands SELECT org_id,actor_id,'accounting.journal.future',key,hash,result,created_at FROM platform_commands WHERE name=?",
          r.name!,
        );
        break;
    }
    assert.throws(() => read(c), defect === "deep JSON" ? limit : invalid);
  });
test("native normalized decision cannot recover unretained whitespace or extra fields; explicit blocker only", (t) => {
  const c = journalFixture(t),
    ready = c.j.prepare(c.f.actor, "ready", c.make());
  const raw = {
    journalId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve" as const,
    reason: "  Independent decision  ",
    extra: "unretained",
  };
  const journal = c.j.decide(c.reviewer, "decision", raw),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  const f = { ...c, journal },
    r = read(f);
  assert.equal(r.attempts[0]!.decision!.requestHash, digest(canonical(raw)));
  assert.equal(r.attempts[0]!.decision!.preimage.status, "not-retained");
  assert(r.blockers.includes("DECISION_REQUEST_PREIMAGE_NOT_RETAINED"));
  assert(!canonical(r).includes("unretained"));
  assert.equal(r.attempts[0]!.prepare.preimage.status, "matched");
});
test("same writer, raw hold, detachment, rollback and reopen conserve every native row", (t) => {
  const c = setup(t, "CA", 1),
    before = snapshot(c),
    r = read(c);
  frozen(r);
  assert.throws(() => reader(c).getInTransaction(c.reviewer, c.journal.id), {
    code: "TRANSACTION",
  });
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        platform(c).run("DELETE FROM platform_recovery");
        reader(c).getInTransaction(c.reviewer, c.journal.id);
      }),
    { code: "RECOVERY_HOLD" },
  );
  assert.equal(snapshot(c), before);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        const n = platform(c).get("SELECT total_changes() AS n")!.n;
        assert.deepEqual(
          reader(c).getInTransaction(c.reviewer, c.journal.id),
          r,
        );
        assert.equal(platform(c).get("SELECT total_changes() AS n")!.n, n);
        throw Error("rollback");
      }),
    /rollback/,
  );
  assert.equal(snapshot(c), before);
  assert.throws(() => {
    (r.attempts[0]!.prepare.result as any).state = "changed";
  }, TypeError);
  c.f.app.close();
  c.f.app = new Application(c.f.path, "CA", { eventReports: false });
  assert.deepEqual(read(c), r);
  assert.equal(snapshot(c), before);
  assert.throws(() => c.f.app.platform.assertProviderAccess(), {
    code: "RECOVERY_HOLD",
  });
});
for (const defect of [
  "role",
  "inactive",
  "password",
  "account",
  "organization",
] as const)
  test(`fresh ${defect} refusal`, (t) => {
    const c = setup(t),
      iam = c.f.app.database.owned("iam");
    read(c);
    switch (defect) {
      case "role":
        iam.run("UPDATE iam_users SET role='sales' WHERE id=?", c.reviewer.id);
        break;
      case "inactive":
        iam.run("UPDATE iam_users SET active=0 WHERE id=?", c.reviewer.id);
        break;
      case "password":
        iam.run(
          "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
          c.reviewer.id,
        );
        break;
      case "account":
        iam.run(
          "UPDATE iam_users SET account_id=? WHERE id=?",
          c.f.buyer,
          c.reviewer.id,
        );
        break;
      case "organization":
        iam.run(
          "UPDATE iam_users SET org_id='other' WHERE id=?",
          c.reviewer.id,
        );
        break;
    }
    assert.throws(() => read(c));
  });
test("primitive locators and actual same-database owners refuse hooks and substitution", (t) => {
  const c = setup(t),
    other = setup(t);
  let calls = 0;
  const trap = () => {
    calls++;
    throw Error("private marker");
  };
  const proxy = new Proxy(
      {},
      {
        get: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
      },
    ),
    revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const actor of [
    proxy,
    revoked.proxy,
    Object.defineProperty({}, "id", { get: trap }),
    { id: proxy, orgId: c.reviewer.orgId },
    Object.create(c.reviewer),
  ])
    assert.throws(() => read(c, actor as Actor), invalid);
  for (const value of [proxy, revoked.proxy, new String(c.journal.id), null])
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          reader(c).getInTransaction(c.reviewer, value as string),
        ),
      invalid,
    );
  assert.throws(
    () =>
      new PlatformOfflineOriginalCommandReviewReader(
        c.f.app.database,
        other.f.app.identity,
        c.j,
      ),
    invalid,
  );
  assert.throws(
    () =>
      new PlatformOfflineOriginalCommandReviewReader(
        c.f.app.database,
        c.f.app.identity,
        other.j,
      ),
    invalid,
  );
  assert.throws(
    () =>
      new PlatformOfflineOriginalCommandReviewReader(
        proxy as any,
        c.f.app.identity,
        c.j,
      ),
    invalid,
  );
  Object.defineProperty(c.j, "readOfflineOriginalInTransaction", {
    get: trap,
    configurable: true,
  });
  assert.throws(() => reader(c), invalid);
  delete (c.j as any).readOfflineOriginalInTransaction;
  assert.equal(calls, 0);
});
test("CA/USD original owner refusal remains unchanged", (t) => {
  const c = journalFixture(t, "CA", false, undefined, "USD");
  assert.throws(() => c.approve(), { code: "JOURNAL_SOURCE" });
});
function beforeRows(c: F, expected = limit) {
  const old = Store.prototype.all;
  let reads = 0;
  Store.prototype.all = function <T extends Row = Row>(
    this: Store,
    sql: string,
    ...params: SQLInputValue[]
  ): T[] {
    if (sql.includes(" AS f0")) reads++;
    return old.call(this, sql, ...params) as T[];
  };
  try {
    assert.throws(() => read(c), expected);
    assert.equal(reads, 0, "oversized retained text must not enter JS");
  } finally {
    Store.prototype.all = old;
  }
}
for (const field of ["actor_id", "name", "key", "hash", "result", "created_at"])
  for (const encoding of ["utf8", "nul"] as const)
    test(`command ${field} ${encoding} row-byte preflight`, (t) => {
      const c = setup(t),
        v = encoding === "utf8" ? "é".repeat(34000) : "x\0".repeat(34000);
      platform(c).run(
        `UPDATE platform_commands SET ${field}=? WHERE name='accounting.journal.prepare'`,
        v,
      );
      beforeRows(c);
    });
for (const field of [
  "id",
  "actor_id",
  "action",
  "reference",
  "detail",
  "created_at",
])
  test(`audit ${field} UTF8 byte preflight`, (t) => {
    const c = setup(t); // IDs referenced by audit_order are changed coherently in a native deferred-FK transaction below.
    if (field === "id") {
      // A non-command synthetic audit has no outgoing business link, but still
      // belongs to the complete Platform organization budget.
      platform(c).run(
        "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
        "é".repeat(34000),
        c.f.actor.orgId,
        c.reviewer.id,
        "synthetic",
        "synthetic",
        "{}",
        new Date().toISOString(),
      );
    } else
      platform(c).run(
        `UPDATE platform_audit SET ${field}=? WHERE action='accounting.journal.prepare'`,
        "é".repeat(34000),
      );
    beforeRows(c);
  });
test("audit order org UTF8 byte preflight", (t) => {
  const c = setup(t);
  platform(c).run(
    "UPDATE platform_audit_order SET org_id=? WHERE audit_id=(SELECT id FROM platform_audit WHERE action='accounting.journal.prepare')",
    "é".repeat(34000),
  );
  beforeRows(c);
});
for (const set of ["commands", "audits", "combined"] as const)
  test(`complete ${set} aggregate refuses before any retained row materialization`, (t) => {
    const c = setup(t),
      s = platform(c),
      v = "é\0".repeat(19500),
      timestamp = new Date().toISOString();
    c.f.app.database.transaction(() => {
      for (let i = 0; i < 160; i++) {
        if (set !== "audits" && (set !== "combined" || i < 80))
          s.run(
            "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
            c.f.actor.orgId,
            c.reviewer.id,
            "synthetic",
            `large-${i}`,
            "a".repeat(64),
            v,
            timestamp,
          );
        if (set !== "commands" && (set !== "combined" || i < 80))
          s.run(
            "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
            `large-${i}`,
            c.f.actor.orgId,
            c.reviewer.id,
            "synthetic",
            `ref-${i}`,
            v,
            timestamp,
          );
      }
    });
    beforeRows(c);
  });
for (const set of ["commands", "audits"] as const)
  test(`complete ${set} count preflight`, (t) => {
    const c = setup(t),
      s = platform(c),
      timestamp = new Date().toISOString();
    c.f.app.database.transaction(() => {
      for (let i = 0; i < originalCommandReviewLimits[set]; i++) {
        if (set === "commands")
          s.run(
            "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
            c.f.actor.orgId,
            c.reviewer.id,
            "synthetic",
            `count-${i}`,
            "a".repeat(64),
            "{}",
            timestamp,
          );
        else
          s.run(
            "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
            `count-${i}`,
            c.f.actor.orgId,
            c.reviewer.id,
            "synthetic",
            `ref-${i}`,
            "{}",
            timestamp,
          );
      }
    });
    beforeRows(c);
  });
for (const [table, field, where] of [
  ["platform_commands", "key", "name='accounting.journal.prepare'"],
  ["platform_commands", "result", "name='accounting.journal.prepare'"],
  ["platform_audit", "detail", "action='accounting.journal.prepare'"],
  ["platform_audit", "reference", "action='accounting.journal.prepare'"],
] as const)
  test(`invalid UTF8 ${table}.${field} is never silently replaced`, (t) => {
    const c = setup(t);
    platform(c).run(
      `UPDATE ${table} SET ${field}=CAST(x'f09080' AS TEXT) WHERE ${where}`,
    );
    assert.throws(() => read(c), invalid);
  });
test("unsafe audit integer fails before row materialization", (t) => {
  const c = setup(t);
  platform(c).run(
    "UPDATE platform_audit_order SET sequence=9007199254740992 WHERE audit_id=(SELECT id FROM platform_audit WHERE action='accounting.journal.prepare')",
  );
  beforeRows(c, invalid);
});
test("valid bounded native multibyte approval reason and key retain exact payload commitment", (t) => {
  const c = journalFixture(t),
    ready = c.j.prepare(c.f.actor, "préparation-量", {
      ...c.make(),
      reason: "préparation 量",
    });
  const input = {
    journalId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve" as const,
    reason: "indépendant 量",
  };
  const journal = c.j.decide(c.reviewer, "approbation-量", input),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  const r = read({ ...c, journal });
  assert.equal(r.attempts[0]!.decision!.requestHash, digest(canonical(input)));
  assert.equal(r.attempts[0]!.decision!.preimage.status, "matched");
});
test("all source attempts include an independently rejected original, not only the live leaf", (t) => {
  const c = journalFixture(t),
    rejected = c.j.prepare(c.f.actor, "rejected-prepare", c.make());
  c.j.decide(c.reviewer, "reject", {
    journalId: rejected.id,
    reviewHash: rejected.reviewHash,
    decision: "reject",
    reason: "Independent rejection",
  });
  const journal = c.approve(),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  const r = read({ ...c, journal });
  assert.equal(r.attempts.length, 2);
  assert.equal(
    r.attempts.find((a) => a.journalId === rejected.id)!.decision!.result.state,
    "rejected",
  );
});
test("other posting-date ready and approved obligations are retained", (t) => {
  const c = journalFixture(t, "CA", false, [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
  ]);
  const journal = c.approve(),
    ready = c.j.prepare(c.f.actor, "other-ready", {
      ...c.make(),
      postingDate: "2026-10-02",
    });
  const pending = c.approve(
    { ...c.make(), postingDate: "2026-10-03" },
    "other-pending",
  );
  const lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  const r = read({ ...c, journal });
  assert.equal(r.attempts.length, 3);
  assert.equal(
    r.attempts.find((a) => a.journalId === ready.id)!.decision,
    null,
  );
  assert.equal(
    r.attempts.find((a) => a.journalId === pending.id)!.decision!.result.state,
    "pending",
  );
});
test("uncommitted receipt damage is seen by the same writer and rollback restores the exact projection", (t) => {
  const c = setup(t),
    before = read(c);
  assert.throws(
    () =>
      c.f.app.database.transaction(() => {
        platform(c).run(
          "UPDATE platform_commands SET hash='bad' WHERE name='accounting.journal.prepare'",
        );
        reader(c).getInTransaction(c.reviewer, c.journal.id);
      }),
    invalid,
  );
  assert.deepEqual(read(c), before);
});
test("fixed refusal never exposes retained private result bytes", (t) => {
  const c = setup(t);
  platform(c).run(
    "UPDATE platform_commands SET result=? WHERE name='accounting.journal.prepare'",
    '{"private-secret-marker":false}',
  );
  assert.throws(
    () => read(c),
    (e: any) =>
      e.code === invalid.code && !String(e).includes("private-secret-marker"),
  );
});
test("bounded embedded NUL in a native approval remains an explicit owning-profile refusal", (t) => {
  const c = journalFixture(t),
    ready = c.j.prepare(c.f.actor, "ready", c.make());
  const journal = c.j.decide(c.reviewer, "approve", {
    journalId: ready.id,
    reviewHash: ready.reviewHash,
    decision: "approve",
    reason: "synthetic\0retained",
  });
  const lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  assert.throws(() => read({ ...c, journal }), {
    code: "OFFLINE_ORIGINAL_REVIEW",
  });
});
test("repeat cancellation-evidence observations each retain their distinct original command receipt", (t) => {
  const c = journalFixture(t),
    journal = c.approve(),
    lease = c.j.claim(c.f.actor, journal.id, "write")!;
  c.j.beforeWrite(lease);
  c.j.unresolved(lease, "transport-uncertain");
  for (let i = 0; i < 2; i++)
    c.j.recordOriginalCancellationEvidence(c.f.actor, `evidence-${i}`, {
      journalId: journal.id,
      requestRef: journal.requestRef,
      reviewHash: c.j.originalCancellationEvidenceReview(c.f.actor, journal.id)
        .reviewHash,
      externalRef: `synthetic-${i}`,
      evidence: "Synthetic final non-posting assertion",
      cancellationFinal: true,
      nonPostingVerified: true,
      noLaterPosting: true,
    });
  c.f.app.platform.isolateRestore(digest("backup"), new Date().toISOString());
  const r = read({ ...c, journal });
  assert.equal(r.attempts[0]!.evidence.length, 2);
  assert.equal(r.attempts[0]!.cancellation, null);
  assert(r.attempts[0]!.evidence.every((c) => c.preimage.status === "matched"));
});
for (const name of [
  "accounting.journal.original-retry.prepare",
  "accounting.journal.cancel-original",
  "accounting.journal.original-cancellation.evidence",
])
  test(`exact ${name} request preimage cannot be replaced with a self-consistent foreign hash`, (t) => {
    const c = setup(t, "CA", 1),
      s = platform(c),
      r = s.get("SELECT * FROM platform_commands WHERE name=? LIMIT 1", name)!;
    s.run(
      "UPDATE platform_commands SET hash=? WHERE name=?",
      "b".repeat(64),
      name,
    );
    s.run(
      "UPDATE platform_audit SET detail=? WHERE action=? AND reference=?",
      canonical({ requestHash: "b".repeat(64) }),
      name,
      r.key!,
    );
    assert.throws(() => read(c), invalid);
  });
test("missing, changed and duplicate native observation joins cannot be covered by command receipts", (t) => {
  const c = setup(t, "CA", 1),
    s = platform(c);
  const before = read(c);
  for (const defect of ["missing", "changed", "duplicate"]) {
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          const a = s.get(
            "SELECT * FROM platform_audit WHERE action='accounting.journal.observed' ORDER BY created_at LIMIT 1",
          )!;
          if (defect === "missing") {
            s.run("DELETE FROM platform_audit_order WHERE audit_id=?", a.id!);
            s.run("DELETE FROM platform_audit WHERE id=?", a.id!);
          }
          if (defect === "changed") {
            const detail = JSON.parse(String(a.detail));
            detail.hash = "b".repeat(64);
            s.run(
              "UPDATE platform_audit SET detail=? WHERE id=?",
              canonical(detail),
              a.id!,
            );
          }
          if (defect === "duplicate")
            s.run(
              "INSERT INTO platform_audit SELECT 'duplicate-observation',org_id,actor_id,action,reference,detail,created_at FROM platform_audit WHERE id=?",
              a.id!,
            );
          reader(c).getInTransaction(c.reviewer, c.journal.id);
        }),
      invalid,
    );
    assert.deepEqual(read(c), before);
  }
});
test("fixed JSON node budget refuses before canonicalizing a dense result", (t) => {
  const c = setup(t);
  platform(c).run(
    "UPDATE platform_commands SET result=? WHERE name='accounting.journal.prepare'",
    JSON.stringify({ dense: Array(17000).fill(0) }),
  );
  assert.throws(() => read(c), limit);
});
test("actual current hold cannot be bypassed by a substituted owner from another database", (t) => {
  const c = setup(t),
    other = setup(t);
  const identity = Object.getOwnPropertyDescriptor(c.j, "identity")!;
  Object.defineProperty(c.j, "identity", {
    ...identity,
    value: other.f.app.identity,
  });
  assert.throws(() => reader(c), invalid);
  Object.defineProperty(c.j, "identity", identity);
  assert.equal(read(c).journalId, c.journal.id);
});
for (const scope of ["foreign", "unsupported-local"] as const)
  test(`${scope} escaped JSON identity collision cannot evade reverse closure`, (t) => {
    const c = setup(t),
      s = platform(c),
      row = s.get(
        "SELECT * FROM platform_commands WHERE name='accounting.journal.prepare'",
      )!;
    const escape = (id: string) =>
      [...id]
        .map((ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
        .join("");
    const escaped = String(row.result)
      .split(c.journal.id)
      .join(escape(c.journal.id))
      .split(c.original.id)
      .join(escape(c.original.id));
    assert.deepEqual(JSON.parse(escaped), JSON.parse(String(row.result)));
    s.run(
      "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
      scope === "foreign" ? "foreign" : row.org_id!,
      row.actor_id!,
      scope === "foreign" ? row.name! : "accounting.journal.future",
      "escaped-key",
      row.hash!,
      escaped,
      row.created_at!,
    );
    assert.throws(() => read(c), invalid);
  });
test("foreign duplicate-key identity cannot hide behind a first-key SQL lookup", (t) => {
  const c = setup(t),
    s = platform(c);
  s.run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    "foreign",
    "synthetic",
    "accounting.journal.prepare",
    "duplicate",
    "a".repeat(64),
    `{"id":"unrelated","id":"${c.journal.id}"}`,
    new Date().toISOString(),
  );
  assert.throws(() => read(c), invalid);
});
test("another native organization's independent receipts do not become returned or falsely joined", (t) => {
  const c = setup(t),
    other = setup(t, "US"),
    before = read(c),
    rows = platform(other).all(
      "SELECT * FROM platform_commands ORDER BY actor_id,name,key",
    );
  c.f.app.database.transaction(() => {
    for (const r of rows)
      platform(c).run(
        "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
        r.org_id!,
        r.actor_id!,
        r.name!,
        r.key!,
        r.hash!,
        r.result!,
        r.created_at!,
      );
  });
  const after = read(c);
  assert.deepEqual(after, before);
  assert(!canonical(after).includes(other.journal.id));
  assert(!canonical(after).includes(other.f.actor.orgId));
});
test("foreign oversized invalid JSON refuses by numeric byte preflight before any local row enters JS", (t) => {
  const c = setup(t);
  platform(c).run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    "foreign",
    "synthetic",
    "accounting.journal.prepare",
    "large",
    "a".repeat(64),
    "é\0".repeat(40000),
    new Date().toISOString(),
  );
  beforeRows(c);
});
test("foreign malformed JSON refuses before local materialization, without disclosing its bytes", (t) => {
  const c = setup(t);
  platform(c).run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    "foreign",
    "synthetic",
    "accounting.journal.prepare",
    "malformed",
    "a".repeat(64),
    "private-foreign-marker",
    new Date().toISOString(),
  );
  beforeRows(c, invalid);
});
test("same-source copied receipt cannot escape by inventing a new foreign journal ID", (t) => {
  const c = setup(t),
    s = platform(c),
    r = s.get(
      "SELECT * FROM platform_commands WHERE name='accounting.journal.prepare'",
    )!,
    result = JSON.parse(String(r.result));
  result.id = "new-foreign-id";
  s.run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    "foreign",
    r.actor_id!,
    r.name!,
    "foreign-key",
    r.hash!,
    JSON.stringify(result),
    r.created_at!,
  );
  assert.throws(() => read(c), invalid);
});
