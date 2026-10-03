import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type { OfflineOriginalJournalReview } from "../src/server/stock-journal-delivery.ts";
import {
  StockJournalOfflineOriginalEvidence,
  assertCapturedOfflineOriginalEvidence,
  type OfflineOriginalEvidenceInput,
  type OfflineOriginalCancellationSnapshot,
} from "../src/server/stock-journal-offline-original-evidence.ts";
import {
  RestoreOfflineOriginalPrivateEvidence,
  readOfflinePrivateEvidence,
  offlineOriginalPrivateTask,
} from "../src/server/restore-offline-private-evidence.ts";
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

function encode(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(encode).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${encode((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v);
}
const refusal = {
  code: "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
  message: "Offline private evidence binding did not complete.",
};
function files(
  t: TestContext,
  c: F,
  bytes = Buffer.from(encode(inputFor(native(c)))),
) {
  const root = fs.mkdtempSync(join(tmpdir(), "original-private-"));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contents = [bytes, Buffer.from("uncaptured synthetic private note")];
  const items = contents.map((b, i) => ({
    reference: `report-${i}`,
    sha256: digest(b),
    bytes: b.length,
  }));
  const manifest = {
    version: 1,
    root,
    files: items.map((item, i) => ({
      reference: item.reference,
      path: `file-${i}`,
    })),
  };
  manifest.files.forEach((file, i) =>
    fs.writeFileSync(join(root, file.path), contents[i]!, { mode: 0o600 }),
  );
  const p = native(c),
    input = inputFor(p),
    h = "a".repeat(64),
    at = "2026-10-03T16:00:00.000Z";
  const a = p.attempts.find((a) => a.row.id === p.journalId)!;
  const envelope = {
    version: 1,
    purpose: "distributor-restore-offline-task-v1",
    requestId: "synthetic-request",
    preparedBy: "preparer",
    executorId: "executor",
    preparedAt: at,
    expiresAt: "2026-10-03T16:15:00.000Z",
    recovery: {
      instanceId: "recovery",
      snapshotHash: h,
      restoredAt: at,
      sourceCompletedAt: at,
      schemaHash: h,
      region: p.region,
      organizations: [{ id: p.orgId, currency: p.currency }],
    },
    session: { id: "session", revision: 1, lineageHash: h },
    candidate: { logicalHash: h, file: { dev: 1, ino: 2 } },
    source: {
      identity: "source",
      baseline: { logicalHash: h, durableCursor: "baseline", auditSequence: 1 },
      end: { logicalHash: h, durableCursor: "end", auditSequence: 2 },
      intervalEvidenceHash: h,
    },
    task: {
      ...offlineOriginalPrivateTask,
      orgId: p.orgId,
      siteIds: [],
      subjectId: p.journalId,
      expectedRevision: a.observations.at(-1)!.revision,
      expectedStateHash: p.hash,
      payloadHash: digest(canonical(input)),
      priorClaim: null,
    },
    evidence: {
      setHash: digest(canonical(items)),
      items,
      qualificationHash: h,
    },
    operations: {
      authorityId: "operations",
      revision: 1,
      adapterIdentity: "adapter",
      fenceTokenHash: h,
      observationHash: h,
    },
    trust: { authorityId: "trust", revision: 1, registryHash: h },
  };
  const capture = { references: ["report-0"], maxBytes: bytes.length };
  const reader = new RestoreOfflineOriginalPrivateEvidence(
    c.f.app.database,
    c.f.app.identity,
    c.j,
  );
  return {
    root,
    contents,
    envelope,
    manifest,
    capture,
    reader,
    read: () => reader.read(envelope, manifest, capture),
  };
}
function observe(t: TestContext) {
  const buffers: Buffer[] = [];
  let opens = 0;
  const alloc = Buffer.alloc,
    open = fs.openSync;
  t.mock.method(Buffer, "alloc", ((
    ...args: Parameters<typeof Buffer.alloc>
  ) => {
    const b = Reflect.apply(alloc, Buffer, args);
    buffers.push(b);
    return b;
  }) as typeof Buffer.alloc);
  t.mock.method(fs, "openSync", ((...args: Parameters<typeof fs.openSync>) => {
    opens++;
    return Reflect.apply(open, fs, args);
  }) as typeof fs.openSync);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    buffers,
    opens: () => opens,
    zero: () => assert.ok(buffers.every((b) => b.every((x) => x === 0))),
  };
}
for (const region of ["CA", "US"] as const)
  test(`${region} actual writer consumes exact private bytes once with native consistency and zeroed captures`, (t) => {
    const c = setup(t, region, 4),
      f = files(t, c),
      io = observe(t);
    assert.ok(f.contents[0]!.length > 64 * 1024);
    const handle = f.read();
    handle.complete();
    assert.equal(io.opens(), 2);
    assert.deepEqual(Object.keys(handle).sort(), ["complete", "dispose"]);
    const before = c.f.app.database
      .owned("integration")
      .get("SELECT total_changes() AS n")!.n;
    const proof = c.f.app.database.transaction(() =>
      handle.captureOriginalJournal("report-0", c.reviewer),
    );
    assertCapturedOfflineOriginalEvidence(proof);
    assert.equal(proof.native.hash, f.envelope.task.expectedStateHash);
    assert.equal(proof.native.journalId, c.journal.id);
    assert.ok(Object.isFrozen(proof));
    assert.equal(
      c.f.app.database.owned("integration").get("SELECT total_changes() AS n")!
        .n,
      before,
    );
    assert.equal(io.opens(), 2);
    io.zero();
    assert.throws(
      () => handle.captureOriginalJournal("report-0", c.reviewer),
      refusal,
    );
  });
for (const key of [
  "orgId",
  "subjectId",
  "payloadHash",
  "expectedStateHash",
  "expectedRevision",
] as const)
  test(`private original task binds ${key} to the actual capture`, (t) => {
    const c = setup(t),
      f = files(t, c),
      io = observe(t);
    (f.envelope.task as any)[key] = key.endsWith("Hash")
      ? "b".repeat(64)
      : key === "expectedRevision"
        ? 900
        : "different";
    if (key === "orgId") f.envelope.recovery.organizations[0]!.id = "different";
    const handle = f.read();
    handle.complete();
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          handle.captureOriginalJournal("report-0", c.reviewer),
        ),
      refusal,
    );
    io.zero();
  });
