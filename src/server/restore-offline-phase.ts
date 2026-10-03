import { types } from "node:util";
import { canonical, check, digest } from "./core.ts";
import type { RestoreRelease } from "./restore-activation.ts";

// Pure data brands distinguish validated shapes, never capabilities/authority.
declare const generationBrand: unique symbol;
declare const phaseBrand: unique symbol;
type GenerationData = {
  version: 1;
  instanceId: string;
  snapshotHash: string;
  restoredAt: string;
  sourceCompletedAt: string;
  schemaVersion: number;
  schemaHash: string;
  region: "CA" | "US";
  organizations: { id: string; currency: "CAD" | "USD" }[];
};
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
export type OfflineRecoveryGeneration = Frozen<GenerationData> & {
  readonly [generationBrand]: "data-only";
};
export type OfflineReleaseHistory = Pick<
  RestoreRelease,
  | "id"
  | "binding"
  | "revision"
  | "state"
  | "phase"
  | "at"
  | "history"
  | "forwardRecoveryRequired"
>;
export type OfflineTaskReceipt = {
  owner: string;
  orgId: string;
  taskName: string;
  requestId: string;
  binding: string;
  payloadHash: string;
  beforeCandidateHash: string;
  resultHash: string;
};
type Phase = "isolated" | "open" | "draining" | "closed" | "invalidated";
type Reason =
  | "generation-changed"
  | "authority-lost"
  | "evidence-changed"
  | "operator-abandoned"
  | "release-observed";
export type OfflinePhaseTransition =
  | { kind: "isolate"; sessionId: string }
  | { kind: "open" | "drain" | "close" }
  | { kind: "record-task"; receipt: OfflineTaskReceipt }
  | { kind: "invalidate"; reason: Reason };
type Step = {
  revision: number;
  kind: OfflinePhaseTransition["kind"];
  phase: Phase;
  receipt: OfflineTaskReceipt | null;
  reason: Reason | null;
  previousHash: string;
  releaseHistoryHash: string;
  lineageHash: string;
};
type Session = {
  id: string;
  revision: number;
  phase: Phase;
  previousSessionHash: string | null;
  lineageHash: string;
  history: Step[];
};
type StateData = {
  version: 1;
  generation: GenerationData;
  releases: OfflineReleaseHistory[];
  sessions: Session[];
};
export type OfflinePhaseState = Frozen<StateData> & {
  readonly [phaseBrand]: "data-only";
};
export type OfflinePhaseExpectation = {
  generationHash: string;
  stateHash: string;
  session: { id: string; revision: number; lineageHash: string } | null;
};
const maxItems = 1000,
  maxHistory = 10000;
