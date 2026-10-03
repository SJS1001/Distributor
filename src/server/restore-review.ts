import { createPublicKey, verify } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonical, check, digest, integer, text } from "./core.ts";
import { inspectConnection } from "./schema.ts";
import {
  pinRestoreCandidateFiles,
  readRestoreCandidateSnapshot,
  type RestoreCandidate,
} from "./restore-candidate-snapshot.ts";
import {
  providerNames,
  type ProviderName,
} from "../shared/provider-choices.ts";

type Evidence = { reference: string; sha256: string };
export type { RestoreCandidate } from "./restore-candidate-snapshot.ts";
export type RestoreDossier = {
  version: 1;
  preparedBy: string;
  preparedAt: string;
  expiresAt: string;
  candidate: RestoreCandidate;
  source: {
    identity: string;
    logicalHash: string;
    durableCursor: string;
    auditSequence: number;
    cutoff: Evidence;
  };
  organizations: {
    orgId: string;
    inventory: Evidence;
    billing: Evidence;
    access: Evidence;
    residency: Evidence;
    providers: {
      provider: ProviderName;
      outcome: "reconciled" | "not-used" | "unknown";
      evidence: Evidence;
    }[];
  }[];
  operations: {
    fencing: Evidence;
    routing: Evidence;
    rollback: Evidence;
    sourceWriters: string[];
    candidateWriters: string[];
    rollbackMode: "source-before-effects-forward-recovery-after-effects";
    rpoMinutes: number;
    rtoMinutes: number;
  };
};
export type RestoreApprover = {
  id: string;
  role: "finance" | "security";
  publicKey: string;
};
export type RestoreApproval = {
  signerId: string;
  role: "finance" | "security";
  dossierHash: string;
  signature: string;
};
const sha = (value: string) => {
  check(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "RESTORE_REVIEW",
    "Evidence requires a lowercase SHA256 fingerprint.",
  );
  return value;
};
const evidence = (value: Evidence) => {
  check(
    value && typeof value === "object",
    "RESTORE_REVIEW",
    "Evidence is required.",
  );
  text(value.reference, "Evidence reference", 2000);
  sha(value.sha256);
};
function instant(raw: string) {
  check(
    typeof raw === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw) &&
      Number.isFinite(Date.parse(raw)) &&
      new Date(raw).toISOString() === raw,
    "RESTORE_REVIEW",
    "Use an exact UTC timestamp.",
  );
  return Date.parse(raw);
}

/** Filesystem-authorized read-only maintenance: bind every persisted application
 * business row, including sessions, grants, policies, effects and audit, to one SQLite
 * snapshot. No row values or credentials leave this function. A hash is not
 * external reconciliation or proof that infrastructure writers are fenced. */
export function captureRestoreCandidate(path: string): RestoreCandidate {
  const unchanged = pinRestoreCandidateFiles(path);
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; BEGIN");
    // Establish the read snapshot before allowing SQLite-created read sidecars.
    inspectConnection(db);
    unchanged(true);
    const candidate = readRestoreCandidateSnapshot(db);
    db.exec("COMMIT");
    unchanged();
    return candidate;
  } catch (error) {
    // A sidecar swap may first surface as a SQLite error. Prefer the stable
    // boundary failure when the filesystem evidence proves a concurrent change.
    unchanged();
    throw error;
  } finally {
    db.close();
  }
}
export function restoreApprovalMessage(
  dossierHash: string,
  signerId: string,
  role: RestoreApprover["role"],
) {
  return canonical({
    purpose: "distributor-restore-review-v1",
    dossierHash: sha(dossierHash),
    signerId: text(signerId, "Approver ID"),
    role,
  });
}

/** Review readiness only. Never clears RECOVERY_HOLD, sends provider requests,
 * changes routing or treats the operators' signed evidence as measured reality. */
