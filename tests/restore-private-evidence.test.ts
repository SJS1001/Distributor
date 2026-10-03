import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonical, digest } from "../src/server/core.ts";
import {
  readRestorePrivateEvidence,
  type RestoreEvidenceCapture,
  type RestoreEvidenceManifest,
} from "../src/server/restore-private-evidence.ts";

const refusal = { code: "RESTORE_EVIDENCE" };
const MiB = 1024 ** 2;

test("data-only evidence inputs refuse proxies before invoking any caller trap or opening files", (t) => {
  const f = setup(t),
    io = trackIO(t);
  for (const revoked of [false, true])
    for (const field of [
      "manifest",
      "files",
      "file",
      "expected",
      "capture",
      "references",
    ] as const) {
      let invoked = false;
      const trap = () => {
        invoked = true;
        throw new Error("caller proxy trap executed");
      };
      const proxy = <T extends object>(value: T): T => {
        const pair = Proxy.revocable(value, {
          get: trap,
          getPrototypeOf: trap,
          ownKeys: trap,
          getOwnPropertyDescriptor: trap,
        });
        if (revoked) pair.revoke();
        return pair.proxy;
      };
      const manifest = {
        ...f.manifest,
        files: f.manifest.files.map((file) => ({ ...file })),
      };
      const capture = { references: ["synthetic:0"], maxBytes: 1024 };
      if (field === "files") manifest.files = proxy(manifest.files);
      if (field === "file") manifest.files[0] = proxy(manifest.files[0]!);
      if (field === "references")
        capture.references = proxy(capture.references);
      assert.throws(
        () =>
          readRestorePrivateEvidence(
            field === "expected" ? proxy(f.expected) : f.expected,
            field === "manifest" ? proxy(manifest) : manifest,
            field === "capture" ? proxy(capture) : capture,
          ),
        refusal,
        field,
      );
      assert.equal(invoked, false, field);
    }
  assert.deepEqual(io.descriptors, []);
});

