import { fixture } from "./fixtures.ts";
import { seedStockQueue, inspectedClaim } from "./stock-queue-fixture.ts";
import { createHttp } from "../src/server/http.ts";
export async function stockQueueBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  inspectedClaim(f);
  seedStockQueue(f, 90);
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3137" });
  await http.listen({ host: "127.0.0.1", port: 3137 });
  return http;
}
