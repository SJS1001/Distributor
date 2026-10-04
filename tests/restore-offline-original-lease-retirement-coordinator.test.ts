import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { PlatformOfflineOriginalLeaseCommandReviewReader } from "../src/server/platform-offline-original-lease-command-review.ts";
import {
  RestoreOfflineOriginalLeaseRetirementCoordinator,
  type OfflineOriginalLeaseRetirementHost,
  type OfflineOriginalLeaseRetirementQualification,
} from "../src/server/restore-offline-original-lease-retirement-coordinator.ts";
import {
  offlineTaskBinding,
  offlineTaskApprovalMessage,
} from "../src/server/restore-offline-envelope.ts";
import { offlineApprovalRosterFingerprint } from "../src/server/restore-offline-approvals.ts";
import { setup, loc } from "./offline-original-lease-fixture.ts";

// Real signatures and native writes; the local host is synthetic and unqualified.
function ready(
  t: TestContext,
  region: "CA" | "US" = "CA",
  reports = false,
  dispatched = false,
  lookup = false,
) {
  const f = setup(t, region, reports, dispatched, lookup),
    a = f.f.app;
  const commands = a.database.transaction(() =>
    new PlatformOfflineOriginalLeaseCommandReviewReader(
      a.database,
      a.identity,
      a.integration.costs.journals,
    ).getInTransaction(f.f.actor, f.journal.id),
  );
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const roster = pairs.map((p, i) => ({
    id: i === 0 ? "finance-signer" : "security-signer",
    role: i === 0 ? ("finance" as const) : ("security" as const),
    personId: "signer-person-" + i,
    publicKey: p.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }));
  const envelope = {
      ...structuredClone(f.envelope),
      trust: { ...f.envelope.trust },
    },
    time = Math.max(Date.now(), f.lease.started + 1);
  envelope.preparedAt = new Date(time).toISOString();
  envelope.expiresAt = new Date(time + 600000).toISOString();
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
  const qualification: OfflineOriginalLeaseRetirementQualification = {
    purpose:
      "distributor-offline-current-original-lease-retirement-qualification-v1",
    envelopeBinding: offlineTaskBinding(envelope),
    now: new Date(time + 1).toISOString(),
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
      payloadHash: envelope.task.payloadHash,
      nativeReviewHash: commands.nativeReviewHash,
      commandReviewHash: commands.factsHash,
      priorClaimHash: digest(canonical(envelope.task.priorClaim)),
      claimStarted: f.lease.started,
      claimStartEvidenceHash: digest(
        "synthetic independent historical claim-start qualification",
      ),
      provider: "quickbooks",
      mode: "sandbox",
      subjectId: f.journal.id,
    },
  };
  let held = false,
    calls = 0;
  const state = {
    qualification,
    onRead: (_calls: number) => {},
    cleanupFailure: false,
  };
  const host: OfflineOriginalLeaseRetirementHost = {
    adapter: {
      identity: envelope.operations.adapterIdentity,
      hold(_r, commit) {
        held = true;
        try {
          commit();
        } finally {
          held = false;
        }
        if (state.cleanupFailure) throw Error("response lost after commit");
      },
      assertHeld() {
        assert(held);
      },
    },
    readCurrent() {
      state.onRead(++calls);
      return state.qualification;
    },
  };
  const coordinator = new RestoreOfflineOriginalLeaseRetirementCoordinator(
    a.database,
    a.identity,
    a.platform,
    a.integration.costs.journals,
    host,
  );
  return {
    ...f,
    envelope,
    approvals,
    state,
    host,
    coordinator,
    commands,
    pairs,
    roster,
  };
}
type F = ReturnType<typeof ready>;
function execute(f: F, payload: unknown = f.payload) {
  return f.coordinator.execute(
    loc(f.f.actor),
    loc(f.reviewer),
    f.envelope,
    f.approvals,
    payload,
  );
}
function snapshot(f: F) {
  const d = new DatabaseSync(f.f.path);
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
function recovery(f: F) {
  return f.f.app.database.transaction(() =>
    f.coordinator.recoverRetainedInTransaction(
      loc(f.f.actor),
      loc(f.reviewer),
      f.envelope,
    ),
  );
}
for (const region of ["CA", "US"] as const)
  for (const reports of [false, true])
    for (const lookup of [false, true])
      test(`${region} reports=${reports} lookup=${lookup}: signed outer commit and exact durable recovery`, (t) => {
        const f = ready(t, region, reports, true, lookup),
          result = execute(f);
        assert.equal(result.status, "committed");
        const receipt = recovery(f);
        assert.equal(receipt.resultHash, result.resultHash);
        assert(
          receipt.requiredChecks.includes(
            "CLAIM_START_TIMESTAMP_NOT_IN_PLATFORM_AUDIT",
          ),
        );
        const a = receipt.after.attempts.find(
          (a) => a.row.id === f.journal.id,
        )!;
        assert.equal(a.row.state, "unknown");
        assert.equal(a.row.lease_id, null);
        assert.equal(a.row.dispatched, f.payload.dispatched);
        const before = snapshot(f);
        assert.throws(() => execute(f));
        assert.equal(snapshot(f), before);
      });
test("missing trusted host refuses without candidate effects", (t) => {
  const f = ready(t),
    a = f.f.app,
    before = snapshot(f);
  const c = new RestoreOfflineOriginalLeaseRetirementCoordinator(
    a.database,
    a.identity,
    a.platform,
    a.integration.costs.journals,
  );
  assert.throws(() =>
    c.execute(
      loc(f.f.actor),
      loc(f.reviewer),
      f.envelope,
      f.approvals,
      f.payload,
    ),
  );
  assert.equal(snapshot(f), before);
});
test("response lost after commit recovers only the exact durable receipt", (t) => {
  const f = ready(t);
  f.state.cleanupFailure = true;
  const r = execute(f);
  assert.equal(r.status, "committed-recovery-required");
  assert.equal(recovery(f).resultHash, r.resultHash);
});
test("reopened application proves receipt without repeating native effect", (t) => {
  const f = ready(t),
    result = execute(f);
  f.f.app.close();
  const a = new Application(f.f.path, "CA", { eventReports: false });
  f.f.app = a;
  const c = new RestoreOfflineOriginalLeaseRetirementCoordinator(
    a.database,
    a.identity,
    a.platform,
    a.integration.costs.journals,
  );
  const r = a.database.transaction(() =>
    c.recoverRetainedInTransaction(loc(f.f.actor), loc(f.reviewer), f.envelope),
  );
  assert.equal(r.resultHash, result.resultHash);
});
for (const key of [
  "payloadHash",
  "nativeReviewHash",
  "commandReviewHash",
  "priorClaimHash",
  "claimStartEvidenceHash",
] as const)
  test(`late ${key} qualification drift rolls back all candidate changes`, (t) => {
    const f = ready(t),
      before = snapshot(f);
    f.state.onRead = (n) => {
      if (n >= 3)
        (f.state.qualification.evidence as any)[key] = digest("changed");
    };
    assert.throws(() => execute(f));
    assert.equal(snapshot(f), before);
  });
test("signed expiry late in application rolls back native and receipt writes", (t) => {
  const f = ready(t),
    before = snapshot(f);
  let reached = false;
  f.state.onRead = () => {
    if (
      f.f.app.database
        .owned("integration")
        .get("SELECT COUNT(*) n FROM integration_offline_original_leases")!
        .n === 1
    ) {
      reached = true;
      (f.state.qualification as any).now = f.envelope.expiresAt;
    }
  };
  assert.throws(() => execute(f));
  assert(reached);
  assert.equal(snapshot(f), before);
});
test("host cannot mutate caller payload into the signed request", (t) => {
  const f = ready(t),
    p = { ...f.payload, leaseId: "wrong" },
    before = snapshot(f);
  f.state.onRead = () => {
    p.leaseId = f.payload.leaseId;
  };
  assert.throws(() => execute(f, p));
  assert.equal(snapshot(f), before);
});
test("hostile locators, payload and approvals execute no traps", (t) => {
  const f = ready(t),
    before = snapshot(f);
  let traps = 0;
  const bad = new Proxy(
    {},
    {
      get() {
        traps++;
        throw Error("trap");
      },
      ownKeys() {
        traps++;
        throw Error("trap");
      },
      getPrototypeOf() {
        traps++;
        throw Error("trap");
      },
    },
  );
  assert.throws(() => execute(f, bad));
  assert.throws(() =>
    f.coordinator.execute(
      bad,
      loc(f.reviewer),
      f.envelope,
      f.approvals,
      f.payload,
    ),
  );
  assert.throws(() =>
    f.coordinator.execute(
      loc(f.f.actor),
      loc(f.reviewer),
      f.envelope,
      bad,
      f.payload,
    ),
  );
  assert.equal(traps, 0);
  assert.equal(snapshot(f), before);
});
test("late inventory costs owner substitution is refused before hook execution", (t) => {
  const f = ready(t),
    a = f.f.app,
    before = snapshot(f);
  let traps = 0;
  const original = a.inventory.costs;
  f.state.onRead = () => {
    (a.inventory as any).costs = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error("trap");
        },
      },
    );
  };
  try {
    assert.throws(() => execute(f));
    assert.equal(traps, 0);
  } finally {
    (a.inventory as any).costs = original;
  }
  assert.equal(snapshot(f), before);
});
test("forged approval refuses before native retirement", (t) => {
  const f = ready(t),
    before = snapshot(f);
  f.approvals[0]!.signature = Buffer.alloc(64).toString("base64");
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});
test("current principal role loss late in native application rolls back", (t) => {
  const f = ready(t),
    before = snapshot(f);
  let reached = false;
  f.state.onRead = () => {
    if (
      f.f.app.database
        .owned("integration")
        .get("SELECT COUNT(*) n FROM integration_offline_original_leases")!
        .n === 1
    ) {
      reached = true;
      f.f.app.database
        .owned("iam")
        .run("UPDATE iam_users SET roles='[]' WHERE id=?", f.reviewer.id);
    }
  };
  assert.throws(() => execute(f));
  assert(reached);
  assert.equal(snapshot(f), before);
});