function setup(
  t: TestContext,
  contents = [
    Buffer.from("synthetic CA report\n"),
    Buffer.from("synthetic US report\n"),
  ],
) {
  const root = fs.mkdtempSync(join(tmpdir(), "restore-private-"));
  fs.chmodSync(root, 0o700);
  t.after(() => {
    const nested = join(root, "nested");
    if (fs.existsSync(nested) && fs.lstatSync(nested).isDirectory())
      fs.chmodSync(nested, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(join(root, "nested"), { mode: 0o700 });
  const manifest: RestoreEvidenceManifest = {
    version: 1,
    root,
    files: contents.map((_, i) => ({
      reference: `synthetic:${i}`,
      path: i === 0 ? "first" : `nested/file-${i}`,
    })),
  };
  const expected = new Map<string, string>();
  for (const [i, file] of manifest.files.entries()) {
    fs.writeFileSync(join(root, file.path), contents[i]!, { mode: 0o600 });
    expected.set(file.reference, digest(contents[i]!));
  }
  const read = (capture?: RestoreEvidenceCapture) =>
    readRestorePrivateEvidence(expected, manifest, capture);
  return { root, manifest, expected, contents, read };
}

// Observe actual synchronous file IO; never replace the filesystem with fake data.
function trackIO(t: TestContext) {
  const open = fs.openSync,
    read = fs.readSync,
    close = fs.closeSync;
  const descriptors: number[] = [],
    closed: number[] = [],
    lengths: number[] = [],
    buffers: Buffer[] = [];
  const hooks = [
    t.mock.method(fs, "openSync", ((
      ...args: Parameters<typeof fs.openSync>
    ) => {
      assert.equal(typeof args[1], "number");
      assert.ok((Number(args[1]) & fs.constants.O_NOFOLLOW) !== 0);
      assert.ok((Number(args[1]) & fs.constants.O_NONBLOCK) !== 0);
      const fd = Reflect.apply(open, fs, args);
      descriptors.push(fd);
      return fd;
    }) as typeof fs.openSync),
    t.mock.method(fs, "readSync", ((
      ...args: Parameters<typeof fs.readSync>
    ) => {
      lengths.push(Number((args as unknown[])[3]));
      buffers.push(args[1] as Buffer);
      return Reflect.apply(read, fs, args);
    }) as typeof fs.readSync),
    t.mock.method(fs, "closeSync", (fd: number) => {
      closed.push(fd);
      return close(fd);
    }),
  ];
  syncBuiltinESMExports();
  const restore = () => {
    for (const hook of hooks) hook.mock.restore();
    syncBuiltinESMExports();
  };
  t.after(restore);
  return { descriptors, closed, lengths, buffers, restore };
}

function closed(io: ReturnType<typeof trackIO>) {
  assert.deepEqual(io.closed, io.descriptors);
  for (const fd of io.descriptors)
    assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
}

test("private read has no dossier dependency, captures nothing by default and returns only the legacy byte summary", (t) => {
  const f = setup(t),
    io = trackIO(t),
    pending = f.read();
  closed(io);
  assert.deepEqual(Object.keys(pending).sort(), ["complete", "discard"]);
  assert.equal(JSON.stringify(pending), "{}");
  const result = pending.complete();
  assert.deepEqual(result, {
    files: 2,
    bytes: f.contents.reduce((n, value) => n + value.length, 0),
    setHash: digest(
      canonical(
        f.manifest.files.map((file, i) => ({
          reference: file.reference,
          sha256: f.expected.get(file.reference),
          bytes: f.contents[i]!.length,
        })),
      ),
    ),
    captured: new Map(),
  });
  assert.equal("verified" in result, false);
  assert.equal("root" in result, false);
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.ok(io.lengths.every((size) => size === 64 * 1024));
  assert.throws(() => pending.complete(), refusal);
  pending.discard();
});

test("selected capture is the exact hashed multibuffer bytes, detached from inputs, stream and subsequent path writes", (t) => {
  const content = Buffer.alloc(150003);
  for (let i = 0; i < content.length; i++) content[i] = i % 251;
  const f = setup(t, [content, Buffer.from("unselected bytes")]);
  const config = { references: ["synthetic:0"], maxBytes: content.length };
  const io = trackIO(t),
    pending = f.read(config);
  closed(io);
  f.manifest.root = "/not-the-pinned-root";
  f.manifest.files[0]!.path = "not-the-pinned-path";
  f.expected.clear();
  config.references[0] = "synthetic:1";
  config.maxBytes = 0;
  for (const buffer of io.buffers) buffer.fill(255);
  const result = pending.complete(),
    captured = result.captured.get("synthetic:0")!;
  assert.equal(result.captured.size, 1);
  assert.deepEqual(captured, content);
  assert.equal(digest(captured), digest(content));
  assert.notEqual(captured.buffer, content.buffer);
  assert.ok(io.buffers.every((buffer) => buffer.buffer !== captured.buffer));
  pending.discard();
  fs.writeFileSync(
    join(f.root, "first"),
    "changed after completed byte integrity check",
  );
  assert.deepEqual(captured, content);
  captured.fill(0);
  assert.notDeepEqual(captured, content);
});

test("capture accepts the exact per-file and aggregate bounds without capturing unselected large reports", (t) => {
  const f = setup(t, [
    Buffer.alloc(MiB, 1),
    Buffer.alloc(MiB, 2),
    Buffer.alloc(MiB, 3),
    Buffer.alloc(MiB, 4),
    Buffer.alloc(MiB + 1, 5),
  ]);
  const pending = f.read({
    references: [...f.expected.keys()].slice(0, 4),
    maxBytes: 4 * MiB,
  });
  const result = pending.complete();
  assert.equal(result.files, 5);
  assert.equal(result.captured.size, 4);
  assert.equal(
    [...result.captured.values()].reduce((n, value) => n + value.length, 0),
    4 * MiB,
  );
  assert.equal(result.captured.has("synthetic:4"), false);
  for (const [ref, value] of result.captured)
    assert.equal(digest(value), f.expected.get(ref));
});

test("capture refuses unknown, repeated, excessive or malformed selection and budgets before opening files", (t) => {
  const f = setup(t),
    io = trackIO(t);
  const bad: unknown[] = [
    null,
    {},
    [],
    { references: [], maxBytes: 1 },
    { references: ["unknown"], maxBytes: 1 },
    { references: ["synthetic:0", "synthetic:0"], maxBytes: 100 },
    { references: Array(17).fill("synthetic:0"), maxBytes: 100 },
    { references: [17], maxBytes: 100 },
    { references: ["synthetic:0"], maxBytes: 100, complete: () => {} },
    ...[0, -1, 0.5, NaN, Infinity, "100", 4 * MiB + 1].map((maxBytes) => ({
      references: ["synthetic:0"],
      maxBytes,
    })),
  ];
  for (const capture of bad)
    assert.throws(() => f.read(capture as RestoreEvidenceCapture), refusal);
  assert.deepEqual(io.descriptors, []);
});

test("capture refuses actual per-file and aggregate overrun with no partial result or open descriptors", (t) => {
  for (const contents of [
    [Buffer.alloc(MiB + 1)],
    [Buffer.alloc(10), Buffer.alloc(11)],
  ]) {
    const f = setup(t, contents),
      io = trackIO(t);
    let pending: ReturnType<typeof f.read> | undefined;
    assert.throws(() => {
      pending = f.read({
        references: [...f.expected.keys()],
        maxBytes: contents.length === 1 ? 4 * MiB : 20,
      });
    }, refusal);
    assert.equal(pending, undefined);
    closed(io);
    io.restore();
  }
});

test("shared reader independently refuses malformed digest maps even without a release dossier", (t) => {
  const f = setup(t),
    io = trackIO(t);
  const bad: unknown[] = [
    null,
    {},
    [],
    new Map(),
    new Map([["synthetic:0", "A".repeat(64)]]),
    new Map([["synthetic:0", "0".repeat(63)]]),
    new Map([["synthetic:0", 7]]),
    new Map([[" ", "0".repeat(64)]]),
    new Map([["x".repeat(2001), "0".repeat(64)]]),
    new Map([[{}, "0".repeat(64)]]),
    new Map(
      Array.from({ length: 1001 }, (_, i) => [String(i), "0".repeat(64)]),
    ),
    Object.assign(new Map(f.expected), { extra: true }),
  ];
  for (const expected of bad)
    assert.throws(
      () =>
        readRestorePrivateEvidence(expected as Map<string, string>, f.manifest),
      refusal,
    );
  assert.deepEqual(io.descriptors, []);
});

test("manifest structure, exact coverage and safe relative paths are checked before opening any evidence", (t) => {
  const f = setup(t),
    io = trackIO(t);
  const variants: unknown[] = [
    null,
    [],
    {},
    { ...f.manifest, version: 2 },
    { ...f.manifest, root: "relative" },
    { ...f.manifest, root: f.root + "\0suffix" },
    { ...f.manifest, extra: true },
    { ...f.manifest, files: [] },
    { ...f.manifest, files: Array(1001).fill(f.manifest.files[0]) },
    { ...f.manifest, files: [f.manifest.files[0]] },
    { ...f.manifest, files: [...f.manifest.files, { ...f.manifest.files[0] }] },
    {
      ...f.manifest,
      files: [
        f.manifest.files[0],
        { ...f.manifest.files[1], reference: "extra" },
      ],
    },
    {
      ...f.manifest,
      files: [f.manifest.files[0], { ...f.manifest.files[1], path: "first" }],
    },
  ];
  for (const path of [
    "",
    "../first",
    "/absolute",
    "nested/../first",
    "nested//file",
    "./first",
    "nested/",
    "nested\\file",
    "first\0end",
    "x".repeat(2001),
    4,
  ])
    variants.push({
      ...f.manifest,
      files: [{ ...f.manifest.files[0], path }, f.manifest.files[1]],
    });
  for (const file of [
    null,
    [],
    {},
    { ...f.manifest.files[0], extra: true },
    { ...f.manifest.files[0], reference: 4 },
  ])
    variants.push({ ...f.manifest, files: [file, f.manifest.files[1]] });
  const sparse = new Array(2);
  sparse[0] = f.manifest.files[0];
  Object.assign(sparse, { extra: f.manifest.files[1] });
  variants.push({ ...f.manifest, files: sparse });
  const accessor = { ...f.manifest };
  Object.defineProperty(accessor, "root", {
    enumerable: true,
    get() {
      assert.fail("untrusted accessor executed");
    },
  });
  variants.push(accessor, { ...f.manifest, [Symbol("extra")]: true });
  for (const manifest of variants)
    assert.throws(
      () =>
        readRestorePrivateEvidence(
          f.expected,
          manifest as RestoreEvidenceManifest,
        ),
      refusal,
    );
  assert.deepEqual(io.descriptors, []);
});

for (const attack of [
  "root-link",
  "parent-link",
  "file-link",
  "hardlink",
  "root-mode",
  "parent-mode",
  "file-mode",
  "empty",
  "oversized",
  "directory",
  "fifo",
] as const)
  test(`private filesystem refuses ${attack} without returning captured data`, (t) => {
    const f = setup(t),
      first = join(f.root, "first");
    if (attack === "root-link") {
      fs.symlinkSync(f.root, join(f.root, "alias"));
      f.manifest.root = join(f.root, "alias");
    }
    if (attack === "parent-link") {
      fs.symlinkSync(join(f.root, "nested"), join(f.root, "alias"));
      f.manifest.files[1]!.path = "alias/file-1";
    }
    if (attack === "file-link") {
      fs.symlinkSync(first, join(f.root, "alias"));
      f.manifest.files[0]!.path = "alias";
    }
    if (attack === "hardlink") fs.linkSync(first, join(f.root, "alias"));
    if (attack === "root-mode") fs.chmodSync(f.root, 0o750);
    if (attack === "parent-mode") fs.chmodSync(join(f.root, "nested"), 0o755);
    if (attack === "file-mode") fs.chmodSync(first, 0o640);
    if (attack === "empty") fs.truncateSync(first, 0);
    if (attack === "oversized") fs.truncateSync(first, 64 * MiB + 1);
    if (attack === "directory") {
      fs.unlinkSync(first);
      fs.mkdirSync(first, { mode: 0o700 });
    }
    if (attack === "fifo") {
      fs.unlinkSync(first);
      const child = spawnSync("mkfifo", ["-m", "600", first], {
        timeout: 5000,
      });
      assert.equal(child.status, 0);
    }
    const io = trackIO(t);
    assert.throws(
      () => f.read({ references: ["synthetic:0"], maxBytes: 100 }),
      refusal,
    );
    closed(io);
  });

for (const attack of [
  "same-byte-replacement",
  "content",
  "private-file-mode",
  "private-parent-mode",
  "parent-link",
  "root-link",
  "hardlink",
  "deleted",
] as const)
  test(`completion refuses ${attack} after the stream; failed captures cannot be retrieved or retried`, (t) => {
    const f = setup(t),
      file = join(f.root, "nested/file-1");
    const pending = f.read({
      references: ["synthetic:0", "synthetic:1"],
      maxBytes: 100,
    });
    if (attack === "same-byte-replacement") {
      const child = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "import fs from 'node:fs'; const p=process.argv[1]; fs.renameSync(p,p+'.old'); fs.copyFileSync(p+'.old',p); fs.chmodSync(p,0o600);",
          file,
        ],
        { timeout: 5000 },
      );
      assert.equal(child.status, 0);
    }
    if (attack === "content")
      fs.writeFileSync(file, Buffer.alloc(f.contents[1]!.length, 9));
    if (attack === "private-file-mode") fs.chmodSync(file, 0o400);
    if (attack === "private-parent-mode")
      fs.chmodSync(join(f.root, "nested"), 0o500);
    if (attack === "parent-link") {
      fs.renameSync(join(f.root, "nested"), join(f.root, "retained"));
      fs.symlinkSync(join(f.root, "retained"), join(f.root, "nested"));
    }
    if (attack === "root-link") {
      // The root path itself is replaced; cleanup explicitly retains both names.
      fs.renameSync(f.root, f.root + "-retained");
      fs.symlinkSync(f.root + "-retained", f.root);
      t.after(() =>
        fs.rmSync(f.root + "-retained", { recursive: true, force: true }),
      );
    }
    if (attack === "hardlink") fs.linkSync(file, join(f.root, "linked"));
    if (attack === "deleted") fs.unlinkSync(file);
    let result: ReturnType<typeof pending.complete> | undefined;
    assert.throws(() => {
      result = pending.complete();
    });
    assert.equal(result, undefined);
    assert.throws(() => pending.complete(), {
      code: "RESTORE_EVIDENCE",
      message: "Private evidence read is already completed or discarded.",
    });
    pending.discard();
  });

test("discard after a caller's authority failure makes captured bytes permanently inaccessible", (t) => {
  const f = setup(t),
    pending = f.read({ references: ["synthetic:0"], maxBytes: 100 });
  assert.throws(() => {
    try {
      throw new Error("synthetic revoked authority");
    } finally {
      pending.discard();
    }
  }, /synthetic revoked authority/);
  assert.throws(() => pending.complete(), refusal);
  assert.equal(JSON.stringify(pending), "{}");
});

test("all descriptors close on later hash mismatch and no earlier captured result escapes", (t) => {
  const f = setup(t),
    io = trackIO(t);
  f.expected.set("synthetic:1", "0".repeat(64));
  let pending: ReturnType<typeof f.read> | undefined;
  assert.throws(
    () => {
      pending = f.read({ references: ["synthetic:0"], maxBytes: 100 });
    },
    {
      code: "RESTORE_EVIDENCE",
      message: "Evidence bytes differ from the signed fingerprint.",
    },
  );
  assert.equal(pending, undefined);
  assert.equal(io.descriptors.length, 2);
  closed(io);
});

test("interrupted stream closes its descriptor and sanitizes filesystem messages/paths while retaining EINTR", (t) => {
  const f = setup(t),
    io = trackIO(t),
    original = fs.readSync;
  let reads = 0;
  const hook = t.mock.method(fs, "readSync", ((
    ...args: Parameters<typeof fs.readSync>
  ) => {
    if (++reads === 2)
      throw Object.assign(new Error(`private report at ${f.root}`), {
        code: "EINTR",
        path: f.root,
      });
    return Reflect.apply(original, fs, args);
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => f.read({ references: ["synthetic:0"], maxBytes: 100 }),
      (error: unknown) => {
        assert.equal((error as NodeJS.ErrnoException).code, "EINTR");
        assert.equal(String(error).includes(f.root), false);
        assert.equal(JSON.stringify(error).includes(f.root), false);
        assert.equal("cause" in (error as Error), false);
        return true;
      },
    );
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
  }
  closed(io);
  assert.ok(io.buffers.every((buffer) => buffer.every((byte) => byte === 0)));
});

test("missing paths remain sanitized in initial reads and final completion", (t) => {
  const f = setup(t),
    pending = f.read({ references: ["synthetic:0"], maxBytes: 100 });
  fs.unlinkSync(join(f.root, "nested/file-1"));
  // Deletion changes the parent identity first; neither refusal exposes its path.
  for (const attempt of [() => f.read(), () => pending.complete()])
    assert.throws(attempt, (error: unknown) => {
      assert.equal(String(error).includes(f.root), false);
      assert.equal(JSON.stringify(error).includes(f.root), false);
      return true;
    });
});

for (const change of ["growth", "already-read-file", "parent"] as const)
  test(`mutation during a later stream (${change}) cannot expose any captured result`, (t) => {
    const f = setup(t),
      io = trackIO(t),
      original = fs.readSync;
    let changed = false;
    const hook = t.mock.method(fs, "readSync", ((
      ...args: Parameters<typeof fs.readSync>
    ) => {
      const count = Reflect.apply(original, fs, args);
      if (
        !changed &&
        count > 0 &&
        (change === "growth" || io.descriptors.length === 2)
      ) {
        changed = true;
        if (change === "growth")
          fs.appendFileSync(join(f.root, "first"), "new bytes");
        if (change === "already-read-file")
          fs.writeFileSync(join(f.root, "first"), f.contents[0]!);
        if (change === "parent") fs.chmodSync(join(f.root, "nested"), 0o500);
      }
      return count;
    }) as typeof fs.readSync);
    syncBuiltinESMExports();
    let pending: ReturnType<typeof f.read> | undefined, result: unknown;
    try {
      assert.throws(() => {
        pending = f.read({ references: ["synthetic:0"], maxBytes: 100 });
        result = pending.complete();
      }, refusal);
    } finally {
      pending?.discard();
      hook.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(changed, true);
    assert.equal(result, undefined);
    closed(io);
  });

test("same-byte file swap between lstat and open refuses capture and closes the opened replacement", (t) => {
  const f = setup(t),
    io = trackIO(t),
    original = fs.openSync;
  let replaced = false;
  const hook = t.mock.method(fs, "openSync", ((
    ...args: Parameters<typeof fs.openSync>
  ) => {
    if (!replaced) {
      replaced = true;
      const file = join(f.root, "first");
      fs.renameSync(file, file + ".retained");
      fs.copyFileSync(file + ".retained", file);
      fs.chmodSync(file, 0o600);
    }
    return Reflect.apply(original, fs, args);
  }) as typeof fs.openSync);
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => f.read({ references: ["synthetic:0"], maxBytes: 100 }),
      {
        code: "RESTORE_EVIDENCE",
        message: "Evidence file identity changed before reading.",
      },
    );
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
  }
  assert.equal(replaced, true);
  closed(io);
});
