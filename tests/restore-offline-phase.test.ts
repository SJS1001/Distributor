import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, digest } from "../src/server/core.ts";
import {
  classifyOfflineReleaseHistory,
  evaluateOfflinePhaseTransition,
  offlinePhaseExpectation,
  parseOfflineRecoveryGeneration,
  validateOfflinePhaseState,
  type OfflinePhaseState,
  type OfflinePhaseTransition,
  type OfflineReleaseHistory,
  type OfflineTaskReceipt,
} from "../src/server/restore-offline-phase.ts";

const refusal = { code: "RESTORE_OFFLINE_PHASE" };
const h = (label: string) => digest(`synthetic:${label}`);
function generation(region: "CA" | "US" = "CA") {
  return {
    version: 1 as const,
    instanceId: h("independent-instance"),
    snapshotHash: h("raw-hold-snapshot"),
    restoredAt: "2026-10-03T12:00:00.000Z",
    sourceCompletedAt: "2026-10-03T11:59:00.000Z",
    schemaVersion: 17,
    schemaHash: h("actual-schema"),
    region,
    organizations: [
      { id: "org-a", currency: "CAD" as const },
      { id: "org-b", currency: "USD" as const },
    ],
  };
}
function initial(region: "CA" | "US" = "CA") {
  return validateOfflinePhaseState({
    version: 1,
    generation: generation(region),
    releases: [],
    sessions: [],
  });
}
function advance(
  current: OfflinePhaseState,
  op: OfflinePhaseTransition,
  releases: unknown = current.releases,
) {
  const result = evaluateOfflinePhaseTransition(
    current,
    offlinePhaseExpectation(current),
    op,
    releases,
  );
  assert.equal(result.status, "static-phase-proposal");
  assert.equal("authorized" in result, false);
  assert.equal("permit" in result, false);
  assert.deepEqual(result.expectation, offlinePhaseExpectation(result.next));
  return result.next;
}
function opened(region: "CA" | "US" = "CA") {
  return advance(
    advance(initial(region), { kind: "isolate", sessionId: "session-a" }),
    { kind: "open" },
  );
}
function receipt(suffix = "a", orgId = "org-a"): OfflineTaskReceipt {
  return {
    owner: "synthetic-inventory",
    orgId,
    taskName: "synthetic.reconcile",
    requestId: `request-${suffix}`,
    binding: h(`binding-${suffix}`),
    payloadHash: h(`payload-${suffix}`),
    beforeCandidateHash: h(`candidate-${suffix}`),
    resultHash: h(`result-${suffix}`),
  };
}
function release(
  points: [OfflineReleaseHistory["state"], OfflineReleaseHistory["phase"]][],
  id = "release-a",
): OfflineReleaseHistory {
  let at = 999;
  const history = points.map(([state, phase]) => ({
    state,
    phase,
    // Native hold() retains current.at; ordinary write() samples its clock.
    at: state === "held" ? at : ++at,
  }));
  return {
    id,
    binding: h(id),
    revision: history.length,
    ...history.at(-1)!,
    history,
  };
}
const prepared = () => release([["prepared", "prepared"]]);

test("an earlier recoverable hold may later acquire a permanent forward marker", () => {
  const r = release([
    ["prepared", "prepared"],
    ["stopping", "stopping"],
    ["forward-held", "stopping"],
    ["returning", "returning"],
    ["forward-held", "returning"],
    ["superseded", "superseded"],
  ]);
  r.forwardRecoveryRequired = true;
  assert.equal(
    classifyOfflineReleaseHistory([r]).effects,
    "forward-recovery-marker",
  );
  // The last positive hold still cannot be resumed to rollback completion.
  const invalid = release([
    ...r.history
      .slice(0, -1)
      .map((p) => [p.state, p.phase] as [typeof p.state, typeof p.phase]),
    ["rolled-back", "rolled-back"],
  ]);
  invalid.forwardRecoveryRequired = true;
  assert.throws(() => classifyOfflineReleaseHistory([invalid]), refusal);
});
function withRelease(
  value: OfflinePhaseState,
  records: OfflineReleaseHistory[],
) {
  return validateOfflinePhaseState({
    ...structuredClone(value),
    releases: records,
  });
}
function mutable(value: OfflinePhaseState): any {
  return structuredClone(value);
}