test("signed preparation cannot precede the copied claim start", (t) => {
  const f = ready(t),
    before = snapshot(f);
  f.envelope.preparedAt = new Date(f.lease.started - 1).toISOString();
  (f.state.qualification as any).envelopeBinding = offlineTaskBinding(
    f.envelope,
  );
  for (const [i, approval] of f.approvals.entries()) {
    approval.binding = offlineTaskBinding(f.envelope);
    approval.signature = sign(
      null,
      Buffer.from(
        offlineTaskApprovalMessage(
          f.envelope,
          approval.signerId,
          approval.role,
        ),
      ),
      f.pairs[i]!.privateKey,
    ).toString("base64");
  }
  assert.throws(() => execute(f));
  assert.equal(snapshot(f), before);
});

test("clock rollback after tentative native application prevents commit", (t) => {
  const f = ready(t),
    before = snapshot(f);
  let reached = false;
  f.state.onRead = () => {
    if (
      f.f.app.database
        .owned("integration")
        .get("SELECT COUNT(*) n FROM integration_offline_original_leases")!
        .n === 1
    ) {
      reached = true;
      (f.state.qualification as any).now = f.envelope.preparedAt;
    }
  };
  assert.throws(() => execute(f));
  assert(reached);
  assert.equal(snapshot(f), before);
});

test("swallowed nested coordinator refusal poisons the enclosing commit", (t) => {
  const f = ready(t),
    before = snapshot(f);
  let attempted = false;
  f.state.onRead = () => {
    if (!attempted) {
      attempted = true;
      assert.throws(() => execute(f));
    }
  };
  assert.throws(() => execute(f));
  assert(attempted);
  assert.equal(snapshot(f), before);
});
