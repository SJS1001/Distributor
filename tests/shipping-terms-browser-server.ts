import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
f.app.orders.saveCart(f.actor, "shipping-cart", {
  accountId: f.buyer,
  warehouseId: f.w1,
  revision: 0,
  lines: [{ productId: f.product, quantity: 2 }],
});
f.app.identity.createUser(f.actor, "shipping-buyer", {
  name: "Shipping buyer",
  email: "shipping-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3220",
  secureCookies: false,
});
await http.listen({ host: "127.0.0.1", port: 3220 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
