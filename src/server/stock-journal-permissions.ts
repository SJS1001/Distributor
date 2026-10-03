import { canonical, check, digest, integer, text } from "./core.ts";
import type { LedgerAuthority } from "./organization-residency.ts";

export type JournalPermissionInput = {
  journalId: string;
  reviewHash: string;
  previousPermissionHash: string;
  authority: LedgerAuthority;
  mode: "write" | "lookup";
  reason: string;
};
export type JournalPermissionDecision = {
  journalId: string;
  permissionReviewId: string;
  permissionReviewHash: string;
  decision: "approve" | "reject";
  reason: string;
};
type Observation = {
  revision: number;
  hash: string;
  body: unknown;
  recordedBy: string;
  recordedAt: string;
};
export type PermissionReview = {
  id: string;
  input: JournalPermissionInput;
  reviewHash: string;
  observation: Observation;
  decision: Observation | null;
};
function exact(value: unknown, keys: string[]) {
  check(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("|") === keys.sort().join("|"),
    "JOURNAL_PERMISSION_INPUT",
    "Use the exact permission review fields.",
  );
}
function hash(value: string) {
  check(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "JOURNAL_PERMISSION_INPUT",
    "Invalid permission review hash.",
  );
}
export function permissionInput(
  input: JournalPermissionInput,
  original?: LedgerAuthority,
) {
  exact(input, [
    "journalId",
    "reviewHash",
    "previousPermissionHash",
    "authority",
    "mode",
    "reason",
  ]);
  text(input.journalId, "Journal identity", 160);
  hash(input.reviewHash);
  hash(input.previousPermissionHash);
  text(input.reason, "Permission review reason", 2000);
  check(
    input.mode === "write" || input.mode === "lookup",
    "JOURNAL_PERMISSION_INPUT",
    "Invalid permission operation.",
  );
  exact(input.authority, [
    "provider",
    "purpose",
    "environment",
    "orgId",
    "region",
    "realm",
    "revision",
    "disclosureId",
    "disclosureHash",
  ]);
  text(input.authority.orgId, "Organization identity", 160);
  check(
    input.authority.provider === "quickbooks" &&
      input.authority.purpose === "stock-cost-journal" &&
      input.authority.environment === "sandbox" &&
      ["CA", "US"].includes(input.authority.region) &&
      typeof input.authority.realm === "string" &&
      /^[1-9][0-9]{0,29}$/.test(input.authority.realm),
    "JOURNAL_PERMISSION_SCOPE",
    "Use an organization QuickBooks stock-journal sandbox permission.",
  );
  integer(
    input.authority.revision,
    "Permission revision",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  text(input.authority.disclosureId, "Disclosure identity", 160);
  hash(input.authority.disclosureHash);
  const scope = ({
    revision: _revision,
    disclosureId: _id,
    disclosureHash: _hash,
    ...rest
  }: LedgerAuthority) => rest;
  check(
    !original ||
      canonical(scope(input.authority)) === canonical(scope(original)),
    "JOURNAL_PERMISSION_SCOPE",
    "Replacement permission must retain the original organization, region, company and operation.",
  );
}
export function permissionDecision(input: JournalPermissionDecision) {
  exact(input, [
    "journalId",
    "permissionReviewId",
    "permissionReviewHash",
    "decision",
    "reason",
  ]);
  text(input.journalId, "Journal identity", 160);
  text(input.permissionReviewId, "Permission review identity", 160);
  hash(input.permissionReviewHash);
  text(input.reason, "Permission decision reason", 2000);
  check(
    input.decision === "approve" || input.decision === "reject",
    "JOURNAL_PERMISSION_INPUT",
    "Invalid permission decision.",
  );
}

// The integration owner verifies every observation's outer integrity before
// reducing this append-only chain. Permission reviews never rewrite a plan.
export function journalPermissions(
  journalId: string,
  reviewHash: string,
  original: LedgerAuthority,
  observations: Observation[],
) {
  let authority = original,
    mode: "write" | "lookup" = "write";
  const reviews = new Map<string, PermissionReview>();
  for (const observation of observations) {
    const body = observation.body as Record<string, unknown> | null;
    if (body?.kind === "permission-replacement.review") {
      exact(body, ["kind", "version", "id", "input", "reviewHash"]);
      check(
        body.version === 1,
        "JOURNAL_INTEGRITY",
        "Unknown permission review version.",
      );
      const input = body.input as JournalPermissionInput;
      permissionInput(input, original);
      text(body.id, "Permission review identity", 160);
      check(
        input.journalId === journalId &&
          input.reviewHash === reviewHash &&
          body.reviewHash === digest(canonical(input)) &&
          !reviews.has(String(body.id)),
        "JOURNAL_INTEGRITY",
        "Permission review differs from its frozen journal or hash.",
      );
      reviews.set(String(body.id), {
        id: String(body.id),
        input,
        reviewHash: String(body.reviewHash),
        observation,
        decision: null,
      });
    } else if (body?.kind === "permission-replacement.decision") {
      exact(body, ["kind", "version", "input"]);
      check(
        body.version === 1,
        "JOURNAL_INTEGRITY",
        "Unknown permission decision version.",
      );
      const input = body.input as JournalPermissionDecision;
      permissionDecision(input);
      const review = reviews.get(input.permissionReviewId);
      check(
        input.journalId === journalId &&
          review &&
          !review.decision &&
          review.reviewHash === input.permissionReviewHash &&
          review.observation.recordedBy !== observation.recordedBy,
        "JOURNAL_INTEGRITY",
        "Permission decision lacks its exact independent review.",
      );
      if (input.decision === "approve") {
        check(
          review.input.previousPermissionHash ===
            digest(canonical(authority)) &&
            canonical(review.input.authority) !== canonical(authority) &&
            (mode !== "lookup" || review.input.mode === "lookup"),
          "JOURNAL_INTEGRITY",
          "Approved permission replacement has a broken authority chain.",
        );
        authority = review.input.authority;
        mode = review.input.mode;
      }
      review.decision = observation;
    }
  }
  return { authority, mode, reviews };
}
