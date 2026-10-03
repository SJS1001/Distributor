import {
  canonical,
  check,
  digest,
  DomainError,
  permit,
  type Actor,
} from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Billing, Invoice, RecordedCredit } from "./billing.ts";
import type { AccountingCreditIntent, Effect } from "./integration.ts";
import type { IntegrationCheckouts } from "./integration-checkouts.ts";

const hash = (v: unknown) => digest(canonical(v));
const exact = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const validText = (v: unknown, max = 160): v is string =>
  typeof v === "string" && v.length > 0 && v === v.trim() && v.length <= max;
const timestamp = (v: unknown): v is string =>
  validText(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const sha = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function assert(v: unknown): asserts v {
  check(
    v,
    "RESTORE_DISPOSITION",
    "Native terminal disposition evidence is incomplete or inconsistent.",
  );
}

export type DispositionCommand =
  | "quickbooks.credit.apply"
  | "quickbooks.credit.cancel"
  | "stripe.checkout.renew";
export type DispositionCommandReceipt = {
  orgId: string;
  actorId: string;
  command: DispositionCommand;
  key: string;
  requestHash: string;
  result: unknown;
  createdAt: string;
};
/** Trusted Platform-owned adapter, not caller-supplied JSON or external evidence.
 * Read all matching committed command receipts on the SAME Database connection
 * and existing transaction. Do not open a second connection or use a cached page.
 * Root wires this port; integration never reads foreign Platform tables. */
export interface IntegrationDispositionReceipts {
  forResultInTransaction(
    orgId: string,
    command: DispositionCommand,
    resultId: string,
  ): readonly DispositionCommandReceipt[];
}
export type IntegrationDispositionBinding = {
  effectId: string;
  effectHash: string;
  orgId: string;
  accountId: string;
  region: "CA" | "US";
  currency: "CAD" | "USD";
  provider: "stripe" | "quickbooks";
  residencyVersion: number;
};
export type IntegrationRestoreDisposition = {
  version: 1;
  disposition:
    "canceled-unsent-credit-application" | "superseded-unsent-checkout";
  binding: IntegrationDispositionBinding;
  invoiceId: string;
  evidenceHash: string;
  transportPermission: false;
  externalOutcomeVerified: false;
  // This is only an identity edge, never a disposition of the successor.
  successorId: string | null;
};
type CreditSource = {
  native: RecordedCredit;
  invoice: Invoice;
  credit: Effect;
  original: AccountingCreditIntent;
};
type Renewal = {
  successor_id: string;
  org_id: string;
  invoice_id: string;
  predecessor_id: string;
  reason: string;
  review_version: string;
  created_at: string;
};

/** Native read fence; no migrations, writes, provider access, or hold changes. */
export class IntegrationRestoreDispositions {
  private store: Store;
  constructor(
    private database: Database,
    private identity: Identity,
    private billing: Billing,
    private checkouts: IntegrationCheckouts,
    private receipts: IntegrationDispositionReceipts,
    private creditSource: (actor: Actor, creditId: string) => CreditSource,
    private creditCapacity: (
      actor: Actor,
      creditId: string,
    ) => {
      reservedAmount: number;
      availableCredit: number;
      availableInvoice: number;
    },
  ) {
    this.store = database.owned("integration");
  }

  getInTransaction(
    actor: Actor,
    binding: IntegrationDispositionBinding,
  ): IntegrationRestoreDisposition | null {
    this.database.requireTransaction();
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance"]);
    check(
      !actor.accountId && !this.identity.security(actor).passwordChangeRequired,
      "FORBIDDEN",
      "Current staff finance authority is required.",
      403,
    );
    // Never retain caller objects or accept a projection for another native row.
    binding = structuredClone(binding);
    try {
      const org = this.identity.configurationOrganization(actor.orgId);
      assert(
        binding.orgId === actor.orgId &&
          binding.region === org.region &&
          binding.currency === org.currency,
      );
      const effect = this.effect(binding.effectId);
      assert(
        effect.org_id === binding.orgId &&
          effect.account_id === binding.accountId &&
          effect.provider === binding.provider &&
          effect.residency_version === binding.residencyVersion &&
          sha(binding.effectHash) &&
          hash(effect) === binding.effectHash,
      );
      this.identity.customer(actor, effect.account_id);
      if (effect.state !== "blocked") return null;
      let evidence: {
        invoiceId: string;
        successorId: string | null;
        facts: unknown;
      };
      let disposition: IntegrationRestoreDisposition["disposition"];
      if (
        effect.provider === "quickbooks" &&
        effect.kind === "credit-application"
      ) {
        evidence = this.cancellation(actor, effect);
        disposition = "canceled-unsent-credit-application";
      } else if (effect.provider === "stripe" && effect.kind === "checkout") {
        evidence = this.supersession(actor, effect);
        disposition = "superseded-unsent-checkout";
      } else return null;
      return {
        version: 1,
        disposition,
        binding,
        invoiceId: evidence.invoiceId,
        successorId: evidence.successorId,
        transportPermission: false,
        externalOutcomeVerified: false,
        evidenceHash: hash({
          version: 1,
          disposition,
          binding,
          facts: evidence.facts,
        }),
      };
    } catch (error) {
      if (
        error instanceof DomainError ||
        error instanceof SyntaxError ||
        error instanceof TypeError
      )
        return null;
      throw error;
    }
  }
  private effect(id: string) {
    assert(validText(id));
    const e = this.store.get<Effect>(
      "SELECT * FROM integration_effects WHERE id=?",
      id,
    );
    assert(
      e &&
        validText(e.org_id) &&
        validText(e.account_id) &&
        validText(e.reference) &&
        timestamp(e.created_at) &&
        Number.isSafeInteger(e.residency_version) &&
        e.residency_version > 0,
    );
    assert(canonical(JSON.parse(e.payload)) === e.payload);
    return e;
  }
  private receipt(
    command: DispositionCommand,
    effect: Effect,
    input: unknown,
    result: unknown,
    actorId?: string,
  ) {
    const rows = this.receipts.forResultInTransaction(
      effect.org_id,
      command,
      effect.id,
    );
    assert(rows.length === 1);
    const r = rows[0]!;
    assert(
      r.orgId === effect.org_id &&
        r.command === command &&
        validText(r.actorId) &&
        (!actorId || r.actorId === actorId) &&
        validText(r.key, 128) &&
        sha(r.requestHash) &&
        r.requestHash === hash(input) &&
        exact(r.result, result) &&
        timestamp(r.createdAt) &&
        r.createdAt >= effect.created_at,
    );
    return r;
  }
  private unsent(e: Effect, error: string) {
    assert(
      e.state === "blocked" &&
        e.error === error &&
        e.started_at === null &&
        e.external_ref === null &&
        e.result === null,
    );
    const lease = this.store.get<{
      effect_id: string;
      org_id: string;
      token: string | null;
      started_at: number | null;
    }>("SELECT * FROM integration_operation_leases WHERE effect_id=?", e.id);
    assert(
      !lease ||
        (lease.org_id === e.org_id &&
          lease.token === null &&
          lease.started_at === null),
    );
    // Any retained provider observation/callback/poll is contradictory for an unsent effect.
    for (const table of [
      "integration_callbacks",
      "integration_refund_callbacks",
      "integration_checkout_observations",
      "integration_balance_reads",
      "integration_balance_observations",
      "integration_refund_polls",
      "integration_payment_allocations",
      "integration_accounting_refunds",
    ])
      assert(
        !this.store.get(
          `SELECT 1 FROM ${table} WHERE effect_id=? LIMIT 1`,
          e.id,
        ),
      );
    return lease ? { token: lease.token, started_at: lease.started_at } : null;
  }
  private cancellation(actor: Actor, e: Effect) {
    const lease = this.unsent(
      e,
      "Unsent credit application canceled by finance.",
    );
    assert(
      !this.store.get(
        "SELECT 1 FROM integration_checkout_renewals WHERE predecessor_id=? OR successor_id=?",
        e.id,
        e.id,
      ),
    );
    const reservation = this.store.get<{
      effect_id: string;
      org_id: string;
      invoice_id: string;
      credit_id: string;
      amount: number;
    }>("SELECT * FROM integration_credit_applications WHERE effect_id=?", e.id);
    const c = this.store.get<{
      effect_id: string;
      org_id: string;
      actor_id: string;
      reason: string;
      review_version: string;
      amount: number;
      created_at: string;
    }>(
      "SELECT * FROM integration_credit_cancellations WHERE effect_id=?",
      e.id,
    );
    assert(
      reservation &&
        c &&
        reservation.org_id === e.org_id &&
        c.org_id === e.org_id &&
        validText(c.actor_id) &&
        validText(c.reason, 1000) &&
        sha(c.review_version) &&
        timestamp(c.created_at) &&
        c.created_at >= e.created_at &&
        Number.isSafeInteger(c.amount) &&
        c.amount > 0 &&
        c.amount === reservation.amount,
    );
    const source = this.creditSource(actor, reservation.credit_id);
    const { invoice, native, credit, original } = source;
    assert(
      invoice.id === reservation.invoice_id &&
        invoice.org_id === e.org_id &&
        invoice.account_id === e.account_id &&
        invoice.currency ===
          this.identity.configurationOrganization(e.org_id).currency &&
        c.amount <= native.total,
    );
    // Validate all original invoice mappings/lines, not just a selected reference.
    const parent = this.effect(original.invoiceEffectId),
      p = JSON.parse(parent.payload);
    const nativeLines = this.billing.lines(actor, invoice.id).map((l) => ({
      productId: l.product_id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      unitTax: l.unit_tax,
    }));
    assert(
      parent.org_id === e.org_id &&
        credit.org_id === e.org_id &&
        parent.error === null &&
        credit.error === null &&
        validText(parent.external_ref) &&
        validText(original.customerRef) &&
        validText(original.taxCodeRef) &&
        validText(original.taxRateRef) &&
        exact(p.invoice, invoice) &&
        exact(
          p.lines.map(({ itemRef: _m, ...l }: Record<string, unknown>) => l),
          nativeLines,
        ) &&
        p.lines.every((l: Record<string, unknown>) => validText(l.itemRef)) &&
        exact(p, {
          invoice,
          lines: p.lines,
          customerRef: original.customerRef,
          taxCodeRef: original.taxCodeRef,
          taxRateRef: original.taxRateRef,
        }),
    );
    const expectedCredit = {
      credit: (({ lines: _l, ...v }) => v)(native),
      invoice: {
        id: invoice.id,
        number: invoice.number,
        total: invoice.total,
        currency: invoice.currency,
      },
      invoiceEffectId: parent.id,
      externalInvoiceRef: parent.external_ref,
      customerRef: p.customerRef,
      taxCodeRef: p.taxCodeRef,
      taxRateRef: p.taxRateRef,
      lines: native.lines.map((l) => {
        const matches = p.lines.filter(
          (m: Record<string, unknown>) =>
            m.productId === l.productId &&
            m.unitPrice === l.unitPrice &&
            m.unitTax === l.unitTax &&
            Number(m.quantity) >= l.quantity,
        );
        assert(
          matches.length > 0 &&
            matches.every(
              (m: Record<string, unknown>) => m.itemRef === matches[0].itemRef,
            ),
        );
        return { ...l, itemRef: matches[0].itemRef };
      }),
    };
    assert(exact(original, expectedCredit));
    const expected = {
      credit: original,
      creditEffectId: credit.id,
      externalCreditRef: credit.external_ref!.slice(7),
      amount: c.amount,
      applicationRef: `DC-${digest(e.reference).slice(0, 18)}`,
      applicationDate: e.created_at.slice(0, 10),
    };
    assert(exact(JSON.parse(e.payload), expected));
    const initial = { ...e, state: "pending", error: null };
    assert(
      c.review_version ===
        hash({ effect: initial, reservation, lease, cancellation: null }),
    );
    const created = this.receipt(
      "quickbooks.credit.apply",
      e,
      { creditId: native.id, amount: c.amount },
      { id: e.id, state: "pending" },
    );
    assert(created.createdAt <= c.created_at);
    const canceled = this.receipt(
      "quickbooks.credit.cancel",
      e,
      {
        effectId: e.id,
        reviewVersion: c.review_version,
        amount: c.amount,
        reason: c.reason,
      },
      {
        id: e.id,
        state: "canceled",
        amount: c.amount,
        reason: c.reason,
        createdAt: c.created_at,
      },
      c.actor_id,
    );
    assert(canceled.createdAt >= c.created_at);
    const capacity = this.creditCapacity(actor, native.id);
    return {
      invoiceId: invoice.id,
      successorId: null,
      facts: {
        effect: e,
        reservation,
        cancellation: c,
        lease,
        originalInvoice: { effect: parent, invoice, lines: nativeLines },
        credit: source,
        commands: [created, canceled],
        reservationDisposition: "excluded-by-exact-cancellation",
        capacity,
      },
    };
  }
  private supersession(actor: Actor, e: Effect) {
    const lease = this.unsent(
      e,
      "Replaced by a reviewed checkout before sending.",
    );
    assert(
      !this.store.get(
        "SELECT 1 FROM integration_credit_applications WHERE effect_id=?",
        e.id,
      ),
    );
    const invoice = this.checkouts.assertIdentity(actor, e);
    assert(
      invoice.org_id === e.org_id &&
        invoice.currency ===
          this.identity.configurationOrganization(e.org_id).currency,
    );
    // Walk the complete immutable replacement chain in both directions; reject
    // missing/cyclic/cross-bound links. A leaf's outcome is deliberately NOT settled here.
    const seen = new Set<string>(),
      chain: unknown[] = [];
    let root = e;
    while (true) {
      assert(!seen.has(root.id));
      seen.add(root.id);
      const incoming = this.store.get<Renewal>(
        "SELECT * FROM integration_checkout_renewals WHERE successor_id=?",
        root.id,
      );
      if (!incoming) break;
      assert(
        incoming.org_id === e.org_id && incoming.invoice_id === invoice.id,
      );
      root = this.effect(incoming.predecessor_id);
    }
    assert(root.reference === invoice.id);
    seen.clear();
    let current = root,
      successorId: string | null = null;
    while (true) {
      assert(!seen.has(current.id));
      seen.add(current.id);
      const p = JSON.parse(current.payload);
      assert(
        current.org_id === e.org_id &&
          current.account_id === e.account_id &&
          current.provider === "stripe" &&
          current.kind === "checkout" &&
          Number.isSafeInteger(p.amount) &&
          p.amount > 0 &&
          p.amount <= invoice.total &&
          exact(p, {
            invoiceId: invoice.id,
            amount: p.amount,
            currency: invoice.currency.toLowerCase(),
            number: invoice.number,
          }),
      );
      this.checkouts.assertIdentity(actor, current);
      const outgoing = this.store.all<Renewal>(
        "SELECT * FROM integration_checkout_renewals WHERE predecessor_id=?",
        current.id,
      );
      assert(outgoing.length <= 1);
      if (!outgoing.length) {
        chain.push({ effect: current, leafDisposition: "not-projected" });
        break;
      }
      const r = outgoing[0]!,
        next = this.effect(r.successor_id);
      assert(
        r.org_id === e.org_id &&
          r.invoice_id === invoice.id &&
          validText(r.reason, 1000) &&
          sha(r.review_version) &&
          timestamp(r.created_at) &&
          r.created_at >= current.created_at &&
          r.created_at >= next.created_at &&
          next.reference === `renewal:${current.id}`,
      );
      let original = current;
      if (current.state === "blocked") {
        this.unsent(current, "Replaced by a reviewed checkout before sending.");
        original = { ...current, state: "pending", error: null };
      } else {
        const proof = JSON.parse(current.result ?? "null");
        assert(
          current.state === "completed" &&
            current.error === null &&
            /^cs_test_[a-zA-Z0-9_]+$/.test(current.external_ref ?? "") &&
            proof &&
            proof.amount === p.amount &&
            proof.currency === p.currency &&
            proof.status === "expired" &&
            proof.paymentStatus === "unpaid" &&
            Number.isSafeInteger(proof.expiresAt) &&
            proof.expiresAt > 0,
        );
      }
      assert(
        r.review_version ===
          hash({
            id: original.id,
            state: original.state,
            reference: original.external_ref,
            result: original.result,
            error: original.error,
            successor: null,
          }),
      );
      const amount = JSON.parse(next.payload).amount;
      const receipt = this.receipt(
        "stripe.checkout.renew",
        next,
        {
          effectId: current.id,
          reviewVersion: r.review_version,
          amount,
          reason: r.reason,
        },
        {
          id: next.id,
          state: "pending",
          predecessorId: current.id,
          invoiceId: invoice.id,
          amount,
        },
      );
      assert(receipt.createdAt >= r.created_at);
      if (current.id === e.id) successorId = next.id;
      chain.push({ effect: current, renewal: r, receipt });
      current = next;
    }
    assert(successorId && seen.has(e.id));
    return {
      invoiceId: invoice.id,
      successorId,
      facts: { invoice, lease, chain },
    };
  }
}
