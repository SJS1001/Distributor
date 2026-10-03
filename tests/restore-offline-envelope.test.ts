import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DomainError } from "../src/server/core.ts";
import {
  canonicalOfflineTaskEnvelope,
  offlineTaskApprovalMessage,
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
  OFFLINE_ENVELOPE_LIMITS,
} from "../src/server/restore-offline-envelope.ts";
import { restoreApprovalMessage } from "../src/server/restore-review.ts";
import { restoreReleaseApprovalMessage } from "../src/server/restore-activation.ts";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
// Independently encoded and SHA-256 pinned with Python json.dumps(sort_keys=True,
// separators=(",", ":")); fixture data is synthetic and grants no task authority.
const fixture = deepFreeze({
  version: 1,
  purpose: "distributor-restore-offline-task-v1",
  requestId: "request-1",
  preparedBy: "preparer",
  executorId: "executor",
  preparedAt: "2026-10-03T16:00:00.000Z",
  expiresAt: "2026-10-03T16:15:00.000Z",
  recovery: {
    instanceId: "recovery-1",
    snapshotHash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    restoredAt: "2026-10-03T15:00:00.000Z",
    sourceCompletedAt: "2026-10-03T14:00:00.000Z",
    schemaHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    region: "CA",
    organizations: [
      {
        id: "org-a",
        currency: "USD",
      },
      {
        id: "org-b",
        currency: "CAD",
      },
    ],
  },
  session: {
    id: "session-1",
    revision: 3,
    lineageHash:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  },
  candidate: {
    logicalHash:
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    file: {
      dev: 11,
      ino: 12,
    },
  },
  source: {
    identity: "source-1",
    baseline: {
      logicalHash:
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      durableCursor: " z/opaque\t ",
      auditSequence: 100,
    },
    end: {
      logicalHash:
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      durableCursor: " a/opaque\n ",
      auditSequence: 102,
    },
    intervalEvidenceHash:
      "0000000000000000000000000000000000000000000000000000000000000000",
  },
  task: {
    name: "synthetic.retained-observation",
    version: 1,
    owner: "synthetic-owner",
    orgId: "org-b",
    siteIds: ["site-a", "site-b"],
    subjectId: "subject-1",
    expectedRevision: 5,
    expectedStateHash:
      "1111111111111111111111111111111111111111111111111111111111111111",
    payloadHash:
      "2222222222222222222222222222222222222222222222222222222222222222",
    priorClaim: {
      operationId: "operation-1",
      tokenHash:
        "3333333333333333333333333333333333333333333333333333333333333333",
      revision: 7,
      stateHash:
        "4444444444444444444444444444444444444444444444444444444444444444",
    },
  },
  evidence: {
    setHash: "5555555555555555555555555555555555555555555555555555555555555555",
    items: [
      {
        reference: "evidence-a",
        sha256:
          "6666666666666666666666666666666666666666666666666666666666666666",
        bytes: 64,
      },
      {
        reference: "evidence-b",
        sha256:
          "7777777777777777777777777777777777777777777777777777777777777777",
        bytes: 128,
      },
    ],
    qualificationHash:
      "8888888888888888888888888888888888888888888888888888888888888888",
  },
  operations: {
    authorityId: "operations-authority",
    revision: 9,
    adapterIdentity: "adapter-1",
    fenceTokenHash:
      "9999999999999999999999999999999999999999999999999999999999999999",
    observationHash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  trust: {
    authorityId: "trust-authority",
    revision: 10,
    registryHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  },
});
const expectedCanonical =
  '{"candidate":{"file":{"dev":11,"ino":12},"logicalHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},"evidence":{"items":[{"bytes":64,"reference":"evidence-a","sha256":"6666666666666666666666666666666666666666666666666666666666666666"},{"bytes":128,"reference":"evidence-b","sha256":"7777777777777777777777777777777777777777777777777777777777777777"}],"qualificationHash":"8888888888888888888888888888888888888888888888888888888888888888","setHash":"5555555555555555555555555555555555555555555555555555555555555555"},"executorId":"executor","expiresAt":"2026-10-03T16:15:00.000Z","operations":{"adapterIdentity":"adapter-1","authorityId":"operations-authority","fenceTokenHash":"9999999999999999999999999999999999999999999999999999999999999999","observationHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","revision":9},"preparedAt":"2026-10-03T16:00:00.000Z","preparedBy":"preparer","purpose":"distributor-restore-offline-task-v1","recovery":{"instanceId":"recovery-1","organizations":[{"currency":"USD","id":"org-a"},{"currency":"CAD","id":"org-b"}],"region":"CA","restoredAt":"2026-10-03T15:00:00.000Z","schemaHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","snapshotHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sourceCompletedAt":"2026-10-03T14:00:00.000Z"},"requestId":"request-1","session":{"id":"session-1","lineageHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","revision":3},"source":{"baseline":{"auditSequence":100,"durableCursor":" z/opaque\\t ","logicalHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},"end":{"auditSequence":102,"durableCursor":" a/opaque\\n ","logicalHash":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"},"identity":"source-1","intervalEvidenceHash":"0000000000000000000000000000000000000000000000000000000000000000"},"task":{"expectedRevision":5,"expectedStateHash":"1111111111111111111111111111111111111111111111111111111111111111","name":"synthetic.retained-observation","orgId":"org-b","owner":"synthetic-owner","payloadHash":"2222222222222222222222222222222222222222222222222222222222222222","priorClaim":{"operationId":"operation-1","revision":7,"stateHash":"4444444444444444444444444444444444444444444444444444444444444444","tokenHash":"3333333333333333333333333333333333333333333333333333333333333333"},"siteIds":["site-a","site-b"],"subjectId":"subject-1","version":1},"trust":{"authorityId":"trust-authority","registryHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","revision":10},"version":1}';
const expectedBinding =
  "ace041ad55240a1f6a662201656405c5010a0f788b4e9987fc115e9f8cc0093b";
const expectedFinanceMessage =
  '{"binding":"ace041ad55240a1f6a662201656405c5010a0f788b4e9987fc115e9f8cc0093b","purpose":"distributor-restore-offline-approval-v1","role":"finance","signerId":"finance-1"}';
const expectedSecurityMessage =
  '{"binding":"ace041ad55240a1f6a662201656405c5010a0f788b4e9987fc115e9f8cc0093b","purpose":"distributor-restore-offline-approval-v1","role":"security","signerId":"security-1"}';
const copy = () => structuredClone(fixture);
function rejected(input: unknown) {
  assert.throws(
    () => parseOfflineTaskEnvelope(input),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "RESTORE_OFFLINE_ENVELOPE" &&
      error.message === "Invalid offline task envelope.",
  );
}
type Path = (string | number)[];
function at(value: unknown, path: Path): any {
  return path.reduce((v: any, key) => v[key], value);
}
function replace(value: unknown, path: Path, next: unknown) {
  const parent = at(value, path.slice(0, -1));
  parent[path.at(-1)!] = next;
}
function leaves(value: unknown, path: Path = []): Path[] {
  return value !== null && typeof value === "object"
    ? Object.entries(value).flatMap(([key, child]) =>
        leaves(child, [...path, key]),
      )
    : [path];
}
function objects(value: unknown, path: Path = []): Path[] {
  return value !== null && typeof value === "object"
    ? [
        path,
        ...Object.entries(value).flatMap(([key, child]) =>
          objects(child, [...path, key]),
        ),
      ]
    : [];
}

test("independent frozen canonical bytes, digest and finance/security messages", () => {
  assert.equal(canonicalOfflineTaskEnvelope(fixture), expectedCanonical);
  assert.equal(offlineTaskBinding(fixture), expectedBinding);
  assert.equal(
    createHash("sha256").update(expectedCanonical, "utf8").digest("hex"),
    expectedBinding,
  );
  assert.equal(
    offlineTaskApprovalMessage(fixture, "finance-1", "finance"),
    expectedFinanceMessage,
  );
  assert.equal(
    offlineTaskApprovalMessage(fixture, "security-1", "security"),
    expectedSecurityMessage,
  );
  const reversed = (value: any): any =>
    Array.isArray(value)
      ? value.map(reversed)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, v]) => [key, reversed(v)]),
          )
        : value;
  assert.equal(
    canonicalOfflineTaskEnvelope(reversed(fixture)),
    expectedCanonical,
  );
});

