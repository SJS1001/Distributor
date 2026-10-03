import { check, integer, text } from "./core.ts";
// A local finance dossier, not a transport authorization or provider receipt.
export type JournalReconciliationDate = {
  postingDate: string;
  debit: number;
  credit: number;
  journal: {
    id: string;
    reviewHash: string;
    requestRef: string;
    realm: string;
    bindingId: string;
    state: string;
    historyHash: string;
    posted: {
      externalId: string;
      syncToken: string;
      observationHash: string;
      revision: number;
      recordedBy: string;
      recordedAt: string;
    } | null;
  } | null;
};
export type JournalReconciliationSnapshot = {
  version: 1;
  packetId: string;
  organizationId: string;
  contentHash: string;
  region: "CA" | "US";
  currency: string;
  debit: number;
  credit: number;
  receiverRef: string | null;
  dates: JournalReconciliationDate[];
};
export type JournalReconciliationAttestation = {
  journalId: string;
  postingDate: string;
  externalId: string;
  syncToken: string;
  debit: number;
  credit: number;
  evidenceRef: string;
};
export type JournalReconciliationInput = {
  packetId: string;
  contentHash: string;
  reviewHash: string;
  externalRef: string;
  reason: string;
  confirmation: "all-dates-reconciled";
  journals: JournalReconciliationAttestation[];
};
export type JournalReconciliationReceipt = {
  reviewHash: string;
  snapshot: JournalReconciliationSnapshot;
  journals: JournalReconciliationAttestation[];
};
export function reconciliationControls(
  dates: JournalReconciliationDate[],
  rows: JournalReconciliationAttestation[],
) {
  return (
    Array.isArray(rows) &&
    rows.length === dates.length &&
    rows.every((row, i) => {
      const date = dates[i]!,
        journal = date.journal,
        posted = journal?.posted;
      return (
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        Object.keys(row).sort().join("|") ===
          "credit|debit|evidenceRef|externalId|journalId|postingDate|syncToken" &&
        posted &&
        row.journalId === journal.id &&
        row.postingDate === date.postingDate &&
        row.externalId === posted.externalId &&
        row.syncToken === posted.syncToken &&
        row.debit === date.debit &&
        row.credit === date.credit &&
        typeof row.evidenceRef === "string" &&
        row.evidenceRef.length > 0 &&
        row.evidenceRef.length <= 1000 &&
        row.evidenceRef.trim() === row.evidenceRef
      );
    })
  );
}
function exact(input: unknown, keys: string[]) {
  check(
    input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).sort().join("|") === keys.sort().join("|"),
    "COST_RECONCILIATION_INPUT",
    "Use the exact reconciliation fields.",
    400,
  );
}
function exactText(value: unknown, label: string, maximum: number) {
  check(
    text(value, label, maximum) === value,
    "COST_RECONCILIATION_INPUT",
    "Reviewed reconciliation text must have no surrounding whitespace.",
    400,
  );
}
export function reconciliationInput(raw: JournalReconciliationInput) {
  const input = structuredClone(raw);
  exact(input, [
    "packetId",
    "contentHash",
    "reviewHash",
    "externalRef",
    "reason",
    "confirmation",
    "journals",
  ]);
  exactText(input.packetId, "Cost packet identity", 160);
  exactText(input.externalRef, "Independent reconciliation reference", 160);
  exactText(input.reason, "Independent reconciliation evidence", 2000);
  check(
    input.confirmation === "all-dates-reconciled" &&
      typeof input.contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(input.contentHash) &&
      typeof input.reviewHash === "string" &&
      /^[a-f0-9]{64}$/.test(input.reviewHash) &&
      Array.isArray(input.journals) &&
      input.journals.length > 0 &&
      input.journals.length <= 500,
    "COST_RECONCILIATION_INPUT",
    "Confirm the exact complete source-date review.",
    400,
  );
  for (const row of input.journals) {
    exact(row, [
      "journalId",
      "postingDate",
      "externalId",
      "syncToken",
      "debit",
      "credit",
      "evidenceRef",
    ]);
    exactText(row.journalId, "Native journal identity", 160);
    exactText(row.evidenceRef, "Independent ledger evidence", 1000);
    check(
      typeof row.postingDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.postingDate) &&
        typeof row.externalId === "string" &&
        /^[1-9][0-9]{0,29}$/.test(row.externalId) &&
        typeof row.syncToken === "string" &&
        /^[0-9]{1,2000}$/.test(row.syncToken),
      "COST_RECONCILIATION_INPUT",
      "Use exact native date, identity and synchronization evidence.",
      400,
    );
    integer(row.debit, "Reconciled debit", 0, Number.MAX_SAFE_INTEGER);
    integer(row.credit, "Reconciled credit", 0, Number.MAX_SAFE_INTEGER);
  }
  return input;
}
