export type IncomingCommitment = {
  id: string;
  lineId: string;
  poId: string;
  purchaseLineId: string;
  quantity: number;
  pendingQuantity: number;
  heldQuantity: number;
  convertedQuantity: number;
  releasedQuantity: number;
  priority: number;
  reason: string;
  createdAt: string;
};
export type IncomingCandidate = {
  poId: string;
  purchaseLineId: string;
  productId: string;
  description: string;
  supplierName: string;
  remainingQuantity: number;
  availableQuantity: number;
};
export type IncomingSupplyReview = {
  orderId: string;
  revision: number;
  state: string;
  lines: {
    lineId: string;
    productId: string;
    description: string;
    outstanding: number;
    allocated: number;
    incoming: number;
    held: number;
    uncovered: number;
  }[];
  commitments: IncomingCommitment[];
  candidates: IncomingCandidate[];
};
