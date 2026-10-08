import { createHttp as productionHttp } from "../src/server/http.ts";

// Browser fixtures listen on loopback HTTP without a TLS listener. WebKit
// otherwise upgrades their assets to HTTPS. Retain every other CSP directive;
// the production server and HTTP security tests use productionHttp directly.
export async function createHttp(
  ...args: Parameters<typeof productionHttp>
): Promise<Awaited<ReturnType<typeof productionHttp>>> {
  const origin = new URL(args[1].origin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1")
    throw new Error("Browser HTTP fixtures require a loopback HTTP origin");
  const http = await productionHttp(...args);
  http.addHook("onSend", async (_request, reply, payload) => {
    const policy = reply.getHeader("Content-Security-Policy");
    if (typeof policy === "string")
      reply.header(
        "Content-Security-Policy",
        policy.replace(/upgrade-insecure-requests;?/g, ""),
      );
    return payload;
  });
  return http;
}