test("every binding leaf changes the digest or is an unsupported fixed discriminator", () => {
  const paths = leaves(fixture);
  assert.equal(paths.length, 61);
  for (const path of paths) {
    const v = copy();
    const old = at(v, path);
    const key = path.join(".");
    if (key === "version" || key === "purpose") {
      replace(
        v,
        path,
        typeof old === "number" ? 2 : "distributor-restore-activation-v1",
      );
      rejected(v);
      continue;
    }
    let next: unknown;
    if (typeof old === "number") next = old + 1;
    else if (/^[a-f0-9]{64}$/.test(old))
      next = (old[0] === "a" ? "b" : "a") + old.slice(1);
    else if (old.endsWith("Z"))
      next = new Date(
        Date.parse(old) + (key === "expiresAt" ? -1 : 1),
      ).toISOString();
    else if (key.endsWith("currency")) next = old === "CAD" ? "USD" : "CAD";
    else if (key === "recovery.region") next = "US";
    else if (key === "task.orgId") next = "org-a";
    else next = old + "0";
    replace(v, path, next);
    if (key === "recovery.organizations.1.id") v.task.orgId = next as string;
    assert.notEqual(offlineTaskBinding(v), expectedBinding, key);
    assert.notEqual(
      offlineTaskApprovalMessage(v, "finance-1", "finance"),
      expectedFinanceMessage,
      key,
    );
  }
  for (const change of [
    (v: ReturnType<typeof copy>) => {
      v.task.priorClaim = null as any;
    },
    (v: ReturnType<typeof copy>) => {
      v.task.siteIds.pop();
    },
    (v: ReturnType<typeof copy>) => {
      v.evidence.items.pop();
    },
    (v: ReturnType<typeof copy>) => {
      v.recovery.organizations.shift();
    },
  ]) {
    const v = copy();
    change(v);
    assert.notEqual(offlineTaskBinding(v), expectedBinding);
  }
});