for (const region of ["CA", "US"] as const)
  test(`${region}: complete isolated/open/draining/closed proposal preserves all task receipts and session ancestry`, () => {
    let value = initial(region);
    value = advance(value, { kind: "isolate", sessionId: "session-a" });
    assert.equal(value.sessions[0]!.phase, "isolated");
    value = advance(value, { kind: "open" });
    const first = receipt(),
      second = receipt("b", "org-b");
    value = advance(value, { kind: "record-task", receipt: first });
    const pinnedFirst = structuredClone(value.sessions[0]!.history[2]);
    value = advance(value, { kind: "record-task", receipt: second });
    value = advance(value, { kind: "drain" });
    value = advance(value, { kind: "close" });
    assert.equal(value.sessions[0]!.revision, 6);
    assert.deepEqual(value.sessions[0]!.history[2], pinnedFirst);
    assert.deepEqual(
      value.sessions[0]!.history.filter((s) => s.receipt).map((s) => s.receipt),
      [first, second],
    );
    const closedHash = value.sessions[0]!.lineageHash;
    value = advance(value, { kind: "isolate", sessionId: "session-b" });
    assert.equal(value.sessions[1]!.previousSessionHash, closedHash);
    assert.deepEqual(validateOfflinePhaseState(value), value);
    assert.equal(value.generation.organizations[0]!.currency, "CAD");
  });

test("opaque generation is detached/frozen and binds every hold/schema/region/organization/instance field", () => {
  const input = generation(),
    parsed = parseOfflineRecoveryGeneration(input),
    anchor = offlinePhaseExpectation(initial());
  input.organizations[0]!.id = "caller-changed";
  assert.equal(parsed.organizations[0]!.id, "org-a");
  assert.ok(
    Object.isFrozen(parsed) &&
      Object.isFrozen(parsed.organizations) &&
      Object.isFrozen(parsed.organizations[0]),
  );
  const changes: ((g: any) => void)[] = [
    (g) => {
      g.instanceId = h("other-instance");
    },
    (g) => {
      g.snapshotHash = h("other-snapshot");
    },
    (g) => {
      g.restoredAt = "2026-10-03T12:01:00.000Z";
    },
    (g) => {
      g.sourceCompletedAt = "2026-10-03T11:58:00.000Z";
    },
    (g) => {
      g.schemaVersion++;
    },
    (g) => {
      g.schemaHash = h("other-schema");
    },
    (g) => {
      g.region = "US";
    },
    (g) => {
      g.organizations[0].id = "org-0";
    },
    (g) => {
      g.organizations[0].currency = "USD";
    },
    (g) => {
      g.organizations.pop();
    },
  ];
  for (const change of changes) {
    const g = generation();
    change(g);
    const state = validateOfflinePhaseState({
      version: 1,
      generation: g,
      releases: [],
      sessions: [],
    });
    assert.notEqual(
      offlinePhaseExpectation(state).generationHash,
      anchor.generationHash,
    );
    assert.throws(
      () =>
        evaluateOfflinePhaseTransition(
          state,
          anchor,
          { kind: "isolate", sessionId: "a" },
          [],
        ),
      refusal,
    );
  }
});

test("generation rejects absent hold fields, malformed dates/hashes/IDs/schema/region and ambiguous organization sets", () => {
  const changes: ((g: any) => void)[] = [
    (g) => {
      delete g.instanceId;
    },
    (g) => {
      g.instanceId = "copied-snapshot-is-not-an-instance";
    },
    (g) => {
      delete g.snapshotHash;
    },
    (g) => {
      g.snapshotHash = "A".repeat(64);
    },
    (g) => {
      g.restoredAt = "2026-02-30T00:00:00.000Z";
    },
    (g) => {
      g.restoredAt = "2026-10-03T12:00:00Z";
    },
    (g) => {
      g.sourceCompletedAt = "2026-10-03T12:00:00.001Z";
    },
    (g) => {
      g.schemaVersion = Number.MAX_SAFE_INTEGER + 1;
    },
    (g) => {
      g.schemaVersion = 0;
    },
    (g) => {
      g.schemaVersion = 1.5;
    },
    (g) => {
      g.schemaHash = "not-a-hash";
    },
    (g) => {
      g.region = "EU";
    },
    (g) => {
      g.organizations = [];
    },
    (g) => {
      g.organizations.reverse();
    },
    (g) => {
      g.organizations[1] = g.organizations[0];
    },
    (g) => {
      g.organizations[0].currency = "EUR";
    },
    (g) => {
      g.organizations[0].id = " org-a";
    },
    (g) => {
      g.organizations[0].id = "org\na";
    },
    (g) => {
      g.organizations[0].extra = true;
    },
    (g) => {
      g.organizations = Array(1001).fill(g.organizations[0]);
    },
    (g) => {
      g.rawHold = true;
    },
  ];
  for (const change of changes) {
    const input = generation();
    change(input);
    assert.throws(() => parseOfflineRecoveryGeneration(input), refusal);
  }
  for (const raw of [
    undefined,
    null,
    true,
    [],
    "hold",
    Object.create(generation()),
  ])
    assert.throws(() => parseOfflineRecoveryGeneration(raw), refusal);
});

