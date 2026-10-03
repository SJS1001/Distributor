import assert from "node:assert/strict";
import crypto, {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";
import { syncBuiltinESMExports } from "node:module";
import { DomainError } from "../src/server/core.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
} from "../src/server/restore-offline-envelope.ts";
import {
  verifyOfflineTaskApprovals,
  offlineApprovalRosterFingerprint,
  OFFLINE_APPROVAL_ROSTER_LIMIT,
} from "../src/server/restore-offline-approvals.ts";
import { restoreApprovalMessage } from "../src/server/restore-review.ts";
import { restoreReleaseApprovalMessage } from "../src/server/restore-activation.ts";
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
}
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
// Deliberately public synthetic deterministic seeds. Never operational keys.
function key(seed: number) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(seed);
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      bytes,
    ]),
    type: "pkcs8",
    format: "der",
  });
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
    fingerprint: createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex"),
  };
}
const financeKey = key(1),
  securityKey = key(2);
const suppliedRoster = deepFreeze([
  {
    id: "finance-1",
    role: "finance",
    personId: "person-finance",
    publicKey: financeKey.publicKey,
  },
  {
    id: "security-1",
    role: "security",
    personId: "person-security",
    publicKey: securityKey.publicKey,
  },
]);
const suppliedPeople = deepFreeze({
  preparer: { id: "preparer", personId: "person-preparer" },
  executor: { id: "executor", personId: "person-executor" },
  operations: { id: "operations-authority", personId: "person-operations" },
});
// Independent canonical encoding for test signing; never call the implementation
// approval-message builder to manufacture the expected signing bytes.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",")}}`;
  return JSON.stringify(value);
}
function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function bundle(envelope: unknown = fixture) {
  const binding = sha(canonical(envelope));
  return suppliedRoster.map((r, i) => ({
    signerId: r.id,
    role: r.role,
    binding,
    signature: sign(
      null,
      Buffer.from(
        canonical({
          purpose: "distributor-restore-offline-approval-v1",
          binding,
          signerId: r.id,
          role: r.role,
        }),
      ),
      i === 0 ? financeKey.privateKey : securityKey.privateKey,
    ).toString("base64"),
  }));
}
const originalBundle = deepFreeze(bundle());
function sample() {
  return {
    envelope: structuredClone(fixture),
    approvals: structuredClone(originalBundle),
    roster: structuredClone(suppliedRoster),
    people: structuredClone(suppliedPeople),
  };
}
function run(v: ReturnType<typeof sample>) {
  return verifyOfflineTaskApprovals(
    v.envelope,
    v.approvals,
    v.roster,
    v.people,
  );
}
function rejected(v: ReturnType<typeof sample>) {
  assert.throws(
    () => run(v),
    (e: unknown) =>
      e instanceof DomainError &&
      ["RESTORE_OFFLINE_APPROVAL", "RESTORE_OFFLINE_ENVELOPE"].includes(e.code),
  );
}
type Path = (string | number)[];
function at(v: any, p: Path): any {
  return p.reduce((v, k) => v[k], v);
}
function replace(v: any, p: Path, next: unknown) {
  at(v, p.slice(0, -1))[p.at(-1)!] = next;
}
function paths(v: unknown, p: Path = []): Path[] {
  return v !== null && typeof v === "object"
    ? [p, ...Object.entries(v).flatMap(([k, c]) => paths(c, [...p, k]))]
    : [];
}
function leaves(v: unknown, p: Path = []): Path[] {
  return v !== null && typeof v === "object"
    ? Object.entries(v).flatMap(([k, c]) => leaves(c, [...p, k]))
    : [p];
}