function requirePhase(value: unknown, message: string): asserts value {
  check(value, "RESTORE_OFFLINE_PHASE", message);
}
function record(
  value: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  requirePhase(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    "Use plain offline phase data records.",
  );
  const fields = Object.getOwnPropertyDescriptors(value);
  requirePhase(
    Reflect.ownKeys(value).length <= keys.length + optional.length &&
      keys.every((key) => Object.hasOwn(fields, key)) &&
      Object.entries(fields).every(
        ([key, d]) =>
          (keys.includes(key) || optional.includes(key)) &&
          "value" in d &&
          d.enumerable,
      ),
    "Unsupported or missing offline phase fields.",
  );
  requirePhase(
    Reflect.ownKeys(value).length === Object.keys(fields).length,
    "Symbol fields are unsupported.",
  );
}
function list(value: unknown, limit: number): asserts value is unknown[] {
  requirePhase(
    !types.isProxy(value) &&
      Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length <= limit &&
      Reflect.ownKeys(value).length === value.length + 1 &&
      Object.entries(Object.getOwnPropertyDescriptors(value)).every(
        ([key, d]) =>
          key === "length" ||
          (/^(0|[1-9][0-9]*)$/.test(key) &&
            Number(key) < value.length &&
            "value" in d &&
            d.enumerable),
      ),
    "Use bounded dense offline phase arrays.",
  );
}
function exactText(value: unknown): asserts value is string {
  requirePhase(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      value.trim() === value &&
      !/[\u0000-\u001f\u007f]/.test(value),
    "Use exact bounded offline identities.",
  );
}
function hash(value: unknown): asserts value is string {
  requirePhase(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "Use lowercase SHA256 bindings.",
  );
}
function integer(value: unknown, minimum: number): asserts value is number {
  requirePhase(
    Number.isSafeInteger(value) &&
      Number(value) >= minimum &&
      !Object.is(value, -0),
    "Use monotonic safe integer revisions and times.",
  );
}
function instant(value: unknown): asserts value is string {
  requirePhase(
    typeof value === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "Use exact UTC recovery timestamps.",
  );
}
function freeze<T>(value: T): Frozen<T> {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}
function generation(value: unknown): GenerationData {
  record(value, [
    "version",
    "instanceId",
    "snapshotHash",
    "restoredAt",
    "sourceCompletedAt",
    "schemaVersion",
    "schemaHash",
    "region",
    "organizations",
  ]);
  requirePhase(value.version === 1, "Unsupported recovery generation version.");
  hash(value.instanceId);
  hash(value.snapshotHash);
  hash(value.schemaHash);
  instant(value.restoredAt);
  instant(value.sourceCompletedAt);
  integer(value.schemaVersion, 1);
  requirePhase(
    value.sourceCompletedAt <= value.restoredAt,
    "Source completion must not follow restoration.",
  );
  requirePhase(
    value.region === "CA" || value.region === "US",
    "Unsupported recovery region.",
  );
  list(value.organizations, maxItems);
  requirePhase(
    value.organizations.length > 0,
    "Recovery requires the complete nonempty organization set.",
  );
  let previous = "";
  const organizations: GenerationData["organizations"] =
    value.organizations.map((org) => {
      record(org, ["id", "currency"]);
      exactText(org.id);
      requirePhase(
        org.id > previous && (org.currency === "CAD" || org.currency === "USD"),
        "Use a unique sorted organization/currency set.",
      );
      previous = org.id;
      return { id: org.id, currency: org.currency as "CAD" | "USD" };
    });
  return {
    version: 1,
    instanceId: value.instanceId,
    snapshotHash: value.snapshotHash,
    restoredAt: value.restoredAt,
    sourceCompletedAt: value.sourceCompletedAt,
    schemaVersion: value.schemaVersion,
    schemaHash: value.schemaHash,
    region: value.region,
    organizations,
  };
}
export function parseOfflineRecoveryGeneration(
  value: unknown,
): OfflineRecoveryGeneration {
  return freeze(generation(value)) as OfflineRecoveryGeneration;
}
function generationHash(value: GenerationData) {
  return digest(
    canonical({
      purpose: "distributor-restore-offline-generation-v1",
      generation: value,
    }),
  );
}

const releasePhases = [
  "prepared",
  "fencing",
  "fenced",
  "routing",
  "released",
  "stopping",
  "returning",
  "rolled-back",
  "superseded",
] as const;
const terminalRelease = (phase: string) =>
  phase === "rolled-back" || phase === "superseded";