test("nested objects reject unknown/missing/symbol/nonenumerable/accessor keys without evaluation", () => {
  let called = 0;
  for (const path of objects(fixture)) {
    const original = at(fixture, path);
    for (const modify of [
      (o: any) => {
        o.extra = true;
      },
      (o: any) => {
        o[Symbol("extra")] = true;
      },
      (o: any) => {
        delete o[Object.keys(o)[0]!];
      },
      (o: any) => {
        Object.defineProperty(o, Object.keys(o)[0]!, {
          get() {
            called++;
            throw Error("getter ran");
          },
          enumerable: true,
        });
      },
      (o: any) => {
        Object.defineProperty(o, Object.keys(o)[0]!, { enumerable: false });
      },
      (o: any) => {
        Object.setPrototypeOf(o, {});
      },
    ]) {
      const v = copy();
      modify(at(v, path));
      rejected(v);
    }
    if (!Array.isArray(original)) {
      const v = copy();
      const o = at(v, path);
      Object.setPrototypeOf(o, null);
      assert.equal(offlineTaskBinding(v), expectedBinding);
    }
  }
  assert.equal(called, 0);
});

test("hostile nonplain objects, proxies, sparse arrays and coercions are never executed", () => {
  let calls = 0;
  const traps = {
    get() {
      calls++;
      throw Error("get");
    },
    getPrototypeOf() {
      calls++;
      throw Error("prototype");
    },
    ownKeys() {
      calls++;
      throw Error("keys");
    },
    getOwnPropertyDescriptor() {
      calls++;
      throw Error("descriptor");
    },
  };
  for (const path of objects(fixture)) {
    const v = copy();
    const proxy = new Proxy(at(v, path), traps);
    if (path.length) {
      replace(v, path, proxy);
      rejected(v);
    } else rejected(proxy);
  }
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  rejected(revoked.proxy);
  for (const x of [
    null,
    undefined,
    [],
    new Date(),
    new Map(),
    new Set(),
    Object(1),
    Object("x"),
    () => {},
    "{}",
    true,
    NaN,
  ])
    rejected(x);
  for (const path of leaves(fixture)) {
    const v = copy();
    replace(v, path, {
      toString() {
        calls++;
        return "x";
      },
      valueOf() {
        calls++;
        return 1;
      },
      toJSON() {
        calls++;
        return "x";
      },
    });
    rejected(v);
  }
  const v = copy();
  v.task.siteIds = new Array(1001);
  rejected(v);
  assert.equal(calls, 0);
});

