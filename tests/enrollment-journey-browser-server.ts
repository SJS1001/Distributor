import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3139",
  enrollmentOrganizationId: f.actor.orgId,
  secureCookies: false,
});
// This isolated HTTP fixture has no TLS listener. Preserve the remaining CSP;
// production HTTPS is verified separately without changing its headers.
http.addHook("onSend", async (_request, reply, payload) => {
  const policy = reply.getHeader("Content-Security-Policy");
  if (typeof policy === "string")
    reply.header(
      "Content-Security-Policy",
      policy.replace(/upgrade-insecure-requests;?/g, ""),
    );
  return payload;
});
await http.listen({ host: "127.0.0.1", port: 3139 });
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
