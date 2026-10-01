import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { check, DomainError, id, integer, text, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { type Effect } from "./integration.ts";

export type CredentialBinding = {
  id: string;
  orgId: string;
  workerUserId: string;
  realm: string;
  clientId: string;
};
export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  hardExpiresAt?: number;
};
type Credential = {
  org_id: string;
  binding_id: string;
  realm: string;
  client_id: string;
  revision: number;
  state: string;
  material: string | null;
  claim: string | null;
  started_at: number | null;
};
// Integration owns credentials. No HTTP route or durable command can return this material.
export class ProviderCredentials {
  private store: Store;
  private key?: Buffer;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    key?: string,
  ) {
    check(
      key === undefined || /^[a-fA-F0-9]{64}$/.test(key),
      "CREDENTIAL_KEY",
      "Provider encryption key must be 64 hexadecimal characters.",
      500,
    );
    if (key) this.key = Buffer.from(key, "hex");
    this.store = database.owned("integration");
    this.store.migrate(`CREATE TABLE IF NOT EXISTS integration_credentials (
      org_id TEXT NOT NULL,binding_id TEXT NOT NULL,realm TEXT NOT NULL,client_id TEXT NOT NULL,
      revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('ready','refreshing','unknown','disabled')),
      material TEXT,claim TEXT,started_at INTEGER,PRIMARY KEY(org_id,binding_id)
    ) STRICT;`);
  }
  get available() {
    return !!this.key;
  }
  close() {
    this.key?.fill(0);
    this.key = undefined;
  }
  private validateBinding(binding: CredentialBinding) {
    text(binding.id, "binding ID");
    text(binding.orgId, "organization ID");
    text(binding.workerUserId, "worker ID");
    check(
      /^\d+$/.test(binding.realm),
      "PROVIDER_CONFIG",
      "Invalid QuickBooks realm.",
    );
    check(
      /^[A-Za-z0-9_-]{1,200}$/.test(binding.clientId),
      "PROVIDER_CONFIG",
      "Invalid QuickBooks client identity.",
    );
    this.identity.workerActor(binding.orgId, binding.workerUserId);
  }
  private authorize(binding: CredentialBinding, effect?: Effect): Actor {
    this.validateBinding(binding);
    this.platform.assertProviderAccess();
    const actor = this.identity.workerActor(
      binding.orgId,
      binding.workerUserId,
    );
    if (effect) {
      check(
        effect.org_id === binding.orgId && effect.provider === "quickbooks",
        "FORBIDDEN",
        "Credential operation scope differs.",
        403,
      );
      this.identity.providerAllowed(actor, effect.account_id, "quickbooks");
    }
    return actor;
  }
  private row(binding: CredentialBinding) {
    const row = this.store.get<Credential>(
      "SELECT * FROM integration_credentials WHERE org_id=? AND binding_id=?",
      binding.orgId,
      binding.id,
    );
    if (row)
      check(
        row.realm === binding.realm && row.client_id === binding.clientId,
        "CREDENTIAL_SCOPE",
        "Credential company or client differs; preserve the original binding.",
      );
    return row;
  }
  private context(row: Credential) {
    return Buffer.from(
      JSON.stringify([
        "quickbooks-sandbox-v1",
        row.org_id,
        row.binding_id,
        row.realm,
        row.client_id,
        row.revision,
      ]),
    );
  }
  private encrypt(row: Credential, bundle: TokenBundle) {
    check(
      this.key,
      "CREDENTIAL_KEY",
      "Provider encryption key is unavailable.",
      503,
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.context(row));
    const plaintext = Buffer.from(JSON.stringify(bundle));
    try {
      const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return JSON.stringify({
        iv: iv.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"),
        data: data.toString("hex"),
      });
    } finally {
      plaintext.fill(0);
    }
  }
  private decrypt(row: Credential): TokenBundle {
    check(
      this.key,
      "CREDENTIAL_KEY",
      "Provider encryption key is unavailable.",
      503,
    );
    let plaintext: Buffer | undefined;
    try {
      const value = JSON.parse(row.material!);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(value.iv, "hex"),
      );
      decipher.setAAD(this.context(row));
      decipher.setAuthTag(Buffer.from(value.tag, "hex"));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.data, "hex")),
        decipher.final(),
      ]);
      return this.validateBundle(JSON.parse(plaintext.toString()), false);
    } catch {
      throw new DomainError(
        "CREDENTIAL_INTEGRITY",
        "Provider credentials cannot be decrypted; inspect key custody and binding.",
        503,
      );
    } finally {
      plaintext?.fill(0);
    }
  }
  private validateBundle(value: TokenBundle, fresh: boolean): TokenBundle {
    const token = (v: unknown) => {
      check(
        typeof v === "string" && /^[\x21-\x7e]{1,8192}$/.test(v),
        "CREDENTIAL_INPUT",
        "Invalid provider token.",
      );
      return v;
    };
    const accessExpiresAt = integer(
        value.accessExpiresAt,
        "access expiry",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      refreshExpiresAt = integer(
        value.refreshExpiresAt,
        "refresh expiry",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      hardExpiresAt =
        value.hardExpiresAt === undefined
          ? undefined
          : integer(
              value.hardExpiresAt,
              "hard expiry",
              1,
              Number.MAX_SAFE_INTEGER,
            );
    check(
      !fresh ||
        (refreshExpiresAt > Date.now() &&
          (hardExpiresAt === undefined || hardExpiresAt > Date.now())),
      "CREDENTIAL_EXPIRED",
      "Reconnect with unexpired refresh credentials.",
    );
    return {
      accessToken: token(value.accessToken),
      refreshToken: token(value.refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      hardExpiresAt,
    };
  }
  status(binding: CredentialBinding) {
    this.validateBinding(binding);
    const row = this.row(binding);
    return {
      bindingId: binding.id,
      revision: row?.revision ?? 0,
      state: row?.state ?? "missing",
      startedAt: row?.started_at ?? null,
    };
  }
  // Filesystem-authorized operator API; secrets arrive via protected stdin in the CLI.
  install(binding: CredentialBinding, revision: number, input: TokenBundle) {
    const bundle = this.validateBundle(input, true);
    integer(revision, "credential revision");
    return this.database.transaction(() => {
      const actor = this.authorize(binding),
        old = this.row(binding);
      check(
        (old?.revision ?? 0) === revision,
        "REVISION",
        "Credentials changed; inspect current state before replacement.",
      );
      const row: Credential = {
        org_id: binding.orgId,
        binding_id: binding.id,
        realm: binding.realm,
        client_id: binding.clientId,
        revision: revision + 1,
        state: "ready",
        material: null,
        claim: null,
        started_at: null,
      };
      const material = this.encrypt(row, bundle);
      this.store.run(
        "INSERT INTO integration_credentials VALUES(?,?,?,?,?,'ready',?,NULL,NULL) ON CONFLICT(org_id,binding_id) DO UPDATE SET revision=excluded.revision,state='ready',material=excluded.material,claim=NULL,started_at=NULL",
        row.org_id,
        row.binding_id,
        row.realm,
        row.client_id,
        row.revision,
        material,
      );
      this.platform.audit(actor, "provider.credentials.install", binding.id, {
        revision: row.revision,
        provider: "quickbooks",
        environment: "sandbox",
      });
      return this.status(binding);
    });
  }
  disable(binding: CredentialBinding, revision: number) {
    return this.database.transaction(() => {
      this.validateBinding(binding);
      const actor = this.identity.workerActor(
          binding.orgId,
          binding.workerUserId,
        ),
        row = this.row(binding);
      check(
        row && row.revision === revision,
        "REVISION",
        "Credentials changed; inspect current state before disabling.",
      );
      this.store.run(
        "UPDATE integration_credentials SET revision=revision+1,state='disabled',material=NULL,claim=NULL,started_at=NULL WHERE org_id=? AND binding_id=?",
        binding.orgId,
        binding.id,
      );
      this.platform.audit(actor, "provider.credentials.disable", binding.id, {
        revision: revision + 1,
        provider: "quickbooks",
        providerRevocationConfirmed: false,
      });
      return this.status(binding);
    });
  }
  // Snapshot refresh tokens may have rotated or been revoked after the cutoff.
  invalidateRestoredCredentials() {
    return Number(
      this.store.run(
        "UPDATE integration_credentials SET revision=revision+1,state='disabled',material=NULL,claim=NULL,started_at=NULL",
      ).changes,
    );
  }
  async access(
    binding: CredentialBinding,
    clientSecret: string,
    effect: Effect,
  ): Promise<string> {
    const claim = this.database.transaction(() => {
      this.authorize(binding, effect);
      const row = this.row(binding);
      check(
        row,
        "CREDENTIAL_MISSING",
        "Reconnect QuickBooks credentials.",
        503,
      );
      if (row.state === "refreshing" && Date.now() - row.started_at! > 90000) {
        this.store.run(
          "UPDATE integration_credentials SET state='unknown',material=NULL,claim=NULL WHERE org_id=? AND binding_id=?",
          binding.orgId,
          binding.id,
        );
        return { expiredClaim: true } as const;
      }
      check(
        row.state === "ready",
        row.state === "refreshing" ? "CREDENTIAL_BUSY" : "CREDENTIAL_RECONNECT",
        "QuickBooks credentials require current state review.",
        503,
      );
      const bundle = this.decrypt(row);
      check(
        Math.min(bundle.refreshExpiresAt, bundle.hardExpiresAt ?? Infinity) >
          Date.now(),
        "CREDENTIAL_EXPIRED",
        "Reconnect expired QuickBooks credentials.",
        503,
      );
      if (bundle.accessExpiresAt > Date.now() + 30000)
        return { accessToken: bundle.accessToken } as const;
      check(
        typeof clientSecret === "string" &&
          /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
        "PROVIDER_CONFIG",
        "QuickBooks client secret is unavailable.",
        503,
      );
      const token = id();
      this.store.run(
        "UPDATE integration_credentials SET state='refreshing',claim=?,started_at=? WHERE org_id=? AND binding_id=?",
        token,
        Date.now(),
        binding.orgId,
        binding.id,
      );
      return { row, bundle, token, requestedAt: Date.now() } as const;
    });
    if ("expiredClaim" in claim)
      throw new DomainError(
        "CREDENTIAL_RECONNECT",
        "An interrupted token refresh requires reconnection.",
        503,
      );
    if ("accessToken" in claim) return claim.accessToken!;
    const { row, bundle, token, requestedAt } = claim;
    try {
      this.authorize(binding, effect);
      const response = await fetch(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${binding.clientId}:${clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "x-include-refresh-token-hard-expires-in": "true",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: bundle.refreshToken,
          }).toString(),
        },
      );
      check(
        response.status === 200,
        "CREDENTIAL_REFRESH",
        "QuickBooks token refresh did not return a valid response.",
        503,
      );
      // Read bounded bytes; never put provider bodies in errors or operational output.
      check(
        response.body,
        "CREDENTIAL_REFRESH",
        "QuickBooks token response is missing.",
        503,
      );
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          check(
            bytes <= 65536,
            "CREDENTIAL_REFRESH",
            "QuickBooks token response exceeds the allowed size.",
            503,
          );
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const result = JSON.parse(Buffer.concat(chunks).toString());
      check(
        typeof result.token_type === "string" &&
          result.token_type.toLowerCase() === "bearer",
        "CREDENTIAL_REFRESH",
        "Unsupported token response.",
        503,
      );
      const seconds = (value: unknown, max: number) =>
        integer(value, "token lifetime", 1, max) * 1000;
      const hardExpiresAt = Math.min(
        bundle.hardExpiresAt ?? Infinity,
        result.x_refresh_token_hard_expires_in === undefined
          ? Infinity
          : requestedAt +
              seconds(result.x_refresh_token_hard_expires_in, 366 * 86400),
      );
      const next = this.validateBundle(
        {
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
          accessExpiresAt: requestedAt + seconds(result.expires_in, 86400),
          refreshExpiresAt:
            requestedAt +
            seconds(result.x_refresh_token_expires_in, 366 * 86400),
          ...(Number.isFinite(hardExpiresAt) ? { hardExpiresAt } : {}),
        },
        true,
      );
      check(
        next.accessExpiresAt > Date.now() + 30000,
        "CREDENTIAL_REFRESH",
        "Returned access token is already expiring.",
        503,
      );
      return this.database.transaction(() => {
        const actor = this.authorize(binding, effect),
          current = this.row(binding);
        check(
          current?.state === "refreshing" &&
            current.claim === token &&
            current.revision === row.revision,
          "CREDENTIAL_STALE",
          "Token refresh was superseded.",
          503,
        );
        const updated = { ...row, revision: row.revision + 1 };
        this.store.run(
          "UPDATE integration_credentials SET revision=?,state='ready',material=?,claim=NULL,started_at=NULL WHERE org_id=? AND binding_id=?",
          updated.revision,
          this.encrypt(updated, next),
          binding.orgId,
          binding.id,
        );
        this.platform.audit(actor, "provider.credentials.refresh", binding.id, {
          revision: updated.revision,
          provider: "quickbooks",
        });
        return next.accessToken;
      });
    } catch (error) {
      this.database.transaction(() => {
        this.store.run(
          "UPDATE integration_credentials SET state='unknown',material=NULL,claim=NULL WHERE org_id=? AND binding_id=? AND revision=? AND claim=? AND state='refreshing'",
          binding.orgId,
          binding.id,
          row.revision,
          token,
        );
      });
      throw new DomainError(
        error instanceof DomainError ? error.code : "CREDENTIAL_REFRESH",
        "QuickBooks token refresh was not accepted; inspect state and reconnect before retrying.",
        503,
      );
    }
  }
}
