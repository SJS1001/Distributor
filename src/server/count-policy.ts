import { check, integer, text } from "./core.ts";

export type CountReviewMode = "administrator" | "independent";
export type CountReviewPolicy = {
  mode: CountReviewMode;
  revision: number;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

export function countReviewMode(value: unknown): CountReviewMode {
  check(
    value === "administrator" || value === "independent",
    "VALIDATION",
    "Select administrator or independent count review.",
    400,
  );
  return value;
}

// Existing organization policies retain their provisional behavior until an
// administrator explicitly selects a reviewed policy. Malformed saved policy
// must never silently fall back to permissive approval.
export function readCountReviewPolicy(
  policy: Record<string, unknown>,
): CountReviewPolicy {
  check(
    policy && typeof policy === "object" && !Array.isArray(policy),
    "CONFIG",
    "Saved organization policy is invalid.",
    500,
  );
  if (!Object.hasOwn(policy, "inventoryCountReview"))
    return {
      mode: "administrator",
      revision: 1,
      reason: null,
      updatedBy: null,
      updatedAt: null,
    };
  const value = policy.inventoryCountReview as CountReviewPolicy;
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "CONFIG",
    "Saved count review policy is invalid.",
    500,
  );
  return {
    mode: countReviewMode(value.mode),
    revision: integer(value.revision, "count policy revision", 2),
    reason: text(value.reason, "count policy reason", 1000),
    updatedBy: text(value.updatedBy, "count policy reviewer"),
    updatedAt: text(value.updatedAt, "count policy timestamp"),
  };
}
