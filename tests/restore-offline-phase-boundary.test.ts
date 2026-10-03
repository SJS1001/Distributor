import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, digest } from "../src/server/core.ts";
import {
  classifyOfflineReleaseHistory,
  evaluateOfflinePhaseTransition,
  offlinePhaseExpectation,
  validateOfflinePhaseState,
  type OfflinePhaseState,
  type OfflinePhaseTransition,
  type OfflineReleaseHistory,
  type OfflineTaskReceipt,
} from "../src/server/restore-offline-phase.ts";
const refusal = { code: "RESTORE_OFFLINE_PHASE" };
const h = (s: string) =>
  digest(canonical({ fixture: "phase-boundary", label: s }));
function initial() {
  return validateOfflinePhaseState({
    version: 1,
    generation: {
      version: 1,
      instanceId: h("instance"),
      snapshotHash: h("snapshot"),
      restoredAt: "2026-10-03T12:00:00.000Z",
      sourceCompletedAt: "2026-10-03T11:00:00.000Z",
      schemaVersion: 17,
      schemaHash: h("schema"),
      region: "CA",
      organizations: [{ id: "org-a", currency: "USD" }],
    },
    releases: [],
    sessions: [],
  });
}
function advance(s: OfflinePhaseState, op: OfflinePhaseTransition) {
  return evaluateOfflinePhaseTransition(s, offlinePhaseExpectation(s), op, [])
    .next;
}
function opened() {
  return advance(advance(initial(), { kind: "isolate", sessionId: "one" }), {
    kind: "open",
  });
}
function receipt(label = "one"): OfflineTaskReceipt {
  return {
    owner: "synthetic-owner",
    orgId: "org-a",
    taskName: "synthetic.reconcile",
    requestId: `request-${label}`,
    binding: h(`binding-${label}`),
    payloadHash: h(`payload-${label}`),
    beforeCandidateHash: h(`candidate-${label}`),
    resultHash: h(`result-${label}`),
  };
}
function release(
  points: [OfflineReleaseHistory["state"], OfflineReleaseHistory["phase"]][],
  marker?: boolean,
): OfflineReleaseHistory {
  const history = points.map(([state, phase]) => ({ state, phase, at: 1000 }));
  return {
    id: "release-one",
    binding: h("release-one"),
    revision: history.length,
    ...history.at(-1)!,
    history,
    ...(marker === undefined ? {} : { forwardRecoveryRequired: marker }),
  };
}
const prepared = () => release([["prepared", "prepared"]]);
const clone = (s: OfflinePhaseState): any => structuredClone(s);
const releaseHash = (releases: unknown) =>
  digest(
    canonical({ purpose: "distributor-restore-offline-releases-v1", releases }),
  );
