import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, digest, DomainError } from "../src/server/core.ts";
import {
  RestoreRuntime,
  parseRestoreOperatorRequest,
} from "../src/server/restore-runtime.ts";
import { createRuntimeApplication } from "../src/server/runtime-application.ts";
import type { RestoreRuntimeConfiguration } from "../src/server/runtime-host.ts";
import { PlatformOfflineOriginalLeaseCommandReviewReader } from "../src/server/platform-offline-original-lease-command-review.ts";
import type {
  OfflineOriginalLeaseRetirementHost,
  OfflineOriginalLeaseRetirementQualification,
} from "../src/server/restore-offline-original-lease-retirement-coordinator.ts";
import {
  offlineTaskBinding,
  offlineTaskApprovalMessage,
} from "../src/server/restore-offline-envelope.ts";
import { offlineApprovalRosterFingerprint } from "../src/server/restore-offline-approvals.ts";
import { setup, loc } from "./offline-original-lease-fixture.ts";

// Synthetic host only: real native owners, signatures and SQLite commits.
// This exercises composition, not source fencing or infrastructure qualification.
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
  return {
    ...f,
    envelope,
    approvals,
    state,
    host,
    commands,
    pairs,
    roster,
  };
}
type F = ReturnType<typeof ready>;
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

const branches = [
  [
    "failedRefund",
    "offline-failed-refund",
    "RESTORE_OFFLINE_REFUND_COORDINATOR",
  ],
  [
    "originalCancellation",
    "offline-original-cancellation",
    "RESTORE_OFFLINE_ORIGINAL_CANCELLATION_COORDINATOR",
  ],
  [
    "originalLeaseRetirement",
    "offline-original-lease-retirement",
    "RESTORE_OFFLINE_ORIGINAL_LEASE_RETIREMENT_COORDINATOR",
  ],
  [
    "canadaPostMember",
    "offline-canada-post-member",
    "RESTORE_OFFLINE_CANADA_POST_MEMBER_COORDINATOR",
  ],
  [
    "checkoutPaid",
    "offline-checkout-paid",
    "RESTORE_OFFLINE_CHECKOUT_PAID_COORDINATOR",
  ],
] as const;