for (const bytes of [
  Buffer.from('{"version":1,"version":1}'),
  Buffer.from(' {"version":1}'),
  Buffer.from("\ufeff{}"),
  Buffer.from([0xc0, 0xaf]),
  Buffer.from('{"a":-0}'),
  Buffer.from('{"a":"\\ud800"}'),
  Buffer.from('{"a":"\\u0000"}'),
  Buffer.from("[".repeat(65) + "0" + "]".repeat(65)),
  Buffer.from(encode({ a: Array(8193).fill(null) })),
])
  test(`original private malformed/alternate bytes refuse ${digest(bytes).slice(0, 10)} and erase`, (t) => {
    const c = setup(t),
      f = files(t, c, bytes),
      io = observe(t),
      handle = f.read();
    handle.complete();
    assert.throws(
      () =>
        c.f.app.database.transaction(() =>
          handle.captureOriginalJournal("report-0", c.reviewer),
        ),
      refusal,
    );
    io.zero();
  });
test("no writer, wrong role and bad references consume and erase independently", (t) => {
  const c = setup(t),
    f = files(t, c);
  for (const kind of ["writer", "role", "reference", "proxy"]) {
    const io = observe(t),
      handle = f.read();
    handle.complete();
    const actor = { ...c.reviewer, role: "admin" } as Actor;
    let hooks = 0;
    const ref =
      kind === "proxy"
        ? new Proxy(
            {},
            {
              get() {
                hooks++;
                throw Error("hook");
              },
            },
          )
        : kind === "reference"
          ? "report-1"
          : "report-0";
    assert.throws(
      () =>
        kind === "writer"
          ? handle.captureOriginalJournal(ref, actor)
          : c.f.app.database.transaction(() => {
              if (kind === "role")
                c.f.app.database
                  .owned("iam")
                  .run(
                    "UPDATE iam_users SET role='support' WHERE id=?",
                    c.reviewer.id,
                  );
              return handle.captureOriginalJournal(ref, actor);
            }),
      refusal,
    );
    assert.equal(hooks, 0);
    io.zero();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
test("legacy handle cannot activate original profile and wrong task is refused before private IO", (t) => {
  const c = setup(t),
    f = files(t, c),
    io = observe(t);
  const legacy = readOfflinePrivateEvidence(f.envelope, f.manifest, f.capture);
  legacy.complete();
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        legacy.captureOriginalJournal("report-0", c.reviewer),
      ),
    refusal,
  );
  io.zero();
  const opened = io.opens();
  (f.envelope.task as { name: string }).name = "different";
  assert.throws(() => f.read(), refusal);
  assert.equal(io.opens(), opened);
});
test("original profile captures one selected member with native input byte budget; legacy limit retained", (t) => {
  const c = setup(t),
    large = Buffer.from(encode({ a: "a".repeat(1024 ** 2 + 1) })),
    f = files(t, c, large),
    io = observe(t);
  assert.throws(
    () => readOfflinePrivateEvidence(f.envelope, f.manifest, f.capture),
    refusal,
  );
  const handle = f.read();
  handle.complete();
  assert.equal(io.buffers.filter((b) => b.length === large.length).length, 1);
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        handle.captureOriginalJournal("report-0", c.reviewer),
      ),
    refusal,
  );
  io.zero();
  f.capture.references.push("report-1");
  assert.throws(() => f.read(), refusal);
  f.capture.references.pop();
  f.capture.maxBytes = 16_016_385;
  assert.throws(() => f.read(), refusal);
});

