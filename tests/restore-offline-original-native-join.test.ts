import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { type OfflineOriginalJournalReview } from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
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

import { RestoreOfflineOriginalNativeJoin } from "../src/server/restore-offline-original-native-join.ts";
import {
  PlatformOfflineOriginalObservationReviewReader,
  originalObservationReviewLimits,
} from "../src/server/platform-offline-original-observation-review.ts";
function capture(c: F) {
  const input = inputFor(native(c));
  return c.f.app.database.transaction(() =>
    comparator(c.f.app).captureInTransaction(c.reviewer, c.journal.id, input),
  );
}
function join(c: F, value: unknown = capture(c), actor: Actor = c.reviewer) {
  const a = c.f.app;
  return a.database.transaction(() =>
    new RestoreOfflineOriginalNativeJoin(
      a.database,
      a.identity,
      a.integration.costs.journals,
    ).getInTransaction(actor, value),
  );
}
function audit(c: F, journalId = c.journal.id) {
  return c.f.app.database.owned("platform").get<{
    id: string;
    org_id: string;
    actor_id: string;
    action: string;
    reference: string;
    detail: string;
    created_at: string;
  }>("SELECT * FROM platform_audit WHERE action='accounting.journal.observed' AND reference=? ORDER BY rowid LIMIT 1", journalId)!;
}
function mutate(c: F, fn: () => void) {
  const before = capture(c);
  c.f.app.database.transaction(fn);
  assert.throws(() => join(c, before));
}
for (const region of ["CA", "US"] as const)
  test(`${region}: original complete native/audit join preserves retained lineage without writes`, (t) => {
    const c = setup(t, region, 3),
      before = capture(c),
      s = c.f.app.database.owned("platform"),
      changes = s.get("SELECT total_changes() AS n")!.n;
    const out = join(c, before);
    assert.equal(s.get("SELECT total_changes() AS n")!.n, changes);
    assert.equal(out.capture.hash, before.hash);
    assert.equal(out.capture.native.attempts.length, 4);
    assert.equal(
      out.platform.audits.length,
      out.capture.native.attempts.reduce(
        (n, a) => n + a.observations.length,
        0,
      ),
    );
    const { hash, ...facts } = out;
    assert.equal(hash, digest(canonical(facts)));
    assert(Object.isFrozen(out));
    assert(Object.isFrozen(out.platform.audits));
    for (const a of out.platform.audits) assert(Object.isFrozen(a));
  });
for (const defect of [
  "missing",
  "wrong-hash",
  "wrong-actor",
  "wrong-revision",
  "duplicate",
  "orphan",
  "missing-order",
  "wrong-order-org",
  "reverse-sequence",
  "bad-json",
  "extra-key",
  "duplicate-json",
  "oversized",
  "unrelated-malformed",
] as const)
  test(`original native join refuses ${defect} audit history`, (t) => {
    const c = setup(t, "CA", defect === "reverse-sequence" ? 1 : 0),
      p = c.f.app.database.owned("platform"),
      a = audit(
        c,
        defect === "reverse-sequence"
          ? native(c).attempts.find(
              (attempt) => attempt.observations.length > 1,
            )!.row.id
          : c.journal.id,
      );
    mutate(c, () => {
      switch (defect) {
        case "missing":
          p.run("DELETE FROM platform_audit_order WHERE audit_id=?", a.id);
          p.run("DELETE FROM platform_audit WHERE id=?", a.id);
          break;
        case "wrong-hash":
          p.run(
            "UPDATE platform_audit SET detail=? WHERE id=?",
            canonical({
              revision: JSON.parse(String(a.detail)).revision,
              hash: digest("changed"),
            }),
            a.id,
          );
          break;
        case "wrong-actor":
          p.run(
            "UPDATE platform_audit SET actor_id=? WHERE id=?",
            c.reviewer.id,
            a.id,
          );
          break;
        case "wrong-revision":
          p.run(
            "UPDATE platform_audit SET detail=? WHERE id=?",
            canonical({
              revision: 99,
              hash: JSON.parse(String(a.detail)).hash,
            }),
            a.id,
          );
          break;
        case "duplicate":
          p.run(
            "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
            "duplicate-audit",
            a.org_id,
            a.actor_id,
            a.action,
            a.reference,
            a.detail,
            a.created_at,
          );
          break;
        case "orphan":
          p.run(
            "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
            "orphan-audit",
            a.org_id,
            a.actor_id,
            a.action,
            a.reference,
            canonical({ revision: 999, hash: digest("orphan") }),
            a.created_at,
          );
          break;
        case "missing-order":
          p.run("DELETE FROM platform_audit_order WHERE audit_id=?", a.id);
          break;
        case "wrong-order-org":
          p.run(
            "UPDATE platform_audit_order SET org_id='different' WHERE audit_id=?",
            a.id,
          );
          break;
        case "reverse-sequence": {
          const last = p.get(
            "SELECT MAX(sequence) AS n FROM platform_audit_order",
          )!.n;
          p.run(
            "UPDATE platform_audit_order SET sequence=? WHERE audit_id=?",
            Number(last) + 100,
            a.id,
          );
          p.run(
            "UPDATE platform_audit_clock SET sequence=? WHERE id=1",
            Number(last) + 100,
          );
          break;
        }
        case "bad-json":
          p.run("UPDATE platform_audit SET detail='[' WHERE id=?", a.id);
          break;
        case "extra-key":
          p.run(
            "UPDATE platform_audit SET detail=? WHERE id=?",
            canonical({ ...JSON.parse(String(a.detail)), unexpected: true }),
            a.id,
          );
          break;
        case "duplicate-json":
          p.run(
            "UPDATE platform_audit SET detail=? WHERE id=?",
            String(a.detail).replace("{", '{"revision":1,'),
            a.id,
          );
          break;
        case "oversized":
          p.run(
            "UPDATE platform_audit SET detail=? WHERE id=?",
            " ".repeat(originalObservationReviewLimits.rowBytes + 1),
            a.id,
          );
          break;
        case "unrelated-malformed":
          p.run(
            "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
            "unrelated-audit",
            a.org_id,
            a.actor_id,
            a.action,
            "unrelated-journal",
            "{}",
            a.created_at,
          );
          break;
      }
    });
  });
