import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { prepared, h } from "./helpers/offline-failed-refund-fixture.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import {
  RestoreOfflineFailedRefundCoordinator,
  type OfflineFailedRefundQualification,
  type OfflineFailedRefundHost,
} from "../src/server/restore-offline-failed-refund-coordinator.ts";
import {
  readOfflinePrivateEvidence,
  RestoreOfflineFailedRefundPrivateEvidence,
} from "../src/server/restore-offline-private-evidence.ts";
import {
  offlineTaskBinding,
  offlineTaskApprovalMessage,
} from "../src/server/restore-offline-envelope.ts";
import { offlineApprovalRosterFingerprint } from "../src/server/restore-offline-approvals.ts";
function json(value: unknown): string {
  // Test-only canonical serialization of private captured assertions.
  if (Array.isArray(value)) return "[" + value.map(json).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + json(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function ready(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = await prepared(t, region, currency);
  const root = fs.mkdtempSync(join(tmpdir(), "refund-coordinator-"));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bytes = Buffer.from(json(f.input));
  fs.writeFileSync(join(root, "refund.json"), bytes, { mode: 0o600 });
  const items = [
    {
      reference: "refund-evidence",
      sha256: digest(bytes),
      bytes: bytes.length,
    },
  ];
  const manifest = {
    version: 1,
    root,
    files: [{ reference: items[0]!.reference, path: "refund.json" }],
  };
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const roster = pairs.map((pair, i) => ({
    id: i === 0 ? "finance-signer" : "security-signer",
    role: i === 0 ? ("finance" as const) : ("security" as const),
    personId: "signer-person-" + i,
    publicKey: pair.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  }));
  const envelope = structuredClone(f.envelope);
  envelope.preparedBy = "preparer";
  envelope.executorId = f.finance.id;
  envelope.preparedAt = "2026-10-03T23:00:00.000Z";
  envelope.expiresAt = "2026-10-03T23:10:00.000Z";
  envelope.evidence = {
    setHash: digest(canonical(items)),
    items,
    qualificationHash: h("qualified-test-only"),
  };
  envelope.trust.registryHash = offlineApprovalRosterFingerprint(roster);
  const approvals = roster.map((r, i) => ({
    signerId: r.id,
    role: r.role,
    binding: offlineTaskBinding(envelope),
    signature: sign(
      null,
      Buffer.from(offlineTaskApprovalMessage(envelope, r.id, r.role)),
      pairs[i]!.privateKey,
    ).toString("base64"),
  }));
  let held = false,
    calls = 0;
  const qualification: OfflineFailedRefundQualification = {
    purpose: "distributor-offline-current-refund-qualification-v1",
    envelopeBinding: offlineTaskBinding(envelope),
    now: "2026-10-03T23:05:00.000Z",
    trust: envelope.trust,
    roster,
    associations: {
      preparer: { id: envelope.preparedBy, personId: "preparer-person" },
      executor: { id: envelope.executorId, personId: "executor-person" },
      operations: {
        id: envelope.operations.authorityId,
        personId: "operations-person",
      },
    },
    evidence: {
      setHash: envelope.evidence.setHash,
      qualificationHash: envelope.evidence.qualificationHash,
      comparisonInputHash: f.comparison.inputHash,
      provider: "stripe",
      mode: "test",
      subjectId: f.effectId,
      reference: f.comparison.outcome.reference,
    },
  };
  const state = {
    qualification,
    onRead: (_calls: number) => {},
    cleanupFailure: false,
    heldReads: 0,
  };
  const host: OfflineFailedRefundHost = {
    adapter: {
      identity: envelope.operations.adapterIdentity,
      hold(_request, commit) {
        held = true;
        try {
          commit();
        } finally {
          held = false;
        }
        if (state.cleanupFailure) throw Error("synthetic lost response");
      },
      assertHeld() {
        assert.equal(held, true);
        state.heldReads++;
      },
    },
    readCurrent() {
      state.onRead(++calls);
      return state.qualification;
    },
  };
  const coordinator = new RestoreOfflineFailedRefundCoordinator(
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.platform,
    host,
  );
  return {
    ...f,
    envelope,
    approvals,
    manifest,
    host,
    state,
    coordinator,
    root,
  };
}
type Ready = Awaited<ReturnType<typeof ready>>;
function execute(f: Ready) {
  return f.coordinator.execute(
    f.finance,
    f.envelope,
    f.approvals,
    f.manifest,
    "refund-evidence",
  );
}
function snapshot(f: Ready) {
  return canonical(
    ["billing", "integration", "platform", "iam"].map((owner) => {
      const s = f.app.database.owned(owner as "billing");
      return s
        .all<{ name: string }>(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE ? ORDER BY name",
          owner + "_%",
        )
        .map((r) => [
          r.name,
          s.all("SELECT * FROM " + r.name + " ORDER BY rowid"),
        ]);
    }),
  );
}
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(
    "signed private fixed refund composition " + region + "/" + currency,
    async (t) => {
      const f = await ready(t, region, currency),
        result = execute(f);
      assert.equal(result.status, "committed");
      assert.ok(f.state.heldReads >= 5);
      const before = snapshot(f),
        recovered = f.app.database.transaction(() =>
          f.coordinator.recoverInTransaction(f.finance, f.envelope),
        );
      assert.equal(recovered.resultHash, result.resultHash);
      assert.equal(snapshot(f), before);
      assert.throws(() => execute(f));
      assert.equal(snapshot(f), before);
    },
  );
test("cleanup lost response recovers retained exact receipt after database reopen", async (t) => {
  const f = await ready(t);
  f.state.cleanupFailure = true;
  const result = execute(f);
  assert.equal(result.status, "committed-recovery-required");
  f.app.close();
  const app = new Application(f.path, "CA", { eventReports: false });
  f.replaceApp(app);
  const coordinator = new RestoreOfflineFailedRefundCoordinator(
    app.database,
    app.identity,
    app.billing,
    app.platform,
  );
  const result2 = app.database.transaction(() =>
    coordinator.recoverInTransaction(f.finance, f.envelope),
  );
  assert.equal(result2.resultHash, result.resultHash);
});

for (const boundary of [2, 3, 4, 5])
  test(
    "qualification expiry at boundary " +
      boundary +
      " conserves all owner state",
    async (t) => {
      const f = await ready(t),
        before = snapshot(f);
      f.state.onRead = (calls) => {
        if (calls >= boundary)
          f.state.qualification = {
            ...f.state.qualification,
            now: f.envelope.expiresAt,
          };
      };
      assert.throws(() => execute(f));
      assert.equal(snapshot(f), before);
    },
  );
test("trusted reader attempting a candidate write is rejected and rolled back", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  f.state.onRead = (calls) => {
    if (calls === 2)
      f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET name='changed' WHERE id=?", f.finance.id);
  };
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("valid nested coordinator attempt poisons outer commit even when caught", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  f.state.onRead = (calls) => {
    if (calls === 2) assert.throws(() => execute(f));
  };
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("input approval mutation in trusted host cannot redirect detached authorization", async (t) => {
  const f = await ready(t);
  f.state.onRead = (calls) => {
    if (calls === 1)
      f.approvals[0]!.signature = Buffer.alloc(64).toString("base64");
  };
  assert.equal(execute(f).status, "committed");
});

for (const defect of [
  "expired",
  "future",
  "trust",
  "roster",
  "person",
  "evidence-set",
  "evidence-qualification",
  "evidence-input",
  "provider-reference",
  "provider-mode",
  "binding",
  "signature",
  "executor",
] as const)
  test(
    "current qualification refuses " + defect + " and conserves native state",
    async (t) => {
      const f = await ready(t),
        before = snapshot(f),
        q = structuredClone(f.state.qualification) as any;
      if (defect === "expired") q.now = f.envelope.expiresAt;
      if (defect === "future") q.now = "2026-10-03T22:59:59.999Z";
      if (defect === "trust") q.trust.revision++;
      if (defect === "roster") q.roster[0].publicKey = q.roster[1].publicKey;
      if (defect === "person")
        q.associations.operations.personId = q.roster[0].personId;
      if (defect === "evidence-set") q.evidence.setHash = h("changed");
      if (defect === "evidence-qualification")
        q.evidence.qualificationHash = h("changed");
      if (defect === "evidence-input")
        q.evidence.comparisonInputHash = h("changed");
      if (defect === "provider-reference") q.evidence.reference = "re_other";
      if (defect === "provider-mode") q.evidence.mode = "live";
      if (defect === "binding") q.envelopeBinding = h("changed");
      if (defect === "signature")
        f.approvals[0]!.signature = Buffer.alloc(64).toString("base64");
      if (defect === "executor") f.envelope.executorId = "other-executor";
      f.state.qualification = q;
      assert.throws(() => execute(f));
      assert.equal(snapshot(f), before);
    },
  );
test("final trust revocation after owner writes rolls back all native receipts", async (t) => {
  const f = await ready(t),
    before = snapshot(f);
  f.state.onRead = (calls) => {
    if (calls >= 5)
      f.state.qualification = {
        ...f.state.qualification,
        trust: { ...f.state.qualification.trust, revision: 2 },
      };
  };
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
for (const boundary of [2, 5])
  test(
    "clock rollback inside valid approval window refuses at boundary " +
      boundary,
    async (t) => {
      const f = await ready(t),
        before = snapshot(f);
      f.state.onRead = (calls) => {
        if (calls === boundary)
          f.state.qualification = {
            ...f.state.qualification,
            now: "2026-10-03T23:04:59.999Z",
          };
      };
      assert.throws(() => execute(f));
      assert.equal(snapshot(f), before);
    },
  );
test("file substitution after captured completion cannot inject newly qualified refund", async (t) => {
  const f = await ready(t);
  f.state.onRead = (calls) => {
    if (calls === 3)
      fs.writeFileSync(join(f.root, "refund.json"), Buffer.from("{}"), {
        mode: 0o600,
      });
  };
  // The completed capture is consumed. A later file substitution cannot
  // inject its contents through another open.
  assert.equal(execute(f).status, "committed");
  assert.equal(fs.readFileSync(join(f.root, "refund.json"), "utf8"), "{}");
  const recovered = f.app.database.transaction(() =>
    f.coordinator.recoverInTransaction(f.finance, f.envelope),
  );
  assert.equal(recovered.receipt.status, "failed");
});
test("proxy and accessor qualification are refused without executing hooks", async (t) => {
  for (const variant of ["proxy", "getter"]) {
    const f = await ready(t),
      before = snapshot(f);
    let hits = 0;
    const q =
      variant === "proxy"
        ? new Proxy(
            {},
            {
              ownKeys() {
                hits++;
                return [];
              },
              getPrototypeOf() {
                hits++;
                return Object.prototype;
              },
              get() {
                hits++;
                return undefined;
              },
            },
          )
        : Object.defineProperty({ ...f.state.qualification }, "now", {
            enumerable: true,
            get() {
              hits++;
              return "2026-10-03T23:05:00.000Z";
            },
          });
    f.state.qualification = q as any;
    // Host function was captured: replace its return through the state rather
    // than replacing the composed callback.
    assert.throws(() => execute(f));
    assert.equal(hits, 0);
    assert.equal(snapshot(f), before);
  }
});
for (const defect of ["aggregate-key-bytes", "unpaired-key-surrogate"] as const)
  test(
    "inert manifest refuses " + defect + " before entering host",
    async (t) => {
      const f = await ready(t),
        before = snapshot(f),
        manifest: Record<string, unknown> = { ...f.manifest };
      if (defect === "aggregate-key-bytes") {
        // Every individual key/record and the complete node count are bounded.
        // Only the combined UTF-8 property-name bytes exceed one MiB.
        for (let branch = 0; branch < 40; branch++) {
          const child: Record<string, unknown> = {};
          for (let entry = 0; entry < 64; entry++)
            child["界".repeat(158) + entry.toString(16).padStart(2, "0")] =
              null;
          manifest["branch" + branch] = child;
        }
      } else manifest["invalid-\ud800"] = null;
      let reads = 0;
      f.state.onRead = () => {
        reads++;
      };
      assert.throws(() =>
        f.coordinator.execute(
          f.finance,
          f.envelope,
          f.approvals,
          manifest,
          "refund-evidence",
        ),
      );
      assert.equal(reads, 0);
      assert.equal(f.state.heldReads, 0);
      assert.equal(snapshot(f), before);
    },
  );
test("default host closed; absent durable receipt never permits application", async (t) => {
  const f = await ready(t),
    before = snapshot(f),
    closed = new RestoreOfflineFailedRefundCoordinator(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.platform,
    );
  assert.throws(() =>
    closed.execute(
      f.finance,
      f.envelope,
      f.approvals,
      f.manifest,
      "refund-evidence",
    ),
  );
  assert.throws(() =>
    f.app.database.transaction(() =>
      closed.recoverInTransaction(f.finance, f.envelope),
    ),
  );
  assert.equal(snapshot(f), before);
});
test("native fixed profile does not rename legacy signed task and is single consumption", async (t) => {
  const f = await ready(t),
    native = new RestoreOfflineFailedRefundPrivateEvidence();
  const legacy: any = structuredClone(f.envelope);
  legacy.task.name = "integration.stripe-refund-failed.import";
  assert.throws(() => native.read(legacy, f.manifest));
  const legacyHandle = readOfflinePrivateEvidence(f.envelope, f.manifest, {
    references: ["refund-evidence"],
    maxBytes: 65536,
  });
  legacyHandle.complete();
  assert.throws(() => legacyHandle.compareFailedRefund("refund-evidence"));
  const handle = native.read(f.envelope, f.manifest);
  handle.complete();
  assert.equal(
    handle.compareFailedRefund("refund-evidence").inputHash,
    f.comparison.inputHash,
  );
  assert.throws(() => handle.compareFailedRefund("refund-evidence"));
  handle.dispose();
});

for (const refusal of [false, true])
  test(
    "coordinator erases private selected allocation on " +
      (refusal ? "authority refusal" : "success"),
    async (t) => {
      const f = await ready(t),
        buffers: Buffer[] = [];
      const size = Buffer.byteLength(json(f.input)),
        allocate = Buffer.alloc;
      t.mock.method(Buffer, "alloc", ((
        ...args: Parameters<typeof Buffer.alloc>
      ) => {
        const buffer = Reflect.apply(allocate, Buffer, args);
        if (buffer.length === size) buffers.push(buffer);
        return buffer;
      }) as typeof Buffer.alloc);
      syncBuiltinESMExports();
      t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
      if (refusal)
        f.state.onRead = (calls) => {
          if (calls === 3)
            f.state.qualification = {
              ...f.state.qualification,
              now: f.envelope.expiresAt,
            };
        };
      if (refusal) assert.throws(() => execute(f));
      else assert.equal(execute(f).status, "committed");
      assert.ok(buffers.length > 0);
      assert.ok(buffers.every((buffer) => buffer.every((byte) => byte === 0)));
    },
  );