test("unknown keys, sparse arrays, accessors and prototypes are refused without invoking supplied functions", () => {
  let called = 0;
  const get = () => {
    called++;
    throw new Error("must not invoke");
  };
  const g = generation();
  Object.defineProperty(g, "snapshotHash", { get, enumerable: true });
  assert.throws(() => parseOfflineRecoveryGeneration(g), refusal);
  const s = mutable(opened());
  Object.defineProperty(s.sessions[0].history[0], "kind", {
    get,
    enumerable: true,
  });
  assert.throws(() => validateOfflinePhaseState(s), refusal);
  const sparse = new Array(2);
  sparse[0] = generation().organizations[0];
  Object.assign(sparse, { extra: generation().organizations[1] });
  assert.throws(
    () =>
      parseOfflineRecoveryGeneration({
        ...generation(),
        organizations: sparse,
      }),
    refusal,
  );
  for (const value of [
    Object.assign(generation(), { [Symbol("hidden")]: true }),
    Object.assign(Object.create(null), generation()),
  ])
    assert.throws(() => parseOfflineRecoveryGeneration(value), refusal);
  const point = prepared();
  Object.defineProperty(point.history[0], "phase", { get, enumerable: true });
  assert.throws(() => classifyOfflineReleaseHistory([point]), refusal);
  const op = { kind: "invalidate", reason: { toString: get } };
  assert.throws(() => advance(opened(), op as any), refusal);
  assert.equal(called, 0);
});

test("same native release progression retains control intent through held, forward-held and superseded", () => {
  const sequences: [
    OfflineReleaseHistory["state"],
    OfflineReleaseHistory["phase"],
  ][][] = [
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["held", "fencing"],
      ["superseded", "superseded"],
    ],
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["fenced", "fenced"],
      ["routing", "routing"],
      ["held", "routing"],
      ["superseded", "superseded"],
    ],
    [
      ["prepared", "prepared"],
      ["stopping", "stopping"],
      ["forward-held", "stopping"],
      ["superseded", "superseded"],
    ],
    [
      ["prepared", "prepared"],
      ["stopping", "stopping"],
      ["returning", "returning"],
      ["rolled-back", "rolled-back"],
    ],
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["fenced", "fenced"],
      ["routing", "routing"],
      ["released", "released"],
      ["stopping", "stopping"],
      ["returning", "returning"],
      ["rolled-back", "rolled-back"],
    ],
  ];
  for (const sequence of sequences) {
    for (let size = 2; size <= sequence.length; size++) {
      const r = release(sequence.slice(0, size));
      const summary = classifyOfflineReleaseHistory([r]);
      assert.equal(summary.barrier, "control-intent-retained");
      assert.equal("externalEffectProven" in summary, false);
      assert.throws(
        () => advance(initial(), { kind: "isolate", sessionId: "a" }, [r]),
        refusal,
      );
      assert.throws(
        () =>
          advance(opened(), { kind: "record-task", receipt: receipt() }, [r]),
        refusal,
      );
    }
  }
});

test("prepared-only and isolated/superseded preparation still block opening; raw hold and booleans prove no fencing", () => {
  for (const r of [
    prepared(),
    release([
      ["prepared", "prepared"],
      ["held", "prepared"],
    ]),
    release([
      ["prepared", "prepared"],
      ["superseded", "superseded"],
    ]),
  ]) {
    assert.equal(
      classifyOfflineReleaseHistory([r]).barrier,
      "prepared-release-retained",
    );
    const isolated = advance(initial(), {
      kind: "isolate",
      sessionId: "session-a",
    });
    assert.throws(() => advance(isolated, { kind: "open" }, [r]), refusal);
  }
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(
        opened(),
        offlinePhaseExpectation(opened()),
        {
          kind: "record-task",
          receipt: receipt(),
          isolated: true,
          qualified: true,
        },
        [],
      ),
    refusal,
  );
  assert.throws(
    () =>
      classifyOfflineReleaseHistory([{ ...prepared(), sourceFenced: true }]),
    refusal,
  );
  assert.deepEqual(classifyOfflineReleaseHistory([]), {
    barrier: "no-recorded-release",
    effects: "not-established",
    releaseCount: 0,
  });
});

test("forward-held false is not an effect proof and never clears the retained control barrier", () => {
  for (const marker of [undefined, false, true]) {
    const r = release([
      ["prepared", "prepared"],
      ["stopping", "stopping"],
      ["forward-held", "stopping"],
      ["superseded", "superseded"],
    ]);
    if (marker !== undefined) r.forwardRecoveryRequired = marker;
    assert.deepEqual(classifyOfflineReleaseHistory([r]), {
      barrier: "control-intent-retained",
      effects: "forward-recovery-marker",
      releaseCount: 1,
    });
  }
});

