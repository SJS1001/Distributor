import { check, integer, text } from "./core.ts";
import type { CoveragePolicyReview } from "../shared/warranty-coverage.ts";
export function coverageDate(value: unknown): string {
  check(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "COVERAGE_DATE",
    "Coverage requires a valid retained UTC date.",
  );
  return value;
}
export function coverageDays(value: unknown): number {
  check(
    Number.isSafeInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= 36500,
    "COVERAGE_POLICY",
    "Provisional coverage duration must be a whole number of days from 0 to 36500.",
  );
  return value as number;
}
export function readCoveragePolicy(
  policy: Record<string, unknown>,
): CoveragePolicyReview {
  check(
    policy && typeof policy === "object" && !Array.isArray(policy),
    "CONFIG",
    "Saved organization policy is invalid.",
    500,
  );
  if (!Object.hasOwn(policy, "warrantyCoverage"))
    return {
      revision: 1,
      days: coverageDays(policy.coverageDays),
      configuredAt: null,
      reason: null,
      configuredBy: null,
    };
  const saved = policy.warrantyCoverage as CoveragePolicyReview;
  check(
    saved && typeof saved === "object" && !Array.isArray(saved),
    "CONFIG",
    "Saved warranty coverage policy is invalid.",
    500,
  );
  return {
    revision: integer(saved.revision, "coverage policy revision", 2),
    days: coverageDays(saved.days),
    configuredAt: coverageDate(saved.configuredAt),
    reason: text(saved.reason, "coverage policy review reason", 1000),
    configuredBy: text(saved.configuredBy, "coverage policy reviewer"),
  };
}