test("parse detaches and deeply freezes every object and array", () => {
  const input = copy();
  const parsed = parseOfflineTaskEnvelope(input);
  for (const path of objects(fixture)) {
    assert.notEqual(at(parsed, path), at(input, path));
    assert.equal(Object.isFrozen(at(parsed, path)), true);
  }
  input.task.priorClaim.tokenHash = "c".repeat(64);
  input.recovery.organizations[0]!.currency = "CAD";
  input.source.baseline.durableCursor = "changed";
  input.evidence.items[0]!.bytes = 100;
  assert.equal(offlineTaskBinding(parsed), expectedBinding);
  assert.throws(() => {
    (parsed.task as any).orgId = "org-a";
  }, TypeError);
  assert.throws(() => {
    (parsed.evidence.items as any).push({});
  }, TypeError);
});

test("CA/CAD, US/USD, CA/USD are actual currency values, never inferred", () => {
  for (const [region, currency] of [
    ["CA", "CAD"],
    ["US", "USD"],
    ["CA", "USD"],
  ]) {
    const v = copy();
    v.recovery.region = region!;
    v.recovery.organizations[1]!.currency = currency!;
    const parsed = parseOfflineTaskEnvelope(v);
    assert.equal(parsed.recovery.organizations[1]!.currency, currency);
  }
  for (const [path, bad] of [
    [["recovery", "region"], "ca"],
    [["recovery", "region"], "EU"],
    [["recovery", "organizations", 0, "currency"], "EUR"],
    [["recovery", "organizations", 0, "currency"], "usd"],
    [["version"], 0],
    [["version"], "1"],
    [["purpose"], "distributor-restore-review-v1"],
  ] as [Path, unknown][]) {
    const v = copy();
    replace(v, path, bad);
    rejected(v);
  }
});

test("all numeric fields reject coercion, negative/unsafe/nonfinite/fractional/negative-zero values", () => {
  for (const path of leaves(fixture).filter(
    (p) => typeof at(fixture, p) === "number",
  )) {
    for (const bad of [
      -1,
      -0,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      0.5,
      "1",
      1n,
      null,
    ]) {
      const v = copy();
      replace(v, path, bad);
      rejected(v);
    }
    if (
      !["version", "task.version"].includes(path.join(".")) &&
      !path.includes("bytes")
    ) {
      for (const valid of [0, Number.MAX_SAFE_INTEGER]) {
        const v = copy();
        replace(v, path, valid);
        parseOfflineTaskEnvelope(v);
      }
    }
  }
  for (const bad of [0, Number.MAX_SAFE_INTEGER + 1]) {
    const v = copy();
    v.task.version = bad;
    rejected(v);
  }
  const v = copy();
  v.task.version = Number.MAX_SAFE_INTEGER;
  parseOfflineTaskEnvelope(v); // unqualified registry version
});

test("every hash is lowercase exact SHA-256 text", () => {
  for (const path of leaves(fixture).filter(
    (p) =>
      typeof at(fixture, p) === "string" &&
      /^[a-f0-9]{64}$/.test(at(fixture, p)),
  )) {
    for (const bad of [
      "A".repeat(64),
      "g".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      " " + "a".repeat(64),
      "a".repeat(64) + "\n",
      null,
    ]) {
      const v = copy();
      replace(v, path, bad);
      rejected(v);
    }
  }
});