test("release journal validation rejects missing prefixes, forged heads, impossible edges and terminal continuation", () => {
  const mutations: ((r: any) => void)[] = [
    (r) => {
      r.history.shift();
    },
    (r) => {
      r.revision++;
    },
    (r) => {
      r.state = "prepared";
    },
    (r) => {
      r.phase = "prepared";
    },
    (r) => {
      r.at++;
    },
    (r) => {
      r.history[1].at = 1;
    },
    (r) => {
      r.history[0].extra = "ignored?";
    },
    (r) => {
      r.history[0].state = "held";
    },
    (r) => {
      r.history[0].phase = "fencing";
    },
    (r) => {
      r.history[1].state = "failed";
    },
    (r) => {
      r.revision = Infinity;
    },
    (r) => {
      r.history[0].at = -0;
    },
    (r) => {
      r.history[0].at = Number.MAX_SAFE_INTEGER + 1;
    },
    (r) => {
      r.forwardRecoveryRequired = true;
    },
  ];
  for (const change of mutations) {
    const r = release([
      ["prepared", "prepared"],
      ["fencing", "fencing"],
    ]);
    change(r);
    assert.throws(() => classifyOfflineReleaseHistory([r]), refusal);
  }
  for (const points of [
    [
      ["prepared", "prepared"],
      ["released", "released"],
    ],
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["prepared", "prepared"],
    ],
    [
      ["prepared", "prepared"],
      ["superseded", "superseded"],
      ["stopping", "stopping"],
    ],
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["held", "fenced"],
    ],
    [
      ["prepared", "prepared"],
      ["fencing", "fencing"],
      ["fenced", "fenced"],
      ["routing", "routing"],
      ["released", "released"],
      ["held", "released"],
    ],
  ] as Parameters<typeof release>[0][])
    assert.throws(
      () => classifyOfflineReleaseHistory([release(points)]),
      refusal,
    );
  assert.throws(
    () =>
      classifyOfflineReleaseHistory([
        prepared(),
        { ...prepared(), id: "release-b" },
      ]),
    refusal,
  );
  assert.throws(
    () => classifyOfflineReleaseHistory([prepared(), prepared()]),
    refusal,
  );
});

test("a newly observed release can only invalidate an active session and remains in every later checkpoint", () => {
  const current = opened(),
    r = prepared();
  for (const op of [
    { kind: "record-task", receipt: receipt() },
    { kind: "drain" },
    { kind: "close" },
  ] as OfflinePhaseTransition[])
    assert.throws(() => advance(current, op, [r]), refusal);
  const invalidated = advance(
    current,
    { kind: "invalidate", reason: "release-observed" },
    [r],
  );
  assert.equal(invalidated.sessions[0]!.phase, "invalidated");
  assert.deepEqual(invalidated.releases, [r]);
  assert.throws(
    () => advance(invalidated, { kind: "isolate", sessionId: "session-b" }, []),
    {
      code: "RESTORE_OFFLINE_PHASE",
      message: "Release history was removed, replaced or regressed.",
    },
  );
  assert.throws(
    () =>
      advance(invalidated, { kind: "isolate", sessionId: "session-b" }, [r]),
    refusal,
  );
});

test("release prefix/binding/positive marker cannot be rewritten by newer observations", () => {
  const r = release([
    ["prepared", "prepared"],
    ["stopping", "stopping"],
    ["forward-held", "stopping"],
  ]);
  r.forwardRecoveryRequired = true;
  const current = withRelease(opened(), [r]);
  const cases = [
    [],
    [{ ...r, binding: h("replaced-binding") }],
    [{ ...r, forwardRecoveryRequired: false }],
    [prepared()],
  ];
  const revised = structuredClone(r);
  revised.history[0]!.at--;
  cases.push([revised]);
  for (const observation of cases)
    assert.throws(
      () =>
        advance(
          current,
          { kind: "invalidate", reason: "release-observed" },
          observation,
        ),
      refusal,
    );
  const final = release([
    ...r.history.map(
      (p) => [p.state, p.phase] as [typeof p.state, typeof p.phase],
    ),
    ["superseded", "superseded"],
  ]);
  final.forwardRecoveryRequired = true;
  const next = advance(
    current,
    { kind: "invalidate", reason: "release-observed" },
    [final],
  );
  assert.equal(
    classifyOfflineReleaseHistory(next.releases).barrier,
    "control-intent-retained",
  );
});