test("exact synthetic Ed25519 signatures and redacted frozen summary", () => {
  const result = run(sample());
  assert.equal(
    result.binding,
    "ace041ad55240a1f6a662201656405c5010a0f788b4e9987fc115e9f8cc0093b",
  );
  assert.deepEqual(result.signers, [
    {
      signerId: "finance-1",
      role: "finance",
      personId: "person-finance",
      keyFingerprint: financeKey.fingerprint,
    },
    {
      signerId: "security-1",
      role: "security",
      personId: "person-security",
      keyFingerprint: securityKey.fingerprint,
    },
  ]);
  assert.deepEqual(Object.keys(result), [
    "binding",
    "rosterFingerprint",
    "associationsFingerprint",
    "signers",
  ]);
  for (const p of paths(result)) assert.ok(Object.isFrozen(at(result, p)));
  assert.ok(!JSON.stringify(result).includes("PUBLIC KEY"));
  assert.ok(!JSON.stringify(result).includes(originalBundle[0]!.signature));
  assert.deepEqual(
    verifyOfflineTaskApprovals(
      parseOfflineTaskEnvelope(fixture),
      originalBundle,
      suppliedRoster,
      suppliedPeople,
    ),
    result,
  );
});

test("fingerprints independently bind all supplied public identities without redefining registryHash", () => {
  const rows = suppliedRoster.map((r) => ({
    id: r.id,
    role: r.role,
    personId: r.personId,
    keyFingerprint:
      r.id === "finance-1" ? financeKey.fingerprint : securityKey.fingerprint,
  }));
  const expected = sha(
    JSON.stringify({
      purpose: "distributor-restore-offline-roster-v1",
      entries: rows,
    }),
  );
  const result = run(sample());
  assert.equal(result.rosterFingerprint, expected);
  assert.equal(
    result.associationsFingerprint,
    sha(
      JSON.stringify({
        purpose: "distributor-restore-offline-associations-v1",
        ...suppliedPeople,
      }),
    ),
  );
  assert.notEqual(result.rosterFingerprint, fixture.trust.registryHash);
  const v = sample();
  v.roster.reverse();
  assert.equal(run(v).rosterFingerprint, expected);
  const added = sample();
  added.roster.push({
    id: "unused",
    role: "finance",
    personId: "person-unused",
    publicKey: key(3).publicKey,
  });
  assert.notEqual(run(added).rosterFingerprint, expected);
  assert.equal(
    offlineApprovalRosterFingerprint(added.roster),
    run(added).rosterFingerprint,
  );
  // Supplied distinct person claims can be false: cryptography cannot qualify them.
  const asserted = sample();
  asserted.roster[0]!.personId = "asserted-different-person";
  assert.notEqual(run(asserted).rosterFingerprint, expected);
  asserted.people.preparer.personId = "asserted-preparer";
  assert.notEqual(
    run(asserted).associationsFingerprint,
    result.associationsFingerprint,
  );
});

test("all changed nested envelope leaves invalidate retained signatures, even with updated binding fields", () => {
  assert.equal(leaves(fixture).length, 61);
  for (const path of leaves(fixture)) {
    const v = sample(),
      old = at(v.envelope, path),
      name = path.join(".");
    let next = typeof old === "number" ? old + 1 : old + "0";
    if (/^[a-f0-9]{64}$/.test(String(old)))
      next = (old[0] === "a" ? "b" : "a") + old.slice(1);
    if (typeof old === "string" && old.endsWith("Z"))
      next = new Date(
        Date.parse(old) + (name === "expiresAt" ? -1 : 1),
      ).toISOString();
    if (name.endsWith("currency")) next = old === "CAD" ? "USD" : "CAD";
    if (name === "recovery.region") next = "US";
    if (name === "task.orgId") next = "org-a";
    replace(v.envelope, path, next);
    rejected(v);
    v.approvals.forEach((a) => {
      a.binding = sha(canonical(v.envelope));
    });
    rejected(v);
  }
  for (const mutate of [
    (v: any) => (v.task.priorClaim = null),
    (v: any) => (v.task.priorClaim.tokenHash = "f".repeat(64)),
    (v: any) => v.evidence.items.pop(),
    (v: any) => v.task.siteIds.pop(),
  ]) {
    const v = sample();
    mutate(v.envelope);
    v.approvals.forEach((a) => (a.binding = offlineTaskBinding(v.envelope)));
    rejected(v);
  }
});

