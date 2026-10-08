import { fixture, accept, ship } from "./fixtures.ts";
import { seedInvoiceQueue } from "./invoice-queue-fixture.ts";
import { createHttp } from "./browser-http.ts";
export async function invoiceQueueBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const native = ship(f, accept(f, 2).id).invoiceId;
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_invoices SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      native,
    );
  f.app.billing.issueCredit(f.actor, "off-page-credit", {
    invoiceId: native,
    reference: "OFF-PAGE-CREDIT",
    reason: "Synthetic original unit credit",
    lines: [
      { lineId: f.app.billing.lines(f.actor, native)[0]!.id, quantity: 1 },
    ],
  });
  seedInvoiceQueue(f);
  f.app.identity.createUser(f.actor, "invoice-finance", {
    email: "invoice-finance@example.test",
    name: "Synthetic invoice finance",
    password: "long-test-only-password",
    role: "finance",
    sites: [f.w1],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3136" });
  await http.listen({ host: "127.0.0.1", port: 3136 });
  return http;
}
