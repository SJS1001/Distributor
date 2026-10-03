import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { canonical, digest } from "../src/server/core.ts";
import { readOfflinePrivateEvidence } from "../src/server/restore-offline-private-evidence.ts";
import { offlineTaskBinding } from "../src/server/restore-offline-envelope.ts";
import { readRestorePrivateEvidence } from "../src/server/restore-private-evidence.ts";

const refusal = {
  code: "RESTORE_OFFLINE_PRIVATE_EVIDENCE",
  message: "Offline private evidence binding did not complete.",
};
const MiB = 1024 ** 2;
function setup(
  t: TestContext,
  contents = [Buffer.from("é\0☃"), Buffer.from("private second report")],
) {
  const root = fs.mkdtempSync(join(tmpdir(), "offline-private-"));
  fs.chmodSync(root, 0o700);
  fs.mkdirSync(join(root, "nested"), { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const items = contents.map((bytes, i) => ({
    reference: `report-${i.toString().padStart(3, "0")}`,
    sha256: digest(bytes),
    bytes: bytes.length,
  }));
  const manifest = {
    version: 1 as const,
    root,
    files: items.map((item, i) => ({
      reference: item.reference,
      path: `nested/file-${i}`,
    })),
  };
  manifest.files.forEach((file, i) =>
    fs.writeFileSync(join(root, file.path), contents[i]!, { mode: 0o600 }),
  );
  const h = "a".repeat(64),
    at = "2026-10-03T16:00:00.000Z";
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
      region: "CA",
      organizations: [{ id: "org", currency: "USD" }],
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
      name: "synthetic.read",
      version: 1,
      owner: "synthetic",
      orgId: "org",
      siteIds: [],
      subjectId: "subject",
      expectedRevision: 1,
      expectedStateHash: h,
      payloadHash: h,
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
  const capture = {
    references: [items[0]!.reference],
    maxBytes: Math.min(4 * MiB, contents[0]!.length),
  };
  const read = () => readOfflinePrivateEvidence(envelope, manifest, capture);
  return { root, contents, manifest, envelope, capture, read };
}

// Observe allocations and real file IO, never substitute file contents/results.
function track(t: TestContext) {
  const allocated: Buffer[] = [],
    opened: number[] = [],
    closed: number[] = [];
  const alloc = Buffer.alloc,
    open = fs.openSync,
    close = fs.closeSync;
  t.mock.method(Buffer, "alloc", ((
    ...args: Parameters<typeof Buffer.alloc>
  ) => {
    const buffer = Reflect.apply(alloc, Buffer, args);
    allocated.push(buffer);
    return buffer;
  }) as typeof Buffer.alloc);
  t.mock.method(fs, "openSync", ((...args: Parameters<typeof fs.openSync>) => {
    const fd = Reflect.apply(open, fs, args);
    opened.push(fd);
    return fd;
  }) as typeof fs.openSync);
  t.mock.method(fs, "closeSync", (fd: number) => {
    closed.push(fd);
    close(fd);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { allocated, opened, closed };
}
function zero(buffers: Buffer[]) {
  assert.ok(buffers.every((b) => b.every((x) => x === 0)));
}

test("real full manifest binds exact bytes; selected buffers stay private until explicit zeroing", (t) => {
  const f = setup(t),
    io = track(t),
    binding = offlineTaskBinding(f.envelope);
  const handle = f.read();
  assert.deepEqual(io.opened, io.closed);
  assert.equal(io.opened.length, 2);
  assert.equal(io.allocated.length, 2); // one stream buffer, one selected capture
  assert.deepEqual(io.allocated[1], f.contents[0]);
  const result = handle.complete();
  assert.deepEqual(result, {
    status: "historical-byte-binding",
    envelopeBinding: binding,
    files: 2,
    bytes: f.contents[0]!.length + f.contents[1]!.length,
    setHash: f.envelope.evidence.setHash,
    qualification: "unverified",
  });
  assert.ok(Object.isFrozen(handle) && Object.isFrozen(result));
  assert.deepEqual(Object.keys(handle).sort(), ["complete", "dispose"]);
  assert.equal(JSON.stringify(handle), "{}");
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.equal(JSON.stringify(result).includes("report-"), false);
  assert.equal(io.opened.length, 2); // completion never reopens for parsing
  handle.dispose();
  zero(io.allocated);
  handle.dispose();
  assert.throws(() => handle.complete(), refusal);
});

test("legacy hash convention is preserved even when reference locale and code-unit order differ", (t) => {
  const f = setup(t);
  f.envelope.evidence.items[0]!.reference = "Z-report";
  f.envelope.evidence.items[1]!.reference = "a-report";
  f.manifest.files.forEach((file, i) => {
    file.reference = f.envelope.evidence.items[i]!.reference;
  });
  f.capture.references = ["Z-report"];
  const legacy = readRestorePrivateEvidence(
    new Map(f.envelope.evidence.items.map((i) => [i.reference, i.sha256])),
    f.manifest,
  );
  try {
    f.envelope.evidence.setHash = legacy.complete().setHash;
  } finally {
    legacy.discard();
  }
  const handle = f.read();
  try {
    assert.equal(handle.complete().setHash, f.envelope.evidence.setHash);
  } finally {
    handle.dispose();
  }
});

test("changed individual counts with identical digests and total refuse before any capture escapes", (t) => {
  const f = setup(t),
    io = track(t);
  f.envelope.evidence.items[0]!.bytes++;
  f.envelope.evidence.items[1]!.bytes--;
  f.envelope.evidence.setHash = digest(canonical(f.envelope.evidence.items));
  f.capture.maxBytes++;
  const handle = f.read();
  assert.throws(() => handle.complete(), refusal);
  zero(io.allocated);
  assert.throws(() => handle.complete(), refusal);
});

test("unselected swapped individual counts also refuse despite identical total", (t) => {
  const f = setup(t),
    io = track(t);
  f.envelope.evidence.items[0]!.bytes++;
  f.envelope.evidence.items[1]!.bytes--;
  f.envelope.evidence.setHash = digest(canonical(f.envelope.evidence.items));
  const handle = readOfflinePrivateEvidence(f.envelope, f.manifest);
  assert.equal(io.allocated.length, 1);
  assert.throws(() => handle.complete(), refusal);
  zero(io.allocated);
});

for (const attack of [
  "setHash",
  "extra",
  "missing",
  "duplicate",
  "path",
  "unknown-field",
  "empty-items",
])
  test(`preflight refuses ${attack} without allocating stream/capture buffers or opening files`, (t) => {
    const f = setup(t),
      io = track(t);
    if (attack === "setHash") f.envelope.evidence.setHash = "0".repeat(64);
    if (attack === "extra")
      f.manifest.files.push({ reference: "extra", path: "other" });
    if (attack === "missing") f.manifest.files.pop();
    if (attack === "duplicate")
      f.manifest.files[1]!.reference = f.manifest.files[0]!.reference;
    if (attack === "path") f.manifest.files[0]!.path = "../private";
    if (attack === "unknown-field")
      Object.assign(f.manifest.files[0]!, { private: "secret" });
    if (attack === "empty-items") f.envelope.evidence.items = [];
    assert.throws(f.read, refusal);
    assert.deepEqual(io.allocated, []);
    assert.deepEqual(io.opened, []);
  });

for (const field of [
  "envelope",
  "evidence",
  "items",
  "item",
  "manifest",
  "files",
  "file",
  "capture",
  "references",
] as const)
  for (const attack of ["proxy", "revoked-proxy", "accessor"] as const)
    test(`${field} ${attack} refuses without invoking a callback or allocating byte buffers`, (t) => {
      const f = setup(t),
        io = track(t);
      let calls = 0;
      const trap = () => {
        calls++;
        throw new Error("private callback secret");
      };
      const wrap = (value: object) => {
        if (attack === "accessor") {
          const key = Array.isArray(value) ? "0" : Object.keys(value)[0]!;
          Object.defineProperty(value, key, { enumerable: true, get: trap });
          return value;
        }
        const pair = Proxy.revocable(value, {
          get: trap,
          ownKeys: trap,
          getPrototypeOf: trap,
          getOwnPropertyDescriptor: trap,
        });
        if (attack === "revoked-proxy") pair.revoke();
        return pair.proxy;
      };
      let e: unknown = f.envelope,
        m: unknown = f.manifest,
        c: unknown = f.capture;
      if (field === "envelope") e = wrap(f.envelope);
      if (field === "evidence")
        f.envelope.evidence = wrap(
          f.envelope.evidence,
        ) as typeof f.envelope.evidence;
      if (field === "items")
        f.envelope.evidence.items = wrap(
          f.envelope.evidence.items,
        ) as typeof f.envelope.evidence.items;
      if (field === "item")
        f.envelope.evidence.items[0] = wrap(
          f.envelope.evidence.items[0]!,
        ) as (typeof f.envelope.evidence.items)[number];
      if (field === "manifest") m = wrap(f.manifest);
      if (field === "files")
        f.manifest.files = wrap(f.manifest.files) as typeof f.manifest.files;
      if (field === "file")
        f.manifest.files[0] = wrap(
          f.manifest.files[0]!,
        ) as (typeof f.manifest.files)[number];
      if (field === "capture") c = wrap(f.capture);
      if (field === "references")
        f.capture.references = wrap(f.capture.references) as string[];
      assert.throws(() => readOfflinePrivateEvidence(e, m, c), refusal);
      assert.equal(calls, 0);
      assert.deepEqual(io.allocated, []);
      assert.deepEqual(io.opened, []);
    });

test("capture count and total/per-file budgets refuse before allocation/reflection over oversized lists", (t) => {
  const f = setup(t),
    io = track(t);
  const huge = new Array(10000000);
  Object.defineProperty(huge, "0", {
    get() {
      assert.fail("oversized list reflected");
    },
  });
  for (const c of [
    { references: huge, maxBytes: 1 },
    { references: Array(17).fill("report-000"), maxBytes: 100 },
    { references: [], maxBytes: 1 },
    { references: ["unknown"], maxBytes: 100 },
    { references: ["report-000", "report-000"], maxBytes: 100 },
    { references: ["report-000"], maxBytes: 1 },
    ...[0, -1, NaN, Infinity, 0.5, 4 * MiB + 1].map((maxBytes) => ({
      references: ["report-000"],
      maxBytes,
    })),
  ])
    assert.throws(
      () => readOfflinePrivateEvidence(f.envelope, f.manifest, c),
      refusal,
    );
  assert.deepEqual(io.allocated, []);
  assert.deepEqual(io.opened, []);
});

test("only selected files are captured and exact capture budget accepts multibuffer binary bytes", (t) => {
  const f = setup(t, [Buffer.alloc(MiB, 31), Buffer.alloc(MiB + 1, 32)]),
    io = track(t);
  const handle = f.read();
  assert.deepEqual(
    io.allocated.map((b) => b.length),
    [64 * 1024, MiB],
  );
  try {
    assert.equal(handle.complete().bytes, 2 * MiB + 1);
    assert.deepEqual(io.allocated[1], f.contents[0]);
  } finally {
    handle.dispose();
  }
  zero(io.allocated);
  f.capture.references = ["report-001"];
  f.capture.maxBytes = 4 * MiB;
  assert.throws(f.read, refusal);
  assert.equal(io.allocated.length, 2);
});

for (const attack of [
  "content",
  "same-byte-replacement",
  "ancestor",
  "file-mode",
  "deleted",
  "unselected-content",
])
  test(`completion revalidates ${attack}, zeroes captures, and permanently refuses reuse`, (t) => {
    const f = setup(t),
      io = track(t),
      handle = f.read();
    const path = join(
      f.root,
      f.manifest.files[attack === "unselected-content" ? 1 : 0]!.path,
    );
    if (attack === "content" || attack === "unselected-content")
      fs.writeFileSync(path, "changed bytes");
    if (attack === "same-byte-replacement") {
      fs.renameSync(path, path + ".old");
      fs.writeFileSync(path, f.contents[0]!, { mode: 0o600 });
    }
    if (attack === "ancestor") fs.chmodSync(join(f.root, "nested"), 0o500);
    if (attack === "file-mode") fs.chmodSync(path, 0o400);
    if (attack === "deleted") fs.unlinkSync(path);
    assert.throws(() => handle.complete(), refusal);
    zero(io.allocated);
    assert.throws(() => handle.complete(), refusal);
    assert.deepEqual(io.opened, io.closed);
    handle.dispose();
    fs.chmodSync(join(f.root, "nested"), 0o700);
  });

test("detached config cannot redirect completion, and repeated completion destroys retained bytes", (t) => {
  const f = setup(t),
    io = track(t),
    expected = offlineTaskBinding(f.envelope),
    handle = f.read();
  f.manifest.root = "/private-changed-path";
  f.manifest.files[0]!.path = "different";
  f.capture.references[0] = "unknown";
  f.capture.maxBytes = 1;
  f.envelope.evidence.items[0]!.bytes++;
  f.envelope.evidence.qualificationHash = "b".repeat(64);
  assert.equal(handle.complete().envelopeBinding, expected);
  assert.throws(() => handle.complete(), refusal);
  zero(io.allocated);
});

test("explicit resource disposal on consumer failure and before completion zeroes all owned bytes", (t) => {
  const f = setup(t),
    io = track(t);
  assert.throws(() => {
    using handle = f.read();
    handle.complete();
    throw new Error("synthetic consumer failure");
  }, /synthetic consumer failure/);
  zero(io.allocated);
  const pending = f.read();
  pending[Symbol.dispose]();
  zero(io.allocated);
  assert.throws(() => pending.complete(), refusal);
});

test("initial digest failure, filesystem errors and completion errors disclose no private fields", (t) => {
  const f = setup(t),
    io = track(t);
  f.envelope.evidence.items[1]!.sha256 = "0".repeat(64);
  f.envelope.evidence.setHash = digest(canonical(f.envelope.evidence.items));
  assert.throws(f.read, (e: unknown) => {
    assert.deepEqual(Object.keys(e as object).sort(), ["code", "status"]);
    assert.match(
      String(e),
      /Offline private evidence binding did not complete/,
    );
    assert.equal(JSON.stringify(e).includes(f.root), false);
    assert.equal(String(e).includes("report-"), false);
    assert.equal("cause" in (e as object), false);
    return true;
  });
  zero(io.allocated);
  assert.deepEqual(io.opened, io.closed);
  f.manifest.root = join(f.root, "private-missing-root");
  assert.throws(f.read, refusal);
});

test("oversized envelope, manifest and capture lists are refused before whole-list reflection", (t) => {
  const f = setup(t),
    io = track(t),
    ownKeys = Reflect.ownKeys;
  const huge = new Array(10000000);
  let reflected = 0;
  t.mock.method(Reflect, "ownKeys", (value: object) => {
    if (value === huge) reflected++;
    return ownKeys(value);
  });
  for (const [e, m, c] of [
    [
      { ...f.envelope, evidence: { ...f.envelope.evidence, items: huge } },
      f.manifest,
      undefined,
    ],
    [f.envelope, { ...f.manifest, files: huge }, undefined],
    [f.envelope, f.manifest, { references: huge, maxBytes: 100 }],
  ])
    assert.throws(() => readOfflinePrivateEvidence(e, m, c), refusal);
  assert.equal(reflected, 0);
  assert.deepEqual(io.allocated, []);
  assert.deepEqual(io.opened, []);
});

test("sixteen selected references and exact 4 MiB total remain bounded and disposable", (t) => {
  const f = setup(
      t,
      Array.from({ length: 16 }, (_, i) => Buffer.alloc(MiB / 4, i + 1)),
    ),
    io = track(t);
  f.capture.references = f.envelope.evidence.items.map((i) => i.reference);
  f.capture.maxBytes = 4 * MiB;
  const handle = f.read();
  try {
    assert.equal(handle.complete().bytes, 4 * MiB);
    assert.equal(io.allocated.length, 17);
    f.contents.forEach((value, i) =>
      assert.deepEqual(io.allocated[i + 1], value),
    );
  } finally {
    handle.dispose();
  }
  zero(io.allocated);
});

test("root replacement and same-byte ancestor replacement invalidate pinned completion", (t) => {
  for (const where of ["root", "ancestor"]) {
    const f = setup(t),
      io = track(t),
      handle = f.read();
    const path = where === "root" ? f.root : join(f.root, "nested");
    fs.renameSync(path, path + "-old");
    fs.cpSync(path + "-old", path, { recursive: true });
    fs.chmodSync(path, 0o700);
    t.after(() => fs.rmSync(path + "-old", { recursive: true, force: true }));
    assert.throws(() => handle.complete(), refusal);
    zero(io.allocated);
    handle.dispose();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("stale handles cannot produce another summary; a historical summary is not authority", (t) => {
  const f = setup(t),
    handle = f.read();
  const summary = handle.complete();
  handle.dispose();
  fs.writeFileSync(
    join(f.root, f.manifest.files[0]!.path),
    "new private contents",
  );
  assert.equal(summary.qualification, "unverified");
  assert.equal(summary.status, "historical-byte-binding");
  assert.throws(() => handle.complete(), refusal);
  assert.throws(f.read, refusal);
});

test("locale-equivalent distinct references retain shared reader manifest tie ordering", (t) => {
  const f = setup(t);
  f.envelope.evidence.items[0]!.reference = "e\u0301";
  f.envelope.evidence.items[1]!.reference = "é";
  f.manifest.files.forEach((file, i) => {
    file.reference = f.envelope.evidence.items[i]!.reference;
  });
  f.manifest.files.reverse();
  f.capture.references = ["é"];
  f.capture.maxBytes = 100;
  const legacy = readRestorePrivateEvidence(
    new Map(f.envelope.evidence.items.map((i) => [i.reference, i.sha256])),
    f.manifest,
  );
  try {
    f.envelope.evidence.setHash = legacy.complete().setHash;
  } finally {
    legacy.discard();
  }
  const handle = f.read();
  try {
    assert.equal(handle.complete().setHash, f.envelope.evidence.setHash);
  } finally {
    handle.dispose();
  }
});