test("exact UTC millisecond dates and explicit bounded approval window", () => {
  for (const path of [
    ["preparedAt"],
    ["expiresAt"],
    ["recovery", "restoredAt"],
    ["recovery", "sourceCompletedAt"],
  ] as Path[]) {
    for (const bad of [
      "2026-02-30T00:00:00.000Z",
      "2026-10-03T24:00:00.000Z",
      "2026-10-03T16:00:00Z",
      "2026-10-03T16:00:00.000+00:00",
      "2026-10-03T16:00:00.000z",
      "2026-10-03T16:00:00.0000Z",
      "2026-10-03",
      "+002026-10-03T16:00:00.000Z",
      new Date(),
    ]) {
      const v = copy();
      replace(v, path, bad);
      rejected(v);
    }
  }
  for (const delta of [-1, 0, 900001]) {
    const v = copy();
    v.expiresAt = new Date(Date.parse(v.preparedAt) + delta).toISOString();
    rejected(v);
  }
  const v = copy();
  v.expiresAt = new Date(Date.parse(v.preparedAt) + 1).toISOString();
  parseOfflineTaskEnvelope(v, { maxApprovalWindowMs: 1 });
  assert.throws(
    () => parseOfflineTaskEnvelope(fixture, { maxApprovalWindowMs: 899999 }),
    DomainError,
  );
  for (const maxApprovalWindowMs of [0, -0, -1, NaN, Infinity, 900001, 1.5])
    assert.throws(
      () => parseOfflineTaskEnvelope(fixture, { maxApprovalWindowMs }),
      DomainError,
    );
  assert.throws(
    () =>
      parseOfflineTaskEnvelope(fixture, {
        maxApprovalWindowMs: 900000,
        extra: true,
      } as any),
    DomainError,
  );
  const historical = copy();
  historical.preparedAt = "2000-02-29T00:00:00.000Z";
  historical.expiresAt = "2000-02-29T00:15:00.000Z";
  parseOfflineTaskEnvelope(historical); // structural, not a current-time approval
});

test("identity/reference bounds reject whitespace aliases and malformed Unicode; cursors stay opaque", () => {
  const paths = leaves(fixture).filter(
    (p) =>
      typeof at(fixture, p) === "string" &&
      !/^[a-f0-9]{64}$/.test(at(fixture, p)) &&
      !["purpose", "recovery.region"].includes(p.join(".")) &&
      ![
        "currency",
        "durableCursor",
        "preparedAt",
        "expiresAt",
        "restoredAt",
        "sourceCompletedAt",
      ].includes(String(p.at(-1))),
  );
  for (const path of paths) {
    const maximum = path.at(-1) === "reference" ? 2000 : 160;
    for (const bad of [
      "",
      " ",
      " a",
      "a ",
      "a\n",
      "\ta",
      "a\0b",
      "a".repeat(maximum + 1),
      "\ud800",
    ]) {
      const v = copy();
      replace(v, path, bad);
      rejected(v);
    }
  }
  const v = copy();
  v.requestId = "x".repeat(160);
  v.evidence.items[1]!.reference = "z".repeat(2000);
  parseOfflineTaskEnvelope(v);
  v.source.baseline.durableCursor = " ".repeat(2000);
  v.source.end.durableCursor = "0";
  v.source.end.auditSequence = 0;
  assert.equal(
    parseOfflineTaskEnvelope(v).source.baseline.durableCursor,
    " ".repeat(2000),
  );
  for (const bad of ["", "x".repeat(2001), "\udfff", 1]) {
    const v = copy();
    v.source.end.durableCursor = bad as string;
    rejected(v);
  }
});

test("organization/site/evidence identity order and uniqueness fail closed, without sorting", () => {
  for (const path of [
    ["recovery", "organizations"],
    ["task", "siteIds"],
    ["evidence", "items"],
  ] as Path[]) {
    const v = copy();
    at(v, path).reverse();
    rejected(v);
    const duplicate = copy();
    at(duplicate, path)[1] = structuredClone(at(duplicate, path)[0]);
    rejected(duplicate);
  }
  const v = copy();
  v.recovery.organizations[1]!.id = "org-a";
  v.recovery.organizations[1]!.currency = "CAD";
  rejected(v);
  const missing = copy();
  missing.task.orgId = "absent";
  rejected(missing);
  const empty = copy();
  empty.recovery.organizations = [];
  rejected(empty);
  const order = copy();
  order.task.siteIds = ["Z", "a", "é"];
  parseOfflineTaskEnvelope(order);
  order.task.siteIds = ["a", "Z"];
  rejected(order); // independent of locale sort
});

