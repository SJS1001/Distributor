import { isAbsolute } from "node:path";
import { canonical, check } from "./core.ts";
import {
  readRestorePrivateEvidence,
  type RestoreEvidenceManifest,
} from "./restore-private-evidence.ts";
export type { RestoreEvidenceManifest } from "./restore-private-evidence.ts";
import {
  reviewRestoreDossier,
  type RestoreApproval,
  type RestoreApprover,
  type RestoreDossier,
} from "./restore-review.ts";

function requireEvidence(value: unknown, message: string): asserts value {
  check(value, "RESTORE_EVIDENCE", message);
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
  // Keep the release envelope errors ahead of conflicting dossier references.
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
  requireEvidence(
    canonical(Object.keys(manifest).sort()) ===
      canonical(["files", "root", "version"]),
    "Unsupported evidence manifest fields.",
  );
  const pending = readRestorePrivateEvidence(
    evidenceReferences(dossier),
    manifest,
  );
  try {
    // Candidate edits, expiry and authority revocation during evidence work refuse
    // the whole result. Neither an earlier review nor a cached fingerprint suffices.
    const reviewed = reviewRestoreDossier(
      candidatePath,
      dossier,
      approvals,
      loadTrust(),
      clock(),
    );
    const evidence = pending.complete();
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
        files: evidence.files,
        bytes: evidence.bytes,
        setHash: evidence.setHash,
        verifiedAt: new Date(completedAt).toISOString(),
      },
    };
  } finally {
    pending.discard();
  }
}