test("exactly finance then security; no partial/extra/reordered/role-substituted bundle", () => {
  for (const mutate of [
    (v: any) => v.approvals.pop(),
    (v: any) => v.approvals.push({ ...v.approvals[0] }),
    (v: any) => v.approvals.reverse(),
    (v: any) => (v.approvals[1] = { ...v.approvals[0] }),
    (v: any) => (v.approvals[0].role = "security"),
    (v: any) => (v.roster[0].role = "security"),
    (v: any) => (v.approvals[0].binding = "0".repeat(64)),
    (v: any) => (v.approvals[0].signerId = "absent"),
  ]) {
    const v = sample();
    mutate(v);
    rejected(v);
  }
  for (const bad of ["operations", "admin", "Finance", undefined, null, {}]) {
    const v = sample();
    v.roster[0]!.role = bad as string;
    rejected(v);
  }
});

test("identity and person separation includes preparer, executor and operations", () => {
  for (const duty of ["preparer", "executor", "operations"] as const) {
    const wrong = sample();
    wrong.people[duty].id += "wrong";
    rejected(wrong);
    for (const i of [0, 1]) {
      const collision = sample();
      collision.roster[i]!.personId = collision.people[duty].personId;
      rejected(collision);
      const alias = sample();
      alias.roster[i]!.id = alias.people[duty].id;
      alias.approvals[i]!.signerId = alias.people[duty].id;
      rejected(alias);
    }
  }
  const same = sample();
  same.roster[1]!.personId = same.roster[0]!.personId;
  rejected(same);
  for (const duty of ["preparer", "executor"] as const) {
    const v = sample();
    v.people.operations.personId = v.people[duty].personId;
    rejected(v);
  }
  const shared = sample();
  shared.envelope.executorId = shared.envelope.preparedBy;
  shared.people.executor = { ...shared.people.preparer };
  shared.approvals = bundle(shared.envelope);
  run(shared);
  shared.people.executor.personId = "contradictory-person";
  rejected(shared);
  const unused = sample();
  unused.roster.push({
    id: unused.people.preparer.id,
    role: "finance",
    personId: "contradiction",
    publicKey: key(3).publicKey,
  });
  rejected(unused);
});

test("duplicate roster IDs/keys and key substitution fail even in unused entries", () => {
  for (const mutate of [
    (v: any) => v.roster.push({ ...v.roster[0] }),
    (v: any) => (v.roster[1].publicKey = v.roster[0].publicKey),
    (v: any) => v.roster.push({ ...v.roster[0], id: "unused" }),
    (v: any) => (v.roster[0].publicKey = key(3).publicKey),
    (v: any) => (v.roster[0].id = v.roster[1].id),
  ]) {
    const v = sample();
    mutate(v);
    rejected(v);
  }
  const v = sample();
  v.roster.push({
    id: "unused",
    role: "finance",
    personId: "person-unused",
    publicKey: "malformed",
  });
  rejected(v);
});

test("canonical padded 64-byte signature base64, including unused padding bits", () => {
  const original = originalBundle[0]!.signature;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padAlias =
    original.slice(0, 85) +
    alphabet[alphabet.indexOf(original[85]!) + 1] +
    "==";
  assert.deepEqual(
    Buffer.from(padAlias, "base64"),
    Buffer.from(original, "base64"),
  );
  for (const bad of [
    original.trimEnd() + "\n",
    original.slice(0, -2),
    original + "=",
    original.replace(/.$/, "_"),
    padAlias,
    "A".repeat(88),
    Buffer.alloc(63).toString("base64"),
    Buffer.alloc(65).toString("base64"),
    null,
    {},
    Buffer.from(original, "base64"),
  ]) {
    const v = sample();
    v.approvals[0]!.signature = bad as string;
    rejected(v);
  }
  const v = sample();
  const changed = Buffer.from(original, "base64");
  changed[0]! ^= 1;
  v.approvals[0]!.signature = changed.toString("base64");
  rejected(v);
});

