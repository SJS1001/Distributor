import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
export async function catalogLifecycleBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  for (let n = 0; n < 43; n++)
    f.app.catalog.create(f.actor, `catalog-${n}`, {
      sku: `LIFE-${String(n).padStart(2, "0")}`,
      name: `Lifecycle fixture ${n}`,
      serialized: false,
      unitPrice: 123,
      taxBasisPoints: 0,
    });
  for (let n = 0; n < 25; n++) {
    const review = f.app.catalog.lifecycleReview(f.actor, f.product);
    (n % 2
      ? f.app.catalog.reactivate.bind(f.app.catalog)
      : f.app.catalog.retire.bind(f.app.catalog))(f.actor, `history-${n}`, {
      productId: f.product,
      expectedHash: review.expectedHash,
      reason: `Historical lifecycle ${n}`,
    });
  }
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3141" });
  await http.listen({ host: "127.0.0.1", port: 3141 });
  return http;
}
