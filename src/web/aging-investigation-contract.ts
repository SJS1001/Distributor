export type AgingInvoice = {
  id: string;
  number: string;
  currency: string;
  dueAt: string | null;
  dueBasis: string;
  bucket: string;
  balance: number;
  total: number;
  credited: number;
  paid: number;
  refunded: number;
  pendingRefunds: number;
};
export const agingFilters = {
  open: "Open balances",
  unknownDue: "Unknown due date",
  overdue: "Overdue balances",
  credit: "Credit balances",
  pendingRefunds: "Pending refunds",
  all: "All invoice records",
} as const;
export type AgingFilter = keyof typeof agingFilters;
export function agingMatches(invoice: AgingInvoice, filter: AgingFilter) {
  switch (filter) {
    case "open":
      return invoice.balance > 0;
    case "unknownDue":
      return invoice.balance > 0 && invoice.bucket === "unknownDue";
    case "overdue":
      return (
        invoice.balance > 0 &&
        ["days1to30", "days31to60", "days61to90", "daysOver90"].includes(
          invoice.bucket,
        )
      );
    case "credit":
      return invoice.balance < 0;
    case "pendingRefunds":
      return invoice.pendingRefunds > 0;
    case "all":
      return true;
  }
}