function request(action: string) {
  const input: Record<string, unknown> = { executor: {}, envelope: {} };
  if (!action.endsWith("-recover")) {
    input.approvals = [];
    if (action === "offline-original-lease-retirement") input.payload = {};
    else input.manifest = {};
    if (
      ["offline-failed-refund", "offline-original-cancellation"].includes(
        action,
      )
    )
      input.reference = {};
  }
  if (
    ![
      "offline-failed-refund",
      "offline-failed-refund-recover",
      "offline-canada-post-member-recover",
    ].includes(action)
  )
    input.preparer = {};
  return input;
}
function runtime(t: TestContext, host?: RestoreRuntimeConfiguration) {
  const dir = mkdtempSync(join(tmpdir(), "distributor-restore-runtime-"));
  const r = createRuntimeApplication(
    join(dir, "runtime.sqlite"),
    "CA",
    {},
    host,
  );
  t.after(() => {
    r.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return r;
}
function code(expected: string) {
  return (error: unknown) =>
    error instanceof DomainError && error.code === expected;
}

test("executable composition stays closed without a static host for all five native tasks", (t) => {
  const r = runtime(t);
  assert.equal(r.restore.installed(), false);
  assert.deepEqual(r.restore.run("release-status", {}), {
    hostInstalled: false,
    release: null,
  });
  for (const [, action] of branches) {
    assert.throws(
      () => r.restore.run(action, request(action)),
      code("RESTORE_OFFLINE_DISABLED"),
    );
    assert.throws(
      () => r.restore.run(action + "-recover", request(action + "-recover")),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code !== "RESTORE_OFFLINE_DISABLED" &&
        error.code !== "RESTORE_INPUT",
    );
  }
  assert.throws(
    () => r.restore.run("release-prepare", { input: {} }),
    code("RESTORE_DISABLED"),
  );
});

for (const [key, action, nativeCode] of branches) {
  test(`explicit ${key} host constructs real owners without callbacks and refuses malformed evidence natively`, (t) => {
    let calls = 0;
    const host = {
      adapter: {
        identity: "synthetic-runtime-host",
        hold() {
          calls++;
          throw Error("unexpected host hold");
        },
        assertHeld() {
          calls++;
          throw Error("unexpected host assertion");
        },
      },
      readCurrent() {
        calls++;
        throw Error("unexpected current qualification read");
      },
    };
    const r = runtime(t, { version: 1, offline: { [key]: host } });
    assert.equal(r.restore.installed(), true);
    assert.equal(calls, 0);
    assert.throws(
      () => r.restore.run(action, request(action)),
      code(nativeCode),
    );
    assert.throws(
      () => r.restore.run(action + "-recover", request(action + "-recover")),
      code(
        key === "failedRefund"
          ? "OFFLINE_FAILED_REFUND_APPLICATION"
          : nativeCode,
      ),
    );
    assert.equal(calls, 0);
    for (const [otherKey, otherAction] of branches) {
      if (key !== otherKey)
        assert.throws(
          () => r.restore.run(otherAction, request(otherAction)),
          code("RESTORE_OFFLINE_DISABLED"),
        );
    }
  });
}

for (const cleanupFailure of [false, true]) {
  test(`native retirement commits once and retained recovery redacts private details, cleanupFailure=${cleanupFailure}`, (t) => {
    const f = ready(t, "CA", false, true);
    let reads = 0;
    f.state.onRead = () => {
      reads++;
    };
    f.state.cleanupFailure = cleanupFailure;
    const r = new RestoreRuntime(f.f.app, {
      version: 1,
      offline: { originalLeaseRetirement: f.host },
    });
    assert.equal(reads, 0);
    const input = {
      preparer: loc(f.f.actor),
      executor: loc(f.reviewer),
      envelope: f.envelope,
      approvals: f.approvals,
      payload: f.payload,
    };
    const before = snapshot(f);
    assert.throws(() =>
      r.run("offline-original-lease-retirement", {
        ...input,
        preparer: input.executor,
        executor: input.preparer,
      }),
    );
    assert.equal(snapshot(f), before);
    assert.equal(reads, 0);
    const result = r.run("offline-original-lease-retirement", input) as {
      version: number;
      action: string;
      status: string;
      resultHash: string;
    };
    assert.deepEqual(Object.keys(result).sort(), [
      "action",
      "resultHash",
      "status",
      "version",
    ]);
    assert.equal(result.version, 1);
    assert.equal(result.action, "offline-original-lease-retirement");
    assert.equal(
      result.status,
      cleanupFailure ? "committed-recovery-required" : "committed",
    );
    assert.match(result.resultHash, /^[a-f0-9]{64}$/);
    assert(reads > 0);
    const retained = snapshot(f),
      callbacks = reads;
    const closed = new RestoreRuntime(f.f.app);
    assert.equal(closed.installed(), false);
    const recovery = {
      preparer: input.preparer,
      executor: input.executor,
      envelope: input.envelope,
    };
    const recovered = closed.run(
      "offline-original-lease-retirement-recover",
      recovery,
    ) as typeof result;
    assert.deepEqual(recovered, {
      ...result,
      action: "offline-original-lease-retirement-recover",
      status: "native-owner-recovery-consistency-only",
    });
    assert.equal(snapshot(f), retained);
    assert.equal(reads, callbacks);
    assert.throws(
      () => closed.run("offline-original-lease-retirement", input),
      code("RESTORE_OFFLINE_DISABLED"),
    );
    assert.throws(() =>
      closed.run("offline-original-lease-retirement-recover", {
        ...recovery,
        preparer: recovery.executor,
        executor: recovery.preparer,
      }),
    );
    assert.equal(snapshot(f), retained);
    assert.throws(() => r.run("offline-original-lease-retirement", input));
    assert.equal(snapshot(f), retained);
    const d = new DatabaseSync(f.f.path);
    try {
      const row = d
        .prepare(
          "SELECT state, lease_id, dispatched FROM integration_stock_journals WHERE id=?",
        )
        .get(f.journal.id);
      assert.deepEqual(
        { ...row },
        { state: "unknown", lease_id: null, dispatched: 1 },
      );
    } finally {
      d.close();
    }
    const beforeReopenCallbacks = reads;
    f.f.app.close();
    const reopened = createRuntimeApplication(f.f.path, "CA", {
      eventReports: false,
      startupMaintenance: false,
    });
    f.f.app = reopened.app;
    assert.equal(reopened.restore.installed(), false);
    assert.deepEqual(
      reopened.restore.run(
        "offline-original-lease-retirement-recover",
        recovery,
      ),
      recovered,
    );
    assert.equal(snapshot(f), retained);
    assert.equal(reads, beforeReopenCallbacks);
  });
}

test("combined static activation, disposition and offline composition invokes no host callbacks at startup", (t) => {
  let calls = 0;
  function unexpected(): never {
    calls++;
    throw Error("unexpected construction callback");
  }
  const offlineHost = {
    adapter: {
      identity: "synthetic-combined-host",
      hold: unexpected,
      assertHeld: unexpected,
    },
    readCurrent: unexpected,
  };
  const r = runtime(t, {
    version: 1,
    activation: {
      adapter: {
        enabled: true,
        identity: "synthetic-activation",
        fence: unexpected,
        routeCandidate: unexpected,
        stopCandidate: unexpected,
        routeSource: unexpected,
        observe: unexpected,
      },
      loadTrust: unexpected,
    },
    nativeDispositions: {
      mappings: [],
      loadTrust: unexpected,
      observe: unexpected,
    },
    offline: Object.fromEntries(branches.map(([key]) => [key, offlineHost])),
  });
  assert.equal(r.restore.installed(), true);
  assert.deepEqual(r.restore.run("release-status", {}), {
    hostInstalled: true,
    release: null,
  });
  assert.equal(calls, 0);
  for (const [, action, expected] of branches) {
    assert.throws(() => r.restore.run(action, request(action)), code(expected));
  }
  assert.equal(calls, 0);
});

test("operator parser detaches clean structured input before native dispatch", () => {
  const nested = {
    list: [null, true, 123, "valid 😀"],
    object: { value: "original" },
  };
  const request = { input: nested };
  const parsed = parseRestoreOperatorRequest("release-prepare", request);
  assert.deepEqual(parsed, request);
  assert.notEqual(parsed, request);
  assert.notEqual(parsed.input, nested);
  nested.list[3] = "caller changed";
  nested.object.value = "caller changed";
  assert.deepEqual(parsed.input, {
    list: [null, true, 123, "valid 😀"],
    object: { value: "original" },
  });
  const detached = parsed.input as typeof nested;
  detached.object.value = "parser result changed";
  assert.equal(nested.object.value, "caller changed");
});

test("operator parser rejects hostile and oversized requests before host callbacks or native mutation", (t) => {
  const f = ready(t);
  let callbacks = 0,
    traps = 0;
  f.state.onRead = () => {
    callbacks++;
  };
  const host: OfflineOriginalLeaseRetirementHost = {
    readCurrent(request) {
      callbacks++;
      return f.host.readCurrent(request);
    },
    adapter: {
      identity: f.host.adapter.identity,
      hold(request, commit) {
        callbacks++;
        f.host.adapter.hold(request, commit);
      },
      assertHeld(request) {
        callbacks++;
        f.host.adapter.assertHeld(request);
      },
    },
  };
  const r = new RestoreRuntime(f.f.app, {
    version: 1,
    offline: { originalLeaseRetirement: host },
  });
  const input = {
    preparer: loc(f.f.actor),
    executor: loc(f.reviewer),
    envelope: f.envelope,
    approvals: f.approvals,
    payload: f.payload,
  };
  const accessor = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      traps++;
      throw Error("unexpected accessor");
    },
  });
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        traps++;
        throw Error("unexpected prototype trap");
      },
      ownKeys() {
        traps++;
        throw Error("unexpected key trap");
      },
      getOwnPropertyDescriptor() {
        traps++;
        throw Error("unexpected descriptor trap");
      },
    },
  );
  const sparse = new Array(2);
  sparse[1] = "present";
  let deep: unknown = null;
  for (let i = 0; i < 34; i++) deep = { nested: deep };
  const payloads: [string, unknown][] = [
    ["accessor", accessor],
    ["proxy", proxy],
    ["unsafe nested constructor", { child: { constructor: "unsafe" } }],
    [
      "unsafe nested prototype",
      { child: JSON.parse('{"__proto__":"unsafe"}') },
    ],
    ["symbol key", { [Symbol("hidden")]: "unsafe" }],
    ["nonenumerable field", Object.defineProperty({}, "hidden", { value: 1 })],
    ["lone high surrogate value", "\ud800"],
    ["lone low surrogate value", "\udfff"],
    ["lone surrogate key", { ["\ud800"]: true }],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["fraction", 1.5],
    ["NaN", NaN],
    ["sparse array", sparse],
    ["array extra field", Object.assign([1], { extra: true })],
    ["depth limit", deep],
    ["node limit", [Array(10000).fill(null), Array(10000).fill(null)]],
    ["aggregate byte limit", Array(17).fill("a".repeat(65536))],
    ["single string limit", "a".repeat(65537)],
    ["array length limit", Array(10001).fill(null)],
    [
      "object key limit",
      Object.fromEntries(
        Array.from({ length: 10002 }, (_, i) => ["field" + i, null]),
      ),
    ],
  ];
  const before = snapshot(f);
  for (const [label, payload] of payloads) {
    assert.throws(
      () => r.run("offline-original-lease-retirement", { ...input, payload }),
      code("RESTORE_INPUT"),
      label,
    );
  }
  assert.throws(
    () =>
      r.run("offline-original-lease-retirement", {
        ...input,
        unexpected: true,
      }),
    code("RESTORE_INPUT"),
  );
  assert.throws(
    () => r.run("not-a-restore-operation", input),
    code("RESTORE_INPUT"),
  );
  const rootAccessor = Object.defineProperty({ ...input }, "payload", {
    enumerable: true,
    get() {
      traps++;
      throw Error("unexpected root accessor");
    },
  });
  assert.throws(
    () => r.run("offline-original-lease-retirement", rootAccessor),
    code("RESTORE_INPUT"),
  );
  assert.equal(traps, 0);
  assert.equal(callbacks, 0);
  assert.equal(snapshot(f), before);
});