test("SPKI public-only Ed25519 with canonical PEM, no private/alternate/trailing encoding", () => {
  const pem = financeKey.publicKey;
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  const x25519 = generateKeyPairSync("x25519")
    .publicKey.export({ format: "pem", type: "spki" })
    .toString();
  const data = pem.split("\n")[1]!;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padAlias =
    data.slice(0, -2) + alphabet[alphabet.indexOf(data.at(-2)!) + 1] + "=";
  assert.deepEqual(
    Buffer.from(data, "base64"),
    Buffer.from(padAlias, "base64"),
  );
  for (const bad of [
    financeKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ec,
    x25519,
    pem.trim(),
    pem + "\n",
    pem.replaceAll("\n", "\r\n"),
    " " + pem,
    pem + pem,
    data,
    pem.replace(data, padAlias),
    pem.replace("PUBLIC KEY", "CERTIFICATE"),
    {},
    createPublicKey(financeKey.privateKey),
  ]) {
    const v = sample();
    v.roster[0]!.publicKey = bad as string;
    rejected(v);
  }
});

test("legacy review/release purpose signatures do not substitute for offline approvals", () => {
  for (const make of [restoreApprovalMessage, restoreReleaseApprovalMessage]) {
    const v = sample();
    v.approvals.forEach((a, i) => {
      a.signature = sign(
        null,
        Buffer.from(
          make(a.binding, a.signerId, a.role as "finance" | "security"),
        ),
        i === 0 ? financeKey.privateKey : securityKey.privateKey,
      ).toString("base64");
    });
    rejected(v);
  }
});

test("all input object depths reject unsupported/missing/nonenumerable/symbol/accessor properties", () => {
  let called = 0;
  for (const root of ["approvals", "roster", "people"] as const)
    for (const path of paths(sample()[root])) {
      for (const mutate of [
        (o: any) => {
          o.extra = true;
        },
        (o: any) => {
          o[Symbol("unknown")] = true;
        },
        (o: any) => {
          delete o[Object.keys(o)[0]!];
        },
        (o: any) => {
          Object.defineProperty(o, Object.keys(o)[0]!, { enumerable: false });
        },
        (o: any) => {
          Object.defineProperty(o, Object.keys(o)[0]!, {
            enumerable: true,
            get() {
              called++;
              throw Error("getter invoked");
            },
          });
        },
        (o: any) => {
          Object.setPrototypeOf(o, {});
        },
      ]) {
        const v = sample();
        mutate(at(v[root], path));
        rejected(v);
      }
      const plain = sample();
      if (!Array.isArray(at(plain[root], path))) {
        Object.setPrototypeOf(at(plain[root], path), null);
        run(plain);
      }
    }
  assert.equal(called, 0);
});

test("proxies, revoked proxies, coercions and wrong root types never invoke caller code", () => {
  let called = 0;
  const traps = {
    get() {
      called++;
      throw Error("get");
    },
    getPrototypeOf() {
      called++;
      throw Error("proto");
    },
    ownKeys() {
      called++;
      throw Error("keys");
    },
    getOwnPropertyDescriptor() {
      called++;
      throw Error("descriptor");
    },
  };
  for (const root of ["envelope", "approvals", "roster", "people"] as const)
    for (const path of paths(sample()[root])) {
      const v = sample();
      const proxy = new Proxy(at(v[root], path), traps);
      if (path.length) replace(v[root], path, proxy);
      else (v as any)[root] = proxy;
      rejected(v);
    }
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const root of ["approvals", "roster", "people"] as const) {
    for (const bad of [
      null,
      undefined,
      "[]",
      false,
      () => {},
      new Map(),
      new Date(),
      revoked.proxy,
    ]) {
      const v = sample();
      (v as any)[root] = bad;
      rejected(v);
    }
    for (const path of leaves(sample()[root])) {
      const v = sample();
      replace(v[root], path, {
        toString() {
          called++;
          return "x";
        },
        valueOf() {
          called++;
          return 1;
        },
        toJSON() {
          called++;
          return "x";
        },
      });
      rejected(v);
    }
  }
  assert.equal(called, 0);
});

