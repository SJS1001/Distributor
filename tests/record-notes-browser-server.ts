import { fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
f.app.orders.saveCart(f.actor, "override-cart", {
  accountId: f.buyer,
  warehouseId: f.w1,
  revision: 0,
  lines: [{ productId: f.product, quantity: 2 }],
});
f.app.identity.createUser(f.actor, "notes-buyer", {
  name: "Shipping buyer",
  email: "notes-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: f.buyer,
});
f.app.identity.createUser(f.actor, "notes-verifier", {
  name: "Independent approver",
  email: "verifier@example.test",
  password: "long-test-only-password",
  role: "admin",
  sites: [],
});
const accepted = accept(f, 1, "notes-order");
ship(f, accepted.id);
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3224",
  secureCookies: false,
});
await http.listen({ host: "127.0.0.1", port: 3224 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