export function reviewRestoreDossier(
  path: string,
  dossier: RestoreDossier,
  approvals: RestoreApproval[],
  trustedApprovers: RestoreApprover[],
  at: number | (() => number) = Date.now,
) {
  check(
    dossier && dossier.version === 1,
    "RESTORE_REVIEW",
    "Unsupported restore dossier.",
  );
  const clock = typeof at === "function" ? at : () => at,
    startedAt = clock(),
    preparer = text(dossier.preparedBy, "Preparer ID"),
    preparedAt = instant(dossier.preparedAt),
    expiresAt = instant(dossier.expiresAt);
  check(
    dossier.preparedBy === preparer &&
      Number.isFinite(startedAt) &&
      preparedAt <= startedAt &&
      expiresAt > startedAt &&
      expiresAt > preparedAt &&
      expiresAt - preparedAt <= 15 * 60 * 1000,
    "RESTORE_REVIEW",
    "Review must bind a fresh frozen candidate; maximum validity is fifteen minutes.",
  );
  const candidate = captureRestoreCandidate(path);
  check(
    canonical(candidate) === canonical(dossier.candidate),
    "RESTORE_REVIEW_CHANGED",
    "Persisted candidate, schema, organization set or restore identity changed.",
  );
  check(
    dossier.source &&
      dossier.operations &&
      Array.isArray(dossier.organizations),
    "RESTORE_REVIEW",
    "Source, operations and organization evidence are required.",
  );
  text(dossier.source.identity, "Authoritative source identity", 2000);
  sha(dossier.source.logicalHash);
  text(dossier.source.durableCursor, "Source durable cursor", 2000);
  integer(
    dossier.source.auditSequence,
    "Source audit sequence",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  evidence(dossier.source.cutoff);
  const orgIds = dossier.organizations.map((o) => o.orgId).sort();
  check(
    canonical(orgIds) ===
      canonical(candidate.organizations.map((o) => o.id).sort()),
    "RESTORE_REVIEW",
    "Reconcile every organization exactly once.",
  );
  for (const org of dossier.organizations) {
    for (const item of [org.inventory, org.billing, org.access, org.residency])
      evidence(item);
    check(
      Array.isArray(org.providers) &&
        canonical(org.providers.map((p) => p.provider).sort()) ===
          canonical([...providerNames].sort()),
      "RESTORE_REVIEW",
      "Every named provider needs an explicit outcome review for each organization.",
    );
    for (const provider of org.providers) {
      check(
        ["reconciled", "not-used"].includes(provider.outcome),
        "RESTORE_OUTCOME_UNKNOWN",
        "Unknown provider outcomes keep the restored store isolated.",
      );
      evidence(provider.evidence);
    }
  }
  const ops = dossier.operations;
  for (const item of [ops.fencing, ops.routing, ops.rollback]) evidence(item);
  for (const writers of [ops.sourceWriters, ops.candidateWriters]) {
    check(
      Array.isArray(writers) &&
        writers.length > 0 &&
        writers.length <= 1000 &&
        new Set(writers).size === writers.length,
      "RESTORE_REVIEW",
      "List each app, worker, CLI and callback writer authority in the fencing evidence.",
    );
    for (const writer of writers)
      check(
        writer === text(writer, "Writer authority", 1000),
        "RESTORE_REVIEW",
        "Writer authority identities must not contain surrounding whitespace.",
      );
  }
  check(
    !ops.sourceWriters.some((w) => ops.candidateWriters.includes(w)),
    "RESTORE_REVIEW",
    "Source and candidate writer authorities must be separately fenced.",
  );
  check(
    ops.rollbackMode === "source-before-effects-forward-recovery-after-effects",
    "RESTORE_REVIEW",
    "Rollback must distinguish pre-effect restoration from post-effect reconciliation/forward recovery.",
  );
  integer(ops.rpoMinutes, "Rehearsal RPO minutes", 1, 10080);
  integer(ops.rtoMinutes, "Rehearsal RTO minutes", 1, 43200);
  const dossierHash = digest(canonical(dossier));
  assertRestoreApprovals(dossier, approvals, trustedApprovers, startedAt);
  const completedAt = clock();
  check(
    Number.isFinite(completedAt) &&
      completedAt >= startedAt &&
      completedAt < expiresAt,
    "RESTORE_REVIEW",
    "Restore review expired or its clock moved backwards.",
  );
  return {
    version: 1,
    dossierHash,
    candidateHash: candidate.logicalHash,
    reviewedAt: new Date(completedAt).toISOString(),
    expiresAt: dossier.expiresAt,
    approvers: approvals.map((a) => ({ id: a.signerId, role: a.role })),
    status: "reviewed-isolated",
    providerHold: true,
    activationAuthorized: false,
  } as const;
}

/** Revalidate retained signatures against current external authority. This does not
 * recapture the candidate or authorize any release by itself. */
export function assertRestoreApprovals(
  dossier: RestoreDossier,
  approvals: RestoreApproval[],
  trustedApprovers: RestoreApprover[],
  at: number,
) {
  const preparer = text(dossier.preparedBy, "Preparer ID");
  check(
    preparer === dossier.preparedBy &&
      Number.isFinite(at) &&
      at >= instant(dossier.preparedAt) &&
      at < instant(dossier.expiresAt),
    "RESTORE_APPROVAL",
    "Release approvals are expired or not current.",
  );
  assertRestoreSignatures(
    digest(canonical(dossier)),
    preparer,
    approvals,
    trustedApprovers,
    restoreApprovalMessage,
  );
}

export function assertRestoreSignatures(
  dossierHash: string,
  preparer: string,
  approvals: RestoreApproval[],
  trustedApprovers: RestoreApprover[],
  message: typeof restoreApprovalMessage,
) {
  check(
    Array.isArray(approvals) &&
      approvals.length === 2 &&
      Array.isArray(trustedApprovers),
    "RESTORE_APPROVAL",
    "Separate finance and security approvals are required.",
  );
  check(
    trustedApprovers.every(
      (a) =>
        a &&
        typeof a.id === "string" &&
        a.id.length > 0 &&
        a.id.length <= 160 &&
        a.id === a.id.trim() &&
        ["finance", "security"].includes(a.role) &&
        typeof a.publicKey === "string",
    ) &&
      new Set(trustedApprovers.map((a) => a.id)).size ===
        trustedApprovers.length,
    "RESTORE_APPROVAL",
    "Trusted approvers require unique exact identities, roles and public keys.",
  );
  const identities = new Set<string>(),
    keys = new Set<string>(),
    roles = new Set<string>();
  for (const approval of approvals) {
    check(
      approval &&
        typeof approval.signerId === "string" &&
        approval.signerId === approval.signerId.trim(),
      "RESTORE_APPROVAL",
      "Approval must identify an exact trusted person.",
    );
    const trusted = trustedApprovers.find(
      (a) => a.id === approval.signerId && a.role === approval.role,
    );
    check(
      trusted &&
        ["finance", "security"].includes(approval.role) &&
        approval.signerId !== preparer &&
        approval.dossierHash === dossierHash,
      "RESTORE_APPROVAL",
      "Approval must come from a current trusted finance/security approver distinct from the preparer.",
    );
    const key = createPublicKey(trusted.publicKey);
    check(
      key.asymmetricKeyType === "ed25519",
      "RESTORE_APPROVAL",
      "Restore approval requires an Ed25519 public key.",
    );
    const keyHash = digest(key.export({ type: "spki", format: "der" }));
    check(
      !identities.has(trusted.id) &&
        !keys.has(keyHash) &&
        !roles.has(approval.role),
      "RESTORE_APPROVAL",
      "Finance and security need distinct people and signing keys.",
    );
    check(
      typeof approval.signature === "string" &&
        /^[A-Za-z0-9+/]{86}==$/.test(approval.signature) &&
        verify(
          null,
          Buffer.from(message(dossierHash, trusted.id, approval.role)),
          key,
          Buffer.from(approval.signature, "base64"),
        ),
      "RESTORE_APPROVAL",
      "Invalid approval signature.",
    );
    identities.add(trusted.id);
    keys.add(keyHash);
    roles.add(approval.role);
  }
}
