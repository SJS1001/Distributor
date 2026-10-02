export type SupplierChoice = { id: string; name: string };
export type SupplierPage = {
  items: SupplierChoice[];
  next: string | null;
};
