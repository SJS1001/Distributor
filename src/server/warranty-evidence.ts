import {
  check,
  canonical,
  digest,
  id,
  now,
  permit,
  site,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import { Inventory } from "./inventory.ts";
import type { Claim } from "./warranty.ts";
import {
  evidenceMaxBytes,
  evidenceMaxFiles,
  evidenceMediaTypes,
  evidencePageSize,
  type EvidenceFile,
  type EvidenceMediaType,
  type EvidenceUpload,
} from "../shared/warranty-evidence.ts";

// Deliberately select metadata only for lists and authorization. Blob reads are bounded.
const metadata = `id,claim_id AS claimId,filename,media_type AS mediaType,audience,
  description,byte_length AS bytes,content_hash AS contentHash,created_at AS createdAt`;
function validateBytes(bytes: Buffer, mediaType: EvidenceMediaType) {
  check(
    bytes.length > 0 && bytes.length <= evidenceMaxBytes,
    "EVIDENCE_SIZE",
    "Evidence must contain 1 byte to 5 MiB.",
    413,
  );
  let valid = false;
  switch (mediaType) {
    case "image/png":
      valid =
        bytes.length >= 24 &&
        bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
        bytes.toString("ascii", 12, 16) === "IHDR";
      break;
    case "image/jpeg":
      valid =
        bytes.length >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff &&
        bytes.at(-2) === 0xff &&
        bytes.at(-1) === 0xd9;
      break;
    case "application/pdf":
      valid =
        /^%PDF-1\.[0-7]/.test(bytes.toString("ascii", 0, 8)) &&
        /%%EOF\s*$/.test(bytes.subarray(-1024).toString("ascii"));
      break;
    case "text/plain":
      try {
        const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        valid = !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
      } catch {
        /* Refuse malformed UTF-8. */
      }
  }
  check(
    valid,
    "EVIDENCE_TYPE",
    "File bytes do not match a supported evidence format.",
    400,
  );
}

export class WarrantyEvidence {
  private store: Store;
  constructor(
    database: Database,
    private platform: Platform,
    private identity: Identity,
    private inventory: Inventory,
    private claim: (actor: Actor, claimId: string) => Claim,
  ) {
    this.store = database.owned("warranty");
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS warranty_evidence(
        id TEXT PRIMARY KEY,org_id TEXT NOT NULL,claim_id TEXT NOT NULL,
        filename TEXT NOT NULL,media_type TEXT NOT NULL CHECK(media_type IN('image/jpeg','image/png','application/pdf','text/plain')),
        audience TEXT NOT NULL CHECK(audience IN('customer','staff')),description TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND ${evidenceMaxBytes}),
        content_hash TEXT NOT NULL,content BLOB NOT NULL CHECK(length(content)=byte_length),
        uploaded_by TEXT NOT NULL,created_at TEXT NOT NULL,
        UNIQUE(org_id,claim_id,audience,content_hash),
        FOREIGN KEY(claim_id) REFERENCES warranty_claims(id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS warranty_evidence_page ON warranty_evidence(org_id,claim_id,created_at,id);
    `);
  }
  private authorize(actor: Actor, claimId: string, upload = false) {
    actor = this.identity.currentActor(actor);
    permit(
      actor,
      upload
        ? ["warranty", "warehouse", "commercial", "buyer"]
        : ["warranty", "warehouse", "commercial", "finance", "buyer"],
    );
    check(
      !this.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before accessing claim evidence.",
      403,
    );
    const claim = this.claim(actor, text(claimId, "Claim ID"));
    if (["warehouse", "warranty"].includes(actor.role))
      site(actor, this.inventory.unit(actor, claim.unit_id).warehouse_id);
    return actor;
  }
  private file(
    actor: Actor,
    claimId: string,
    evidenceId: string,
  ): EvidenceFile {
    const file = this.store.get<EvidenceFile>(
      `SELECT ${metadata} FROM warranty_evidence WHERE org_id=? AND claim_id=? AND id=? ${actor.role === "buyer" ? "AND audience='customer'" : ""}`,
      actor.orgId,
      claimId,
      text(evidenceId, "Evidence ID"),
    );
    check(file, "NOT_FOUND", "Evidence not found.", 404);
    return { ...file };
  }
  list(actor: Actor, claimId: string, after?: string) {
    claimId = text(claimId, "Claim ID");
    actor = this.authorize(actor, claimId);
    const cursor =
      after === undefined ? undefined : this.file(actor, claimId, after);
    const rows = this.store.all<EvidenceFile>(
      `SELECT ${metadata} FROM warranty_evidence WHERE org_id=? AND claim_id=? ${actor.role === "buyer" ? "AND audience='customer'" : ""}
      AND (? IS NULL OR created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT ${evidencePageSize + 1}`,
      actor.orgId,
      claimId,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
    );
    const items = rows.slice(0, evidencePageSize).map((row) => ({ ...row }));
    return {
      items,
      next: rows.length > evidencePageSize ? items.at(-1)!.id : null,
    };
  }
  upload(actor: Actor, key: string, claimId: string, input: EvidenceUpload) {
    claimId = text(claimId, "Claim ID");
    actor = this.authorize(actor, claimId, true);
    // Validate before decoding; Buffer accepts noncanonical base64 by default.
    check(
      typeof input.contentBase64 === "string" &&
        input.contentBase64.length > 0 &&
        input.contentBase64.length <= 4 * Math.ceil(evidenceMaxBytes / 3),
      "EVIDENCE_SIZE",
      "Evidence must contain 1 byte to 5 MiB.",
      413,
    );
    check(
      input.contentBase64.length % 4 === 0 &&
        /^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64),
      "VALIDATION",
      "Evidence requires canonical base64.",
      400,
    );
    const bytes = Buffer.from(input.contentBase64, "base64");
    check(
      bytes.toString("base64") === input.contentBase64,
      "VALIDATION",
      "Evidence requires canonical base64.",
      400,
    );
    check(
      Object.hasOwn(evidenceMediaTypes, input.mediaType),
      "EVIDENCE_TYPE",
      "Unsupported evidence type.",
      400,
    );
    validateBytes(bytes, input.mediaType);
    const filename = text(input.filename, "File name", 120);
    check(
      !/[\\/\x00-\x1f\x7f]/.test(filename) &&
        filename !== "." &&
        filename !== "..",
      "VALIDATION",
      "Use a file name without paths or control characters.",
      400,
    );
    check(
      ["customer", "staff"].includes(input.audience),
      "VALIDATION",
      "Choose customer-visible or staff-only evidence.",
      400,
    );
    const payload = {
      claimId: text(claimId, "Claim ID"),
      filename,
      mediaType: input.mediaType,
      audience: input.audience,
      description: text(input.description, "Evidence description", 1000),
      bytes: bytes.length,
      contentHash: digest(bytes),
    };
    return this.platform.command(
      actor,
      "warranty.evidence.upload",
      key,
      payload,
      (cached: EvidenceFile | undefined) => {
        actor = this.authorize(actor, claimId, true);
        check(
          actor.role !== "buyer" || input.audience === "customer",
          "FORBIDDEN",
          "Buyers may upload customer-visible evidence only.",
          403,
        );
        if (cached) this.file(actor, claimId, cached.id);
      },
      () => {
        const old = this.store.get<EvidenceFile>(
          `SELECT ${metadata} FROM warranty_evidence WHERE org_id=? AND claim_id=? AND audience=? AND content_hash=?`,
          actor.orgId,
          claimId,
          payload.audience,
          payload.contentHash,
        );
        if (old) {
          check(
            old.filename === payload.filename &&
              old.mediaType === payload.mediaType &&
              old.description === payload.description,
            "EVIDENCE_DUPLICATE",
            "These bytes are already attached with different metadata. Review the existing evidence.",
          );
          return { ...old };
        }
        const count = Number(
          this.store.get(
            "SELECT COUNT(*) AS total FROM warranty_evidence WHERE org_id=? AND claim_id=?",
            actor.orgId,
            claimId,
          )!.total,
        );
        check(
          count < evidenceMaxFiles,
          "EVIDENCE_LIMIT",
          "This claim has reached its 20-file evidence limit.",
        );
        const file: EvidenceFile = { id: id(), ...payload, createdAt: now() };
        this.store.run(
          "INSERT INTO warranty_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          file.id,
          actor.orgId,
          claimId,
          filename,
          file.mediaType,
          file.audience,
          file.description,
          file.bytes,
          file.contentHash,
          bytes,
          actor.id,
          file.createdAt,
        );
        return file;
      },
    );
  }
  download(actor: Actor, key: string, claimId: string, evidenceId: string) {
    claimId = text(claimId, "Claim ID");
    evidenceId = text(evidenceId, "Evidence ID");
    let bytes: Buffer | undefined;
    const receipt = this.platform.command(
      actor,
      "warranty.evidence.download",
      key,
      { claimId, evidenceId },
      (cached: { id: string; file: EvidenceFile } | undefined) => {
        actor = this.authorize(actor, claimId);
        const file = this.file(actor, claimId, evidenceId);
        check(
          !cached || canonical(cached.file) === canonical(file),
          "EVIDENCE_INTEGRITY",
          "Stored evidence metadata changed after the original download.",
          500,
        );
        const row = this.store.get(
          "SELECT content FROM warranty_evidence WHERE org_id=? AND claim_id=? AND id=?",
          actor.orgId,
          claimId,
          evidenceId,
        )!;
        bytes = Buffer.from(row.content as Uint8Array);
        check(
          bytes.length === file.bytes && digest(bytes) === file.contentHash,
          "EVIDENCE_INTEGRITY",
          "Stored evidence failed its integrity check.",
          500,
        );
        validateBytes(bytes, file.mediaType);
      },
      () => ({ id: id(), file: this.file(actor, claimId, evidenceId) }),
    );
    return {
      receipt,
      bytes: bytes!,
      filename: `warranty-evidence-${receipt.file.id}.${evidenceMediaTypes[receipt.file.mediaType]}`,
    };
  }
}