test("an older terminal control history cannot be hidden behind a newer prepared release", () => {
  const old = release(
    [
      ["prepared", "prepared"],
      ["stopping", "stopping"],
      ["returning", "returning"],
      ["rolled-back", "rolled-back"],
    ],
    "old-release",
  );
  const newer = prepared();
  assert.equal(
    classifyOfflineReleaseHistory([newer, old]).barrier,
    "control-intent-retained",
  );
  const value = withRelease(opened(), [old, newer]);
  assert.throws(
    () =>
      advance(value, { kind: "invalidate", reason: "release-observed" }, [
        newer,
      ]),
    refusal,
  );
});

test("stale copies and mismatched generation/revision/lineage cannot advance a current snapshot", () => {
  const old = opened(),
    expected = offlinePhaseExpectation(old),
    current = advance(old, { kind: "record-task", receipt: receipt() });
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(current, expected, { kind: "drain" }, []),
    refusal,
  );
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(
        old,
        offlinePhaseExpectation(current),
        { kind: "drain" },
        [],
      ),
    refusal,
  );
  for (const mutate of [
    (e: any) => {
      e.generationHash = h("wrong");
    },
    (e: any) => {
      e.stateHash = h("wrong");
    },
    (e: any) => {
      e.session.revision++;
    },
    (e: any) => {
      e.session.id = "other";
    },
    (e: any) => {
      e.session.lineageHash = h("wrong");
    },
    (e: any) => {
      e.session = null;
    },
    (e: any) => {
      e.verified = true;
    },
  ]) {
    const e = structuredClone(expected);
    mutate(e);
    assert.throws(
      () => evaluateOfflinePhaseTransition(old, e, { kind: "drain" }, []),
      refusal,
    );
  }
});

test("receipts cannot be appended outside open, replaced, replayed or reassigned across organizations", () => {
  let value = advance(opened(), { kind: "record-task", receipt: receipt() });
  const duplicateKey = {
    ...receipt(),
    binding: h("new-binding"),
    resultHash: h("other-result"),
  };
  for (const r of [
    receipt(),
    duplicateKey,
    { ...receipt("b"), binding: receipt().binding },
    receipt("b", "org-missing"),
  ])
    assert.throws(
      () => advance(value, { kind: "record-task", receipt: r }),
      refusal,
    );
  const bad = mutable(value);
  bad.sessions[0].history[2].receipt.resultHash = h("forged-result");
  assert.throws(() => validateOfflinePhaseState(bad), refusal);
  value = advance(value, { kind: "drain" });
  assert.throws(
    () => advance(value, { kind: "record-task", receipt: receipt("b") }),
    refusal,
  );
  value = advance(value, { kind: "close" });
  assert.throws(
    () => advance(value, { kind: "record-task", receipt: receipt("b") }),
    refusal,
  );
  value = advance(advance(value, { kind: "isolate", sessionId: "session-b" }), {
    kind: "open",
  });
  assert.throws(
    () => advance(value, { kind: "record-task", receipt: receipt() }),
    refusal,
  );
});

test("closed/invalidated sessions cannot reopen, and an active session cannot acquire a competing sibling", () => {
  for (const end of ["closed", "invalidated"] as const) {
    let value = opened();
    assert.throws(
      () => advance(value, { kind: "isolate", sessionId: "session-b" }),
      refusal,
    );
    value =
      end === "closed"
        ? advance(advance(value, { kind: "drain" }), { kind: "close" })
        : advance(value, { kind: "invalidate", reason: "authority-lost" });
    for (const op of [
      { kind: "open" },
      { kind: "close" },
      { kind: "invalidate", reason: "authority-lost" },
      { kind: "isolate", sessionId: "session-a" },
    ] as OfflinePhaseTransition[])
      assert.throws(() => advance(value, op), refusal);
    const next = advance(value, { kind: "isolate", sessionId: "session-b" });
    assert.equal(
      next.sessions[1]!.previousSessionHash,
      value.sessions[0]!.lineageHash,
    );
  }
});

