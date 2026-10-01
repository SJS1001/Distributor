import { randomBytes, timingSafeEqual } from "node:crypto";
import { check, digest, DomainError, id, integer, type Actor } from "./core.ts";
import { type Database, type Store } from "./database.ts";
import { type Identity } from "./iam.ts";
import { type Platform } from "./platform.ts";
import {
  type CredentialBinding,
  type ProviderCredentials,
  type TokenBundle,
} from "./provider-credentials.ts";
import {
  exchangeQuickBooksToken,
  readQuickBooksJson,
} from "./quickbooks-oauth-protocol.ts";

const scope = "com.intuit.quickbooks.accounting";
export type AuthorizationBinding = CredentialBinding & {
  accountId: string;
  redirectUri: string;
};
type Attempt = {
  id: string;
  org_id: string;
  binding_id: string;
  account_id: string;
  worker_id: string;
  realm: string;
  client_id: string;
  redirect_uri: string;
  state_hash: string;
  credential_revision: number;
  residency_version: number;
  expires_at: number;
  state: string;
  claim: string | null;
  started_at: number | null;
  installed_revision: number | null;
};

export class QuickBooksAuthorization {
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private store: Store,
    private vault: ProviderCredentials,
    // Credential owner provides a write within this class's completion transaction.
    private install: (
      binding: CredentialBinding,
      revision: number,
      bundle: TokenBundle,
    ) => { revision: number },
  ) {
    store.migrate(`CREATE TABLE IF NOT EXISTS integration_authorizations (
      id TEXT PRIMARY KEY,org_id TEXT NOT NULL,binding_id TEXT NOT NULL,account_id TEXT NOT NULL,worker_id TEXT NOT NULL,
      realm TEXT NOT NULL,client_id TEXT NOT NULL,redirect_uri TEXT NOT NULL,state_hash TEXT NOT NULL UNIQUE,
      credential_revision INTEGER NOT NULL,residency_version INTEGER NOT NULL,expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN('pending','exchanging','completed','canceled','denied','unknown','expired')),
      claim TEXT,started_at INTEGER,installed_revision INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS integration_authorization_binding ON integration_authorizations(org_id,binding_id);`);
  }
  private redirect(binding: AuthorizationBinding) {
    let uri: URL;
    try {
      uri = new URL(binding.redirectUri);
    } catch {
      throw new DomainError(
        "OAUTH_CONFIG",
        "Configure an exact approved callback URI.",
      );
    }
    check(
      binding.redirectUri.length <= 2048 &&
        uri.href === binding.redirectUri &&
        !uri.username &&
        !uri.password &&
        !uri.search &&
        !uri.hash &&
        (uri.protocol === "https:" ||
          (uri.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname))),
      "OAUTH_CONFIG",
      "Use an exact HTTPS or loopback callback URI without query, fragment or user information.",
    );
    return uri;
  }
  private current(binding: AuthorizationBinding, outbound = true) {
    this.redirect(binding);
    const credentials = this.vault.status(binding);
    const actor = this.identity.workerActor(
      binding.orgId,
      binding.workerUserId,
    );
    if (outbound) {
      this.platform.assertProviderAccess();
      check(
        this.vault.available,
        "CREDENTIAL_KEY",
        "Provider encryption key is unavailable.",
        503,
      );
    }
    const version = outbound
      ? this.identity.providerAllowed(actor, binding.accountId, "quickbooks")
      : this.identity.customer(actor, binding.accountId).residency_version;
    return { actor, credentials, version };
  }
  private row(binding: AuthorizationBinding, attemptId: string) {
    const row = this.store.get<Attempt>(
      "SELECT * FROM integration_authorizations WHERE org_id=? AND binding_id=? AND id=?",
      binding.orgId,
      binding.id,
      attemptId,
    );
    check(row, "NOT_FOUND", "Authorization attempt not found.", 404);
    check(
      row.account_id === binding.accountId &&
        row.worker_id === binding.workerUserId &&
        row.realm === binding.realm &&
        row.client_id === binding.clientId &&
        row.redirect_uri === binding.redirectUri,
      "OAUTH_SCOPE",
      "Authorization binding differs; preserve the initiating configuration.",
    );
    return row;
  }
  private metadata(row: Attempt) {
    return {
      id: row.id,
      bindingId: row.binding_id,
      state: row.state,
      expiresAt: row.expires_at,
      credentialRevision: row.credential_revision,
      installedRevision: row.installed_revision,
      startedAt: row.started_at,
    };
  }
  status(binding: AuthorizationBinding, attemptId: string) {
    this.current(binding, false);
    return this.metadata(this.row(binding, attemptId));
  }
  begin(binding: AuthorizationBinding, revision: number) {
    integer(revision, "credential revision");
    return this.database.transaction(() => {
      const { actor, credentials, version } = this.current(binding);
      check(
        this.vault.available,
        "CREDENTIAL_KEY",
        "Provider encryption key is unavailable.",
        503,
      );
      check(
        credentials.revision === revision,
        "REVISION",
        "Credentials changed; inspect their current revision.",
      );
      check(
        credentials.state !== "refreshing",
        "CREDENTIAL_BUSY",
        "Wait for the current credential refresh to finish.",
        503,
      );
      const nonce = randomBytes(32).toString("base64url"),
        attemptId = id(),
        expiresAt = Date.now() + 600000;
      // A new explicit begin supersedes pending/exchanging attempts, fencing late responses.
      this.store.run(
        "UPDATE integration_authorizations SET state='canceled',claim=NULL WHERE org_id=? AND binding_id=? AND state IN('pending','exchanging')",
        binding.orgId,
        binding.id,
      );
      this.store.run(
        "INSERT INTO integration_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'pending',NULL,NULL,NULL)",
        attemptId,
        binding.orgId,
        binding.id,
        binding.accountId,
        binding.workerUserId,
        binding.realm,
        binding.clientId,
        binding.redirectUri,
        digest(nonce),
        revision,
        version,
        expiresAt,
      );
      this.audit(actor, "begin", attemptId);
      const url = new URL("https://appcenter.intuit.com/connect/oauth2");
      url.search = new URLSearchParams({
        client_id: binding.clientId,
        response_type: "code",
        scope,
        redirect_uri: binding.redirectUri,
        state: nonce,
      }).toString();
      return {
        ...this.metadata(this.row(binding, attemptId)),
        authorizationUrl: url.href,
      };
    });
  }
  cancel(binding: AuthorizationBinding, attemptId: string) {
    return this.database.transaction(() => {
      const { actor } = this.current(binding, false),
        row = this.row(binding, attemptId);
      check(
        ["pending", "exchanging", "canceled"].includes(row.state),
        "OAUTH_USED",
        "This authorization attempt is already terminal.",
      );
      if (row.state !== "canceled") {
        this.store.run(
          "UPDATE integration_authorizations SET state='canceled',claim=NULL WHERE id=?",
          row.id,
        );
        this.audit(actor, "cancel", row.id);
      }
      return this.metadata(this.row(binding, attemptId));
    });
  }
  invalidateRestoredAttempts() {
    return Number(
      this.store.run(
        "UPDATE integration_authorizations SET state='canceled',claim=NULL WHERE state IN('pending','exchanging')",
      ).changes,
    );
  }
  private callback(binding: AuthorizationBinding, input: string) {
    check(
      typeof input === "string" && input.length <= 16384,
      "OAUTH_CALLBACK",
      "Supply a bounded callback through protected stdin.",
    );
    let callback: URL;
    try {
      callback = new URL(input);
    } catch {
      throw new DomainError(
        "OAUTH_CALLBACK",
        "Invalid authorization callback.",
      );
    }
    const expected = this.redirect(binding),
      params = callback.searchParams;
    check(
      !callback.username &&
        !callback.password &&
        !callback.hash &&
        callback.origin === expected.origin &&
        callback.pathname === expected.pathname &&
        [...params.keys()].every(
          (key) =>
            ["state", "code", "realmId", "error", "error_description"].includes(
              key,
            ) && params.getAll(key).length === 1,
        ),
      "OAUTH_CALLBACK",
      "Authorization callback address or parameters differ.",
    );
    const state = params.get("state");
    check(
      state && /^[A-Za-z0-9_-]{43}$/.test(state),
      "OAUTH_STATE",
      "Authorization state is missing or invalid.",
    );
    if (params.has("error")) {
      check(
        !params.has("code") && !params.has("realmId"),
        "OAUTH_CALLBACK",
        "Conflicting authorization callback.",
      );
      return { state, denied: true } as const;
    }
    const code = params.get("code");
    check(
      code &&
        /^[\x21-\x7e]{1,8192}$/.test(code) &&
        !params.has("error_description"),
      "OAUTH_CALLBACK",
      "Authorization code is missing or invalid.",
    );
    check(
      params.get("realmId") === binding.realm,
      "OAUTH_REALM",
      "Authorize the configured sandbox company.",
    );
    return { state, code, denied: false } as const;
  }
  async complete(
    binding: AuthorizationBinding,
    attemptId: string,
    clientSecret: string,
    callbackUrl: string,
  ) {
    const callback = this.callback(binding, callbackUrl);
    const claimed = this.database.transaction(() => {
      const current = this.current(binding),
        row = this.row(binding, attemptId);
      check(
        timingSafeEqual(
          Buffer.from(row.state_hash, "hex"),
          Buffer.from(digest(callback.state), "hex"),
        ),
        "OAUTH_STATE",
        "Authorization state differs.",
      );
      if (row.state === "exchanging" && Date.now() - row.started_at! > 90000) {
        this.store.run(
          "UPDATE integration_authorizations SET state='unknown',claim=NULL WHERE id=?",
          row.id,
        );
        return { terminal: true } as const;
      }
      check(
        row.state === "pending",
        row.state === "exchanging" ? "OAUTH_BUSY" : "OAUTH_USED",
        "Authorization was already consumed; inspect its status.",
      );
      if (Date.now() >= row.expires_at) {
        this.store.run(
          "UPDATE integration_authorizations SET state='expired' WHERE id=?",
          row.id,
        );
        return { terminal: true } as const;
      }
      this.fresh(row, current);
      if (callback.denied) {
        this.store.run(
          "UPDATE integration_authorizations SET state='denied' WHERE id=?",
          row.id,
        );
        this.audit(current.actor, "deny", row.id);
        return { denied: this.metadata(this.row(binding, row.id)) } as const;
      }
      // Validate the secret before consuming state or initiating network I/O.
      check(
        typeof clientSecret === "string" &&
          /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
        "PROVIDER_CONFIG",
        "QuickBooks client secret is unavailable.",
        503,
      );
      const claim = id();
      this.store.run(
        "UPDATE integration_authorizations SET state='exchanging',claim=?,started_at=? WHERE id=?",
        claim,
        Date.now(),
        row.id,
      );
      this.audit(current.actor, "exchange", row.id);
      return { row, claim } as const;
    });
    if ("terminal" in claimed)
      throw new DomainError(
        "OAUTH_EXPIRED",
        "Expired or interrupted authorization requires a new connection attempt.",
      );
    if ("denied" in claimed) return claimed.denied!;
    const { row, claim } = claimed;
    try {
      // Recheck before outbound IO even though the claim transaction just authorized it.
      this.assertClaim(binding, row, claim);
      const tokens = await exchangeQuickBooksToken(binding, clientSecret, {
        grant_type: "authorization_code",
        code: callback.code!,
        redirect_uri: row.redirect_uri,
      });
      // Prove access to the exact sandbox company before retaining the issued tokens.
      this.assertClaim(binding, row, claim);
      const company = await readQuickBooksJson(
        await fetch(
          `https://sandbox-quickbooks.api.intuit.com/v3/company/${binding.realm}/companyinfo/${binding.realm}`,
          {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(20000),
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
              Accept: "application/json",
            },
          },
        ),
      );
      check(
        company?.CompanyInfo?.Id === binding.realm,
        "OAUTH_COMPANY",
        "Sandbox company identity differs from the approved binding.",
      );
      return this.database.transaction(() => {
        const current = this.current(binding),
          active = this.row(binding, attemptId);
        check(
          active.state === "exchanging" && active.claim === claim,
          "OAUTH_STALE",
          "Authorization was superseded.",
        );
        check(
          Date.now() < row.expires_at,
          "OAUTH_EXPIRED",
          "Authorization attempt expired during exchange.",
        );
        this.fresh(row, current);
        const installed = this.install(
          binding,
          row.credential_revision,
          tokens,
        );
        this.store.run(
          "UPDATE integration_authorizations SET state='completed',claim=NULL,installed_revision=? WHERE id=?",
          installed.revision,
          row.id,
        );
        this.audit(current.actor, "complete", row.id);
        return this.metadata(this.row(binding, row.id));
      });
    } catch (error) {
      this.database.transaction(() => {
        this.store.run(
          "UPDATE integration_authorizations SET state='unknown',claim=NULL WHERE id=? AND state='exchanging' AND claim=?",
          row.id,
          claim,
        );
      });
      throw new DomainError(
        error instanceof DomainError ? error.code : "OAUTH_EXCHANGE",
        "Authorization could not be committed; inspect its status and start a new connection if required.",
        503,
      );
    }
  }
  private assertClaim(
    binding: AuthorizationBinding,
    row: Attempt,
    claim: string,
  ) {
    this.database.transaction(() => {
      const active = this.row(binding, row.id);
      check(
        active.state === "exchanging" && active.claim === claim,
        "OAUTH_STALE",
        "Authorization was superseded.",
      );
      check(
        Date.now() < row.expires_at,
        "OAUTH_EXPIRED",
        "Authorization attempt expired during exchange.",
      );
      this.fresh(row, this.current(binding));
    });
  }
  private fresh(
    row: Attempt,
    current: ReturnType<QuickBooksAuthorization["current"]>,
  ) {
    check(
      row.credential_revision === current.credentials.revision &&
        current.credentials.state !== "refreshing",
      "REVISION",
      "Credentials changed during authorization; begin again with the current revision.",
    );
    check(
      row.residency_version === current.version,
      "OAUTH_CONSENT",
      "Customer processing choice changed during authorization.",
    );
  }
  private audit(actor: Actor, action: string, attemptId: string) {
    this.platform.audit(actor, `provider.authorization.${action}`, attemptId, {
      provider: "quickbooks",
      environment: "sandbox",
    });
  }
}
