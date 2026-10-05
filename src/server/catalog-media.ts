import { createCanvas, loadImage } from "@napi-rs/canvas";
import { normalizeCatalogPdf } from "./catalog-pdf.ts";
import {
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import type { Product } from "./catalog.ts";
import { CATALOG_MEDIA_DDL } from "./catalog-media-schema.ts";
import {
  catalogImageMaxBytes,
  catalogDocumentMaxBytes,
  catalogResourceMaxFiles,
  catalogOrganizationMaxBytes,
  resourceKinds,
  type ResourceMetadata,
  type ResourceUpload,
  type CatalogResource,
  type ResourceChange,
  type ResourcePublish,
} from "../shared/catalog-media.ts";
const columns = `id,product_id AS productId,kind,title,alt_text AS altText,models,language,revision,source,position,state,version,media_type AS mediaType,byte_length AS bytes,content_hash AS contentHash,external_url AS externalUrl,inspection,created_at AS createdAt,updated_at AS updatedAt`;
export interface ResourceCatalog {
  authorizeResourceAccess(actor: Actor, productId: string): Product;
}
/** Trusted deployment configuration only. No HTTP input can supply an inspection verdict. */
export type PdfInspector = (
  bytes: Buffer,
  hash: string,
) => Promise<{ approved: boolean; evidence: string }>;
function optional(value: unknown, name: string, max: number) {
  return value === undefined || value === "" ? "" : text(value, name, max);
}
function metadata(input: ResourceMetadata) {
  check(
    resourceKinds.includes(input.kind),
    "VALIDATION",
    "Choose a supported resource category.",
    400,
  );
  const m = {
    kind: input.kind,
    title: text(input.title, "Resource title", 160),
    altText: optional(input.altText, "Alternative text", 500),
    models: optional(input.models, "Applicable models", 1000),
    language: optional(input.language, "Language", 40),
    revision: optional(input.revision, "Revision", 120),
    source: optional(input.source, "Source and provenance", 2000),
    position: integer(input.position ?? 0, "Gallery position", 0, 10000),
  };
  check(
    m.kind !== "image" || m.altText.length > 0,
    "VALIDATION",
    "Images require meaningful alternative text.",
    400,
  );
  return m;
}
function dimensions(b: Buffer, type: string): [number, number] {
  if (
    type === "image/png" &&
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
    b.toString("ascii", 12, 16) === "IHDR"
  )
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (type === "image/jpeg" && b[0] === 255 && b[1] === 216) {
    let p = 2;
    while (p + 4 <= b.length) {
      check(b[p] === 255, "RESOURCE_TYPE", "Malformed JPEG.", 400);
      while (b[p] === 255) p++;
      const marker = b[p++]!;
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const len = b.readUInt16BE(p);
      check(
        len >= 2 && p + len <= b.length,
        "RESOURCE_TYPE",
        "Malformed JPEG.",
        400,
      );
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        len >= 7
      )
        return [b.readUInt16BE(p + 5), b.readUInt16BE(p + 3)];
      p += len;
    }
  }
  if (
    type === "image/webp" &&
    b.length >= 30 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  ) {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      check(
        (b[20]! & 2) === 0,
        "RESOURCE_TYPE",
        "Animated images are not supported.",
        400,
      );
      return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    }
    if (kind === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42)
      return [b.readUInt16LE(26) & 16383, b.readUInt16LE(28) & 16383];
    if (kind === "VP8L" && b[20] === 47) {
      const bits = b.readUInt32LE(21);
      return [1 + (bits & 16383), 1 + ((bits >>> 14) & 16383)];
    }
  }
  check(
    false,
    "RESOURCE_TYPE",
    "Bytes do not match a supported image format.",
    400,
  );
}
export class CatalogMedia {
  private store: Store;
  constructor(
    private database: Database,
    private identity: Identity,
    private platform: Platform,
    private catalog: ResourceCatalog,
    private inspectPdf?: PdfInspector,
  ) {
    this.store = database.owned("catalog");
    this.store.migrate(CATALOG_MEDIA_DDL);
  }
  private authorize(actor: Actor, productId: string, admin = false) {
    actor = this.identity.currentActor(actor);
    if (admin) permit(actor, ["admin"]);
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing resources.",
      403,
    );
    this.catalog.authorizeResourceAccess(
      actor,
      text(productId, "Product ID", 128),
    );
    return actor;
  }
  private resource(actor: Actor, productId: string, resourceId: string) {
    const r = this.store.get<CatalogResource>(
      `SELECT ${columns} FROM catalog_resources WHERE org_id=? AND product_id=? AND id=? ${actor.role === "buyer" ? "AND state='published'" : ""}`,
      actor.orgId,
      productId,
      text(resourceId, "Resource ID", 128),
    );
    check(r, "NOT_FOUND", "Resource not found.", 404);
    return { ...r };
  }
  list(actor: Actor, productId: string) {
    return this.database.transaction(() => {
      actor = this.authorize(actor, productId);
      return {
        items: this.store
          .all<CatalogResource>(
            `SELECT ${columns} FROM catalog_resources WHERE org_id=? AND product_id=? ${actor.role === "buyer" ? "AND state='published'" : ""} ORDER BY position,id LIMIT ${catalogResourceMaxFiles}`,
            actor.orgId,
            productId,
          )
          .map((r) => ({ ...r })),
      };
    });
  }
  private record(
    actor: Actor,
    r: CatalogResource,
    action: string,
    extra: unknown = {},
  ) {
    this.store.run(
      "INSERT INTO catalog_resource_history VALUES(?,?,?,?,?,?,?)",
      id(),
      actor.orgId,
      r.id,
      actor.id,
      action,
      JSON.stringify({ resource: r, extra }),
      now(),
    );
  }
  async upload(
    actor: Actor,
    key: string,
    productId: string,
    input: ResourceUpload,
  ) {
    actor = this.authorize(actor, productId, true);
    const m = metadata(input);
    let content: Buffer = Buffer.alloc(0);
    let originalHash = "";
    let mediaType = "text/uri-list",
      externalUrl = "",
      inspection: CatalogResource["inspection"] = "link";
    if (input.externalUrl !== undefined) {
      check(
        input.contentBase64 === undefined &&
          input.mediaType === undefined &&
          m.kind !== "image",
        "VALIDATION",
        "Choose one document link or file upload.",
        400,
      );
      let url: URL;
      try {
        url = new URL(text(input.externalUrl, "Document URL", 2000));
      } catch {
        check(false, "VALIDATION", "Use a valid HTTPS document URL.", 400);
      }
      check(
        url!.protocol === "https:" && !url!.username && !url!.password,
        "VALIDATION",
        "Document links must use HTTPS without credentials.",
        400,
      );
      externalUrl = url!.href;
      originalHash = digest(externalUrl);
    } else {
      const max =
        input.mediaType === "application/pdf"
          ? catalogDocumentMaxBytes
          : catalogImageMaxBytes;
      check(
        typeof input.contentBase64 === "string" &&
          input.contentBase64.length > 0 &&
          input.contentBase64.length <= 4 * Math.ceil(max / 3),
        "RESOURCE_SIZE",
        "Resource exceeds the file limit.",
        413,
      );
      check(
        input.contentBase64.length % 4 === 0 &&
          /^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64),
        "VALIDATION",
        "Use canonical base64.",
        400,
      );
      content = Buffer.from(input.contentBase64, "base64");
      originalHash = digest(content);
      check(
        content.toString("base64") === input.contentBase64,
        "VALIDATION",
        "Use canonical base64.",
        400,
      );
      check(
        content.length > 0 && content.length <= max,
        "RESOURCE_SIZE",
        "Resource exceeds the file limit.",
        413,
      );
      if (input.mediaType === "application/pdf") {
        check(
          m.kind !== "image" &&
            /^%PDF-(1\.[0-7]|2\.0)/.test(content.toString("ascii", 0, 8)) &&
            /%%EOF\s*$/.test(content.subarray(-1024).toString("ascii")),
          "RESOURCE_TYPE",
          "Upload a valid PDF document.",
          400,
        );
        content = await normalizeCatalogPdf(content);
        mediaType = "application/pdf";
        inspection = "approved";
      } else {
        check(
          m.kind === "image" &&
            ["image/jpeg", "image/png", "image/webp"].includes(
              input.mediaType ?? "",
            ),
          "RESOURCE_TYPE",
          "Images require JPEG, PNG or WebP bytes.",
          400,
        );
        const [w, h] = dimensions(content, input.mediaType!);
        check(
          w > 0 && h > 0 && w <= 8192 && h <= 8192 && w * h <= 16000000,
          "RESOURCE_SIZE",
          "Image dimensions exceed the 16 megapixel limit.",
          413,
        );
        try {
          const image = await loadImage(content);
          check(
            image.width === w && image.height === h,
            "RESOURCE_TYPE",
            "Image dimensions do not match.",
            400,
          );
          const canvas = createCanvas(w, h);
          canvas.getContext("2d").drawImage(image, 0, 0);
          content = canvas.toBuffer("image/png");
        } catch {
          check(false, "RESOURCE_TYPE", "Image could not be decoded.", 400);
        }
        check(
          content.length <= catalogImageMaxBytes,
          "RESOURCE_SIZE",
          "Normalized image exceeds 8 MiB.",
          413,
        );
        mediaType = "image/png";
        inspection = "normalized";
      }
    }
    return this.platform.command(
      actor,
      "catalog.resource.upload",
      key,
      {
        productId,
        ...m,
        originalHash,
        inputMediaType: input.mediaType ?? "text/uri-list",
        externalUrl,
      },
      () => {
        actor = this.authorize(actor, productId, true);
      },
      () => {
        actor = this.authorize(actor, productId, true);
        const quota = this.store.get<{ count: number; bytes: number }>(
          "SELECT COUNT(*) AS count,COALESCE(SUM(byte_length),0) AS bytes FROM catalog_resources WHERE org_id=?",
          actor.orgId,
        )!;
        const count = this.store.get<{ total: number }>(
          "SELECT COUNT(*) AS total FROM catalog_resources WHERE org_id=? AND product_id=?",
          actor.orgId,
          productId,
        )!.total;
        check(
          count < catalogResourceMaxFiles &&
            quota.bytes + content.length <= catalogOrganizationMaxBytes,
          "RESOURCE_QUOTA",
          "Catalog resource quota reached; retained retired resources count toward quota.",
          413,
        );
        const createdAt = now();
        const r: CatalogResource = {
          id: id(),
          productId,
          ...m,
          state: "draft",
          version: 1,
          mediaType,
          bytes: content.length,
          contentHash: digest(content),
          externalUrl,
          inspection,
          createdAt,
          updatedAt: createdAt,
        };
        this.store.run(
          "INSERT INTO catalog_resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          r.id,
          actor.orgId,
          productId,
          r.kind,
          r.title,
          r.altText,
          r.models,
          r.language,
          r.revision,
          r.source,
          r.position,
          r.state,
          r.version,
          r.mediaType,
          r.bytes,
          r.contentHash,
          r.externalUrl,
          r.inspection,
          content,
          actor.id,
          createdAt,
          createdAt,
        );
        this.record(actor, r, "uploaded", {
          originalHash,
          normalization:
            mediaType === "application/pdf" ? "pdf-raster-v1" : inspection,
        });
        return r;
      },
    );
  }
  update(
    actor: Actor,
    key: string,
    productId: string,
    resourceId: string,
    input: ResourceChange,
  ) {
    return this.platform.command(
      actor,
      "catalog.resource.update",
      key,
      { productId, resourceId, input },
      () => {
        actor = this.authorize(actor, productId, true);
      },
      () => {
        actor = this.authorize(actor, productId, true);
        const r = this.resource(actor, productId, resourceId);
        this.version(r, input.expectedVersion);
        check(
          r.state !== "retired",
          "RESOURCE_STATE",
          "Retired resources cannot be edited. Upload a replacement.",
        );
        const m = metadata({ ...r, ...input });
        check(
          m.kind === r.kind,
          "VALIDATION",
          "Resource category cannot change after upload.",
          400,
        );
        const next = {
          ...r,
          ...m,
          state: "draft" as const,
          version: r.version + 1,
          updatedAt: now(),
        };
        this.store.run(
          "UPDATE catalog_resources SET title=?,alt_text=?,models=?,language=?,revision=?,source=?,position=?,state='draft',version=?,updated_at=? WHERE id=? AND org_id=?",
          next.title,
          next.altText,
          next.models,
          next.language,
          next.revision,
          next.source,
          next.position,
          next.version,
          next.updatedAt,
          r.id,
          actor.orgId,
        );
        this.record(actor, next, "updated");
        return next;
      },
    );
  }
  private version(r: CatalogResource, version: number) {
    check(
      r.version === integer(version, "Expected version", 1),
      "RESOURCE_CHANGED",
      "Resource changed. Reload before deciding.",
    );
  }
  async publish(
    actor: Actor,
    key: string,
    productId: string,
    resourceId: string,
    input: ResourcePublish,
  ) {
    actor = this.authorize(actor, productId, true);
    const reviewed = this.resource(actor, productId, resourceId);

    check(
      input.permissionAffirmed === true,
      "RESOURCE_PERMISSION",
      "Confirm ownership or permitted distribution.",
      400,
    );
    const basis = text(
      input.permissionBasis,
      "Distribution permission basis",
      1000,
    );
    let evidence = "";
    if (
      reviewed.mediaType === "application/pdf" &&
      reviewed.inspection !== "approved"
    ) {
      check(
        this.inspectPdf,
        "RESOURCE_QUARANTINE",
        "PDF publication is disabled until a trusted document inspection service is configured.",
      );
      const bytes = this.content(actor, productId, reviewed);
      const result = await this.inspectPdf(bytes, reviewed.contentHash);
      check(
        result.approved === true,
        "RESOURCE_QUARANTINE",
        "Document inspection did not approve publication.",
      );
      evidence = text(result.evidence, "Inspection evidence", 2000);
    }
    return this.platform.command(
      actor,
      "catalog.resource.publish",
      key,
      { productId, resourceId, input },
      () => {
        actor = this.authorize(actor, productId, true);
      },
      () => {
        actor = this.authorize(actor, productId, true);
        const r = this.resource(actor, productId, resourceId);
        this.version(r, input.expectedVersion);
        check(
          r.state === "draft",
          "RESOURCE_STATE",
          "Only a draft resource may be published.",
        );
        const next = {
          ...r,
          state: "published" as const,
          inspection:
            r.mediaType === "application/pdf"
              ? ("approved" as const)
              : r.inspection,
          version: r.version + 1,
          updatedAt: now(),
        };
        this.store.run(
          "UPDATE catalog_resources SET state=?,inspection=?,version=?,updated_at=? WHERE id=? AND org_id=?",
          next.state,
          next.inspection,
          next.version,
          next.updatedAt,
          r.id,
          actor.orgId,
        );
        this.record(actor, next, "published", {
          permissionBasis: basis,
          inspectionEvidence: evidence,
        });
        return next;
      },
    );
  }
  retire(
    actor: Actor,
    key: string,
    productId: string,
    resourceId: string,
    input: { expectedVersion: number; reason: string },
  ) {
    return this.platform.command(
      actor,
      "catalog.resource.retire",
      key,
      { productId, resourceId, input },
      () => {
        actor = this.authorize(actor, productId, true);
      },
      () => {
        actor = this.authorize(actor, productId, true);
        const r = this.resource(actor, productId, resourceId);
        this.version(r, input.expectedVersion);
        check(
          r.state !== "retired",
          "RESOURCE_STATE",
          "Resource is already retired.",
        );
        const reason = text(input.reason, "Retirement reason", 1000);
        const next = {
          ...r,
          state: "retired" as const,
          version: r.version + 1,
          updatedAt: now(),
        };
        this.store.run(
          "UPDATE catalog_resources SET state='retired',version=?,updated_at=? WHERE id=? AND org_id=?",
          next.version,
          next.updatedAt,
          r.id,
          actor.orgId,
        );
        this.record(actor, next, "retired", { reason });
        return next;
      },
    );
  }
  private content(actor: Actor, productId: string, r: CatalogResource) {
    const row = this.store.get(
      "SELECT content FROM catalog_resources WHERE org_id=? AND product_id=? AND id=?",
      actor.orgId,
      productId,
      r.id,
    )!;
    const bytes = Buffer.from(row.content as Uint8Array);
    check(
      bytes.length === r.bytes && digest(bytes) === r.contentHash,
      "RESOURCE_INTEGRITY",
      "Resource content failed integrity checks.",
      503,
    );
    return bytes;
  }
  bytes(actor: Actor, productId: string, resourceId: string) {
    return this.database.transaction(() => {
      actor = this.authorize(actor, productId);
      const resource = this.resource(actor, productId, resourceId);
      check(
        !resource.externalUrl,
        "RESOURCE_LINK",
        "This resource is an external link.",
        400,
      );
      check(
        resource.inspection !== "quarantined",
        "RESOURCE_QUARANTINE",
        "Quarantined documents cannot be downloaded through the application.",
        403,
      );
      return {
        resource,
        bytes: this.content(actor, productId, resource),
        filename: `catalog-${resource.id}.${resource.mediaType === "image/png" ? "png" : "pdf"}`,
      };
    });
  }
  history(actor: Actor, productId: string, resourceId: string, after?: string) {
    return this.database.transaction(() => {
      actor = this.authorize(actor, productId, true);
      this.resource(actor, productId, resourceId);
      const cursor =
        after === undefined
          ? undefined
          : this.store.get<{ id: string; created_at: string }>(
              "SELECT id,created_at FROM catalog_resource_history WHERE org_id=? AND resource_id=? AND id=?",
              actor.orgId,
              resourceId,
              text(after, "History cursor", 128),
            );
      check(
        after === undefined || cursor,
        "CURSOR",
        "Resource history cursor is outside the current scope.",
        400,
      );
      const rows = this.store.all<{
        id: string;
        actorId: string;
        action: string;
        detail: string;
        createdAt: string;
      }>(
        "SELECT id,actor_id AS actorId,action,detail,created_at AS createdAt FROM catalog_resource_history WHERE org_id=? AND resource_id=? AND (? IS NULL OR created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 21",
        actor.orgId,
        resourceId,
        cursor?.id ?? null,
        cursor?.created_at ?? null,
        cursor?.created_at ?? null,
        cursor?.id ?? null,
      );
      return {
        items: rows.slice(0, 20).map((row) => ({ ...row })),
        next: rows.length > 20 ? rows[19]!.id : null,
      };
    });
  }
}
