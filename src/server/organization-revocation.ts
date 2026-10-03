import { canonical, check, DomainError, id, integer, text } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Platform } from "./platform.ts";
import type { Identity } from "./iam.ts";
import type { CredentialBinding } from "./provider-credentials.ts";
import type { LedgerAuthority } from "./organization-residency.ts";
import { ORGANIZATION_REVOCATION_INITIALIZE_DDL } from "./organization-revocation-schema.ts";

type RevocationBinding = CredentialBinding;
type Receipt = {
  id: string;
  org_id: string;
  binding_id: string;
  worker_id: string;
  realm: string;
  client_id: string;
  credential_revision: number;
  disabled_revision: number;
  authority: string;
  review_revision: number | null;
  state: "sending" | "unknown" | "confirmed" | "released";
  claim: string | null;
  started_at: number;
  finished_at: number | null;
  evidence: string | null;
};

// Integration-owned security operation. No persisted token, secret or response body.
export class OrganizationLedgerRevocation {
  constructor(
    private database: Database,
    private store: Store,
    private platform: Platform,
    private identity: Identity,
    private credentials: {
      status: (binding: CredentialBinding) => {
        revision: number;
        state: string;
      };
      currentKey: () => void;
      capture: (
        binding: CredentialBinding,
        revision: number,
        authority: LedgerAuthority,
      ) => string;
      disable: (
        binding: CredentialBinding,
        revision: number,
      ) => { revision: number };
    },
  ) {
    store.migrate(ORGANIZATION_REVOCATION_INITIALIZE_DDL);
  }
  private authority(binding: RevocationBinding, stamp?: LedgerAuthority) {
    this.credentials.status(binding);
    const actor = this.identity.workerActor(
      binding.orgId,
      binding.workerUserId,
    );
    check(
      !actor.accountId,
      "FORBIDDEN",
      "Organization revocation requires an unbound finance worker.",
      403,
    );
    if (stamp) {
      this.platform.assertProviderAccess();
      this.credentials.currentKey();
      check(
        stamp.orgId === binding.orgId && stamp.realm === binding.realm,
        "CREDENTIAL_SCOPE",
        "Organization revocation company differs.",
        403,
      );
      this.identity.organizationResidency.assertAllowedInTransaction(
        actor,
        stamp,
      );
    }
    return { actor };
  }
  assertClear(binding: CredentialBinding) {
    check(
      !this.store.get(
        "SELECT 1 FROM integration_ledger_revocations WHERE org_id=? AND binding_id=? AND state IN('sending','unknown') LIMIT 1",
        binding.orgId,
        binding.id,
      ),
      "REVOCATION_REVIEW",
      "Review the unresolved upstream revocation before reconnecting credentials.",
      503,
    );
  }
  assertRotationClear() {
    check(
      !this.store.get(
        "SELECT 1 FROM integration_ledger_revocations WHERE state IN('sending','unknown') LIMIT 1",
      ),
      "CREDENTIAL_BUSY",
      "Review unresolved upstream revocations before rotating the key.",
      503,
    );
  }
  private row(binding: RevocationBinding, receiptId: string) {
    receiptId = text(receiptId, "revocation receipt ID", 128);
    const row = this.store.get<Receipt>(
      "SELECT * FROM integration_ledger_revocations WHERE org_id=? AND binding_id=? AND id=?",
      binding.orgId,
      binding.id,
      receiptId,
    );
    check(row, "NOT_FOUND", "Revocation receipt is unavailable.", 404);
    check(
      row.worker_id === binding.workerUserId &&
        row.realm === binding.realm &&
        row.client_id === binding.clientId,
      "CREDENTIAL_SCOPE",
      "Revocation receipt belongs to a different initiating binding.",
      403,
    );
    return row;
  }
  private metadata(row: Receipt) {
    return {
      id: row.id,
      purpose: "stock-cost-journal",
      credentialScope: "organization",
      environment: "sandbox",
      authority: JSON.parse(row.authority) as LedgerAuthority,
      bindingId: row.binding_id,
      state: row.state,
      credentialRevision: row.credential_revision,
      disabledRevision: row.disabled_revision,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      providerRevocationConfirmed: row.state === "confirmed",
      confirmationSource:
        row.state === "confirmed"
          ? row.evidence === null
            ? "provider-response"
            : "operator-evidence"
          : null,
    };
  }
  status(binding: RevocationBinding, receiptId: string) {
    return this.database.transaction(() => {
      this.authority(binding);
      return this.metadata(this.row(binding, receiptId));
    });
  }
  invalidateRestored() {
    return this.store.run(
      "UPDATE integration_ledger_revocations SET state='unknown',claim=NULL,finished_at=NULL WHERE state='sending'",
    ).changes;
  }
  async revoke(
    binding: RevocationBinding,
    receiptId: string,
    revision: number,
    authority: LedgerAuthority,
    clientSecret: string,
  ) {
    binding = Object.freeze({ ...binding });
    authority = Object.freeze({ ...authority });
    receiptId = text(receiptId, "revocation receipt ID", 128);
    integer(revision, "credential revision", 1, Number.MAX_SAFE_INTEGER - 1);
    check(
      typeof clientSecret === "string" &&
        /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
      "PROVIDER_CONFIG",
      "QuickBooks client secret is unavailable.",
      503,
    );
    const prepared = this.database.transaction<
      | { cached: ReturnType<OrganizationLedgerRevocation["metadata"]> }
      | { token: string; claim: string }
    >(() => {
      this.authority(binding);
      const previous = this.store.get<Receipt>(
        "SELECT * FROM integration_ledger_revocations WHERE org_id=? AND binding_id=? AND id=?",
        binding.orgId,
        binding.id,
        receiptId,
      );
      if (previous) {
        const row = this.row(binding, receiptId);
        check(
          row.credential_revision === revision &&
            row.authority === canonical(authority),
          "IDEMPOTENCY_CONFLICT",
          "Revocation receipt input differs.",
        );
        return { cached: this.metadata(row) } as const;
      }
      const { actor } = this.authority(binding, authority);
      this.assertClear(binding);
      check(
        !this.store.get(
          "SELECT 1 FROM integration_ledger_revocations WHERE org_id=? AND binding_id=? AND credential_revision=?",
          binding.orgId,
          binding.id,
          revision,
        ),
        "IDEMPOTENCY_CONFLICT",
        "This credential revision already has a revocation receipt.",
      );
      // Capture only in process memory. Disable and cancel callbacks before the sole request.
      const token = this.credentials.capture(binding, revision, authority);
      const disabled = this.credentials.disable(binding, revision);
      this.store.run(
        "UPDATE integration_ledger_authorizations SET state='canceled',claim=NULL,started_at=NULL WHERE org_id=? AND binding_id=? AND state IN('pending','exchanging')",
        binding.orgId,
        binding.id,
      );
      const claim = id(),
        started = Date.now();
      this.store.run(
        "INSERT INTO integration_ledger_revocations VALUES(?,?,?,?,?,?,?,?,?,'sending',?,?,NULL,NULL,NULL)",
        receiptId,
        binding.orgId,
        binding.id,
        binding.workerUserId,
        binding.realm,
        binding.clientId,
        revision,
        disabled.revision,
        canonical(authority),
        claim,
        started,
      );
      this.platform.audit(
        actor,
        "provider.ledger-revocation.begin",
        receiptId,
        {
          bindingId: binding.id,
          revision,
          disabledRevision: disabled.revision,
          provider: "quickbooks",
          environment: "sandbox",
          credentialScope: "organization",
          purpose: "stock-cost-journal",
        },
      );
      return { token, claim } as const;
    });
    if ("cached" in prepared) return prepared.cached;
    try {
      this.database.transaction(() =>
        this.assertClaim(binding, receiptId, prepared.claim, authority),
      );
      const response = await fetch(
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${binding.clientId}:${clientSecret}`).toString("base64")}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ token: prepared.token }),
        },
      );
      // A bounded 200 response is provider confirmation, never independent company qualification.
      // Read and discard even an empty body. Refuse non-200, redirects and oversized bodies.
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new DomainError(
          "REVOCATION_UNKNOWN",
          "Upstream revocation outcome is uncertain.",
          503,
        );
      }
      if (response.body) {
        const reader = response.body.getReader();
        let bytes = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            value.fill(0);
            check(
              bytes <= 65536,
              "REVOCATION_UNKNOWN",
              "Upstream revocation response exceeds the allowed size.",
              503,
            );
          }
        } finally {
          await reader.cancel();
        }
      }
      return this.database.transaction(() => {
        const row = this.assertClaim(
          binding,
          receiptId,
          prepared.claim,
          authority,
        );
        const { actor } = this.authority(binding, authority);
        this.store.run(
          "UPDATE integration_ledger_revocations SET state='confirmed',claim=NULL,finished_at=? WHERE id=?",
          Date.now(),
          row.id,
        );
        this.platform.audit(
          actor,
          "provider.ledger-revocation.confirmed",
          row.id,
          {
            bindingId: binding.id,
            disabledRevision: row.disabled_revision,
            provider: "quickbooks",
            environment: "sandbox",
            credentialScope: "organization",
            purpose: "stock-cost-journal",
          },
        );
        return this.metadata(this.row(binding, receiptId));
      });
    } catch {
      // This may itself fail if the store is unavailable; the persisted sending receipt
      // remains an unresolved fence and can be reviewed after its deadline.
      this.database.transaction(() => {
        this.store.run(
          "UPDATE integration_ledger_revocations SET state='unknown',claim=NULL WHERE org_id=? AND binding_id=? AND id=? AND state='sending' AND claim=?",
          binding.orgId,
          binding.id,
          receiptId,
          prepared.claim,
        );
      });
      throw new DomainError(
        "REVOCATION_UNKNOWN",
        "Upstream revocation is unresolved. Inspect the receipt; do not resend.",
        503,
      );
    }
  }
  private assertClaim(
    binding: RevocationBinding,
    receiptId: string,
    claim: string,
    authority: LedgerAuthority,
  ) {
    // The caller owns the transaction; nesting BEGIN would discard a valid reply.
    this.authority(binding, authority);
    const row = this.row(binding, receiptId);
    const current = this.credentials.status(binding);
    check(
      row.state === "sending" &&
        row.claim === claim &&
        Date.now() < row.started_at + 90000 &&
        row.authority === canonical(authority) &&
        current.revision === row.disabled_revision &&
        current.state === "disabled",
      "REVOCATION_UNKNOWN",
      "Current revocation claim or authority changed.",
      503,
    );
    return row;
  }
  review(
    binding: RevocationBinding,
    receiptId: string,
    revision: number,
    resolution: "provider-confirmed" | "provider-unconfirmed",
    evidence: string,
  ) {
    integer(revision, "credential revision", 1, Number.MAX_SAFE_INTEGER - 1);
    check(
      ["provider-confirmed", "provider-unconfirmed"].includes(resolution),
      "REVOCATION_INPUT",
      "Select an explicit provider outcome.",
    );
    evidence = text(evidence, "provider review evidence", 2000);
    return this.database.transaction(() => {
      const { actor } = this.authority(binding),
        row = this.row(binding, receiptId);
      const current = this.credentials.status(binding),
        state = resolution === "provider-confirmed" ? "confirmed" : "released";
      if (row.state === "confirmed" || row.state === "released") {
        check(
          row.state === state &&
            row.evidence === evidence &&
            row.review_revision === revision,
          "IDEMPOTENCY_CONFLICT",
          "Revocation review already has a different outcome.",
        );
        return this.metadata(row);
      }
      check(
        current.revision === revision &&
          current.state === "disabled" &&
          revision >= row.disabled_revision,
        "REVISION",
        "Review current disabled credentials before releasing the revocation fence.",
      );
      check(
        row.state === "unknown" ||
          (row.state === "sending" && Date.now() >= row.started_at + 90000),
        "CREDENTIAL_BUSY",
        "Allow an active revocation to finish before reviewing it.",
        503,
      );
      this.store.run(
        "UPDATE integration_ledger_revocations SET state=?,claim=NULL,finished_at=?,evidence=?,review_revision=? WHERE id=?",
        state,
        Date.now(),
        evidence,
        revision,
        row.id,
      );
      this.platform.audit(actor, "provider.ledger-revocation.review", row.id, {
        bindingId: binding.id,
        revision,
        resolution,
        evidence,
        provider: "quickbooks",
        environment: "sandbox",
        credentialScope: "organization",
        purpose: "stock-cost-journal",
      });
      return this.metadata(this.row(binding, receiptId));
    });
  }
}