test("all three collection capacities are bounded and boundary maxima accepted", () => {
  const v = copy();
  v.recovery.organizations = Array.from({ length: 1000 }, (_, i) => ({
    id: `org-${String(i).padStart(4, "0")}`,
    currency: "USD",
  }));
  v.task.orgId = v.recovery.organizations[0]!.id;
  v.task.siteIds = Array.from(
    { length: 1000 },
    (_, i) => `site-${String(i).padStart(4, "0")}`,
  );
  v.evidence.items = Array.from({ length: 1000 }, (_, i) => ({
    reference: `evidence-${String(i).padStart(4, "0")}`,
    sha256: "a".repeat(64),
    bytes: 1,
  }));
  parseOfflineTaskEnvelope(v);
  for (const path of [
    ["recovery", "organizations"],
    ["task", "siteIds"],
    ["evidence", "items"],
  ] as Path[]) {
    const bad = structuredClone(v);
    at(bad, path).push(structuredClone(at(bad, path).at(-1)));
    rejected(bad);
  }
  v.task.siteIds = [];
  v.evidence.items = [];
  parseOfflineTaskEnvelope(v); // completeness belongs to qualification
});

test("evidence byte limits, exact totals and malformed claims fail closed", () => {
  const v = copy();
  v.evidence.items = Array.from({ length: 4 }, (_, i) => ({
    reference: `file-${i}`,
    sha256: "a".repeat(64),
    bytes: 64 * 1024 * 1024,
  }));
  parseOfflineTaskEnvelope(v);
  assert.equal(
    v.evidence.items.reduce((a, b) => a + b.bytes, 0),
    OFFLINE_ENVELOPE_LIMITS.totalBytes,
  );
  v.evidence.items.push({
    reference: "file-4",
    sha256: "a".repeat(64),
    bytes: 1,
  });
  rejected(v);
  for (const bytes of [0, 64 * 1024 * 1024 + 1]) {
    const bad = copy();
    bad.evidence.items[0]!.bytes = bytes;
    rejected(bad);
  }
  for (const claim of [
    undefined,
    {},
    [],
    false,
    "none",
    { ...fixture.task.priorClaim, token: "secret" },
  ]) {
    const bad = copy();
    bad.task.priorClaim = claim as any;
    rejected(bad);
  }
  const absent = copy();
  absent.task.priorClaim = null as any;
  assert.equal(parseOfflineTaskEnvelope(absent).task.priorClaim, null);
});

test("approval purpose separation, role/signer validation and preparer/executor collisions", () => {
  assert.notEqual(
    expectedFinanceMessage,
    restoreApprovalMessage(expectedBinding, "finance-1", "finance"),
  );
  assert.notEqual(
    expectedFinanceMessage,
    restoreReleaseApprovalMessage(expectedBinding, "finance-1", "finance"),
  );
  for (const signer of [
    "preparer",
    "executor",
    "",
    " finance-1",
    "finance-1 ",
    "x".repeat(161),
  ])
    assert.throws(
      () => offlineTaskApprovalMessage(fixture, signer, "finance"),
      DomainError,
    );
  for (const role of ["operations", "admin", "Finance", null, {}, undefined])
    assert.throws(
      () => offlineTaskApprovalMessage(fixture, "finance-1", role as any),
      DomainError,
    );
  assert.notEqual(
    offlineTaskApprovalMessage(fixture, "finance-2", "finance"),
    expectedFinanceMessage,
  );
  assert.notEqual(
    offlineTaskApprovalMessage(fixture, "finance-1", "security"),
    expectedFinanceMessage,
  );
  // Equal signer strings across separately built messages are not a quorum check.
  assert.equal(
    typeof offlineTaskApprovalMessage(fixture, "finance-1", "security"),
    "string",
  );
  const samePreparer = copy();
  samePreparer.executorId = samePreparer.preparedBy;
  parseOfflineTaskEnvelope(samePreparer);
});

test("Unicode is retained exactly and cyclic input cannot escape the fixed schema", () => {
  const v = copy();
  v.requestId = "request-\u{1f680}";
  v.task.siteIds = ["e\u0301", "\u00e9"];
  const parsed = parseOfflineTaskEnvelope(v);
  assert.equal(parsed.requestId, v.requestId);
  assert.deepEqual(parsed.task.siteIds, v.task.siteIds);
  assert.equal(
    JSON.parse(canonicalOfflineTaskEnvelope(v)).requestId,
    v.requestId,
  );
  const cycle = copy();
  (cycle.task as any).priorClaim = cycle.task;
  rejected(cycle);
  const bad = copy();
  (bad.recovery.organizations as any)[0] = bad;
  rejected(bad);
});
