import type { fixture } from "./fixtures.ts";
// Tied-time synthetic financial facts, not operator or accounting acceptance.
export function seedInvoiceQueue(
  f: ReturnType<typeof fixture>,
  count = 45,
  prefix = "invoice-queue",
  accountId = f.buyer,
) {
  const store = f.app.database.owned("billing"),
    ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}-${String(i).padStart(3, "0")}`;
    ids.push(id);
    store.run(
      "INSERT INTO billing_invoices VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      id,
      f.actor.orgId,
      accountId,
      `${id}-order`,
      `${id}-shipment`,
      `SYNTHETIC-${id}`,
      f.app.identity.region === "CA" ? "CAD" : "USD",
      10000,
      1300,
      11300,
      "2026-09-30T12:00:00.000Z",
    );
    store.run(
      "INSERT INTO billing_lines VALUES(?,?,?,?,?,?,?,?)",
      `${id}-line`,
      f.actor.orgId,
      id,
      f.product,
      "Synthetic equipment",
      1,
      10000,
      1300,
    );
    if (i % 3 !== 0)
      store.run(
        "INSERT INTO billing_payments VALUES(?,?,?,?,?,?,?)",
        `${id}-payment`,
        f.actor.orgId,
        id,
        "manual",
        `${id}-cash`,
        11300,
        "2026-09-30T12:00:00.000Z",
      );
    if (i % 3 === 2) {
      store.run(
        "INSERT INTO billing_credits VALUES(?,?,?,?,?,?,?,?,?,?)",
        `${id}-credit`,
        f.actor.orgId,
        id,
        `${id}-credit-ref`,
        `CREDIT-${id}`,
        "Synthetic credit",
        10000,
        1300,
        11300,
        "2026-09-30T12:00:00.000Z",
      );
      store.run(
        "INSERT INTO billing_credit_lines VALUES(?,?,?,?,?)",
        `${id}-credit-line`,
        f.actor.orgId,
        `${id}-credit`,
        `${id}-line`,
        1,
      );
    }
  }
  return ids;
}
