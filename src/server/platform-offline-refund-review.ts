import {
  canonical,
  check,
  digest,
  permit,
  type Actor,
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";

export const platformOfflineRefundReviewLimits = Object.freeze({
  commands: 1000,
  audits: 1000,
  rowBytes: 64 * 1024,
  totalBytes: 8 * 1024 * 1024,
});
type Command = "billing.refund.request" | "stripe.refund";
type State =
  "pending" | "running" | "unknown" | "completed" | "rejected" | "blocked";
type Frozen<T> = T extends object
  ? { readonly [K in keyof T]: Frozen<T[K]> }
  : T;
type Audit = {
  id: string;
  orgId: string;
  actorId: string;
  action: Command;
  reference: string;
  requestHash: string;
  detailJson: string;
  createdAt: string;
  sequence: number;
};
type Receipt = {
  orgId: string;
  actorId: string;
  command: Command;
  key: string;
  requestHash: string;
  result: { id: string; state: State };
  resultJson: string;
  createdAt: string;
  audit: Audit;
};
export type PlatformOfflineRefundReview = Frozen<{
  version: 1;
  purpose: "distributor-platform-offline-refund-review-v1";
  orgId: string;
  refundId: string;
  effectId: string;
  history: { commands: number; audits: number; hash: string };
  requests: Receipt[];
  queues: Receipt[];
  factsHash: string;
}>;
function valid(value: unknown): asserts value {
  check(
    value,
    "RESTORE_RECEIPT_INTEGRITY",
    "Retained refund command or audit history is malformed or incomplete.",
  );
}
function exact(value: unknown, max = 160): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function json(raw: unknown): Record<string, unknown> {
  valid(typeof raw === "string");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    valid(false);
  }
  valid(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function freeze<T>(value: T): Frozen<T> {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}
const key = (actor: string, command: string, request: string) =>
  canonical([actor, command, request]);

/** Trusted internal historical read on the supplied writer. No source, provider,
 * release or import authority. Root must compose matching owner projections. */
export class PlatformOfflineRefundReviewReader {
  private readonly store: Store;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
  ) {
    this.store = database.owned("platform");
  }
  getInTransaction(
    actor: Actor,
    refundId: string,
    effectId: string,
  ): PlatformOfflineRefundReview {
    this.database.requireTransaction();
    const current = this.identity.currentActor(actor);
    permit(current, ["finance"]);
    check(
      !current.accountId,
      "FORBIDDEN",
      "Current organization finance staff is required.",
      403,
    );
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing refund receipts.",
      403,
    );
    check(
      exact(refundId) && exact(effectId),
      "VALIDATION",
      "Use exact refund and effect identities.",
      400,
    );
    // Historical reads remain possible during restore hold. This tests neither
    // effective permits nor the qualification/freshness of a recovery tuple.
    const orgId = current.orgId;
    const commandSize = this.store.get(
      `SELECT COUNT(*) AS count,
      COALESCE(SUM(n),0) AS bytes, COALESCE(MAX(n),0) AS largest FROM (
      SELECT length(CAST(org_id AS BLOB))+length(CAST(actor_id AS BLOB))+
        length(CAST(name AS BLOB))+length(CAST(key AS BLOB))+length(CAST(hash AS BLOB))+
        length(CAST(result AS BLOB))+length(CAST(created_at AS BLOB)) AS n
      FROM platform_commands WHERE org_id=? AND name IN('billing.refund.request','stripe.refund'))`,
      orgId,
    )!;
    const auditSize = this.store.get(
      `SELECT COUNT(*) AS count,
      COALESCE(SUM(n),0) AS bytes, COALESCE(MAX(n),0) AS largest FROM (
      SELECT length(CAST(a.id AS BLOB))+length(CAST(a.org_id AS BLOB))+length(CAST(a.actor_id AS BLOB))+
        length(CAST(a.action AS BLOB))+length(CAST(a.reference AS BLOB))+length(CAST(a.detail AS BLOB))+
        length(CAST(a.created_at AS BLOB))+COALESCE(length(CAST(o.org_id AS BLOB)),0) AS n
      FROM platform_audit a LEFT JOIN platform_audit_order o ON o.audit_id=a.id
      WHERE a.org_id=? AND a.action IN('billing.refund.request','stripe.refund'))`,
      orgId,
    )!;
    for (const [size, limit] of [
      [commandSize, platformOfflineRefundReviewLimits.commands],
      [auditSize, platformOfflineRefundReviewLimits.audits],
    ] as const) {
      valid(
        Number.isSafeInteger(size.count) &&
          Number(size.count) <= limit &&
          Number(size.count) >= 0 &&
          Number.isSafeInteger(size.bytes) &&
          Number(size.bytes) >= 0 &&
          Number.isSafeInteger(size.largest) &&
          Number(size.largest) <= platformOfflineRefundReviewLimits.rowBytes,
      );
    }
    valid(
      Number(commandSize.bytes) + Number(auditSize.bytes) <=
        platformOfflineRefundReviewLimits.totalBytes,
    );
    let commands: Row[], audits: Row[];
    try {
      commands = this.store.all(
        "SELECT org_id,actor_id,name,key,hash,result,created_at FROM platform_commands WHERE org_id=? AND name IN('billing.refund.request','stripe.refund') ORDER BY actor_id,name,key",
        orgId,
      );
      audits = this.store.all(
        `SELECT a.*,o.org_id AS order_org_id,o.sequence FROM platform_audit a
        LEFT JOIN platform_audit_order o ON o.audit_id=a.id
        WHERE a.org_id=? AND a.action IN('billing.refund.request','stripe.refund') ORDER BY a.id`,
        orgId,
      );
    } catch {
      valid(false);
    }
    valid(
      commands.length === commandSize.count &&
        audits.length === auditSize.count,
    );
    const links = new Map<string, Audit>();
    for (const a of audits) {
      valid(
        exact(a.id) &&
          a.org_id === orgId &&
          exact(a.actor_id) &&
          exact(a.reference, 128) &&
          (a.action === "billing.refund.request" ||
            a.action === "stripe.refund") &&
          instant(a.created_at) &&
          a.order_org_id === orgId &&
          Number.isSafeInteger(a.sequence) &&
          Number(a.sequence) > 0,
      );
      const detail = json(a.detail);
      valid(
        Object.keys(detail).length === 1 &&
          hash(detail.requestHash) &&
          canonical(detail) === a.detail,
      );
      const k = key(a.actor_id, a.action, a.reference);
      valid(!links.has(k));
      links.set(k, {
        id: a.id,
        orgId,
        actorId: a.actor_id,
        action: a.action,
        reference: a.reference,
        requestHash: detail.requestHash,
        detailJson: a.detail as string,
        createdAt: a.created_at,
        sequence: a.sequence as number,
      });
    }
    const requests: Receipt[] = [],
      queues: Receipt[] = [];
    // This one payload is exact at Integration.refund(); original Billing input
    // is not retained here and its hash must not be reconstructed from guesses.
    const queueRequestHash = digest(canonical({ refundId }));
    for (const c of commands) {
      valid(
        c.org_id === orgId &&
          exact(c.actor_id) &&
          exact(c.key, 128) &&
          hash(c.hash) &&
          instant(c.created_at) &&
          (c.name === "billing.refund.request" || c.name === "stripe.refund"),
      );
      const result = json(c.result);
      valid(
        Object.keys(result).length === 2 &&
          exact(result.id) &&
          typeof result.state === "string" &&
          (c.name === "billing.refund.request"
            ? result.state === "pending"
            : [
                "pending",
                "running",
                "unknown",
                "completed",
                "rejected",
                "blocked",
              ].includes(result.state)) &&
          JSON.stringify(result) === c.result,
      );
      const k = key(c.actor_id, c.name, c.key),
        audit = links.get(k);
      valid(audit && audit.requestHash === c.hash);
      links.delete(k);
      const receipt: Receipt = {
        orgId,
        actorId: c.actor_id,
        command: c.name,
        key: c.key,
        requestHash: c.hash,
        result: { id: result.id, state: result.state as State },
        resultJson: c.result as string,
        createdAt: c.created_at,
        audit,
      };
      if (c.name === "billing.refund.request" && result.id === refundId)
        requests.push(receipt);
      if (
        c.name === "stripe.refund" &&
        (result.id === effectId || c.hash === queueRequestHash)
      ) {
        valid(result.id === effectId && c.hash === queueRequestHash);
        queues.push(receipt);
      }
    }
    valid(links.size === 0);
    const body = {
      version: 1 as const,
      purpose: "distributor-platform-offline-refund-review-v1" as const,
      orgId,
      refundId,
      effectId,
      history: {
        commands: commands.length,
        audits: audits.length,
        hash: digest(
          canonical({
            purpose: "distributor-platform-refund-history-v1",
            commands,
            audits,
          }),
        ),
      },
      requests,
      queues,
    };
    return freeze({ ...body, factsHash: digest(canonical(body)) });
  }
}
