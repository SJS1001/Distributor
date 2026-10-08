import { fixture } from "./fixtures.ts";
import { seedPurchaseQueue } from "./purchase-queue-fixture.ts";
import { createHttp } from "./browser-http.ts";
export async function purchaseQueueBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  f.app.database
    .owned("procurement")
    .run(
      "UPDATE procurement_orders SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      f.po,
    );
  seedPurchaseQueue(f);
  seedPurchaseQueue(f, 80, "other-site", f.w2);
  f.app.identity.createUser(f.actor, "purchasing-user", {
    email: "purchasing@example.test",
    name: "Synthetic purchasing warehouse",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  // Exact saved line deliberately belongs to a header outside the first page.
  f.app.procurement.drafts.save(f.actor, "off-page-draft", {
    poId: "purchase-queue-001",
    lineId: "purchase-queue-001-line",
    deliveryRef: "OFF-PAGE-DRAFT",
    quantity: 1,
    serials: ["OFF-PAGE-SERIAL"],
    bin: "QUEUE-1",
    quarantine: true,
    observedSku: "EQ-1",
    draftId: null,
    revision: 0,
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3135" });
  await http.listen({ host: "127.0.0.1", port: 3135 });
  return http;
}
