// Synthetic fixtures only. No provider transport or actual finance qualification.
import { fixture } from "./fixtures.ts";
import type {
  CorrectionOutcomeInput,
  CorrectionInput,
  CostPolicyInput,
} from "../src/server/cost-corrections.ts";
type Fixture = ReturnType<typeof fixture>;
export function setup(f: Fixture) {
  const source = f.app.integration.costs.source(f.actor);
  const prepared = f.app.integration.costs.prepare(f.actor, "original", {
    version: 1,
    batchRef: "ORIGINAL",
    afterSequence: 0,
    throughSequence: source.throughSequence,
    inventoryAccount: "1200",
    mappings: [{ type: "receipt", offsetAccount: "2100" }],
    expectedMovements: 3,
    expectedIncrease: 18000,
    expectedDecrease: 0,
    expectedOpeningValue: 0,
    expectedClosingValue: 18000,
    acknowledgment: "Synthetic independent controls",
  });
  const original = f.app.integration.costs.decide(f.actor, "approve-original", {
    packetId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic finance review",
  });
  const u = f.app.identity.createUser(f.actor, "reviewer", {
    email: "finance@example.test",
    name: "Synthetic reviewer",
    password: "test-only-long-password",
    role: "finance",
    sites: [],
  });
  const reviewer = f.app.identity.currentActor({ ...f.actor, id: u.id });
  return { original, reviewer };
}
export function policy(previousRevision = 0): CostPolicyInput {
  return {
    previousRevision,
    policyVersion: "synthetic-policy-v1",
    mappingVersion: "synthetic-chart-v2",
    establishedValuation:
      "Synthetic established specific identification; no new valuation calculation",
    period: "monthly",
    closedThrough: "2026-09-30",
    inventoryPostingOwner: "distributor",
    inventoryAccount: "1201",
    mappings: [{ type: "receipt", offsetAccount: "2101" }],
    financeEvidence: "Synthetic finance policy approval",
  };
}
export function input(
  original: ReturnType<typeof setup>["original"],
  outcome: CorrectionInput["outcome"] = "posted",
): CorrectionInput {
  return {
    originalId: original.id,
    originalHash: original.contentHash!,
    policyRevision: 1,
    postingDate: "2026-10-03",
    outcome,
    receiverRef: "synthetic-ledger",
    externalRef: "synthetic-journal-1",
    originalPostingDate: outcome === "posted" ? "2026-09-29" : null,
    outcomeEvidence: "Synthetic ledger outcome checked independently",
    cancellationEvidence:
      outcome === "unposted"
        ? "Synthetic receiver cancelled original, verified no posting"
        : null,
    priorPeriodEvidence:
      "Synthetic responsible accountant reviewed prior period treatment",
    reason: "Correct two synthetic account mappings",
  };
}
export function approvedCorrection(
  f: Fixture,
  originalOutcome: CorrectionInput["outcome"] = "posted",
) {
  const { original, reviewer } = setup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "policy", policy());
  const prepared = c.prepare(
    f.actor,
    "correction",
    input(original, originalOutcome),
  );
  const approved = c.decide(reviewer, "approve", {
    correctionId: prepared.id,
    reviewHash: prepared.reviewHash,
    decision: "approve",
    reason: "Synthetic independent approval",
  });
  return { original, reviewer, approved, c };
}
export function outcomeInput(
  f: Fixture,
  correctionId: string,
  leg: "reversal" | "replacement",
  overrides: Partial<CorrectionOutcomeInput> = {},
): CorrectionOutcomeInput {
  const state = f.app.integration.costs.corrections.outcomes(
      f.actor,
      correctionId,
    ),
    journal = state.legs.find((l) => l.leg === leg)!;
  return {
    correctionId,
    ...(journal.attemptId ? { attemptId: journal.attemptId } : {}),
    contentHash: state.contentHash,
    leg,
    previousRevision: journal.current?.revision ?? 0,
    outcome: "unknown",
    receiverRef: state.receiverRef,
    receiverRegion: state.receiverRegion,
    currency: state.currency,
    externalRef: journal.externalRef ?? `synthetic-${leg}`,
    debit: journal.debit,
    credit: journal.credit,
    postingDate: null,
    evidence: "Synthetic receiver request is uncertain; no success inferred",
    ...overrides,
  };
}
