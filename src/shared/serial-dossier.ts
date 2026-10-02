import type { StockHistoryPage } from "./stock-history.ts";

export type SerialDossierInput = {
  serial: string;
  movementAfter?: string;
  shipmentAfter?: string;
  claimAfter?: string;
};
export type SerialReceipt = {
  id: string;
  purchaseOrderId: string;
  warehouseId: string;
  supplierId: string;
  deliveryReference: string;
  receivedAt: string;
};
export type SerialShipment = {
  id: string;
  orderId: string;
  accountId: string;
  warehouseId: string;
  mode: string;
  carrier: string | null;
  tracking: string | null;
  shippedAt: string;
  invoiceId: string | null;
  invoice: {
    id: string;
    number: string;
    currency: string;
    total: number;
    createdAt: string;
  } | null;
};
export type SerialClaim = {
  id: string;
  accountId: string;
  unitId: string;
  shipmentId: string;
  invoiceId: string;
  type: string;
  state: string;
  issue: string;
  coverageEnd: string;
  disposition: string | null;
  creditId: string | null;
  createdAt: string;
  relationship: "claimed" | "replacement";
  replacementState: string | null;
};
export type SerialDossier = {
  movements: StockHistoryPage;
  receipt: SerialReceipt | null;
  shipments: { items: SerialShipment[]; next: string | null };
  claims: { items: SerialClaim[]; next: string | null };
};
