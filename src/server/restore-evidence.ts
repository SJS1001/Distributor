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
import { canonical, check, digest } from "./core.ts";
import {
  reviewRestoreDossier,
  type RestoreApproval,
  type RestoreApprover,
  type RestoreDossier,
} from "./restore-review.ts";

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
function evidenceReferences(dossier: RestoreDossier) {
  const references = new Map<string, string>();
  const items = [
    dossier.source.cutoff,
    dossier.operations.fencing,
    dossier.operations.routing,
    dossier.operations.rollback,
    ...dossier.organizations.flatMap((org) => [
      org.inventory,
      org.billing,
      org.access,
      org.residency,
      ...org.providers.map((provider) => provider.evidence),
    ]),
  ];
  for (const item of items) {
    const previous = references.get(item.reference);
    requireEvidence(
      !previous || previous === item.sha256,
      "One evidence reference cannot identify conflicting fingerprints.",
    );
    references.set(item.reference, item.sha256);
  }
  return references;
}

/** Read-only private-file verification. Callers reload the external trust registry
 * before and after file reads. Evidence bytes are never parsed, returned, copied
 * to the database or interpreted as proof of reconciliation/fencing/routing.
 * The operator must control the root's ancestors and exclude concurrent writers. */
export function reviewRestoreEvidence(
  candidatePath: string,
  dossier: RestoreDossier,
  approvals: RestoreApproval[],
  loadTrust: () => RestoreApprover[],
  manifest: RestoreEvidenceManifest,
  clock: () => number = Date.now,
) {
  const initial = reviewRestoreDossier(
    candidatePath,
    dossier,
    approvals,
    loadTrust(),
    clock(),
  );
  requireEvidence(
    manifest &&
      manifest.version === 1 &&
      typeof manifest.root === "string" &&
      isAbsolute(manifest.root) &&
      Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length <= 1000,
    "Use a version-one private evidence manifest with an absolute root and 1–1000 files.",
  );
  exactKeys(manifest, ["version", "root", "files"]);
  const expected = evidenceReferences(dossier),
    references = new Set<string>(),
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
    fingerprints: { reference: string; sha256: string; bytes: number }[] = [],
    buffer = Buffer.alloc(64 * 1024);
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
  // Candidate edits, expiry and authority revocation during evidence work refuse
  // the whole result. Neither an earlier review nor a cached fingerprint suffices.
  const reviewed = reviewRestoreDossier(
    candidatePath,
    dossier,
    approvals,
    loadTrust(),
    clock(),
  );
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
  const completedAt = clock();
  requireEvidence(
    Number.isFinite(completedAt) &&
      Date.parse(reviewed.reviewedAt) >= Date.parse(initial.reviewedAt) &&
      completedAt >= Date.parse(reviewed.reviewedAt) &&
      completedAt < Date.parse(reviewed.expiresAt),
    "Evidence review expired or its clock moved backwards.",
  );
  return {
    ...reviewed,
    status: "reviewed-evidence-isolated" as const,
    evidence: {
      files: fingerprints.length,
      bytes,
      setHash: digest(
        canonical(
          fingerprints.sort((a, b) => a.reference.localeCompare(b.reference)),
        ),
      ),
      verifiedAt: new Date(completedAt).toISOString(),
    },
  };
}
