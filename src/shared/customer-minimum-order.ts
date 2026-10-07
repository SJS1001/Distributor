export type CustomerMinimumOrder = {
  accountId: string;
  currency: string;
  minimumSubtotal: number;
  minimumEquipmentQuantity: number;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  canManage: boolean;
};
export type SaveCustomerMinimumOrder = {
  accountId: string;
  expectedRevision: number;
  minimumSubtotal: number;
  minimumEquipmentQuantity: number;
  reason: string;
};
/** Equipment uses the catalog's serialized classification; bulk goods are accessories. */
export function minimumOrderAssessment(
  policy: Pick<
    CustomerMinimumOrder,
    "currency" | "minimumSubtotal" | "minimumEquipmentQuantity"
  >,
  lines: readonly {
    quantity: number;
    unitPrice: number;
    serialized: number | boolean;
  }[],
) {
  const subtotal = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );
  const equipmentQuantity = lines.reduce(
    (sum, line) =>
      sum +
      (line.serialized === 1 || line.serialized === true ? line.quantity : 0),
    0,
  );
  const missingSubtotal = Math.max(0, policy.minimumSubtotal - subtotal);
  const missingEquipmentQuantity = Math.max(
    0,
    policy.minimumEquipmentQuantity - equipmentQuantity,
  );
  const needs = [];
  if (missingSubtotal)
    needs.push(
      `${new Intl.NumberFormat("en-CA", { style: "currency", currency: policy.currency }).format(missingSubtotal / 100)} more merchandise before tax and freight`,
    );
  if (missingEquipmentQuantity)
    needs.push(
      `${missingEquipmentQuantity} more equipment unit${missingEquipmentQuantity === 1 ? "" : "s"}`,
    );
  return {
    subtotal,
    equipmentQuantity,
    missingSubtotal,
    missingEquipmentQuantity,
    met: !needs.length,
    message: needs.length
      ? `Customer minimum order: add ${needs.join(" and ")}.`
      : "Customer minimum order met.",
  };
}
