import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
let sends = 0;
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3223",
  secureCookies: false,
  scannerLinks: {
    orgId: f.actor.orgId,
    channels: ["email", "sms"],
    async send() {
      sends++;
      return "accepted";
    },
  },
});
http.get("/test-scanner-sends", async () => ({ sends }));
await http.listen({ host: "127.0.0.1", port: 3223 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
