import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDemoGateway } from "./gateway.ts";

// Demo-specific hosting values only. Native DATABASE_PATH and provider secrets
// are never consulted. Remote hosting remains a separately qualified activity.
const host = process.env.DEMO_HOST ?? "127.0.0.1";
const port = Number(process.env.DEMO_PORT ?? 3200);
const origin = process.env.DEMO_ORIGIN ?? `http://127.0.0.1:${port}`;
const secureCookies = process.env.DEMO_SECURE_COOKIES === "true";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid DEMO_PORT.");
if (
  !["localhost", "127.0.0.1", "::1"].includes(host) &&
  (!secureCookies || new URL(origin).protocol !== "https:")
)
  throw new Error(
    "Non-loopback demo hosting requires HTTPS origin and secure cookies.",
  );
const staticRoot = resolve("dist");
if (!existsSync(resolve(staticRoot, "index.html")))
  throw new Error("Build the actual native interface first: npm run build.");
const http = await createDemoGateway({ origin, secureCookies, staticRoot });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void http.close().then(() => {
      process.exitCode = 0;
    });
  });
await http.listen({ host, port });
process.stdout.write(`Distributor native fictional demo: ${origin}/demo\n`);
