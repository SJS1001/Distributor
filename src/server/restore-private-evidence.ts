import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type BigIntStats,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { types } from "node:util";
import { canonical, check, digest, DomainError } from "./core.ts";
export type RestoreEvidenceManifest = {
  version: 1;
  root: string;
  files: { reference: string; path: string }[];
};
const maxFileBytes = 64 * 1024 ** 2,
  maxTotalBytes = 256 * 1024 ** 2;
function requireEvidence(value: unknown, message: string): asserts value {
  check(value, "RESTORE_EVIDENCE", message);
}
function exactKeys(value: object, keys: string[]) {
  requireEvidence(
    canonical(Object.keys(value).sort()) === canonical(keys.sort()),
    "Unsupported evidence manifest fields.",
  );
}
function same(a: BigIntStats, b: BigIntStats) {
  return (
    [
      "dev",
      "ino",
      "size",
      "mtimeNs",
      "ctimeNs",
      "mode",
      "nlink",
      "uid",
      "gid",
    ] as const
  ).every((key) => a[key] === b[key]);
}
function privateDirectory(path: string) {
  const stat = lstatSync(path, { bigint: true });
  requireEvidence(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (Number(stat.mode) & 0o077) === 0 &&
      (!process.geteuid || stat.uid === BigInt(process.geteuid())),
    "Evidence requires operator-owned private directories without symlinks.",
  );
  return stat;
}
function privateFile(stat: BigIntStats) {
  requireEvidence(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1n &&
      stat.size > 0n &&
      stat.size <= BigInt(maxFileBytes) &&
      (Number(stat.mode) & 0o077) === 0 &&
      (!process.geteuid || stat.uid === BigInt(process.geteuid())),
    "Evidence requires nonempty operator-owned private regular files without links, up to 64 MiB each.",
  );
}

export type RestoreEvidenceCapture = {
  references: readonly string[];
  maxBytes: number;
};

// Data-only inputs: accessors, exotic prototypes and extra fields are unsupported.
function record(value: unknown, keys: string[]) {
  requireEvidence(
    value !== null &&
      typeof value === "object" &&
      !types.isProxy(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null),
    "Evidence requires plain data records.",
  );
  exactKeys(value, keys);
  requireEvidence(
    Reflect.ownKeys(value).length === keys.length &&
      Object.values(Object.getOwnPropertyDescriptors(value)).every(
        (d) => "value" in d && d.enumerable,
      ),
    "Evidence requires plain data fields.",
  );
}
function list(value: unknown, maximum: number): asserts value is unknown[] {
  requireEvidence(
    !types.isProxy(value) &&
      Array.isArray(value) &&
      Object.getPrototypeOf(value) === Array.prototype &&
      value.length > 0 &&
      value.length <= maximum &&
      Reflect.ownKeys(value).length === value.length + 1 &&
      Object.entries(Object.getOwnPropertyDescriptors(value)).every(
        ([key, d]) =>
          key === "length" ||
          (/^(0|[1-9][0-9]*)$/.test(key) &&
            Number(key) < value.length &&
            "value" in d &&
            d.enumerable),
      ),
    "Evidence requires a bounded dense data list.",
  );
}
function reference(value: unknown): asserts value is string {
  requireEvidence(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 2000,
    "Evidence requires a bounded nonempty reference.",
  );
}
function safeFailure(error: unknown): never {
  if (error instanceof DomainError && error.code === "RESTORE_EVIDENCE")
    throw error;
  // Preserve filesystem error codes (including EINTR), never paths, raw messages,
  // syscall arguments or a cause containing private input.
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  throw Object.assign(
    new Error("Private evidence verification did not complete."),
    {
      code:
        typeof code === "string" && /^E[A-Z0-9]+$/.test(code)
          ? code
          : "RESTORE_EVIDENCE",
    },
  );
}

/** Internal byte integrity reader, not evidence qualification or authority.
 * Reads close every descriptor before returning. Only complete() releases any
 * selected bytes, after rechecking pinned identities. Call discard() in finally.
 * Between read and complete the caller must revalidate its own current binding,
 * trust and phase. Root ancestors must be controlled and writers excluded.
 */