test("malformed session head/history/revision/lineage and receipt structures fail closed", () => {
  const good = advance(opened(), { kind: "record-task", receipt: receipt() });
  const changes: ((s: any) => void)[] = [
    (s) => {
      s.sessions[0].revision++;
    },
    (s) => {
      s.sessions[0].revision = Number.MAX_SAFE_INTEGER + 1;
    },
    (s) => {
      s.sessions[0].history[1].revision = 1;
    },
    (s) => {
      s.sessions[0].history.shift();
    },
    (s) => {
      s.sessions[0].phase = "closed";
    },
    (s) => {
      s.sessions[0].previousSessionHash = h("lost-parent");
    },
    (s) => {
      s.sessions[0].history[0].receipt = receipt();
    },
    (s) => {
      s.sessions[0].history[1].reason = "authority-lost";
    },
    (s) => {
      s.sessions[0].history[2].receipt.extra = true;
    },
    (s) => {
      s.sessions[0].history[2].receipt.binding = "invalid";
    },
    (s) => {
      s.sessions[0].history[2].receipt.requestId = " alias";
    },
    (s) => {
      s.sessions[0].history[1].lineageHash = h("rewritten");
    },
    (s) => {
      s.sessions[0].history[2].previousHash = h("missing-parent");
    },
    (s) => {
      s.sessions[0].history[2].phase = "draining";
    },
    (s) => {
      s.sessions[0].history[2].kind = "grant-permit";
    },
    (s) => {
      s.sessions[0].extra = true;
    },
    (s) => {
      s.sessions.push(s.sessions[0]);
    },
    (s) => {
      s.extra = true;
    },
    (s) => {
      s.version = 2;
    },
  ];
  for (const change of changes) {
    const input = mutable(good);
    change(input);
    assert.throws(() => validateOfflinePhaseState(input), refusal);
  }
});

test("caller mutation cannot alter a proposal, imported receipt, release anchor or frozen expectation", () => {
  const input = mutable(opened()),
    e = structuredClone(offlinePhaseExpectation(input)),
    r = receipt();
  const proposal = evaluateOfflinePhaseTransition(
    input,
    e,
    { kind: "record-task", receipt: r },
    [],
  );
  const fingerprint = canonical(proposal);
  input.generation.organizations[0].id = "caller-change";
  input.sessions[0].history.length = 0;
  (e.session as { revision: number }).revision = 900;
  r.resultHash = h("caller-change");
  assert.equal(canonical(proposal), fingerprint);
  assert.throws(() => {
    (proposal.next.sessions[0]!.history[2]!.receipt as any).resultHash =
      h("mutate-frozen");
  }, TypeError);
  assert.throws(() => {
    (proposal.expectation.session as any).revision = 0;
  }, TypeError);
  const observed = prepared(),
    next = advance(
      opened(),
      { kind: "invalidate", reason: "release-observed" },
      [observed],
    );
  observed.history[0]!.at = 0;
  assert.equal(next.releases[0]!.history[0]!.at, 1000);
});

test("pure evaluation is deterministic and never samples a clock", (t) => {
  const input = opened(),
    expected = offlinePhaseExpectation(input),
    op = { kind: "record-task", receipt: receipt() };
  t.mock.method(Date, "now", () => {
    assert.fail("phase evaluation must not sample current time");
  });
  const first = evaluateOfflinePhaseTransition(input, expected, op, []);
  const second = evaluateOfflinePhaseTransition(input, expected, op, []);
  assert.deepEqual(first, second);
  assert.deepEqual(input, opened());
});

test("native approveRelease retries append prepared/prepared revisions before any control intent", () => {
  const approved = release([
    ["prepared", "prepared"],
    ["prepared", "prepared"],
    ["prepared", "prepared"],
  ]);
  assert.equal(
    classifyOfflineReleaseHistory([approved]).barrier,
    "prepared-release-retained",
  );
  const started = release([
    ...approved.history.map(
      (p) => [p.state, p.phase] as [typeof p.state, typeof p.phase],
    ),
    ["fencing", "fencing"],
    ["held", "fencing"],
    ["superseded", "superseded"],
  ]);
  assert.equal(
    classifyOfflineReleaseHistory([started]).barrier,
    "control-intent-retained",
  );
  const old = withRelease(opened(), [prepared()]);
  assert.deepEqual(
    advance(old, { kind: "invalidate", reason: "release-observed" }, [approved])
      .releases,
    [approved],
  );
});

// Rehash a proposed session independently to distinguish semantic refusal from
// merely catching a stale digest. This does not authenticate any proposal.
function rehashSession(input: any) {
  const generationHash = digest(
    canonical({
      purpose: "distributor-restore-offline-generation-v1",
      generation: input.generation,
    }),
  );
  let previousSessionHash: string | null = null;
  for (const session of input.sessions) {
    session.previousSessionHash = previousSessionHash;
    let previousHash = digest(
      canonical({
        purpose: "distributor-restore-offline-session-v1",
        generationHash,
        id: session.id,
        previousSessionHash,
      }),
    );
    for (const [i, entry] of session.history.entries()) {
      entry.revision = i + 1;
      entry.previousHash = previousHash;
      const { lineageHash: _old, ...step } = entry;
      entry.lineageHash = digest(
        canonical({
          purpose: "distributor-restore-offline-step-v1",
          generationHash,
          sessionId: session.id,
          ...step,
        }),
      );
      previousHash = entry.lineageHash;
    }
    session.revision = session.history.length;
    session.phase = session.history.at(-1).phase;
    session.lineageHash = previousHash;
    previousSessionHash = previousHash;
  }
  return input;
}

