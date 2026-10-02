import {
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import { type Database, type Store } from "./database.ts";
import { type Identity } from "./iam.ts";
import { type Platform } from "./platform.ts";
import type { QueueObservation } from "../shared/operations-health.ts";

// Version 1 is the existing native outbox contract. It has no aggregate revision
// or correlation envelope; consumers must not treat it as a mutable state feed.
export type LocalEvent = {
  id: string;
  orgId: string;
  type: string;
  version: number;
  reference: string;
  createdAt: string;
  payload: Record<string, unknown>;
};
export type EventConsumer = {
  readonly id: string;
  readonly version: number;
  readonly eventVersions: readonly number[];
  // Trusted, synchronous owning database operations only. No external I/O.
  apply(event: LocalEvent): unknown;
};
export type EventClaim = {
  consumerId: string;
  eventId: string;
  orgId: string;
  token: string;
  revision: number;
  attempt: number;
};
type Delivery = Row & {
  consumer_id: string;
  event_id: string;
  org_id: string;
  state: string;
  attempts: number;
  cycle_attempts: number;
  revision: number;
  lease_token: string | null;
  lease_until: number | null;
};
const leaseMs = 30_000,
  retryMs = 1_000,
  maxAttempts = 3;
const permanent = new Set(["EVENT_VERSION", "EVENT_SHAPE", "HANDLER_ASYNC"]);
function failure(code: string): Error & { deliveryCode: string } {
  return Object.assign(new Error("Local event processing failed."), {
    deliveryCode: code,
  });
}

export class EventDelivery {
  private store: Store;
  private consumers = new Map<string, EventConsumer>();
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    consumers: readonly EventConsumer[],
  ) {
    this.store = database.owned("platform");
    for (const consumer of consumers) {
      check(
        /^[a-z][a-z0-9-]{0,63}$/.test(consumer.id) &&
          !this.consumers.has(consumer.id),
        "CONSUMER",
        "Invalid or duplicate local consumer.",
      );
      integer(consumer.version, "Consumer version", 1);
      check(
        consumer.eventVersions.length > 0 &&
          consumer.eventVersions.length <= 20,
        "CONSUMER",
        "Declare supported event versions.",
      );
      for (const version of consumer.eventVersions)
        integer(version, "Event version", 1);
      check(
        consumer.apply.constructor.name !== "AsyncFunction",
        "CONSUMER",
        "Local consumers must be synchronous.",
      );
      this.consumers.set(consumer.id, consumer);
    }
    this.store.migrate(`
      CREATE TABLE IF NOT EXISTS platform_deliveries(
        consumer_id TEXT NOT NULL,event_id TEXT NOT NULL,org_id TEXT NOT NULL,consumer_version INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN('leased','retry','quarantined','completed')),
        attempts INTEGER NOT NULL CHECK(attempts>0),cycle_attempts INTEGER NOT NULL CHECK(cycle_attempts>=0),revision INTEGER NOT NULL CHECK(revision>0),
        lease_token TEXT,lease_until INTEGER,available_at INTEGER NOT NULL,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
        PRIMARY KEY(consumer_id,event_id),CHECK((state='leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL) OR (state<>'leased' AND lease_token IS NULL AND lease_until IS NULL))) STRICT;
      CREATE INDEX IF NOT EXISTS platform_deliveries_due ON platform_deliveries(consumer_id,state,available_at,lease_until);
      CREATE INDEX IF NOT EXISTS platform_deliveries_org ON platform_deliveries(org_id,consumer_id,state,updated_at,event_id);
      CREATE TABLE IF NOT EXISTS platform_delivery_attempts(
        id TEXT PRIMARY KEY,consumer_id TEXT NOT NULL,event_id TEXT NOT NULL,org_id TEXT NOT NULL,attempt INTEGER NOT NULL,consumer_version INTEGER NOT NULL,
        claimed_at TEXT NOT NULL,finished_at TEXT,outcome TEXT NOT NULL CHECK(outcome IN('leased','expired','retry','quarantined','completed')),error_code TEXT,
        UNIQUE(consumer_id,event_id,attempt)) STRICT;
      CREATE TABLE IF NOT EXISTS platform_delivery_receipts(consumer_id TEXT NOT NULL,event_id TEXT NOT NULL,org_id TEXT NOT NULL,consumer_version INTEGER NOT NULL,event_hash TEXT NOT NULL,completed_at TEXT NOT NULL,PRIMARY KEY(consumer_id,event_id)) STRICT;
    `);
  }
  private consumer(consumerId: string) {
    const consumer = this.consumers.get(consumerId);
    check(
      consumer,
      "CONSUMER_REMOVED",
      "This local consumer is not registered.",
      409,
    );
    return consumer;
  }
  private operator(actor: Actor, write = false) {
    const current = this.identity.currentActor(actor);
    check(
      !this.identity.security(current).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before continuing.",
      403,
    );
    permit(current, write ? [] : ["support"]);
    return current;
  }
  // Filesystem-authorized worker API. No HTTP route may accept claims or tokens.
  claimBatch(consumerId: string, limit = 20) {
    const consumer = this.consumer(consumerId);
    integer(limit, "Batch limit", 1, 100);
    return this.database.transaction(() => {
      this.identity.assertRegionalStore();
      const clock = Date.now(),
        timestamp = now();
      const candidates = this.store.all<Delivery>(
        `
        SELECT e.id AS event_id,e.org_id,d.state,d.attempts,d.cycle_attempts,d.revision
        FROM platform_events e LEFT JOIN platform_deliveries d ON d.event_id=e.id AND d.consumer_id=?
        WHERE d.event_id IS NULL OR (d.state='retry' AND d.available_at<=?) OR (d.state='leased' AND d.lease_until<=?)
        ORDER BY e.rowid LIMIT ?`,
        consumerId,
        clock,
        clock,
        limit,
      );
      const claims: EventClaim[] = [];
      let quarantined = 0;
      for (const row of candidates) {
        if (row.state === "leased") {
          this.store.run(
            "UPDATE platform_delivery_attempts SET outcome='expired',finished_at=?,error_code='LEASE_EXPIRED' WHERE consumer_id=? AND event_id=? AND attempt=? AND outcome='leased'",
            timestamp,
            consumerId,
            row.event_id,
            row.attempts,
          );
          if (row.cycle_attempts >= maxAttempts) {
            this.store.run(
              "UPDATE platform_deliveries SET state='quarantined',revision=revision+1,lease_token=NULL,lease_until=NULL,last_error='LEASE_EXHAUSTED',updated_at=? WHERE consumer_id=? AND event_id=?",
              timestamp,
              consumerId,
              row.event_id,
            );
            quarantined++;
            continue;
          }
        }
        const token = id(),
          attempt = Number(row.attempts ?? 0) + 1,
          revision = Number(row.revision ?? 0) + 1;
        this.store.run(
          `INSERT INTO platform_deliveries VALUES(?,?,?,?,'leased',?,1,?,?,?, ?,NULL,?,?,NULL)
          ON CONFLICT(consumer_id,event_id) DO UPDATE SET consumer_version=excluded.consumer_version,state='leased',attempts=excluded.attempts,cycle_attempts=platform_deliveries.cycle_attempts+1,revision=excluded.revision,lease_token=excluded.lease_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at`,
          consumerId,
          row.event_id,
          row.org_id,
          consumer.version,
          attempt,
          revision,
          token,
          clock + leaseMs,
          clock,
          timestamp,
          timestamp,
        );
        this.store.run(
          "INSERT INTO platform_delivery_attempts VALUES(?,?,?,?,?,?,?,NULL,'leased',NULL)",
          id(),
          consumerId,
          row.event_id,
          row.org_id,
          attempt,
          consumer.version,
          timestamp,
        );
        claims.push({
          consumerId,
          eventId: row.event_id,
          orgId: row.org_id,
          token,
          revision,
          attempt,
        });
      }
      return { claims, quarantined };
    });
  }
  private ownedClaim(claim: EventClaim) {
    const row = this.store.get<Delivery>(
      "SELECT * FROM platform_deliveries WHERE consumer_id=? AND event_id=? AND org_id=?",
      claim.consumerId,
      claim.eventId,
      claim.orgId,
    );
    return row &&
      row.state === "leased" &&
      row.lease_token === claim.token &&
      row.revision === claim.revision &&
      row.attempts === claim.attempt &&
      row.consumer_version === this.consumer(claim.consumerId).version &&
      Number(row.lease_until) > Date.now()
      ? row
      : undefined;
  }
  private decode(row: Row, consumer: EventConsumer): LocalEvent {
    if (!consumer.eventVersions.includes(Number(row.version)))
      throw failure("EVENT_VERSION");
    let payload: unknown;
    try {
      if (
        typeof row.payload !== "string" ||
        Buffer.byteLength(row.payload, "utf8") > 262144
      )
        throw Error();
      payload = JSON.parse(row.payload);
    } catch {
      throw failure("EVENT_SHAPE");
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      ![row.id, row.org_id, row.reference].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 200,
      ) ||
      typeof row.type !== "string" ||
      !/^[A-Za-z][A-Za-z0-9._-]{0,159}$/.test(row.type) ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      new Date(row.created_at).toISOString() !== row.created_at
    )
      throw failure("EVENT_SHAPE");
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      type: row.type,
      version: Number(row.version),
      reference: String(row.reference),
      createdAt: row.created_at,
      payload: payload as Record<string, unknown>,
    };
  }
  deliver(
    claim: EventClaim,
  ): "completed" | "retry" | "quarantined" | "abandoned" {
    const consumer = this.consumer(claim.consumerId);
    this.identity.assertRegionalStore();
    try {
      return this.database.transaction(() => {
        if (!this.ownedClaim(claim)) return "abandoned";
        const raw = this.store.get(
          "SELECT * FROM platform_events WHERE id=? AND org_id=?",
          claim.eventId,
          claim.orgId,
        );
        if (!raw) throw failure("EVENT_SHAPE");
        const event = this.decode(raw, consumer),
          eventHash = digest(canonical(event));
        const receipt = this.store.get(
          "SELECT * FROM platform_delivery_receipts WHERE consumer_id=? AND event_id=?",
          claim.consumerId,
          claim.eventId,
        );
        if (receipt) {
          if (
            receipt.event_hash !== eventHash ||
            receipt.org_id !== claim.orgId
          )
            throw failure("EVENT_SHAPE");
        } else {
          const result = consumer.apply(event);
          if (
            result &&
            typeof (result as { then?: unknown }).then === "function"
          ) {
            void Promise.resolve(result).catch(() => {});
            throw failure("HANDLER_ASYNC");
          }
          // Recheck after the synchronous handler: an expired attempt rolls back its effect.
          if (!this.ownedClaim(claim)) throw failure("LEASE_EXPIRED");
          this.store.run(
            "INSERT INTO platform_delivery_receipts VALUES(?,?,?,?,?,?)",
            claim.consumerId,
            claim.eventId,
            claim.orgId,
            consumer.version,
            eventHash,
            now(),
          );
        }
        const timestamp = now();
        this.store.run(
          "UPDATE platform_deliveries SET state='completed',revision=revision+1,lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=?,completed_at=? WHERE consumer_id=? AND event_id=?",
          timestamp,
          timestamp,
          claim.consumerId,
          claim.eventId,
        );
        this.store.run(
          "UPDATE platform_delivery_attempts SET outcome='completed',finished_at=? WHERE consumer_id=? AND event_id=? AND attempt=?",
          timestamp,
          claim.consumerId,
          claim.eventId,
          claim.attempt,
        );
        return "completed";
      });
    } catch (error) {
      const rawCode = (error as { deliveryCode?: string })?.deliveryCode;
      const code =
        rawCode &&
        [
          "EVENT_VERSION",
          "EVENT_SHAPE",
          "HANDLER_ASYNC",
          "LEASE_EXPIRED",
        ].includes(rawCode)
          ? rawCode
          : "HANDLER_FAILED";
      return this.database.transaction(() => {
        const row = this.ownedClaim(claim);
        if (!row) return "abandoned";
        const state =
            permanent.has(code) || row.cycle_attempts >= maxAttempts
              ? "quarantined"
              : "retry",
          timestamp = now();
        this.store.run(
          "UPDATE platform_deliveries SET state=?,revision=revision+1,lease_token=NULL,lease_until=NULL,available_at=?,last_error=?,updated_at=? WHERE consumer_id=? AND event_id=?",
          state,
          Date.now() + retryMs * row.cycle_attempts,
          code,
          timestamp,
          claim.consumerId,
          claim.eventId,
        );
        this.store.run(
          "UPDATE platform_delivery_attempts SET outcome=?,finished_at=?,error_code=? WHERE consumer_id=? AND event_id=? AND attempt=?",
          state,
          timestamp,
          code,
          claim.consumerId,
          claim.eventId,
          claim.attempt,
        );
        return state;
      });
    }
  }
  tick(
    consumerId: string,
    options: { enabled?: boolean; limit?: number } = {},
  ) {
    const result = {
      claimed: 0,
      completed: 0,
      retry: 0,
      quarantined: 0,
      abandoned: 0,
    };
    if (!options.enabled) return result;
    const batch = this.claimBatch(consumerId, options.limit);
    result.claimed = batch.claims.length;
    result.quarantined = batch.quarantined;
    for (const claim of batch.claims) result[this.deliver(claim)]++;
    return result;
  }
  health(actor: Actor, consumerId: string, clock: number): QueueObservation {
    actor = this.operator(actor);
    consumerId = text(consumerId, "Consumer", 64);
    const states = this.store.all<QueueObservation["states"][number]>(
      `SELECT state,COUNT(*) AS count,MIN(created_at) AS oldestCreatedAt FROM platform_deliveries WHERE org_id=? AND consumer_id=? GROUP BY state ORDER BY state`,
      actor.orgId,
      consumerId,
    );
    const pending = this.store.get<{
      count: number;
      oldestCreatedAt: string | null;
    }>(
      `SELECT COUNT(*) AS count,MIN(e.created_at) AS oldestCreatedAt FROM platform_events e LEFT JOIN platform_deliveries d ON d.event_id=e.id AND d.consumer_id=? WHERE e.org_id=? AND d.event_id IS NULL`,
      consumerId,
      actor.orgId,
    )!;
    const due = this.store.get<{
      count: number;
      expired: number;
      completed: string | null;
    }>(
      `SELECT COALESCE(SUM(CASE WHEN state='retry' AND available_at<=? OR state='leased' AND lease_until<=? THEN 1 ELSE 0 END),0) AS count,
        COALESCE(SUM(CASE WHEN state='leased' AND lease_until<=? THEN 1 ELSE 0 END),0) AS expired,MAX(completed_at) AS completed
        FROM platform_deliveries WHERE org_id=? AND consumer_id=?`,
      clock,
      clock,
      clock,
      actor.orgId,
      consumerId,
    )!;
    return {
      id: "event-report",
      label: "Local event reporting",
      registered: this.consumers.has(consumerId),
      states: [{ state: "unclaimed", ...pending }, ...states],
      due: pending.count + due.count,
      expiredLeases: due.expired,
      lastCompletedAt: due.completed,
    };
  }
  diagnostics(actor: Actor, consumerId: string, after?: string) {
    const current = this.operator(actor);
    text(consumerId, "Consumer", 64);
    let cursor: Row | undefined;
    if (after) {
      cursor = this.store.get(
        "SELECT updated_at,event_id FROM platform_deliveries WHERE org_id=? AND consumer_id=? AND event_id=?",
        current.orgId,
        consumerId,
        text(after, "Cursor", 200),
      );
      check(cursor, "CURSOR", "Continuation is no longer available.", 400);
    }
    const items = this.store.all(
      `SELECT event_id,consumer_id,consumer_version,state,attempts,cycle_attempts,revision,available_at,lease_until,last_error,created_at,updated_at,completed_at
      FROM platform_deliveries WHERE org_id=? AND consumer_id=? ${cursor ? "AND (updated_at<? OR (updated_at=? AND event_id<?))" : ""} ORDER BY updated_at DESC,event_id DESC LIMIT 21`,
      current.orgId,
      consumerId,
      ...(cursor
        ? [
            String(cursor.updated_at),
            String(cursor.updated_at),
            String(cursor.event_id),
          ]
        : []),
    );
    const totals = this.store.all(
      "SELECT state,COUNT(*) AS count FROM platform_deliveries WHERE org_id=? AND consumer_id=? GROUP BY state",
      current.orgId,
      consumerId,
    );
    const pending = this.store.get(
      "SELECT COUNT(*) AS count,MIN(e.created_at) AS oldest FROM platform_events e LEFT JOIN platform_deliveries d ON e.id=d.event_id AND d.consumer_id=? WHERE e.org_id=? AND d.event_id IS NULL",
      consumerId,
      current.orgId,
    )!;
    return {
      registered: this.consumers.has(consumerId),
      consumerId,
      totals,
      pending,
      policy: {
        leaseMs,
        retryMs,
        maxAttempts,
        defaultBatch: 20,
        maximumBatch: 100,
      },
      items: items.slice(0, 20),
      next: items.length > 20 ? String(items[19]!.event_id) : null,
    };
  }
  history(actor: Actor, consumerId: string, eventId: string, before?: number) {
    const current = this.operator(actor);
    const delivery = this.store.get(
      "SELECT event_id FROM platform_deliveries WHERE org_id=? AND consumer_id=? AND event_id=?",
      current.orgId,
      text(consumerId, "Consumer", 64),
      text(eventId, "Event", 200),
    );
    check(delivery, "NOT_FOUND", "Local delivery not found.", 404);
    if (before !== undefined) integer(before, "Attempt cursor", 1);
    const rows = this.store.all(
      "SELECT attempt,consumer_version,claimed_at,finished_at,outcome,error_code FROM platform_delivery_attempts WHERE org_id=? AND consumer_id=? AND event_id=? AND attempt<? ORDER BY attempt DESC LIMIT 21",
      current.orgId,
      consumerId,
      eventId,
      before ?? Number.MAX_SAFE_INTEGER,
    );
    return {
      items: rows.slice(0, 20),
      next: rows.length > 20 ? Number(rows[19]!.attempt) : null,
    };
  }
  retry(
    actor: Actor,
    key: string,
    input: {
      consumerId: string;
      eventId: string;
      revision: number;
      reason: string;
    },
  ) {
    const payload = {
      consumerId: text(input.consumerId, "Consumer", 64),
      eventId: text(input.eventId, "Event", 200),
      revision: integer(input.revision, "Delivery revision", 1),
      reason: text(input.reason, "Review reason", 1000),
    };
    let current: Actor;
    return this.platform.command(
      actor,
      "events.retry",
      key,
      payload,
      () => {
        current = this.operator(actor, true);
        this.consumer(payload.consumerId);
        check(
          this.store.get(
            "SELECT event_id FROM platform_deliveries WHERE org_id=? AND consumer_id=? AND event_id=?",
            current.orgId,
            payload.consumerId,
            payload.eventId,
          ),
          "NOT_FOUND",
          "Local delivery not found.",
          404,
        );
      },
      () => {
        const row = this.store.get<Delivery>(
          "SELECT * FROM platform_deliveries WHERE org_id=? AND consumer_id=? AND event_id=?",
          current!.orgId,
          payload.consumerId,
          payload.eventId,
        )!;
        check(
          row.revision === payload.revision,
          "REVISION",
          "Local delivery changed. Refresh before reviewing.",
        );
        check(
          row.state === "quarantined" || row.state === "retry",
          "DELIVERY_STATE",
          "Only failed local deliveries can be retried. Completed effects are never replayed.",
        );
        this.store.run(
          "UPDATE platform_deliveries SET state='retry',cycle_attempts=0,revision=revision+1,available_at=?,updated_at=? WHERE org_id=? AND consumer_id=? AND event_id=?",
          Date.now(),
          now(),
          current!.orgId,
          payload.consumerId,
          payload.eventId,
        );
        const result = {
          consumerId: payload.consumerId,
          eventId: payload.eventId,
          revision: row.revision + 1,
          state: "retry",
        };
        this.platform.audit(current!, "events.retry.review", payload.eventId, {
          consumerId: payload.consumerId,
          previousError: row.last_error,
          reason: payload.reason,
          revision: result.revision,
        });
        return result;
      },
    );
  }
}
