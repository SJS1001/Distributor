import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";

export const originalObservationReviewLimits = Object.freeze({
  rows: 1000,
  rowBytes: 65536,
  totalBytes: 8 * 1024 * 1024,
});
function consistent(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_ORIGINAL_AUDIT",
    "Original observation audit history is incomplete or inconsistent.",
  );
}
function identifier(value: unknown): asserts value is string {
  consistent(typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value));
}
function iso(value: unknown): asserts value is string {
  consistent(
    typeof value === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );
}
export function originalObservationPrincipal(input: Actor): Actor {
  consistent(input && typeof input === "object" && !types.isProxy(input));
  const locator: Record<string, string> = {};
  for (const key of ["id", "orgId"]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    consistent(descriptor && "value" in descriptor);
    identifier(descriptor.value);
    locator[key] = descriptor.value;
  }
  return locator as unknown as Actor;
}
/** Platform owns this bounded complete organization audit projection. It carries
 * historical consistency only, never external source or recovery authority. */
export class PlatformOfflineOriginalObservationReviewReader {
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
  ) {
    for (const [owner, prototype] of [
      [database, Database.prototype],
      [identity, Identity.prototype],
    ] as const)
      consistent(
        owner &&
          !types.isProxy(owner) &&
          Object.getPrototypeOf(owner) === prototype,
      );
  }
  getInTransaction(actorInput: Actor) {
    this.database.requireTransaction();
    const actor = this.identity.currentActor(
      originalObservationPrincipal(actorInput),
    );
    permit(actor, ["finance"]);
    consistent(
      !actor.accountId && !this.identity.security(actor).passwordChangeRequired,
    );
    const store = this.database.owned("platform"),
      unchanged = store.get("SELECT total_changes() AS n")!.n;
    const size = store.get<{
      n: number;
      bytes: number;
      largest: number;
      bad: number;
    }>(
      `SELECT COUNT(*) AS n,COALESCE(SUM(bytes),0) AS bytes,COALESCE(MAX(bytes),0) AS largest,COALESCE(MAX(bad),0) AS bad FROM (
      SELECT length(CAST(a.id AS BLOB))+length(CAST(a.org_id AS BLOB))+length(CAST(a.actor_id AS BLOB))+length(CAST(a.action AS BLOB))+length(CAST(a.reference AS BLOB))+length(CAST(a.detail AS BLOB))+length(CAST(a.created_at AS BLOB))+COALESCE(length(CAST(o.org_id AS BLOB)),0) AS bytes,
      CASE WHEN o.audit_id IS NULL OR o.org_id!=a.org_id OR typeof(o.sequence)!='integer' OR o.sequence<1 THEN 1 ELSE 0 END AS bad
      FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id WHERE a.org_id=? AND a.action='accounting.journal.observed')`,
      actor.orgId,
    )!;
    consistent(
      Number.isSafeInteger(size.n) &&
        size.n >= 0 &&
        size.n <= originalObservationReviewLimits.rows &&
        Number.isSafeInteger(size.bytes) &&
        size.bytes >= 0 &&
        size.bytes <= originalObservationReviewLimits.totalBytes &&
        Number.isSafeInteger(size.largest) &&
        size.largest <= originalObservationReviewLimits.rowBytes &&
        size.bad === 0,
    );
    // An orphan or cross-organization order cannot disappear through the join.
    consistent(
      store.get(
        `SELECT COUNT(*) AS n FROM platform_audit_order o LEFT JOIN platform_audit a ON a.id=o.audit_id WHERE o.org_id=? AND (a.id IS NULL OR a.org_id!=o.org_id)`,
        actor.orgId,
      )!.n === 0,
    );
    const clock = store.get<{ n: number; sequence: number }>(
      "SELECT COUNT(*) AS n,MAX(sequence) AS sequence FROM platform_audit_clock WHERE id=1",
    )!;
    const greatest = store.get<{ sequence: number }>(
      "SELECT COALESCE(MAX(sequence),0) AS sequence FROM platform_audit_order",
    )!;
    consistent(
      clock.n === 1 &&
        Number.isSafeInteger(clock.sequence) &&
        clock.sequence >= 0 &&
        clock.sequence >= greatest.sequence,
    );
    const rows = store.all<{
      id: string;
      org_id: string;
      actor_id: string;
      action: string;
      reference: string;
      detail: string;
      created_at: string;
      sequence: number;
    }>(
      `SELECT a.id,a.org_id,a.actor_id,a.action,a.reference,a.detail,a.created_at,o.sequence FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id WHERE a.org_id=? AND a.action='accounting.journal.observed' ORDER BY o.sequence`,
      actor.orgId,
    );
    consistent(rows.length === size.n);
    let sequence = 0;
    const audits = rows.map((row) => {
      identifier(row.id);
      identifier(row.org_id);
      identifier(row.actor_id);
      identifier(row.reference);
      iso(row.created_at);
      consistent(
        row.org_id === actor.orgId &&
          row.action === "accounting.journal.observed" &&
          Number.isSafeInteger(row.sequence) &&
          row.sequence > sequence &&
          typeof row.detail === "string",
      );
      sequence = row.sequence;
      let detail: unknown;
      try {
        detail = JSON.parse(row.detail);
      } catch {
        consistent(false);
      }
      consistent(
        detail && typeof detail === "object" && !Array.isArray(detail),
      );
      const data = detail as { revision: number; hash: string };
      consistent(
        Object.keys(data).length === 2 &&
          Number.isSafeInteger(data.revision) &&
          data.revision > 0 &&
          typeof data.hash === "string" &&
          /^[a-f0-9]{64}$/.test(data.hash) &&
          canonical(data) === row.detail,
      );
      return Object.freeze({
        id: row.id,
        orgId: row.org_id,
        actorId: row.actor_id,
        journalId: row.reference,
        revision: data.revision,
        hash: data.hash,
        createdAt: row.created_at,
        sequence: row.sequence,
      });
    });
    consistent(store.get("SELECT total_changes() AS n")!.n === unchanged);
    const facts = {
      version: 1 as const,
      purpose: "distributor-platform-offline-original-observations-v1" as const,
      orgId: actor.orgId,
      profile: originalObservationReviewLimits,
      audits: Object.freeze(audits),
    };
    return Object.freeze({ ...facts, hash: digest(canonical(facts)) });
  }
}