function releasePoint(value: unknown): RestoreRelease["history"][number] {
  record(value, ["state", "phase", "at"]);
  requirePhase(
    releasePhases.includes(value.phase as (typeof releasePhases)[number]) &&
      (value.state === value.phase ||
        value.state === "held" ||
        value.state === "forward-held"),
    "Unsupported release state or phase.",
  );
  requirePhase(
    !terminalRelease(String(value.phase)) || value.state === value.phase,
    "Terminal release phase cannot be held.",
  );
  integer(value.at, 0);
  return {
    state: value.state as RestoreRelease["state"],
    phase: value.phase as RestoreRelease["phase"],
    at: value.at,
  };
}
function validReleaseEdge(
  a: RestoreRelease["history"][number],
  b: RestoreRelease["history"][number],
) {
  if (terminalRelease(a.phase) || b.at < a.at) return false;
  // isolate() may supersede ANY unresolved phase, including prepared. It does
  // not erase the earlier control intent or prove any external isolation.
  if (b.state === "superseded") return true;
  // approveRelease() and its exact retries append prepared revisions.
  if (a.state === "prepared" && b.state === "prepared") return true;
  if (b.state === "held")
    return (
      a.state !== "forward-held" &&
      b.at === a.at &&
      b.phase === a.phase &&
      ["prepared", "fencing", "fenced", "routing"].includes(a.phase)
    );
  if (b.state === "forward-held") return b.phase === a.phase;
  if (b.phase === "stopping")
    return !["stopping", "returning"].includes(a.phase);
  if (a.phase === "stopping") return b.phase === "returning";
  if (a.phase === "returning") return b.phase === "rolled-back";
  if (a.state === "forward-held") return false;
  return (
    (
      {
        prepared: "fencing",
        fencing: "fenced",
        fenced: "routing",
        routing: "released",
      } as Record<string, string>
    )[a.phase] === b.phase
  );
}
function releases(value: unknown): OfflineReleaseHistory[] {
  list(value, maxItems);
  let entries = 0,
    unresolved = 0;
  const ids = new Set<string>();
  return value
    .map((item) => {
      record(
        item,
        ["id", "binding", "revision", "state", "phase", "at", "history"],
        ["forwardRecoveryRequired"],
      );
      exactText(item.id);
      hash(item.binding);
      integer(item.revision, 1);
      requirePhase(!ids.has(item.id), "Release identities must be unique.");
      ids.add(item.id);
      const point = releasePoint({
        state: item.state,
        phase: item.phase,
        at: item.at,
      });
      list(item.history, maxHistory);
      entries += item.history.length;
      requirePhase(
        entries <= maxHistory && item.history.length === item.revision,
        "Supply complete bounded release history for every revision.",
      );
      const history = item.history.map(releasePoint);
      requirePhase(
        history[0]?.state === "prepared" && history[0]?.phase === "prepared",
        "Release history must begin prepared.",
      );
      for (let i = 1; i < history.length; i++)
        requirePhase(
          validReleaseEdge(history[i - 1]!, history[i]!),
          "Impossible release history transition.",
        );
      requirePhase(
        canonical(history.at(-1)) === canonical(point),
        "Release head disagrees with retained history.",
      );
      if (!terminalRelease(point.phase)) unresolved++;
      requirePhase(
        unresolved <= 1,
        "Competing unresolved releases are unsupported.",
      );
      if (Object.hasOwn(item, "forwardRecoveryRequired"))
        requirePhase(
          typeof item.forwardRecoveryRequired === "boolean" &&
            history.some((p) => p.state === "forward-held"),
          "Invalid forward recovery marker.",
        );
      // The projection retains only the final marker. Earlier false holds can
      // resume and later acquire a positive marker, so inspect the last hold.
      // Positive and conservative legacy holds cannot resume native rollback;
      // supersession still retains the old control intent.
      const lastForward = history.findLastIndex(
        (p) => p.state === "forward-held",
      );
      if (lastForward >= 0 && item.forwardRecoveryRequired !== false)
        requirePhase(
          history.slice(lastForward + 1).every((p) => p.state === "superseded"),
          "Forward recovery hold cannot resume rollback without an explicit false marker.",
        );
      return {
        id: item.id,
        binding: item.binding,
        revision: item.revision,
        ...point,
        history,
        ...(Object.hasOwn(item, "forwardRecoveryRequired")
          ? { forwardRecoveryRequired: item.forwardRecoveryRequired as boolean }
          : {}),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function classification(records: OfflineReleaseHistory[]) {
  const intent = records.some((r) =>
    r.history.some((p) => p.phase !== "prepared" && p.phase !== "superseded"),
  );
  return freeze({
    barrier: intent
      ? ("control-intent-retained" as const)
      : records.length
        ? ("prepared-release-retained" as const)
        : ("no-recorded-release" as const),
    effects: records.some((r) =>
      r.history.some((p) => p.state === "forward-held"),
    )
      ? ("forward-recovery-marker" as const)
      : ("not-established" as const),
    releaseCount: records.length,
  });
}
/** Classification only: a recorded intent is not proof of a completed effect. */
export function classifyOfflineReleaseHistory(value: unknown) {
  return classification(releases(value));
}
function monotonicReleases(
  before: OfflineReleaseHistory[],
  after: OfflineReleaseHistory[],
) {
  for (const old of before) {
    const next = after.find((r) => r.id === old.id);
    requirePhase(
      next &&
        next.binding === old.binding &&
        next.revision >= old.revision &&
        canonical(next.history.slice(0, old.history.length)) ===
          canonical(old.history) &&
        (old.forwardRecoveryRequired !== true ||
          next.forwardRecoveryRequired === true) &&
        (next.revision !== old.revision || canonical(next) === canonical(old)),
      "Release history was removed, replaced or regressed.",
    );
  }
}
function receipt(value: unknown, orgs: Set<string>): OfflineTaskReceipt {
  record(value, [
    "owner",
    "orgId",
    "taskName",
    "requestId",
    "binding",
    "payloadHash",
    "beforeCandidateHash",
    "resultHash",
  ]);
  for (const key of ["owner", "orgId", "taskName", "requestId"])
    exactText(value[key]);
  for (const key of [
    "binding",
    "payloadHash",
    "beforeCandidateHash",
    "resultHash",
  ])
    hash(value[key]);
  requirePhase(
    orgs.has(String(value.orgId)),
    "Receipt organization is outside the generation.",
  );
  return { ...value } as OfflineTaskReceipt;
}
function transition(value: unknown, orgs: Set<string>): OfflinePhaseTransition {
  // Read only a data descriptor to choose the exact discriminated shape.
  requirePhase(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    "Use a plain phase transition.",
  );
  const kind = Object.getOwnPropertyDescriptor(value, "kind")?.value;
  const keys =
    kind === "isolate"
      ? ["kind", "sessionId"]
      : kind === "record-task"
        ? ["kind", "receipt"]
        : kind === "invalidate"
          ? ["kind", "reason"]
          : ["kind"];
  record(value, keys);
  switch (value.kind) {
    case "isolate":
      exactText(value.sessionId);
      return { kind: "isolate", sessionId: value.sessionId };
    case "open":
    case "drain":
    case "close":
      return { kind: value.kind };
    case "record-task":
      return { kind: "record-task", receipt: receipt(value.receipt, orgs) };
    case "invalidate":
      requirePhase(
        [
          "generation-changed",
          "authority-lost",
          "evidence-changed",
          "operator-abandoned",
          "release-observed",
        ].includes(typeof value.reason === "string" ? value.reason : ""),
        "Unsupported invalidation reason.",
      );
      return { kind: "invalidate", reason: value.reason as Reason };
    default:
      requirePhase(false, "Unsupported offline transition.");
  }
}
function nextPhase(
  previous: Phase | null,
  kind: OfflinePhaseTransition["kind"],
): Phase {
  if (previous === null && kind === "isolate") return "isolated";
  if (previous === "isolated" && kind === "open") return "open";
  if (previous === "open" && kind === "record-task") return "open";
  if (previous === "open" && kind === "drain") return "draining";
  if (previous === "draining" && kind === "close") return "closed";
  if (
    previous !== null &&
    previous !== "closed" &&
    previous !== "invalidated" &&
    kind === "invalidate"
  )
    return "invalidated";
  requirePhase(false, "Offline session transition is not applicable.");
}
function seed(
  generationHash: string,
  id: string,
  previousSessionHash: string | null,
) {
  return digest(
    canonical({
      purpose: "distributor-restore-offline-session-v1",
      generationHash,
      id,
      previousSessionHash,
    }),
  );
}
function stepHash(
  generationHash: string,
  id: string,
  step: Omit<Step, "lineageHash">,
) {
  return digest(
    canonical({
      purpose: "distributor-restore-offline-step-v1",
      generationHash,
      sessionId: id,
      ...step,
    }),
  );
}
function releaseHistoryHash(records: OfflineReleaseHistory[]) {
  return digest(
    canonical({
      purpose: "distributor-restore-offline-releases-v1",
      releases: records,
    }),
  );
}
function state(value: unknown): StateData {
  record(value, ["version", "generation", "releases", "sessions"]);
  requirePhase(value.version === 1, "Unsupported offline state version.");
  const gen = generation(value.generation),
    journal = releases(value.releases),
    genHash = generationHash(gen),
    journalHash = releaseHistoryHash(journal),
    emptyJournalHash = releaseHistoryHash([]),
    orgs = new Set(gen.organizations.map((o) => o.id));
  list(value.sessions, maxItems);
  const ids = new Set<string>(),
    bindings = new Set<string>();
  let previousSessionHash: string | null = null,
    entries = 0;
  const sessionInputs = value.sessions;
  const sessions = sessionInputs.map((s, index) => {
    record(s, [
      "id",
      "revision",
      "phase",
      "previousSessionHash",
      "lineageHash",
      "history",
    ]);
    exactText(s.id);
    integer(s.revision, 1);
    hash(s.lineageHash);
    requirePhase(
      !ids.has(s.id) && s.previousSessionHash === previousSessionHash,
      "Session identity or predecessor lineage is inconsistent.",
    );
    ids.add(s.id);
    list(s.history, maxHistory);
    entries += s.history.length;
    requirePhase(
      entries <= maxHistory && s.history.length === s.revision,
      "Supply every bounded session revision.",
    );
    let previousHash = seed(genHash, s.id, previousSessionHash),
      phase: Phase | null = null;
    const requests = new Set<string>();
    const history: Step[] = s.history.map((item, i) => {
      record(item, [
        "revision",
        "kind",
        "phase",
        "receipt",
        "reason",
        "previousHash",
        "releaseHistoryHash",
        "lineageHash",
      ]);
      integer(item.revision, 1);
      hash(item.previousHash);
      hash(item.releaseHistoryHash);
      hash(item.lineageHash);
      const op = transition(
        item.kind === "isolate"
          ? { kind: item.kind, sessionId: s.id }
          : item.kind === "record-task"
            ? { kind: item.kind, receipt: item.receipt }
            : item.kind === "invalidate"
              ? { kind: item.kind, reason: item.reason }
              : { kind: item.kind },
        orgs,
      );
      const r = op.kind === "record-task" ? op.receipt : null,
        reason = op.kind === "invalidate" ? op.reason : null;
      requirePhase(
        (r !== null || item.receipt === null) &&
          (reason !== null || item.reason === null),
        "Unexpected receipt or invalidation metadata.",
      );
      const releaseHash =
        op.kind === "invalidate" && index === sessionInputs.length - 1
          ? journalHash
          : emptyJournalHash;
      requirePhase(
        item.releaseHistoryHash === releaseHash,
        "Session lineage does not bind the retained release history.",
      );
      phase = nextPhase(phase, op.kind);
      requirePhase(
        item.revision === i + 1 &&
          item.phase === phase &&
          item.previousHash === previousHash,
        "Session revision, phase or lineage regressed.",
      );
      if (r) {
        const key = canonical([r.owner, r.orgId, r.taskName, r.requestId]);
        requirePhase(
          !requests.has(key) && !bindings.has(r.binding),
          "Task receipt identity or binding was reused.",
        );
        requests.add(key);
        bindings.add(r.binding);
      }
      const entry = {
        revision: i + 1,
        kind: op.kind,
        phase,
        receipt: r,
        reason,
        previousHash,
        releaseHistoryHash: releaseHash,
      };
      const lineageHash = stepHash(genHash, s.id as string, entry);
      requirePhase(
        lineageHash === item.lineageHash,
        "Session receipt lineage is inconsistent.",
      );
      previousHash = lineageHash;
      return { ...entry, lineageHash };
    });
    const head = history.at(-1)!;
    requirePhase(
      s.phase === head.phase &&
        s.lineageHash === head.lineageHash &&
        (index === sessionInputs.length - 1 ||
          head.phase === "closed" ||
          head.phase === "invalidated"),
      "Session head disagrees with history or another session is active.",
    );
    const result = {
      id: s.id,
      revision: s.revision,
      phase: head.phase,
      previousSessionHash,
      lineageHash: head.lineageHash,
      history,
    };
    previousSessionHash = head.lineageHash;
    return result;
  });
  return { version: 1, generation: gen, releases: journal, sessions };
}
export function validateOfflinePhaseState(value: unknown): OfflinePhaseState {
  return freeze(state(value)) as OfflinePhaseState;
}
function expectation(value: StateData): OfflinePhaseExpectation {
  const last = value.sessions.at(-1);
  return {
    generationHash: generationHash(value.generation),
    stateHash: digest(
      canonical({
        purpose: "distributor-restore-offline-state-v1",
        state: value,
      }),
    ),
    session: last
      ? { id: last.id, revision: last.revision, lineageHash: last.lineageHash }
      : null,
  };
}
/** Data binding for a future same-writer CAS. Not proof that a supplied state is current. */
export function offlinePhaseExpectation(
  value: unknown,
): Frozen<OfflinePhaseExpectation> {
  return freeze(expectation(state(value)));
}
function checkExpectation(input: unknown, current: StateData) {
  record(input, ["generationHash", "stateHash", "session"]);
  hash(input.generationHash);
  hash(input.stateHash);
  if (input.session !== null) {
    record(input.session, ["id", "revision", "lineageHash"]);
    exactText(input.session.id);
    integer(input.session.revision, 1);
    hash(input.session.lineageHash);
  }
  requirePhase(
    canonical(input) === canonical(expectation(current)),
    "Stale generation, session revision or retained lineage.",
  );
}
/** PURE proposal evaluator. No writes, time sampling, callbacks or authority.
 * A trusted future coordinator must supply a complete fresh release projection
 * and enforce signatures, current isolation/authority and atomic CAS separately.
 */
export function evaluateOfflinePhaseTransition(
  currentInput: unknown,
  expectedInput: unknown,
  transitionInput: unknown,
  observedReleaseHistory: unknown,
) {
  const current = state(currentInput);
  checkExpectation(expectedInput, current);
  const observed = releases(observedReleaseHistory);
  monotonicReleases(current.releases, observed);
  const op = transition(
    transitionInput,
    new Set(current.generation.organizations.map((o) => o.id)),
  );
  requirePhase(
    op.kind === "invalidate" || observed.length === 0,
    "Retained release history requires a separate qualified recovery procedure.",
  );
  const last = current.sessions.at(-1);
  let target: Session;
  if (op.kind === "isolate") {
    requirePhase(
      !last || last.phase === "closed" || last.phase === "invalidated",
      "Only one offline session may be active.",
    );
    requirePhase(
      !current.sessions.some((s) => s.id === op.sessionId),
      "A prior session identity cannot be reused.",
    );
    target = {
      id: op.sessionId,
      revision: 0,
      phase: "isolated",
      previousSessionHash: last?.lineageHash ?? null,
      lineageHash: seed(
        generationHash(current.generation),
        op.sessionId,
        last?.lineageHash ?? null,
      ),
      history: [],
    };
    current.sessions.push(target);
  } else {
    requirePhase(last, "An offline session is required.");
    target = last;
  }
  requirePhase(
    target.revision < Number.MAX_SAFE_INTEGER,
    "Session revision exhausted.",
  );
  const entry = {
    revision: target.revision + 1,
    kind: op.kind,
    phase: nextPhase(target.history.length ? target.phase : null, op.kind),
    receipt: op.kind === "record-task" ? op.receipt : null,
    reason: op.kind === "invalidate" ? op.reason : null,
    previousHash: target.lineageHash,
    releaseHistoryHash: releaseHistoryHash(observed),
  };
  const lineageHash = stepHash(
    generationHash(current.generation),
    target.id,
    entry,
  );
  target.history.push({ ...entry, lineageHash });
  target.revision = entry.revision;
  target.phase = entry.phase;
  target.lineageHash = lineageHash;
  current.releases = observed;
  const next = state(current);
  return freeze({
    status: "static-phase-proposal" as const,
    next: freeze(next) as OfflinePhaseState,
    expectation: expectation(next),
    releases: classification(observed),
  });
}
