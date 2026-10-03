import { canonical, check, text } from "./core.ts";

export type OriginalCancellationEvidenceInput = {
  journalId: string;
  reviewHash: string;
  requestRef: string;
  externalRef: string;
  evidence: string;
  cancellationFinal: true;
  nonPostingVerified: true;
  noLaterPosting: true;
};
export type OriginalCancellationInput = {
  journalId: string;
  requestRef: string;
  evidenceHash: string;
  reason: string;
};
function exact(value: unknown, fields: string[]) {
  check(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      canonical(Object.keys(value).sort()) === canonical(fields.sort()),
    "JOURNAL_CANCELLATION_INPUT",
    "Use the exact original cancellation fields.",
  );
}
function hash(value: unknown) {
  check(
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    "JOURNAL_CANCELLATION_INPUT",
    "Invalid cancellation evidence hash.",
  );
}
function reference(value: unknown) {
  check(
    typeof value === "string" && /^DJ-[a-f0-9]{18}$/.test(value),
    "JOURNAL_CANCELLATION_INPUT",
    "Use the exact native request reference.",
  );
}
export function originalCancellationEvidenceInput(
  input: OriginalCancellationEvidenceInput,
) {
  exact(input, [
    "journalId",
    "reviewHash",
    "requestRef",
    "externalRef",
    "evidence",
    "cancellationFinal",
    "nonPostingVerified",
    "noLaterPosting",
  ]);
  text(input.journalId, "Journal identity", 160);
  hash(input.reviewHash);
  reference(input.requestRef);
  text(input.externalRef, "Receiver cancellation case reference", 160);
  text(input.evidence, "Final cancellation and non-posting evidence", 2000);
  check(
    input.cancellationFinal === true &&
      input.nonPostingVerified === true &&
      input.noLaterPosting === true,
    "JOURNAL_CANCELLATION_EVIDENCE",
    "Attest final cancellation, verified non-posting and prevention of later posting for this exact request. A lookup miss is insufficient.",
  );
}
export function originalCancellationInput(input: OriginalCancellationInput) {
  exact(input, ["journalId", "requestRef", "evidenceHash", "reason"]);
  text(input.journalId, "Journal identity", 160);
  reference(input.requestRef);
  hash(input.evidenceHash);
  text(input.reason, "Independent cancellation review reason", 2000);
}