export function readRestorePrivateEvidence(
  expectedInput: ReadonlyMap<string, string>,
  manifestInput: RestoreEvidenceManifest,
  capture?: RestoreEvidenceCapture,
) {
  return readPrivateEvidence(expectedInput, manifestInput, capture, {
    references: 16,
    fileBytes: 1024 ** 2,
    totalBytes: 4 * 1024 ** 2,
  });
}

/** Fixed original-journal profile; other reader callers retain legacy limits. */
export function readRestorePrivateOriginalEvidence(
  expectedInput: ReadonlyMap<string, string>,
  manifestInput: RestoreEvidenceManifest,
  capture: RestoreEvidenceCapture,
) {
  return readPrivateEvidence(expectedInput, manifestInput, capture, {
    references: 1,
    fileBytes: 16_016_384,
    totalBytes: 16_016_384,
  });
}
function readPrivateEvidence(
  expectedInput: ReadonlyMap<string, string>,
  manifestInput: RestoreEvidenceManifest,
  capture: RestoreEvidenceCapture | undefined,
  profile: { references: number; fileBytes: number; totalBytes: number },
) {
  const captures = new Map<string, Buffer>();
  const buffer = Buffer.alloc(64 * 1024);
  let active = true;
  const discard = () => {
    active = false;
    for (const bytes of captures.values()) bytes.fill(0);
    captures.clear();
  };
  try {
    record(manifestInput, ["version", "root", "files"]);
    list(manifestInput.files, 1000);
    requireEvidence(
      manifestInput.version === 1 &&
        typeof manifestInput.root === "string" &&
        isAbsolute(manifestInput.root) &&
        manifestInput.root.length <= 4096 &&
        !manifestInput.root.includes("\0"),
      "Use a version-one private evidence manifest with an absolute root and 1–1000 files.",
    );
    for (const file of manifestInput.files) record(file, ["reference", "path"]);
    const manifest: RestoreEvidenceManifest = {
      version: 1,
      root: manifestInput.root,
      files: manifestInput.files.map((file) => ({
        reference: file.reference,
        path: file.path,
      })),
    };
    requireEvidence(
      !types.isProxy(expectedInput) &&
        expectedInput instanceof Map &&
        Object.getPrototypeOf(expectedInput) === Map.prototype &&
        Reflect.ownKeys(expectedInput).length === 0 &&
        expectedInput.size > 0 &&
        expectedInput.size <= 1000,
      "Evidence requires an exact bounded reference-to-digest map.",
    );
    const expected = new Map<string, string>();
    Map.prototype.forEach.call(
      expectedInput,
      (sha256: unknown, ref: unknown) => {
        reference(ref);
        requireEvidence(
          typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256),
          "Evidence requires a lowercase SHA256 fingerprint.",
        );
        expected.set(ref, sha256);
      },
    );
    const selected = new Set<string>();
    let captureLimit = 0,
      capturedBytes = 0;
    if (capture !== undefined) {
      record(capture, ["references", "maxBytes"]);
      list(capture.references, profile.references);
      requireEvidence(
        Number.isSafeInteger(capture.maxBytes) &&
          capture.maxBytes > 0 &&
          capture.maxBytes <= profile.totalBytes,
        "Explicit evidence capture requires a positive budget within its fixed profile.",
      );
      captureLimit = capture.maxBytes;
      for (const ref of capture.references) {
        reference(ref);
        requireEvidence(
          expected.has(ref) && !selected.has(ref),
          "Capture only distinct expected evidence references.",
        );
        selected.add(ref);
      }
    }
    const captureSize = (size: number) => {
      requireEvidence(
        size <= profile.fileBytes && capturedBytes + size <= captureLimit,
        "Selected evidence exceeds the capture byte limit.",
      );
      capturedBytes += size;
      return size;
    };
    const references = new Set<string>(),
      paths = new Set<string>(),
      root = resolve(manifest.root);
    const retainedDirectories = new Map<string, BigIntStats>();
    const directory = (path: string) => {
      const stat = privateDirectory(path),
        previous = retainedDirectories.get(path);
      requireEvidence(
        !previous || same(previous, stat),
        "Evidence directory changed during verification.",
      );
      retainedDirectories.set(path, stat);
    };
    directory(root);
    // Validate exact coverage and all names before opening any evidence file.
    for (const file of manifest.files) {
      requireEvidence(
        file && typeof file === "object",
        "Evidence file mapping is required.",
      );
      exactKeys(file, ["reference", "path"]);
      requireEvidence(
        typeof file.reference === "string" &&
          expected.has(file.reference) &&
          !references.has(file.reference),
        "Map every signed evidence reference exactly once, without extras.",
      );
      requireEvidence(
        typeof file.path === "string" &&
          file.path.length > 0 &&
          file.path.length <= 2000 &&
          !isAbsolute(file.path) &&
          !/[\\\u0000]/.test(file.path) &&
          file.path
            .split("/")
            .every((part) => part && part !== "." && part !== "..") &&
          !paths.has(file.path),
        "Evidence paths must be distinct relative paths below the private root, without traversal.",
      );
      references.add(file.reference);
      paths.add(file.path);
    }
    requireEvidence(
      references.size === expected.size,
      "Evidence manifest is incomplete.",
    );
    let bytes = 0;
    const retainedFiles: { path: string; stat: BigIntStats }[] = [],
      fingerprints: { reference: string; sha256: string; bytes: number }[] = [];
    for (const file of manifest.files) {
      let parent = root;
      directory(parent);
      for (const part of file.path.split("/").slice(0, -1)) {
        parent = join(parent, part);
        directory(parent);
      }
      const path = join(root, file.path),
        before = lstatSync(path, { bigint: true });
      privateFile(before);
      requireEvidence(
        bytes + Number(before.size) <= maxTotalBytes,
        "Evidence exceeds the 256 MiB review limit.",
      );
      const captured = selected.has(file.reference)
        ? Buffer.alloc(captureSize(Number(before.size)))
        : undefined;
      if (captured) captures.set(file.reference, captured);
      const descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const opened = fstatSync(descriptor, { bigint: true });
        privateFile(opened);
        requireEvidence(
          same(before, opened),
          "Evidence file identity changed before reading.",
        );
        const hash = createHash("sha256");
        let count = 0,
          read: number;
        while (
          (read = readSync(descriptor, buffer, 0, buffer.length, null)) > 0
        ) {
          count += read;
          requireEvidence(
            count <= maxFileBytes && bytes + count <= maxTotalBytes,
            "Evidence grew beyond the review limit.",
          );
          if (captured) {
            requireEvidence(
              count <= captured.length,
              "Evidence capture grew beyond its limit.",
            );
            buffer.copy(captured, count - read, 0, read);
          }
          hash.update(buffer.subarray(0, read));
        }
        const after = fstatSync(descriptor, { bigint: true }),
          fingerprint = hash.digest("hex");
        requireEvidence(
          same(opened, after) &&
            same(after, lstatSync(path, { bigint: true })) &&
            count === Number(after.size),
          "Evidence changed during reading.",
        );
        requireEvidence(
          fingerprint === expected.get(file.reference),
          "Evidence bytes differ from the signed fingerprint.",
        );
        bytes += count;
        fingerprints.push({
          reference: file.reference,
          sha256: fingerprint,
          bytes: count,
        });
        retainedFiles.push({ path, stat: after });
      } finally {
        closeSync(descriptor);
      }
    }

    return Object.freeze({
      discard,
      complete() {
        requireEvidence(
          active,
          "Private evidence read is already completed or discarded.",
        );
        active = false;
        try {
          for (const [path, stat] of retainedDirectories)
            requireEvidence(
              same(stat, privateDirectory(path)),
              "Evidence directory changed before completion.",
            );
          for (const { path, stat } of retainedFiles)
            requireEvidence(
              same(stat, lstatSync(path, { bigint: true })),
              "Evidence changed before completion.",
            );

          const result = {
            files: fingerprints.length,
            bytes,
            setHash: digest(
              canonical(
                fingerprints.sort((a, b) =>
                  a.reference.localeCompare(b.reference),
                ),
              ),
            ),
            captured: new Map(captures) as ReadonlyMap<string, Buffer>,
          };
          // Transfer private allocations only on success. discard() must not erase
          // bytes already handed to the caller, which now owns their lifetime.
          captures.clear();
          return result;
        } catch (error) {
          discard();
          safeFailure(error);
        }
      },
    });
  } catch (error) {
    discard();
    safeFailure(error);
  } finally {
    buffer.fill(0);
  }
}