test("rehashing cannot turn impossible session transitions or duplicate receipts into valid lineage", () => {
  const good = advance(opened(), { kind: "record-task", receipt: receipt() });
  for (const mutate of [
    (s: any) => {
      s.sessions[0].history[1].kind = "close";
      s.sessions[0].history[1].phase = "closed";
    },
    (s: any) => {
      s.sessions[0].history[1].kind = "drain";
      s.sessions[0].history[1].phase = "draining";
    },
    (s: any) => {
      s.sessions[0].history.push(structuredClone(s.sessions[0].history[2]));
    },
    (s: any) => {
      s.sessions.push({ ...structuredClone(s.sessions[0]), id: "competing" });
    },
  ]) {
    const input = mutable(good);
    mutate(input);
    rehashSession(input);
    assert.throws(() => validateOfflinePhaseState(input), refusal);
  }
});

test("even self-consistent rewritten old receipts cannot match the trusted checkpoint expectation", () => {
  const current = advance(opened(), {
      kind: "record-task",
      receipt: receipt(),
    }),
    anchor = offlinePhaseExpectation(current);
  const altered = mutable(current);
  altered.sessions[0].history[2].receipt.resultHash = h(
    "rewritten-but-rehashed",
  );
  rehashSession(altered);
  // Shape/lineage is internally consistent. Fresh persisted state and CAS remain
  // the coordinator's obligation; a content hash alone is not authentication.
  assert.doesNotThrow(() => validateOfflinePhaseState(altered));
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(altered, anchor, { kind: "drain" }, []),
    refusal,
  );
  const truncated = mutable(current);
  truncated.sessions[0].history.pop();
  rehashSession(truncated);
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(truncated, anchor, { kind: "drain" }, []),
    refusal,
  );
});

test("changed generation rejects copied sessions and cannot be bypassed with an invalidation reason", () => {
  const old = opened(),
    changed = mutable(old);
  changed.generation.instanceId = h("new-independent-instance");
  assert.throws(() => validateOfflinePhaseState(changed), refusal);
  const fresh = validateOfflinePhaseState({
    version: 1,
    generation: changed.generation,
    releases: [],
    sessions: [],
  });
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(
        old,
        offlinePhaseExpectation(fresh),
        { kind: "invalidate", reason: "generation-changed" },
        [],
      ),
    refusal,
  );
  const invalidated = advance(old, {
    kind: "invalidate",
    reason: "generation-changed",
  });
  assert.equal(
    invalidated.sessions[0]!.history.at(-1)!.reason,
    "generation-changed",
  );
  assert.equal(invalidated.generation.instanceId, old.generation.instanceId);
});

