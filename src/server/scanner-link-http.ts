import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Application } from "./application.ts";
import type { Actor } from "./core.ts";
import type { ScannerLinkInput } from "../shared/scanner-link.ts";
import type { ScannerLinkTransport } from "./scanner-link.ts";

export function installScannerLinks(
  http: FastifyInstance,
  app: Application,
  actor: (request: FastifyRequest) => Actor,
  origin: string,
  transport?: ScannerLinkTransport,
) {
  http.get("/api/scanner-link/config", async (request) =>
    app.scannerLinks.configuration(actor(request), transport),
  );
  http.post<{ Body: ScannerLinkInput }>(
    "/api/scanner-link/send",
    {
      schema: {
        headers: {
          type: "object",
          properties: {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["idempotency-key"],
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["channel", "recipient"],
          properties: {
            channel: { enum: ["email", "sms"] },
            recipient: { type: "string", minLength: 1, maxLength: 254 },
          },
        },
      },
    },
    async (request) =>
      app.scannerLinks.send(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.body,
        origin,
        transport,
      ),
  );
}