test("bounded IDs/people/list counts and malformed sparse arrays", () => {
  for (const root of ["approvals", "roster", "people"] as const)
    for (const path of leaves(sample()[root]).filter((p) =>
      ["id", "signerId", "personId"].includes(String(p.at(-1))),
    )) {
      for (const bad of [
        "",
        "x".repeat(161),
        " alias",
        "alias ",
        "alias\n",
        "a\0b",
        "\ud800",
        null,
      ]) {
        const v = sample();
        replace(v[root], path, bad);
        rejected(v);
      }
    }
  for (const bad of [[], new Array(2), new Array(257)]) {
    const v = sample();
    v.roster = bad;
    rejected(v);
  }
  const maximum = sample();
  for (let i = 3; i <= OFFLINE_APPROVAL_ROSTER_LIMIT; i++)
    maximum.roster.push({
      id: `unused-${i}`,
      role: "finance",
      personId: `person-${i}`,
      publicKey: key(i).publicKey,
    });
  run(maximum);
  maximum.roster.push({
    id: "overflow",
    role: "security",
    personId: "overflow",
    publicKey: key(257).publicKey,
  });
  rejected(maximum);
  const alias = sample();
  (alias.approvals as any).extra = true;
  rejected(alias);
});

test("caller mutations cannot alter a captured summary or leave a verification cache", () => {
  const v = sample();
  const result = run(v);
  const retained = JSON.stringify(result);
  v.roster[0]!.personId = "changed-person";
  v.roster[0]!.publicKey = key(3).publicKey;
  v.people.preparer.personId = "changed-preparer";
  v.approvals[0]!.signature = "A".repeat(88);
  v.envelope.task.priorClaim.revision++;
  assert.equal(JSON.stringify(result), retained);
  rejected(v);
  assert.throws(() => {
    (result.signers[0] as any).personId = "mutable";
  }, TypeError);
  assert.throws(() => {
    (result.signers as any).push({});
  }, TypeError);
});

test("expired historical input is only cryptographic evidence; no current truth or policy bypass", () => {
  const v = sample();
  v.envelope.preparedAt = "2000-01-01T00:00:00.000Z";
  v.envelope.expiresAt = "2000-01-01T00:15:00.000Z";
  v.approvals = bundle(v.envelope);
  run(v);
  assert.throws(
    () =>
      verifyOfflineTaskApprovals(v.envelope, v.approvals, v.roster, v.people, {
        maxApprovalWindowMs: 1000,
      }),
    DomainError,
  );
  const booleans = sample();
  (booleans.people as any).current = true;
  rejected(booleans);
  const extra = sample();
  (extra.envelope.trust as any).verified = true;
  rejected(extra);
});

// Cross-checked using Python cryptography 46.0.0 Ed25519, separate canonical
// message construction and DER fingerprinting; fixed public synthetic seeds.
test("independent signature and roster fingerprint vectors", () => {
  const pinned = [
    {
      signature:
        "8amTVGpi37sXoSgigHpDLH36aFlByNGop1ZKXxHUeGrBqquDL9cW8aiBqXqjBPAkH7eWprboYXy58WZtwgWEAw==",
      keyFingerprint:
        "2b514f0c4db8f6fdc0dca75b69ee9e59145366b758d07b59208edeef117a542f",
    },
    {
      signature:
        "pzyXpfpGrevZ1trTzC1lXvTu15sZsvQEFbR2xcyFbqQdmzzZakr56E8KSeBJwFnYyLlLwvE45fF2xGf0fmAFCQ==",
      keyFingerprint:
        "6fceb3b2b70d5bbfc3e44f6b3cfc2b273ccd8e8513a448672ff466682c500457",
    },
  ];
  assert.deepEqual(
    originalBundle.map((a) => a.signature),
    pinned.map((p) => p.signature),
  );
  assert.deepEqual(
    run(sample()).signers.map((s) => s.keyFingerprint),
    pinned.map((p) => p.keyFingerprint),
  );
  assert.equal(
    run(sample()).rosterFingerprint,
    "33b9b908e554f6170634732eede529b4fb75f5a2a63f0a42d86d04b57cd9e412",
  );
});

