import { readFileSync, lstatSync } from "node:fs";
import {
  captureRestoreCandidate,
  reviewRestoreDossier,
  type RestoreDossier,
  type RestoreApproval,
  type RestoreApprover,
} from "./restore-review.ts";
import { check, DomainError } from "./core.ts";
import {
  reviewRestoreEvidence,
  type RestoreEvidenceManifest,
} from "./restore-evidence.ts";
function input(path: string) {
  const stat = lstatSync(path);
  check(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= 1024 * 1024 &&
      (stat.mode & 0o077) === 0,
    "RESTORE_REVIEW",
    "Evidence and trust files require private regular files (0600), at most 1 MiB.",
  );
  return JSON.parse(readFileSync(path, "utf8"));
}
try {
  const [action, candidate, dossier, approvals, trust, manifest] =
    process.argv.slice(2);
  check(
    candidate &&
      ((action === "capture" && process.argv.length === 4) ||
        (action === "review" &&
          process.argv.length === 7 &&
          dossier &&
          approvals &&
          trust) ||
        (action === "verify-evidence" &&
          process.argv.length === 8 &&
          dossier &&
          approvals &&
          trust &&
          manifest)),
    "CLI",
    "Usage: restore-review capture <candidate.db> | restore-review review <candidate.db> <dossier.json> <approvals.json> <trusted-approvers.json> | restore-review verify-evidence <candidate.db> <dossier.json> <approvals.json> <trusted-approvers.json> <manifest.json>",
    400,
  );
  const result =
    action === "capture"
      ? captureRestoreCandidate(candidate)
      : action === "verify-evidence"
        ? reviewRestoreEvidence(
            candidate,
            input(dossier!) as RestoreDossier,
            input(approvals!) as RestoreApproval[],
            () => input(trust!) as RestoreApprover[],
            input(manifest!) as RestoreEvidenceManifest,
          )
        : reviewRestoreDossier(
            candidate,
            input(dossier!) as RestoreDossier,
            input(approvals!) as RestoreApproval[],
            input(trust!) as RestoreApprover[],
          );
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "RESTORE_REVIEW_FAILED"}: Restore review did not complete; provider hold and routing remain unchanged.\n`,
  );
  process.exitCode = 1;
}