test("limits and unsafe revisions refuse before any proposed state escapes", () => {
  const g = initial(),
    raw = mutable(g);
  raw.sessions = Array(1001).fill({});
  assert.throws(() => validateOfflinePhaseState(raw), refusal);
  assert.throws(
    () => classifyOfflineReleaseHistory(Array(1001).fill(prepared())),
    refusal,
  );
  const oversized = prepared();
  oversized.history = Array(10001).fill(oversized.history[0]);
  oversized.revision = 10001;
  assert.throws(() => classifyOfflineReleaseHistory([oversized]), refusal);
  for (const revision of [
    -1,
    -0,
    0,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const s = mutable(opened());
    s.sessions[0].revision = revision;
    assert.throws(() => validateOfflinePhaseState(s), refusal);
    const expected = structuredClone(offlinePhaseExpectation(opened()));
    (expected.session as { revision: number }).revision = revision;
    assert.throws(
      () =>
        evaluateOfflinePhaseTransition(
          opened(),
          expected,
          { kind: "drain" },
          [],
        ),
      refusal,
    );
  }
});

test("invalidation session lineage binds the exact retained release evidence, not only its reason", () => {
  const value = opened(),
    left = prepared(),
    right = { ...prepared(), binding: h("different-retained-binding") };
  const a = advance(value, { kind: "invalidate", reason: "release-observed" }, [
    left,
  ]);
  const b = advance(value, { kind: "invalidate", reason: "release-observed" }, [
    right,
  ]);
  assert.notEqual(a.sessions[0]!.lineageHash, b.sessions[0]!.lineageHash);
  const replaced = mutable(a);
  replaced.releases = [right];
  assert.throws(() => validateOfflinePhaseState(replaced), refusal);
});

test("normal and revoked Proxies refuse at every phase data boundary without executing caller traps", () => {
  const cases: {
    name: string;
    target: object;
    invoke: (proxy: unknown) => unknown;
  }[] = [
    {
      name: "generation root",
      target: generation(),
      invoke: (p) => parseOfflineRecoveryGeneration(p),
    },
    {
      name: "organization array",
      target: generation().organizations,
      invoke: (p) =>
        parseOfflineRecoveryGeneration({ ...generation(), organizations: p }),
    },
    {
      name: "organization record",
      target: generation().organizations[0]!,
      invoke: (p) =>
        parseOfflineRecoveryGeneration({ ...generation(), organizations: [p] }),
    },
    {
      name: "state root",
      target: mutable(opened()),
      invoke: (p) => validateOfflinePhaseState(p),
    },
    {
      name: "nested generation",
      target: generation(),
      invoke: (p) =>
        validateOfflinePhaseState({ ...mutable(opened()), generation: p }),
    },
    {
      name: "sessions array",
      target: mutable(opened()).sessions,
      invoke: (p) =>
        validateOfflinePhaseState({ ...mutable(opened()), sessions: p }),
    },
    {
      name: "session record",
      target: mutable(opened()).sessions[0],
      invoke: (p) =>
        validateOfflinePhaseState({ ...mutable(opened()), sessions: [p] }),
    },
    {
      name: "session history",
      target: mutable(opened()).sessions[0].history,
      invoke: (p) => {
        const s = mutable(opened());
        s.sessions[0].history = p;
        return validateOfflinePhaseState(s);
      },
    },
    {
      name: "session step",
      target: mutable(opened()).sessions[0].history[0],
      invoke: (p) => {
        const s = mutable(opened());
        s.sessions[0].history[0] = p;
        return validateOfflinePhaseState(s);
      },
    },
    {
      name: "release array",
      target: [prepared()],
      invoke: (p) => classifyOfflineReleaseHistory(p),
    },
    {
      name: "release record",
      target: prepared(),
      invoke: (p) => classifyOfflineReleaseHistory([p]),
    },
    {
      name: "release history",
      target: prepared().history,
      invoke: (p) =>
        classifyOfflineReleaseHistory([{ ...prepared(), history: p }]),
    },
    {
      name: "release step",
      target: prepared().history[0]!,
      invoke: (p) =>
        classifyOfflineReleaseHistory([{ ...prepared(), history: [p] }]),
    },
    {
      name: "expectation root",
      target: structuredClone(offlinePhaseExpectation(opened())),
      invoke: (p) =>
        evaluateOfflinePhaseTransition(opened(), p, { kind: "drain" }, []),
    },
    {
      name: "expectation session",
      target: structuredClone(offlinePhaseExpectation(opened()).session!),
      invoke: (p) =>
        evaluateOfflinePhaseTransition(
          opened(),
          { ...offlinePhaseExpectation(opened()), session: p },
          { kind: "drain" },
          [],
        ),
    },
    {
      name: "transition root",
      target: { kind: "drain" },
      invoke: (p) =>
        evaluateOfflinePhaseTransition(
          opened(),
          offlinePhaseExpectation(opened()),
          p,
          [],
        ),
    },
    {
      name: "task receipt",
      target: receipt(),
      invoke: (p) =>
        evaluateOfflinePhaseTransition(
          opened(),
          offlinePhaseExpectation(opened()),
          { kind: "record-task", receipt: p },
          [],
        ),
    },
    {
      name: "retained task receipt",
      target: receipt(),
      invoke: (p) => {
        const s = mutable(
          advance(opened(), { kind: "record-task", receipt: receipt() }),
        );
        s.sessions[0].history[2].receipt = p;
        return validateOfflinePhaseState(s);
      },
    },
    {
      name: "observed release array",
      target: [],
      invoke: (p) =>
        evaluateOfflinePhaseTransition(
          opened(),
          offlinePhaseExpectation(opened()),
          { kind: "drain" },
          p,
        ),
    },
  ];
  for (const example of cases)
    for (const revoked of [false, true]) {
      let traps = 0,
        caught: unknown;
      const wrapped = Proxy.revocable(example.target, {
        getPrototypeOf(target) {
          traps++;
          return Reflect.getPrototypeOf(target);
        },
        get(target, key, receiver) {
          traps++;
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          traps++;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          traps++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      if (revoked) wrapped.revoke();
      try {
        example.invoke(wrapped.proxy);
      } catch (error) {
        caught = error;
      }
      assert.equal(
        traps,
        0,
        `${example.name}, revoked=${revoked}: caller trap executed`,
      );
      assert.equal(
        (caught as { code?: string } | undefined)?.code,
        "RESTORE_OFFLINE_PHASE",
        `${example.name}, revoked=${revoked}: expected deliberate data refusal`,
      );
    }
});
