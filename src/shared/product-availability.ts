/** Customer-facing availability advice; never a warehouse inventory balance. */
export type ProductAvailability = {
  productId: string;
  hidden: boolean;
  outOfStock: boolean;
  expectedAvailableOn: string | null;
  revision: number;
};
export type ProductAvailabilityInput = ProductAvailability & { reason: string };
