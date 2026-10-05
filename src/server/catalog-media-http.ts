import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Application } from "./application.ts";
import type { Actor } from "./core.ts";
import {
  catalogDocumentMaxBytes,
  resourceKinds,
  type ResourceUpload,
  type ResourceChange,
  type ResourcePublish,
} from "../shared/catalog-media.ts";

type Schema = Record<string, unknown>;
const text = (maxLength: number, minLength = 0): Schema => ({
  type: "string",
  minLength,
  maxLength,
});
const obj = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const revision = {
  type: "integer",
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
};
const metadata = {
  kind: { type: "string", enum: resourceKinds },
  title: text(160, 1),
  altText: text(500),
  models: text(1000),
  language: text(40),
  revision: text(120),
  source: text(2000),
  position: { type: "integer", minimum: 0, maximum: 10000 },
};
const headers = {
  type: "object",
  properties: { "idempotency-key": text(128, 1) },
  required: ["idempotency-key"],
};
type Product = { productId: string };
type Resource = Product & { resourceId: string };
const base = "/api/catalog/products/:productId/resources";
const productParams = obj({ productId: text(128, 1) });
const resourceParams = obj({
  productId: text(128, 1),
  resourceId: text(128, 1),
});
export function installCatalogMedia(
  http: FastifyInstance,
  app: Application,
  actor: (request: FastifyRequest) => Actor,
) {
  http.get<{ Params: Product }>(
    base,
    { schema: { params: productParams } },
    async (request) =>
      app.catalogMedia.list(actor(request), request.params.productId),
  );
  http.post<{ Params: Product; Body: ResourceUpload }>(
    base,
    {
      bodyLimit: 4 * Math.ceil(catalogDocumentMaxBytes / 3) + 16384,
      schema: {
        params: productParams,
        headers,
        body: obj(
          {
            ...metadata,
            contentBase64: text(4 * Math.ceil(catalogDocumentMaxBytes / 3), 1),
            mediaType: {
              enum: [
                "image/jpeg",
                "image/png",
                "image/webp",
                "application/pdf",
              ],
            },
            externalUrl: text(2000, 1),
          },
          ["kind", "title"],
        ),
      },
    },
    async (request) =>
      app.catalogMedia.upload(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.productId,
        request.body,
      ),
  );
  http.patch<{ Params: Resource; Body: ResourceChange }>(
    `${base}/:resourceId`,
    {
      schema: {
        params: resourceParams,
        headers,
        body: obj({ ...metadata, expectedVersion: revision }, [
          "expectedVersion",
        ]),
      },
    },
    async (request) =>
      app.catalogMedia.update(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.productId,
        request.params.resourceId,
        request.body,
      ),
  );
  http.post<{ Params: Resource; Body: ResourcePublish }>(
    `${base}/:resourceId/publish`,
    {
      schema: {
        params: resourceParams,
        headers,
        body: obj({
          expectedVersion: revision,
          permissionAffirmed: { type: "boolean" },
          permissionBasis: text(1000, 1),
        }),
      },
    },
    async (request) =>
      app.catalogMedia.publish(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.productId,
        request.params.resourceId,
        request.body,
      ),
  );
  http.post<{
    Params: Resource;
    Body: { expectedVersion: number; reason: string };
  }>(
    `${base}/:resourceId/retire`,
    {
      schema: {
        params: resourceParams,
        headers,
        body: obj({ expectedVersion: revision, reason: text(1000, 1) }),
      },
    },
    async (request) =>
      app.catalogMedia.retire(
        actor(request),
        String(request.headers["idempotency-key"]),
        request.params.productId,
        request.params.resourceId,
        request.body,
      ),
  );
  http.get<{ Params: Resource; Querystring: { after?: string } }>(
    `${base}/:resourceId/history`,
    {
      schema: {
        params: resourceParams,
        querystring: obj({ after: text(128, 1) }, []),
      },
    },
    async (request) =>
      app.catalogMedia.history(
        actor(request),
        request.params.productId,
        request.params.resourceId,
        request.query.after,
      ),
  );
  http.get<{ Params: Resource }>(
    `${base}/:resourceId/bytes`,
    { schema: { params: resourceParams } },
    async (request, reply) => {
      const file = app.catalogMedia.bytes(
        actor(request),
        request.params.productId,
        request.params.resourceId,
      );
      return reply
        .type(file.resource.mediaType)
        .header("Cache-Control", "private, no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header(
          "Content-Disposition",
          `${file.resource.mediaType === "image/png" ? "inline" : "attachment"}; filename="${file.filename}"`,
        )
        .header("x-document-sha256", file.resource.contentHash)
        .send(file.bytes);
    },
  );
}