test("original join refuses nonissued captures and revoked proxies without invoking hooks", (t) => {
  const c = setup(t),
    v = capture(c);
  let hooks = 0;
  for (const bad of [
    structuredClone(v),
    new Proxy(v, {
      get() {
        hooks++;
        throw Error("hook");
      },
    }),
  ])
    assert.throws(() => join(c, bad));
  const revoked = Proxy.revocable(v, {});
  revoked.revoke();
  assert.throws(() => join(c, revoked.proxy));
  assert.equal(hooks, 0);
});
test("original join requires real writer, live hold and current native IAM", (t) => {
  const c = setup(t),
    a = c.f.app,
    v = capture(c),
    reader = new RestoreOfflineOriginalNativeJoin(
      a.database,
      a.identity,
      a.integration.costs.journals,
    );
  assert.throws(() => reader.getInTransaction(c.reviewer, v));
  assert.throws(
    () =>
      a.database.transaction(() => {
        a.database.owned("platform").run("DELETE FROM platform_recovery");
        assert.throws(() => reader.getInTransaction(c.reviewer, v));
        throw Error("fixture rollback");
      }),
    /fixture rollback/,
  );
  assert.equal(join(c, v).capture.hash, v.hash);
});

test("original audit reader bounds the complete organization set before materialization", (t) => {
  const c = setup(t),
    p = c.f.app.database.owned("platform"),
    a = audit(c);
  c.f.app.database.transaction(() => {
    for (let i = 0; i <= originalObservationReviewLimits.rows; i++)
      p.run(
        "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
        `many-${i}`,
        a.org_id,
        a.actor_id,
        a.action,
        `unrelated-${i}`,
        a.detail,
        a.created_at,
      );
  });
  assert.throws(() => join(c));
});
test("original join refreshes revoked finance grants and rejects principal accessors/proxies", (t) => {
  const c = setup(t),
    v = capture(c);
  let hooks = 0;
  const bad = {
    get id() {
      hooks++;
      return c.reviewer.id;
    },
    orgId: c.reviewer.orgId,
  } as Actor;
  assert.throws(() => join(c, v, bad));
  assert.throws(() =>
    join(
      c,
      v,
      new Proxy(c.reviewer, {
        get() {
          hooks++;
          throw Error("hook");
        },
      }),
    ),
  );
  assert.equal(hooks, 0);
  c.f.app.database.transaction(() =>
    c.f.app.database
      .owned("iam")
      .run("UPDATE iam_users SET role='support' WHERE id=?", c.reviewer.id),
  );
  assert.throws(() => join(c, v, { ...c.reviewer, role: "admin" }));
});
test("original join refuses stale native projection and substituted native owners", (t) => {
  const c = setup(t),
    v = capture(c);
  c.f.app.database.transaction(() =>
    c.f.app.database
      .owned("integration")
      .run(
        "UPDATE integration_stock_journals SET dispatched=0 WHERE id=?",
        c.journal.id,
      ),
  );
  assert.throws(() => join(c, v));
  const a = c.f.app;
  assert.throws(
    () =>
      new RestoreOfflineOriginalNativeJoin(
        new Proxy(a.database, {}),
        a.identity,
        a.integration.costs.journals,
      ),
  );
});

test("original join refuses current password restrictions and account grants", (t) => {
  const c = setup(t),
    value = capture(c),
    app = c.f.app,
    iam = app.database.owned("iam"),
    reader = new RestoreOfflineOriginalNativeJoin(
      app.database,
      app.identity,
      app.integration.costs.journals,
    );
  for (const [code, mutation] of [
    [
      "PASSWORD_CHANGE_REQUIRED",
      () =>
        iam.run(
          "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
          c.reviewer.id,
          new Date().toISOString(),
        ),
    ],
    [
      "FORBIDDEN",
      () =>
        iam.run(
          "UPDATE iam_users SET account_id='synthetic-account' WHERE id=?",
          c.reviewer.id,
        ),
    ],
  ] as const) {
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          mutation();
          assert.throws(() => reader.getInTransaction(c.reviewer, value), {
            code,
          });
          throw Error("fixture rollback");
        }),
      /fixture rollback/,
    );
  }
  assert.equal(join(c, value).capture.hash, value.hash);
});
for (const defect of ["clock-behind", "bad-date", "negative-revision"] as const)
  test(`original audit reader refuses ${defect}`, (t) => {
    const c = setup(t),
      p = c.f.app.database.owned("platform"),
      a = audit(c);
    mutate(c, () => {
      if (defect === "clock-behind")
        p.run("UPDATE platform_audit_clock SET sequence=0 WHERE id=1");
      else if (defect === "bad-date")
        p.run(
          "UPDATE platform_audit SET created_at='2026-02-30T12:00:00.000Z' WHERE id=?",
          a.id,
        );
      else
        p.run(
          "UPDATE platform_audit SET detail=? WHERE id=?",
          canonical({ revision: -1, hash: JSON.parse(a.detail).hash }),
          a.id,
        );
    });
  });