for (const change of ["history", "password", "hold"] as const)
  test(`actual ${change} drift after private completion refuses and erases`, (t) => {
    const c = setup(t),
      f = files(t, c),
      io = observe(t),
      handle = f.read();
    handle.complete();
    assert.throws(
      () =>
        c.f.app.database.transaction(() => {
          if (change === "history")
            c.f.app.database
              .owned("integration")
              .run(
                "UPDATE integration_stock_journal_observations SET body='{}' WHERE journal_id=?",
                c.journal.id,
              );
          if (change === "password")
            c.f.app.database
              .owned("iam")
              .run(
                "INSERT INTO iam_user_security VALUES(?,1,1,'2026-10-03T00:00:00.000Z') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
                c.reviewer.id,
              );
          if (change === "hold")
            c.f.app.database
              .owned("platform")
              .run("DELETE FROM platform_recovery");
          handle.captureOriginalJournal("report-0", {
            ...c.reviewer,
            role: "admin",
          } as Actor);
        }),
      refusal,
    );
    io.zero();
  });
test("capture before completion, explicit disposal and parser success cannot supply a byte getter", (t) => {
  const c = setup(t),
    f = files(t, c),
    io = observe(t),
    handle = f.read();
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        handle.captureOriginalJournal("report-0", c.reviewer),
      ),
    refusal,
  );
  assert.throws(() => handle.complete(), refusal);
  io.zero();
  const second = f.read();
  second.complete();
  second.dispose();
  second[Symbol.dispose]();
  assert.throws(
    () =>
      c.f.app.database.transaction(() =>
        second.captureOriginalJournal("report-0", c.reviewer),
      ),
    refusal,
  );
  io.zero();
  assert.ok(
    !Reflect.ownKeys(second).some(
      (k) => typeof k === "string" && /bytes|map|parser|callback/.test(k),
    ),
  );
});
