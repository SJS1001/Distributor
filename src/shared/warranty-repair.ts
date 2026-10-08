export type WarrantyRepairReview = {
  claimId: string;
  unitId: string;
  unitRevision: number;
  serial: string;
  warehouseId: string;
  accountId: string;
  shipmentId: string;
  invoiceId: string;
  coverageEnd: string;
};

export type WarrantyRepairHandoverInput = {
  claimId: string;
  unitRevision: number;
  serial: string;
  recipient: string;
  evidence: string;
  reason: string;
};

export type WarrantyRepairHandoverReceipt = {
  claimId: string;
  unitId: string;
  unitRevision: number;
  serial: string;
  state: "disposed";
  recipient: string;
  evidence: string;
  reason: string;
  completedAt: string;
  shipmentId: string;
  invoiceId: string;
  coverageEnd: string;
};