test("noncanonical Ed25519 scalar and synthetic weak-point forgeries are refused", () => {
  const v = sample();
  const signature = Buffer.from(v.approvals[0]!.signature, "base64");
  const order = (1n << 252n) + 27742317777372353535851937790883648493n;
  let scalar = 0n;
  for (let i = 63; i >= 32; i--)
    scalar = (scalar << 8n) + BigInt(signature[i]!);
  scalar += order;
  for (let i = 32; i < 64; i++) {
    signature[i] = Number(scalar & 255n);
    scalar >>= 8n;
  }
  v.approvals[0]!.signature = signature.toString("base64");
  rejected(v);
  for (const first of [0, 1]) {
    const weak = sample();
    const raw = Buffer.alloc(32);
    raw[0] = first;
    weak.roster[0]!.publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
      type: "spki",
      format: "der",
    })
      .export({ type: "spki", format: "pem" })
      .toString();
    const forged = Buffer.alloc(64);
    forged[0] = 1;
    weak.approvals[0]!.signature = forged.toString("base64");
    rejected(weak);
  }
});

// Independently generated with Python affine Edwards addition: a point of order
// eight, multiplied by 0..7. Canonical encodings of the complete torsion subgroup.
const torsionPoints = [
  "0100000000000000000000000000000000000000000000000000000000000000",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "0000000000000000000000000000000000000000000000000000000000000080",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
];
const malformedPoints = [
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "0100000000000000000000000000000000000000000000000000000000000080",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "0200000000000000000000000000000000000000000000000000000000000000",
  "0700000000000000000000000000000000000000000000000000000000000000",
  "0800000000000000000000000000000000000000000000000000000000000000",
];
// Independently generated with Python affine Edwards addition as B + [i]T,
// i=1..7, where B is the standard base point and T is the order-eight point
// above. For every vector [8]P is nonidentity but [L]P is nonidentity, too.
// These valid curve encodings expose a subgroup gap, not a malformed point.
const mixedTorsionPoints = [
  "98519eadf35b995233b51b5cd23e9cc5a28b639b5a4af0ec903cb960d81b7819",
  "9bad33f580df7ecc49df5342bac8145d5bedc40f573d1b067f3c4ce449689a15",
  "da99e28ba529cdde35a25fba9059e78ecaee239f99755b9b1aa4f65df00803e2",
  "9599999999999999999999999999999999999999999999999999999999999999",
  "55ae61520ca466adcc4ae4a32dc1633a5d749c64a5b50f136fc3469f27e487e6",
  "5252cc0a7f208133b620acbd4537eba2a4123bf0a8c2e4f980c3b31bb69765ea",
  "13661d745ad63221ca5da0456fa618713511dc60668aa464e55b09a20ff7fc1d",
];
function pointPem(hex: string): string {
  return (
    "-----BEGIN PUBLIC KEY-----\n" +
    Buffer.from("302a300506032b6570032100" + hex, "hex").toString("base64") +
    "\n-----END PUBLIC KEY-----\n"
  );
}

test("roster decoding rejects every torsion point and malformed compressed point independently of native verify", () => {
  for (const hex of [...torsionPoints, ...malformedPoints]) {
    const v = sample();
    v.roster[0]!.publicKey = pointPem(hex);
    assert.throws(
      () => offlineApprovalRosterFingerprint(v.roster),
      DomainError,
      hex,
    );
  }
});

test("mixed-torsion roster points fail the local prime-subgroup policy", () => {
  for (const hex of mixedTorsionPoints) {
    const v = sample();
    v.roster[0]!.publicKey = pointPem(hex);
    assert.throws(
      () => offlineApprovalRosterFingerprint(v.roster),
      DomainError,
      hex,
    );
  }
});

