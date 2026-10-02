import { canonical, check, digest, id, type Actor } from "./core.ts";
import {
  reconciliationMaxBytes,
  type Reconciliation,
  type ReconciliationReceipt,
} from "../shared/reconciliation.ts";

export const reconciliationCommand = "operations.reconciliation.prepare";
export type RetainedReconciliation = ReconciliationReceipt & {
  content: string;
};
export function reconciliationHash(
  orgId: string,
  report: Omit<Reconciliation, "snapshotHash">,
) {
  const { version, currency, stock, billing, sales } = report;
  return digest(canonical({ orgId, version, currency, stock, billing, sales }));
}
export function retainReconciliation(
  actor: Actor,
  report: Reconciliation,
): RetainedReconciliation {
  const receiptId = id();
  const content =
    canonical({
      format: "distributor.reconciliation",
      formatVersion: 1,
      receiptId,
      orgId: actor.orgId,
      preparedBy: actor.id,
      report,
      limits: {
        detailsPerControl: 100,
        independentPhysicalBankProviderVerification: false,
        productGateAcceptance: false,
      },
    }) + "\n";
  const bytes = Buffer.byteLength(content);
  check(
    bytes <= reconciliationMaxBytes,
    "REPORT_SIZE",
    "The reconciliation report exceeds the retained document limit.",
    413,
  );
  return {
    id: receiptId,
    checkedAt: report.checkedAt,
    currency: report.currency,
    preparedBy: actor.id,
    snapshotHash: report.snapshotHash,
    discrepancies:
      report.stock.issues.count +
      report.billing.issues.count +
      report.sales.issues.count,
    filename: `reconciliation-${receiptId}.json`,
    bytes,
    contentHash: digest(content),
    content,
  };
}
export function validateReconciliation(
  value: unknown,
  orgId: string,
): RetainedReconciliation {
  try {
    const r = value as RetainedReconciliation;
    if (
      !r ||
      typeof r.content !== "string" ||
      !Number.isSafeInteger(r.bytes) ||
      r.bytes < 1 ||
      r.bytes > reconciliationMaxBytes ||
      Buffer.byteLength(r.content) !== r.bytes ||
      digest(r.content) !== r.contentHash
    )
      throw Error();
    const doc = JSON.parse(r.content);
    const report = doc.report as Reconciliation;
    if (
      doc.format !== "distributor.reconciliation" ||
      doc.formatVersion !== 1 ||
      doc.orgId !== orgId ||
      doc.receiptId !== r.id ||
      !/^[a-f0-9-]{36}$/.test(r.id) ||
      doc.preparedBy !== r.preparedBy ||
      typeof r.preparedBy !== "string" ||
      !r.preparedBy ||
      r.filename !== `reconciliation-${r.id}.json` ||
      report.version !== 1 ||
      !["CAD", "USD"].includes(report.currency) ||
      report.currency !== r.currency ||
      report.checkedAt !== r.checkedAt ||
      !Number.isFinite(Date.parse(r.checkedAt)) ||
      report.snapshotHash !== r.snapshotHash ||
      reconciliationHash(orgId, report) !== r.snapshotHash
    )
      throw Error();
    const counts = [
      report.stock.issues.count,
      report.billing.issues.count,
      report.sales.issues.count,
    ];
    if (
      counts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
      counts.reduce((a, b) => a + b, 0) !== r.discrepancies ||
      !Number.isSafeInteger(r.discrepancies)
    )
      throw Error();
    return r;
  } catch {
    check(
      false,
      "REPORT_INTEGRITY",
      "Retained reconciliation evidence is unavailable. Investigate the original receipt.",
      503,
    );
    throw Error("Unreachable");
  }
}
export function reconciliationMetadata(
  r: RetainedReconciliation,
): ReconciliationReceipt {
  return {
    id: r.id,
    checkedAt: r.checkedAt,
    currency: r.currency,
    preparedBy: r.preparedBy,
    snapshotHash: r.snapshotHash,
    discrepancies: r.discrepancies,
    filename: r.filename,
    bytes: r.bytes,
    contentHash: r.contentHash,
  };
}