// Independent public-data rehashing distinguishes semantic checks from stale
// digest checks. It never authenticates a supplied history.
function rehash(s: any) {
  const generationHash = digest(
    canonical({
      purpose: "distributor-restore-offline-generation-v1",
      generation: s.generation,
    }),
  );
  let previousSessionHash: string | null = null;
  for (const session of s.sessions) {
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
  return s;
}
// Native rollback() immediately returns for true, or legacy forward-held with
// no explicit false. Keep these RED expectations for root's production repair.
for (const marker of [true, undefined])
  for (const stoppedAt of ["stopping", "returning"] as const) {
    test(`native forward hold cannot resume to rolled-back: marker=${String(marker)}, phase=${stoppedAt}`, () => {
      const points: Parameters<typeof release>[0] = [
        ["prepared", "prepared"],
        ["stopping", "stopping"],
      ];
      if (stoppedAt === "returning") points.push(["returning", "returning"]);
      points.push(["forward-held", stoppedAt]);
      if (stoppedAt === "stopping") points.push(["returning", "returning"]);
      points.push(["rolled-back", "rolled-back"]);
      assert.throws(
        () => classifyOfflineReleaseHistory([release(points, marker)]),
        refusal,
      );
    });
  }
test("native held entries cannot advance the retained control timestamp", () => {
  const r = release([
    ["prepared", "prepared"],
    ["fencing", "fencing"],
    ["held", "fencing"],
  ]);
  assert.equal(
    classifyOfflineReleaseHistory([r]).barrier,
    "control-intent-retained",
  );
  r.history[2]!.at = r.at = 1001;
  // hold() uses current.at, without sampling the clock. Head and prefix agree.
  assert.throws(() => classifyOfflineReleaseHistory([r]), refusal);
});
test("explicit false interrupted controls resume while positive holds may be superseded", () => {
  for (const phase of ["stopping", "returning"] as const) {
    const points: Parameters<typeof release>[0] = [
      ["prepared", "prepared"],
      ["stopping", "stopping"],
    ];
    if (phase === "returning") points.push(["returning", "returning"]);
    points.push(["forward-held", phase]);
    for (const marker of [true, false, undefined])
      assert.deepEqual(
        classifyOfflineReleaseHistory([
          release([...points, ["superseded", "superseded"]], marker),
        ]),
        {
          barrier: "control-intent-retained",
          effects: "forward-recovery-marker",
          releaseCount: 1,
        },
      );
    if (phase === "stopping") points.push(["returning", "returning"]);
    points.push(["rolled-back", "rolled-back"]);
    assert.equal(
      classifyOfflineReleaseHistory([release(points, false)]).barrier,
      "control-intent-retained",
    );
  }
});
test("every release revision is bound, including repeated approvals and equal-time holds", () => {
  const r = release([
    ["prepared", "prepared"],
    ["prepared", "prepared"],
    ["fencing", "fencing"],
    ["held", "fencing"],
    ["held", "fencing"],
    ["superseded", "superseded"],
  ]);
  const s = opened();
  const invalidated = evaluateOfflinePhaseTransition(
    s,
    offlinePhaseExpectation(s),
    { kind: "invalidate", reason: "release-observed" },
    [r],
  ).next;
  assert.equal(
    invalidated.sessions[0]!.history.at(-1)!.releaseHistoryHash,
    releaseHash([r]),
  );
  for (let i = 0; i < r.history.length; i++) {
    const changed = structuredClone(r);
    for (let j = i; j < changed.history.length; j++) changed.history[j]!.at++;
    changed.at = changed.history.at(-1)!.at;
    const copy = clone(invalidated);
    copy.releases = [changed];
    assert.throws(
      () => validateOfflinePhaseState(copy),
      refusal,
      `revision ${i + 1}`,
    );
  }
});
test("self-consistent terminal continuation refuses for both native terminal phases", () => {
  for (const terminal of ["rolled-back", "superseded"] as const) {
    const points: Parameters<typeof release>[0] =
      terminal === "rolled-back"
        ? [
            ["prepared", "prepared"],
            ["stopping", "stopping"],
            ["returning", "returning"],
            [terminal, terminal],
          ]
        : [
            ["prepared", "prepared"],
            [terminal, terminal],
          ];
    for (const tail of [
      [terminal, terminal],
      ["superseded", "superseded"],
      ["forward-held", terminal],
    ] as Parameters<typeof release>[0])
      assert.throws(
        () => classifyOfflineReleaseHistory([release([...points, tail])]),
        refusal,
      );
  }
});
test("self-consistent copies cannot transplant release anchors into earlier ordinary revisions", () => {
  const s = opened(),
    r = prepared();
  const done = evaluateOfflinePhaseTransition(
    s,
    offlinePhaseExpectation(s),
    { kind: "invalidate", reason: "release-observed" },
    [r],
  ).next;
  for (const revision of [0, 1]) {
    const copy = clone(done);
    copy.sessions[0].history[revision].releaseHistoryHash = releaseHash([r]);
    rehash(copy);
    assert.throws(() => validateOfflinePhaseState(copy), refusal);
  }
  const changed = clone(s);
  changed.generation.instanceId = h("other-generation");
  rehash(changed);
  assert.doesNotThrow(() => validateOfflinePhaseState(changed));
  assert.throws(
    () =>
      evaluateOfflinePhaseTransition(
        changed,
        offlinePhaseExpectation(s),
        { kind: "drain" },
        [],
      ),
    refusal,
  );
});
test("consumed bindings stay global across sessions, organizations, owners and tasks", () => {
  let s = advance(opened(), { kind: "record-task", receipt: receipt() });
  s = advance(advance(s, { kind: "drain" }), { kind: "close" });
  s = advance(advance(s, { kind: "isolate", sessionId: "two" }), {
    kind: "open",
  });
  for (const change of [
    { requestId: "other-request" },
    { owner: "other-owner" },
    { taskName: "other.task" },
  ])
    assert.throws(
      () =>
        advance(s, {
          kind: "record-task",
          receipt: { ...receipt(), ...change },
        }),
      refusal,
    );
  const raw = clone(s);
  raw.generation.organizations.push({ id: "org-b", currency: "CAD" });
  rehash(raw);
  assert.throws(
    () =>
      advance(validateOfflinePhaseState(raw), {
        kind: "record-task",
        receipt: { ...receipt(), orgId: "org-b" },
      }),
    refusal,
  );
  // Published common contract's permanent key includes sessionId. Do not invent
  // a broader global request-string policy; consumed binding remains global.
  const distinct = { ...receipt("new"), requestId: receipt().requestId };
  assert.equal(
    advance(s, { kind: "record-task", receipt: distinct }).sessions[1]!
      .revision,
    3,
  );
});
test("Unicode, delimiters and prototype-looking identity values remain exact and distinct", () => {
  const ids = [
    "é",
    "e\u0301",
    "\ud800",
    "\ud801",
    "__proto__",
    "constructor",
    "a|b",
    'a","b',
  ];
  const hashes = new Set<string>();
  for (const id of ids) {
    const raw = clone(initial());
    raw.generation.organizations[0].id = id;
    const state = validateOfflinePhaseState(raw);
    assert.equal(state.generation.organizations[0]!.id, id);
    hashes.add(offlinePhaseExpectation(state).generationHash);
  }
  assert.equal(hashes.size, ids.length);
  let s = opened();
  for (const id of ids)
    s = advance(s, {
      kind: "record-task",
      receipt: { ...receipt(id), requestId: id },
    });
  assert.equal(
    s.sessions[0]!.history.filter((p) => p.receipt).length,
    ids.length,
  );
  for (const id of ["\u00a0alias", "alias\u2003", "alias\n"])
    assert.throws(
      () =>
        advance(opened(), {
          kind: "record-task",
          receipt: { ...receipt(), requestId: id },
        }),
      refusal,
    );
});
test("primitive-position normal and revoked proxies execute no coercion or reflection traps", () => {
  const s = clone(
    advance(opened(), { kind: "record-task", receipt: receipt() }),
  );
  const paths = [
    ["version"],
    ["generation", "schemaVersion"],
    ["generation", "region"],
    ["generation", "organizations", 0, "id"],
    ["sessions", 0, "revision"],
    ["sessions", 0, "phase"],
    ["sessions", 0, "previousSessionHash"],
    ["sessions", 0, "lineageHash"],
    ...[
      "revision",
      "kind",
      "phase",
      "reason",
      "previousHash",
      "releaseHistoryHash",
      "lineageHash",
    ].map((k) => ["sessions", 0, "history", 0, k]),
    ...Object.keys(receipt()).map((k) => [
      "sessions",
      0,
      "history",
      2,
      "receipt",
      k,
    ]),
  ];
  let traps = 0;
  const trap = () => {
    traps++;
    throw new Error("caller trap executed");
  };
  for (const revoked of [false, true]) {
    for (const path of paths) {
      const { proxy, revoke } = Proxy.revocable(
        {},
        {
          get: trap,
          getPrototypeOf: trap,
          ownKeys: trap,
          getOwnPropertyDescriptor: trap,
        },
      );
      if (revoked) revoke();
      const input = structuredClone(s);
      let target = input;
      for (const key of path.slice(0, -1)) target = target[key!];
      target[path.at(-1)!] = proxy;
      assert.throws(
        () => validateOfflinePhaseState(input),
        refusal,
        path.join("."),
      );
      assert.equal(traps, 0, path.join("."));
    }
    for (const key of ["state", "phase", "at"]) {
      const { proxy, revoke } = Proxy.revocable(
        {},
        {
          get: trap,
          getPrototypeOf: trap,
          ownKeys: trap,
          getOwnPropertyDescriptor: trap,
        },
      );
      if (revoked) revoke();
      const r = prepared();
      Object.assign(r.history[0]!, { [key]: proxy });
      assert.throws(() => classifyOfflineReleaseHistory([r]), refusal);
      assert.equal(traps, 0);
    }
  }
});
test("nested accessors and hidden prototype or symbol keys refuse without getter execution", () => {
  const source = clone(
    advance(opened(), { kind: "record-task", receipt: receipt() }),
  );
  let calls = 0;
  for (const path of [
    ["generation", "organizations", 0],
    ["sessions", 0, "history", 2, "receipt"],
  ]) {
    for (const kind of ["getter", "symbol", "prototype", "hidden"]) {
      const raw = structuredClone(source);
      let target = raw;
      for (const key of path) target = target[key];
      if (kind === "getter")
        Object.defineProperty(target, Object.keys(target)[0]!, {
          enumerable: true,
          get() {
            calls++;
            return "forged";
          },
        });
      if (kind === "symbol") target[Symbol("extra")] = true;
      if (kind === "prototype")
        Object.setPrototypeOf(target, { inherited: true });
      if (kind === "hidden")
        Object.defineProperty(target, "hidden", { value: true });
      assert.throws(() => validateOfflinePhaseState(raw), refusal);
      assert.equal(calls, 0);
    }
  }
});
test("exact aggregate release limit accepts 10000 revisions and refuses 10001 across records", () => {
  const records = Array.from({ length: 1000 }, (_, i) => {
    const points: Parameters<typeof release>[0] = Array.from(
      { length: 9 },
      () => ["prepared", "prepared"],
    );
    points.push(["superseded", "superseded"]);
    const r = release(points);
    r.id = `release-${String(i).padStart(4, "0")}`;
    r.binding = h(r.id);
    return r;
  });
  assert.equal(classifyOfflineReleaseHistory(records).releaseCount, 1000);
  records[999]!.history.splice(1, 0, {
    state: "prepared",
    phase: "prepared",
    at: 1000,
  });
  records[999]!.revision++;
  assert.throws(() => classifyOfflineReleaseHistory(records), refusal);
});
test("aggregate session bound and oversized sparse arrays refuse before traversing supplied members", () => {
  const raw = clone(
    advance(opened(), { kind: "record-task", receipt: receipt() }),
  );
  const template = raw.sessions[0].history[2];
  raw.sessions[0].history = raw.sessions[0].history.slice(0, 2);
  for (let i = 0; i < 9998; i++)
    raw.sessions[0].history.push({ ...template, receipt: receipt(String(i)) });
  rehash(raw);
  const full = validateOfflinePhaseState(raw);
  assert.equal(full.sessions[0]!.revision, 10000);
  assert.throws(() => advance(full, { kind: "drain" }), refusal);
  let calls = 0;
  const huge = new Array(0xffffffff);
  Object.defineProperty(huge, "0", {
    enumerable: true,
    get() {
      calls++;
      throw new Error("reject length first");
    },
  });
  assert.throws(() => classifyOfflineReleaseHistory(huge), refusal);
  assert.throws(
    () => validateOfflinePhaseState({ ...initial(), sessions: huge }),
    refusal,
  );
  assert.equal(calls, 0);
});