test("mixed-torsion signature R never reaches a permissive native verifier", (t) => {
  let calls = 0;
  const native = t.mock.method(crypto, "verify", () => {
    calls++;
    return true;
  });
  syncBuiltinESMExports();
  try {
    for (const hex of mixedTorsionPoints) {
      const v = sample();
      const bytes = Buffer.from(v.approvals[0]!.signature, "base64");
      Buffer.from(hex, "hex").copy(bytes, 0);
      v.approvals[0]!.signature = bytes.toString("base64");
      rejected(v);
      assert.equal(calls, 0, hex);
    }
  } finally {
    native.mock.restore();
    syncBuiltinESMExports();
  }
  run(sample());
});

test("invalid R/scalars never reach even a permissive native verifier", (t) => {
  let calls = 0;
  const native = t.mock.method(crypto, "verify", () => {
    calls++;
    return true;
  });
  syncBuiltinESMExports();
  try {
    for (const hex of [...torsionPoints, ...malformedPoints]) {
      const v = sample();
      const bytes = Buffer.from(v.approvals[0]!.signature, "base64");
      Buffer.from(hex, "hex").copy(bytes, 0);
      v.approvals[0]!.signature = bytes.toString("base64");
      rejected(v);
      assert.equal(calls, 0, hex);
    }
    const L = (1n << 252n) + 27742317777372353535851937790883648493n;
    for (let scalar of [L, L + 1n, (1n << 256n) - 1n]) {
      const v = sample();
      const bytes = Buffer.from(v.approvals[0]!.signature, "base64");
      for (let i = 32; i < 64; i++) {
        bytes[i] = Number(scalar & 255n);
        scalar >>= 8n;
      }
      v.approvals[0]!.signature = bytes.toString("base64");
      rejected(v);
      assert.equal(calls, 0);
    }
  } finally {
    native.mock.restore();
    syncBuiltinESMExports();
  }
  // The real verifier still decides the signature equation after decoding.
  const v = sample();
  const bytes = Buffer.from(v.approvals[0]!.signature, "base64");
  bytes.fill(0, 32);
  v.approvals[0]!.signature = bytes.toString("base64");
  rejected(v);
  run(sample());
});

test("all out-of-field encodings fail and valid sign/scalar boundaries still reach native verification", (t) => {
  const p = (1n << 255n) - 19n;
  for (let y = p; y < 1n << 255n; y++) {
    for (const sign of [0n, 1n]) {
      let encoded = y | (sign << 255n);
      const raw = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) {
        raw[i] = Number(encoded & 255n);
        encoded >>= 8n;
      }
      const v = sample();
      v.roster[0]!.publicKey = pointPem(raw.toString("hex"));
      assert.throws(
        () => offlineApprovalRosterFingerprint(v.roster),
        DomainError,
      );
    }
  }
  const opposite = sample();
  const der = Buffer.from(
    opposite.roster[0]!.publicKey.split("\n")[1]!,
    "base64",
  );
  der[43]! ^= 128;
  opposite.roster[0]!.publicKey = pointPem(der.subarray(12).toString("hex"));
  // Negating a genuine public point remains a valid encoding, but its old
  // signature cannot authenticate under the substituted public key.
  assert.equal(
    typeof offlineApprovalRosterFingerprint(opposite.roster),
    "string",
  );
  rejected(opposite);
  let calls = 0;
  const native = t.mock.method(crypto, "verify", () => {
    calls++;
    return false;
  });
  syncBuiltinESMExports();
  try {
    const L = (1n << 252n) + 27742317777372353535851937790883648493n;
    for (let scalar of [0n, L - 1n]) {
      const v = sample();
      const bytes = Buffer.from(v.approvals[0]!.signature, "base64");
      for (let i = 32; i < 64; i++) {
        bytes[i] = Number(scalar & 255n);
        scalar >>= 8n;
      }
      v.approvals[0]!.signature = bytes.toString("base64");
      const before = calls;
      rejected(v);
      assert.equal(calls, before + 1);
    }
  } finally {
    native.mock.restore();
    syncBuiltinESMExports();
  }
});
