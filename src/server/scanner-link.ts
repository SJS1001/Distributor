import {
  canonical,
  check,
  digest,
  id,
  now,
  permit,
  text,
  type Actor,
  type Row,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import { SCANNER_LINK_INITIALIZE } from "./scanner-link-schema.ts";
import type {
  ScannerLinkInput,
  ScannerLinkChannel,
  ScannerLinkReceipt,
} from "../shared/scanner-link.ts";

export type ScannerLinkTransport = {
  orgId: string;
  channels: readonly ScannerLinkChannel[];
  send(
    input: ScannerLinkInput & {
      attemptId: string;
      scannerUrl: string;
      signal: AbortSignal;
    },
  ): Promise<"accepted" | "confirmed" | "rejected">;
};
type Attempt = Row & {
  id: string;
  channel: ScannerLinkChannel;
  recipient_hint: string;
  state: ScannerLinkReceipt["state"];
  created_at: string;
  request_hash: string;
};
const receipt = (row: Attempt): ScannerLinkReceipt => ({
  id: row.id,
  channel: row.channel,
  recipientHint: row.recipient_hint,
  state: row.state,
  createdAt: row.created_at,
});

/** Fixed-purpose staff communication. Unknown attempts are never re-sent. */
export class ScannerLinks {
  private store: Store;
  constructor(
    private database: Database,
    private identity: Identity,
    private platform: Platform,
  ) {
    this.store = database.owned("platform");
    this.store.migrate(SCANNER_LINK_INITIALIZE);
  }
  private authorize(actor: Actor) {
    actor = this.identity.currentActor(actor);
    permit(actor, ["warehouse", "commercial"]);
    check(!actor.accountId, "FORBIDDEN", "Staff access is required.", 403);
    const security = this.identity.security(actor);
    check(
      !security.passwordChangeRequired &&
        (!security.mfa.required || security.mfa.enabled),
      "PASSWORD_CHANGE_REQUIRED",
      "Complete account security setup before sending a scanner link.",
      403,
    );
    return actor;
  }
  configuration(actor: Actor, transport?: ScannerLinkTransport) {
    actor = this.authorize(actor);
    return {
      scope: `${actor.orgId}:${actor.id}`,
      channels: transport?.orgId === actor.orgId ? [...transport.channels] : [],
    };
  }
  async send(
    actor: Actor,
    key: string,
    input: ScannerLinkInput,
    origin: string,
    transport?: ScannerLinkTransport,
  ) {
    const prepared = this.database.transaction(() => {
      actor = this.authorize(actor);
      text(key, "Attempt key", 128);
      check(
        input.channel === "email" || input.channel === "sms",
        "VALIDATION",
        "Choose email or text.",
        400,
      );
      const recipient = text(input.recipient, "Recipient", 254);
      check(
        input.channel === "email"
          ? /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)
          : /^\+[1-9][0-9]{7,14}$/.test(recipient),
        "VALIDATION",
        "Enter a valid email or international phone number such as +14165550123.",
        400,
      );
      const scannerUrl = new URL("/#scanner", origin).href;
      const hash = digest(canonical({ ...input, recipient, scannerUrl }));
      const old = this.store.get<Attempt>(
        "SELECT * FROM platform_scanner_links WHERE org_id=? AND actor_id=? AND attempt_key=?",
        actor.orgId,
        actor.id,
        key,
      );
      if (old) {
        check(
          old.request_hash === hash,
          "IDEMPOTENCY_CONFLICT",
          "This attempt belongs to different recipient details.",
        );
        return { old };
      }
      this.platform.assertProviderAccess();
      check(
        transport?.orgId === actor.orgId &&
          transport.channels.includes(input.channel),
        "DELIVERY_UNAVAILABLE",
        "Internal delivery is not configured for this channel. Use QR, copy or your device app.",
        503,
      );
      const since = new Date(Date.now() - 3600000).toISOString();
      const own = this.store.get(
        "SELECT count(*) AS n FROM platform_scanner_links WHERE org_id=? AND actor_id=? AND created_at>=?",
        actor.orgId,
        actor.id,
        since,
      );
      const org = this.store.get(
        "SELECT count(*) AS n FROM platform_scanner_links WHERE org_id=? AND created_at>=?",
        actor.orgId,
        since,
      );
      check(
        Number(own?.n) < 5 && Number(org?.n) < 20,
        "DELIVERY_LIMIT",
        "Scanner link limit reached. Use the QR code or copy link for now.",
        429,
      );
      const attemptId = id(),
        created = now();
      const hint =
        input.channel === "sms"
          ? `••••${recipient.slice(-4)}`
          : `${recipient[0]}•••@${recipient.split("@")[1]}`;
      // Commit uncertainty before outbound I/O; a crash cannot make retry send twice.
      this.store.run(
        "INSERT INTO platform_scanner_links VALUES(?,?,?,?,?,?,?,?,?)",
        attemptId,
        actor.orgId,
        actor.id,
        key,
        hash,
        input.channel,
        hint,
        "unknown",
        created,
      );
      this.platform.audit(actor, "scanner.link.attempted", attemptId, {
        channel: input.channel,
        recipientHint: hint,
      });
      return { attemptId, scannerUrl, recipient };
    });
    if (prepared.old) return receipt(prepared.old);
    let state: ScannerLinkReceipt["state"] = "unknown";
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Recheck current authority immediately before invoking the trusted adapter.
      actor = this.authorize(actor);
      this.platform.assertProviderAccess();
      const result = await Promise.race([
        transport!.send({
          ...input,
          recipient: prepared.recipient!,
          attemptId: prepared.attemptId!,
          scannerUrl: prepared.scannerUrl!,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Delivery timed out"));
          }, 10000);
        }),
      ]);
      if (["accepted", "confirmed", "rejected"].includes(result))
        state = result;
    } catch {
      /* Never infer failure or delivery from a lost provider response. */
    } finally {
      clearTimeout(timer);
    }
    this.database.transaction(() => {
      this.store.run(
        "UPDATE platform_scanner_links SET state=? WHERE id=? AND state='unknown'",
        state,
        prepared.attemptId!,
      );
      this.platform.audit(actor, "scanner.link.outcome", prepared.attemptId!, {
        state,
      });
    });
    // A revoked actor cannot use completion as an alternate read path.
    this.authorize(actor);
    return receipt(
      this.store.get<Attempt>(
        "SELECT * FROM platform_scanner_links WHERE id=?",
        prepared.attemptId!,
      )!,
    );
  }
}
