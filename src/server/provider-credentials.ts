import { OrganizationLedgerAuthorization } from "./organization-authorization.ts";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { check, DomainError, id, integer, text, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { type Effect } from "./integration.ts";
import { QuickBooksAuthorization } from "./quickbooks-authorization.ts";
import { exchangeQuickBooksToken } from "./quickbooks-oauth-protocol.ts";
import type { LedgerAuthority } from "./organization-residency.ts";
import { QuickBooksRevocation } from "./quickbooks-revocation.ts";

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
// Scope is part of the durable binding ID and thus authenticated encryption AAD.
// Only this vault constructs branded bindings. Buyer APIs refuse the namespace.
const ledgerNamespace = "organization-ledger-sandbox-v1:";
const ledgerBindings = new WeakSet<CredentialBinding>();

// Integration owns credentials. No HTTP route or durable command can return this material.
export class ProviderCredentials {
  private store: Store;
  private key?: Buffer;
  private generation = 0;
  readonly ledger: {
    authorization: OrganizationLedgerAuthorization;
    status: (
      binding: CredentialBinding,
    ) => ReturnType<ProviderCredentials["status"]>;
    install: (
      binding: CredentialBinding,
      revision: number,
      input: TokenBundle,
      authority: LedgerAuthority,
    ) => ReturnType<ProviderCredentials["status"]>;
    disable: (
      binding: CredentialBinding,
      revision: number,
    ) => ReturnType<ProviderCredentials["status"]>;
    access: (
      binding: CredentialBinding,
      clientSecret: string,
      authority: LedgerAuthority,
    ) => Promise<string>;
    accessVersioned: (
      binding: CredentialBinding,
      clientSecret: string,
      authority: LedgerAuthority,
      expectedRevision: number,
    ) => Promise<Readonly<{ accessToken: string; revision: number }>>;
    assertVersionInTransaction: (
      binding: CredentialBinding,
      authority: LedgerAuthority,
      revision: number,
    ) => void;
  };
  readonly authorization: QuickBooksAuthorization;
  readonly revocation: QuickBooksRevocation;
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
    ) STRICT;
    CREATE TABLE IF NOT EXISTS integration_credential_key (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation INTEGER NOT NULL CHECK(generation>0),fingerprint TEXT NOT NULL
    ) STRICT;`);
    this.generation = this.keyRow()?.generation ?? 0;
    const publicStatus = (
      binding: CredentialBinding,
      internal: CredentialBinding,
    ) => ({
      ...this.status(internal),
      bindingId: binding.id,
    });
    const ledgerAuthorization = new OrganizationLedgerAuthorization(
      database,
      platform,
      identity,
      this.store,
      {
        status: (binding) => publicStatus(binding, this.ledgerBinding(binding)),
        currentKey: () => this.assertCurrentKey(),
      },
      (binding, revision, bundle, authority) =>
        this.writeInstall(
          this.ledgerBinding(binding),
          revision,
          bundle,
          this.ledgerStamp(authority),
        ),
    );
    this.ledger = Object.freeze({
      authorization: ledgerAuthorization,
      status: (binding: CredentialBinding) =>
        publicStatus(binding, this.ledgerBinding(binding)),
      install: (
        binding: CredentialBinding,
        revision: number,
        input: TokenBundle,
        authority: LedgerAuthority,
      ) => {
        const internal = this.ledgerBinding(binding),
          stamp = this.ledgerStamp(authority);
        return this.database.transaction(() => {
          this.writeInstall(internal, revision, input, stamp);
          return publicStatus(binding, internal);
        });
      },
      disable: (binding: CredentialBinding, revision: number) => {
        const internal = this.ledgerBinding(binding);
        return this.database.transaction(() => {
          this.writeDisable(internal, revision);
          return publicStatus(binding, internal);
        });
      },
      access: async (
        binding: CredentialBinding,
        clientSecret: string,
        authority: LedgerAuthority,
      ) =>
        (
          await this.accessScoped(
            this.ledgerBinding(binding),
            clientSecret,
            undefined,
            this.ledgerStamp(authority),
          )
        ).accessToken,
      accessVersioned: async (
        binding: CredentialBinding,
        clientSecret: string,
        authority: LedgerAuthority,
        expectedRevision: number,
      ) =>
        this.accessScoped(
          this.ledgerBinding(binding),
          clientSecret,
          undefined,
          this.ledgerStamp(authority),
          integer(expectedRevision, "credential revision", 0),
        ),
      assertVersionInTransaction: (
        binding: CredentialBinding,
        authority: LedgerAuthority,
        revision: number,
      ) => {
        this.database.requireTransaction();
        const internal = this.ledgerBinding(binding);
        this.authorize(internal, undefined, this.ledgerStamp(authority));
        this.assertCurrentKey();
        const row = this.row(internal);
        check(
          row?.state === "ready" && row.revision === revision,
          "CREDENTIAL_STALE",
          "Organization credentials changed during this journal operation.",
          503,
        );
      },
    });
    this.revocation = new QuickBooksRevocation(
      database,
      this.store,
      platform,
      identity,
      {
        status: (binding) => this.status(binding),
        currentKey: () => this.assertCurrentKey(),
        capture: (binding, revision) => {
          this.authorize(binding);
          this.assertCurrentKey();
          const row = this.row(binding);
          check(
            row && row.revision === revision,
            "REVISION",
            "Inspect the current credential revision before revocation.",
          );
          check(
            row.state === "ready",
            "CREDENTIAL_RECONNECT",
            "Only a current ready token can be revoked; resolve interrupted refreshes separately.",
            503,
          );
          return this.decrypt(row).refreshToken;
        },
        disable: (binding, revision) => this.writeDisable(binding, revision),
      },
    );
    this.authorization = new QuickBooksAuthorization(
      database,
      platform,
      identity,
      this.store,
      this,
      (binding, revision, bundle) =>
        this.writeInstall(binding, revision, bundle),
      (binding, revision) => this.writeDisable(binding, revision),
    );
  }
  get available() {
    return this.keyAvailable(this.keyRow());
  }
  private keyAvailable(current: ReturnType<ProviderCredentials["keyRow"]>) {
    return (
      !!this.key &&
      (!current ||
        (current.fingerprint === this.fingerprint(this.key) &&
          (current.generation === this.generation ||
            (this.generation === 0 && current.generation === 1))))
    );
  }
  close() {
    this.key?.fill(0);
    this.key = undefined;
  }
  private fingerprint(key: Buffer) {
    return createHash("sha256")
      .update("distributor-provider-key-v1")
      .update(key)
      .digest("hex");
  }
  private keyRow() {
    return this.store.get<{ generation: number; fingerprint: string }>(
      "SELECT generation,fingerprint FROM integration_credential_key WHERE singleton=1",
    );
  }
  keyStatus() {
    const current = this.keyRow();
    return {
      generation: current?.generation ?? 0,
      configured: !!this.key,
      current: this.keyAvailable(current),
    };
  }
  private assertConfiguredKey() {
    check(
      this.key,
      "CREDENTIAL_KEY",
      "Provider encryption key is unavailable.",
      503,
    );
    check(
      this.available,
      "CREDENTIAL_INTEGRITY",
      "Provider key or generation differs; restart with the current key.",
      503,
    );
  }
  assertCurrentKey() {
    this.assertConfiguredKey();
    // Before the first marker, a configured key must prove existing legacy material.
    if (!this.keyRow()) {
      this.store.visit<Credential>(
        "SELECT * FROM integration_credentials WHERE material IS NOT NULL",
        [],
        (row) => {
          this.decrypt(row);
        },
      );
    }
  }
  private registerKey() {
    this.assertCurrentKey();
    let current = this.keyRow();
    if (!current) {
      // This marker commits in the same transaction as the credential write.
      this.store.run(
        "INSERT INTO integration_credential_key VALUES(1,1,?)",
        this.fingerprint(this.key!),
      );
      current = this.keyRow()!;
    }
    this.generation = current.generation;
  }
  // Filesystem operator action. Every affected organization needs current finance authority.
  rotate(
    workers: { orgId: string; workerUserId: string }[],
    generation: number,
    nextKey: string,
  ) {
    integer(generation, "key generation", 0, Number.MAX_SAFE_INTEGER - 1);
    check(
      typeof nextKey === "string" && /^[a-fA-F0-9]{64}$/.test(nextKey),
      "CREDENTIAL_KEY",
      "Supply a separate 64-character hexadecimal key through protected stdin.",
    );
    check(
      Array.isArray(workers) && workers.length > 0 && workers.length <= 100,
      "CREDENTIAL_SCOPE",
      "Supply current finance workers for all affected organizations (at most 100).",
    );
    const replacement = Buffer.from(nextKey, "hex");
    let committed = false;
    try {
      const result = this.database.transaction(() => {
        this.assertCurrentKey();
        this.platform.assertProviderAccess();
        this.revocation.assertRotationClear();
        check(
          (this.keyRow()?.generation ?? 0) === generation,
          "REVISION",
          "Key generation changed; inspect current status before rotation.",
        );
        check(
          this.fingerprint(replacement) !== this.fingerprint(this.key!),
          "CREDENTIAL_KEY",
          "Choose a different encryption key.",
        );
        const actors = new Map<string, Actor>();
        for (const worker of workers) {
          check(
            worker && typeof worker === "object" && !Array.isArray(worker),
            "CREDENTIAL_SCOPE",
            "Supply organization worker identities.",
          );
          text(worker.orgId, "organization ID");
          text(worker.workerUserId, "worker ID");
          check(
            !actors.has(worker.orgId),
            "CREDENTIAL_SCOPE",
            "Duplicate organization in rotation authority.",
          );
          actors.set(
            worker.orgId,
            this.identity.workerActor(worker.orgId, worker.workerUserId),
          );
        }
        const scopes = this.store.all<{ org_id: string }>(
          "SELECT org_id FROM integration_credentials UNION SELECT org_id FROM integration_authorizations WHERE state IN('pending','exchanging') UNION SELECT org_id FROM integration_ledger_authorizations WHERE state IN('pending','exchanging') LIMIT 101",
        );
        check(
          scopes.length <= 100 && scopes.every((row) => actors.has(row.org_id)),
          "CREDENTIAL_SCOPE",
          "Current finance authority is required for every affected organization.",
        );
        check(
          !this.store.get(
            "SELECT 1 FROM integration_credentials WHERE state='refreshing' UNION ALL SELECT 1 FROM integration_authorizations WHERE state='exchanging' UNION ALL SELECT 1 FROM integration_ledger_authorizations WHERE state='exchanging' LIMIT 1",
          ),
          "CREDENTIAL_BUSY",
          "Resolve active or interrupted provider exchanges before rotating.",
          503,
        );
        const rows = this.store.all<Credential>(
          "SELECT * FROM integration_credentials ORDER BY org_id,binding_id LIMIT 1001",
        );
        check(
          rows.length <= 1000,
          "CREDENTIAL_LIMIT",
          "This local rotation supports at most 1,000 bindings.",
        );
        for (const row of rows) {
          check(
            Number.isSafeInteger(row.revision) &&
              row.revision < Number.MAX_SAFE_INTEGER,
            "REVISION",
            "Credential revision is exhausted.",
          );
          check(
            (row.state === "ready") === (row.material !== null),
            "CREDENTIAL_INTEGRITY",
            "Credential material does not match its state.",
            503,
          );
          const material =
            row.material === null
              ? null
              : this.encrypt(
                  { ...row, revision: row.revision + 1 },
                  this.decrypt(row),
                  replacement,
                );
          this.store.run(
            "UPDATE integration_credentials SET revision=revision+1,material=?,claim=NULL,started_at=NULL WHERE org_id=? AND binding_id=?",
            material,
            row.org_id,
            row.binding_id,
          );
        }
        const canceled =
          this.authorization.invalidateRestoredAttempts() +
          this.ledger.authorization.invalidateRestoredAttempts();
        this.store.run(
          "INSERT INTO integration_credential_key VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation,fingerprint=excluded.fingerprint",
          generation + 1,
          this.fingerprint(replacement),
        );
        for (const actor of actors.values()) {
          this.platform.audit(
            actor,
            "provider.credentials.rotate",
            "provider-vault",
            {
              generation: generation + 1,
              bindings: rows.filter((row) => row.org_id === actor.orgId).length,
              provider: "quickbooks",
              environment: "sandbox",
            },
          );
        }
        return {
          generation: generation + 1,
          bindings: rows.length,
          canceledAuthorizations: canceled,
        };
      });
      this.key?.fill(0);
      this.key = replacement;
      this.generation = result.generation;
      committed = true;
      return result;
    } finally {
      if (!committed) replacement.fill(0);
    }
  }
  private ledgerStamp(authority: LedgerAuthority): LedgerAuthority {
    check(
      authority && typeof authority === "object" && !Array.isArray(authority),
      "CREDENTIAL_SCOPE",
      "Supply the exact organization ledger authority stamp.",
    );
    // Copy all fields so unexpected scope fields still refuse exact comparison.
    return Object.freeze({ ...authority });
  }
  private ledgerBinding(binding: CredentialBinding): CredentialBinding {
    this.validateBinding(binding);
    check(
      /^[1-9][0-9]{0,39}$/.test(binding.realm),
      "PROVIDER_CONFIG",
      "Invalid organization QuickBooks realm.",
    );
    const internal = Object.freeze({
      id:
        ledgerNamespace +
        createHash("sha256")
          .update(JSON.stringify([binding.orgId, binding.id]))
          .digest("hex"),
      orgId: binding.orgId,
      workerUserId: binding.workerUserId,
      realm: binding.realm,
      clientId: binding.clientId,
    });
    ledgerBindings.add(internal);
    return internal;
  }
  private auditScope(binding: CredentialBinding) {
    return ledgerBindings.has(binding)
      ? {
          purpose: "stock-cost-journal",
          credentialScope: "organization",
          environment: "sandbox",
        }
      : {};
  }
  private validateBinding(binding: CredentialBinding) {
    text(binding.id, "binding ID");
    check(
      !binding.id.startsWith(ledgerNamespace) || ledgerBindings.has(binding),
      "CREDENTIAL_SCOPE",
      "Organization ledger credentials cannot be used through buyer credential APIs.",
    );
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
  private authorize(
    binding: CredentialBinding,
    effect?: Effect,
    authority?: LedgerAuthority,
  ): Actor {
    this.validateBinding(binding);
    this.platform.assertProviderAccess();
    const actor = this.identity.workerActor(
      binding.orgId,
      binding.workerUserId,
    );
    if (ledgerBindings.has(binding)) {
      check(
        authority &&
          authority.orgId === binding.orgId &&
          authority.realm === binding.realm &&
          !effect,
        "CREDENTIAL_SCOPE",
        "Credential company and organization ledger authority differ.",
      );
      this.identity.organizationResidency.assertAllowedInTransaction(
        actor,
        authority,
      );
    } else
      check(
        !authority,
        "CREDENTIAL_SCOPE",
        "Buyer credentials cannot satisfy organization ledger authority.",
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
        row.binding_id.startsWith(ledgerNamespace)
          ? "quickbooks-organization-stock-journal-sandbox-v1"
          : "quickbooks-sandbox-v1",
        row.org_id,
        row.binding_id,
        row.realm,
        row.client_id,
        row.revision,
      ]),
    );
  }
  private encrypt(row: Credential, bundle: TokenBundle, replacement?: Buffer) {
    if (!replacement) this.registerKey();
    check(
      this.key,
      "CREDENTIAL_KEY",
      "Provider encryption key is unavailable.",
      503,
    );
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", replacement ?? this.key, iv);
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
    this.assertConfiguredKey();
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
    return this.database.transaction(() =>
      this.writeInstall(binding, revision, input),
    );
  }
  // Used only by native installation and authorization inside their owning transaction.
  private writeInstall(
    binding: CredentialBinding,
    revision: number,
    input: TokenBundle,
    authority?: LedgerAuthority,
  ) {
    const bundle = this.validateBundle(input, true);
    integer(revision, "credential revision", 0, Number.MAX_SAFE_INTEGER - 1);
    const actor = this.authorize(binding, undefined, authority),
      old = this.row(binding);
    this.revocation.assertClear(binding);
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
      ...this.auditScope(binding),
    });
    return this.status(binding);
  }
  disable(binding: CredentialBinding, revision: number) {
    return this.database.transaction(() =>
      this.writeDisable(binding, revision),
    );
  }
  private writeDisable(binding: CredentialBinding, revision: number) {
    integer(revision, "credential revision", 0, Number.MAX_SAFE_INTEGER - 1);
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
      ...this.auditScope(binding),
    });
    return this.status(binding);
  }
  // Snapshot refresh tokens may have rotated or been revoked after the cutoff.
  invalidateRestoredCredentials() {
    this.revocation.invalidateRestored();
    this.authorization.invalidateRestoredAttempts();
    this.ledger.authorization.invalidateRestoredAttempts();
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
    // Caller-owned configuration and effect records cannot change during refresh.
    return (
      await this.accessScoped(
        Object.freeze({ ...binding }),
        clientSecret,
        Object.freeze({ ...effect }),
      )
    ).accessToken;
  }
  private async accessScoped(
    binding: CredentialBinding,
    clientSecret: string,
    effect?: Effect,
    authority?: LedgerAuthority,
    expectedRevision?: number,
  ): Promise<Readonly<{ accessToken: string; revision: number }>> {
    const claim = this.database.transaction(() => {
      this.authorize(binding, effect, authority);
      this.revocation.assertClear(binding);
      const row = this.row(binding);
      check(
        row,
        "CREDENTIAL_MISSING",
        "Reconnect QuickBooks credentials.",
        503,
      );
      check(
        expectedRevision === undefined || row.revision === expectedRevision,
        "CREDENTIAL_STALE",
        "Organization credentials changed before token access.",
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
        return {
          accessToken: bundle.accessToken,
          revision: row.revision,
        } as const;
      check(
        typeof clientSecret === "string" &&
          /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
        "PROVIDER_CONFIG",
        "QuickBooks client secret is unavailable.",
        503,
      );
      integer(
        row.revision,
        "credential revision",
        0,
        Number.MAX_SAFE_INTEGER - 1,
      );
      const token = id();
      this.store.run(
        "UPDATE integration_credentials SET state='refreshing',claim=?,started_at=? WHERE org_id=? AND binding_id=?",
        token,
        Date.now(),
        binding.orgId,
        binding.id,
      );
      return { row, bundle, token } as const;
    });
    if ("expiredClaim" in claim)
      throw new DomainError(
        "CREDENTIAL_RECONNECT",
        "An interrupted token refresh requires reconnection.",
        503,
      );
    if ("accessToken" in claim)
      return Object.freeze({
        accessToken: claim.accessToken!,
        revision: claim.revision!,
      });
    const { row, bundle, token } = claim;
    try {
      this.database.transaction(() =>
        this.authorize(binding, effect, authority),
      );
      const next = this.validateBundle(
        await exchangeQuickBooksToken(
          binding,
          clientSecret,
          {
            grant_type: "refresh_token",
            refresh_token: bundle.refreshToken,
          },
          bundle.hardExpiresAt,
        ),
        true,
      );
      return this.database.transaction(() => {
        const actor = this.authorize(binding, effect, authority),
          current = this.row(binding);
        check(
          current?.state === "refreshing" &&
            current.claim === token &&
            current.revision === row.revision &&
            current.started_at !== null &&
            Date.now() >= current.started_at &&
            Date.now() - current.started_at <= 90000,
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
          ...this.auditScope(binding),
        });
        return Object.freeze({
          accessToken: next.accessToken,
          revision: updated.revision,
        });
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
