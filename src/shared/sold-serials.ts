export type SoldSerial = {
  id: string;
  productId: string;
  serial: string;
  accountId: string;
};
export type SoldSerialPage = { items: SoldSerial[]; next: string | null };
