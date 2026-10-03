import { canonical, check, DomainError, text, type Actor } from "./core.ts";
import type {
  CredentialBinding,
  ProviderCredentials,
} from "./provider-credentials.ts";
import { QuickBooksStockJournalAdapter } from "./quickbooks-stock-journal.ts";
import type { Effect } from "./integration.ts";
import type { StockJournalDelivery } from "./stock-journal-delivery.ts";

export type JournalTransportResult =
  | { journalId: string; outcome: "idle" }
  | { journalId: string; outcome: "posted"; reference: string }
  | {
      journalId: string;
      outcome: "unknown";
      reason:
        | "lookup-miss"
        | "existing-requires-lookup"
        | "interrupted"
        | "transport-uncertain";
    };

// One explicitly invoked operation, disabled by default. No application startup,
// HTTP route, worker registration, polling, automatic reconciliation or resend.
// The protected foreground CLI invokes one explicitly selected operation.
export class StockJournalTransport {
  private readonly binding: Readonly<CredentialBinding>;
  constructor(
    private readonly journals: StockJournalDelivery,
    private readonly credentials: ProviderCredentials,
    binding: CredentialBinding,
    private readonly clientSecret: string,
    private readonly enabled = false,
  ) {
    check(
      binding &&
        typeof binding === "object" &&
        !Array.isArray(binding) &&
        canonical(Object.keys(binding).sort()) ===
          canonical(
            ["id", "orgId", "workerUserId", "realm", "clientId"].sort(),
          ),
      "JOURNAL_BINDING",
      "Supply the exact organization journal credential binding.",
    );
    for (const name of ["id", "orgId", "workerUserId", "clientId"] as const)
      text(binding[name], name, 200);
    check(
      typeof binding.realm === "string" &&
        /^[1-9][0-9]{0,29}$/.test(binding.realm) &&
        typeof clientSecret === "string" &&
        typeof enabled === "boolean",
      "JOURNAL_BINDING",
      "Invalid sandbox journal transport configuration.",
    );
    this.binding = Object.freeze({ ...binding });
  }
  async run(
    actor: Actor,
    journalId: string,
    mode: "write" | "lookup",
    signal?: AbortSignal,
  ): Promise<JournalTransportResult> {
    check(
      this.enabled,
      "PROVIDER_DISABLED",
      "Journal sandbox transport is disabled.",
      503,
    );
    const uninterrupted = () =>
      check(
        !signal?.aborted,
        "JOURNAL_INTERRUPTED",
        "Journal operation was interrupted.",
        503,
      );
    uninterrupted();
    check(
      actor.orgId === this.binding.orgId &&
        actor.id === this.binding.workerUserId,
      "JOURNAL_BINDING",
      "The current worker must match this organization credential binding.",
      403,
    );
    const current = this.journals.detail(actor, journalId);
    check(
      current.bindingId === this.binding.id &&
        current.realm === this.binding.realm,
      "JOURNAL_BINDING",
      "Use the exact independently reviewed journal binding and company.",
    );
    const status = this.credentials.ledger.status(this.binding);
    check(
      status.state === "ready",
      "CREDENTIAL_RECONNECT",
      "Review and reconnect current organization credentials.",
      503,
    );
    let credentialRevision = status.revision;
    const lease = this.journals.claim(actor, journalId, mode);
    if (!lease) return { journalId, outcome: "idle" };
    let dispatched = false;
    const credentialFence = () => {
      uninterrupted();
      this.credentials.ledger.assertVersionInTransaction(
        this.binding,
        lease.authority,
        credentialRevision,
      );
    };
    const guard = (
      effect: Readonly<Effect>,
      phase: "read" | "write" = "read",
    ) => {
      uninterrupted();
      check(
        canonical(effect) === canonical(lease.effect) &&
          (phase === "read" || lease.mode === "write"),
        "JOURNAL_BINDING",
        "Transport operation differs from its issued lease.",
      );
      this.journals.guard(lease, credentialFence);
    };
    try {
      const adapter = new QuickBooksStockJournalAdapter(
        lease.realm,
        async (effect) => {
          guard(effect);
          // The revision is captured atomically with cached-token decryption or
          // refresh acceptance, never inferred from a later status read.
          const token = await this.credentials.ledger.accessVersioned(
            this.binding,
            this.clientSecret,
            lease.authority,
            credentialRevision,
          );
          check(
            token.revision === credentialRevision ||
              token.revision === credentialRevision + 1,
            "CREDENTIAL_STALE",
            "Credential access differs from this operation's revision.",
            503,
          );
          credentialRevision = token.revision;
          guard(effect);
          return token.accessToken;
        },
        guard,
        true,
        signal,
      );
      const result =
        mode === "lookup"
          ? await adapter.lookup(lease.effect)
          : await adapter.execute(lease.effect, () => {
              guard(lease.effect, "write");
              this.journals.beforeWrite(lease, credentialFence);
              dispatched = true;
            });
      guard(lease.effect);
      if (!result || (mode === "write" && !dispatched)) {
        this.journals.unresolved(
          lease,
          result ? "transport-uncertain" : "lookup-miss",
        );
        return {
          journalId,
          outcome: "unknown",
          reason: result ? "existing-requires-lookup" : "lookup-miss",
        };
      }
      this.journals.posted(lease, result, credentialFence);
      return { journalId, outcome: "posted", reference: result.reference };
    } catch {
      // Raw provider bodies, exceptions and credential material never enter an
      // observation or operational result. A failed retention must not claim a
      // persisted unknown outcome or release a successor's lease.
      try {
        this.journals.unresolved(lease, "transport-uncertain");
      } catch {
        throw new DomainError(
          "JOURNAL_RETENTION",
          "Journal ownership or outcome retention changed; inspect native state before reconciliation.",
          503,
        );
      }
      return {
        journalId,
        outcome: "unknown",
        reason: signal?.aborted ? "interrupted" : "transport-uncertain",
      };
    }
  }
}
