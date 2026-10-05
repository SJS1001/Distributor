import type { FastifyInstance } from "fastify";

/** Navigation-only aliases; API mutations keep the existing single-origin policy. */
export function installCanonicalOrigin(
  http: FastifyInstance,
  origin: string,
  aliases: string[],
) {
  const canonical = new URL(origin).origin;
  const hosts = new Set(
    aliases.map((host) => {
      const normalized = host.trim().toLowerCase();
      if (!/^[a-z0-9.-]+(?::[0-9]+)?$/.test(normalized))
        throw new Error("Invalid canonical origin alias.");
      return normalized;
    }),
  );
  http.addHook("onRequest", async (request, reply) => {
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      hosts.has((request.headers.host ?? "").toLowerCase()) &&
      request.url.startsWith("/") &&
      !request.url.startsWith("/api/")
    ) {
      // Concatenation preserves the configured destination even for // paths.
      return reply
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .redirect(canonical + request.url, 308);
    }
  });
}
