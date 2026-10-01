import {
  account,
  canonical,
  check,
  digest,
  id,
  integer,
  now,
  permit,
  text,
  type Actor,
} from "./core.ts";
import { Database, type Store } from "./database.ts";
import { Platform } from "./platform.ts";
import { Identity } from "./iam.ts";
import {
  IntegrationAccountingBalances,
  type AccountingBalance,
} from "./integration-accounting-balances.ts";
import { IntegrationOperations } from "./integration-operations.ts";
import { IntegrationRefundCallbacks } from "./integration-refund-callbacks.ts";
import { IntegrationRefunds } from "./integration-refunds.ts";
import {
  Billing,
  type RecordedPayment,
  type RecordedCredit,
} from "./billing.ts";
export type Effect = {
  id: string;
  org_id: string;
  account_id: string;
  provider: "stripe" | "quickbooks" | "carrier";
  kind: string;
  reference: string;
  payload: string;
  state: string;
  external_ref: string | null;
  result: string | null;
  created_at: string;
  residency_version: number;
  started_at: number | null;
  error: string | null;
};
export type EffectResult = {
  reference: string;
  result: Record<string, unknown>;
};
export type Adapter = {
  execute(effect: Effect): Promise<EffectResult>;
  lookup(effect: Effect): Promise<EffectResult | null>;
  readInvoiceBalance?(effect: Effect): Promise<AccountingBalance>;
};
export type AccountingPaymentIntent = {
  payment: RecordedPayment;
  invoice: { id: string; number: string; total: number; currency: string };
  invoiceEffectId: string;
  externalInvoiceRef: string;
  customerRef: string;
  depositAccountRef: string;
  appliedAmount: number;
  paymentRef: string;
};
export type AccountingCreditIntent = {
  credit: Omit<RecordedCredit, "lines">;
  invoice: { id: string; number: string; total: number; currency: string };
  invoiceEffectId: string;
  externalInvoiceRef: string;
  customerRef: string;
  taxCodeRef: string;
  taxRateRef: string;
  lines: (RecordedCredit["lines"][number] & { itemRef: string })[];
};
export type AccountingCreditApplicationIntent = {
  credit: AccountingCreditIntent;
  creditEffectId: string;
  externalCreditRef: string;
  amount: number;
  applicationRef: string;
  applicationDate: string;
};
export type Callback = {
  id: string;
  org_id: string;
  binding_id: string;
  event_id: string;
  session_id: string;
  effect_id: string;
  hash: string;
  state: string;
  attempts: number;
  started_at: number | null;
  retry_at: number;
  error: string | null;
  created_at: string;
};
export class Integration {
  private store: Store;
  readonly balances: IntegrationAccountingBalances;
  readonly refunds: IntegrationRefunds;
  readonly refundCallbacks: IntegrationRefundCallbacks;
  private readonly operations: IntegrationOperations;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
    private billing: Billing,
  ) {
    this.store = database.owned("integration");
    this.store.migrate(`
    CREATE TABLE IF NOT EXISTS integration_effects(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,account_id TEXT NOT NULL,provider TEXT NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','running','unknown','completed','rejected','blocked')),external_ref TEXT,result TEXT,created_at TEXT NOT NULL,residency_version INTEGER NOT NULL,started_at INTEGER,error TEXT,UNIQUE(org_id,provider,kind,reference)) STRICT;
    CREATE TABLE IF NOT EXISTS integration_inbox(provider TEXT NOT NULL,event_id TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(provider,event_id)) STRICT;
    CREATE TABLE IF NOT EXISTS integration_callbacks(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,binding_id TEXT NOT NULL,event_id TEXT NOT NULL,session_id TEXT NOT NULL,effect_id TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('pending','processing','waiting','blocked','failed','completed')),attempts INTEGER NOT NULL DEFAULT 0,started_at INTEGER,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL,UNIQUE(org_id,binding_id,event_id)) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS integration_external_identity ON integration_effects(org_id,provider,external_ref) WHERE external_ref IS NOT NULL;
    CREATE TABLE IF NOT EXISTS integration_payment_allocations(effect_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,payment_id TEXT NOT NULL,applied_amount INTEGER NOT NULL CHECK(applied_amount>=0),UNIQUE(org_id,payment_id)) STRICT;
    CREATE INDEX IF NOT EXISTS integration_payment_invoice ON integration_payment_allocations(org_id,invoice_id);
    CREATE TABLE IF NOT EXISTS integration_credit_applications(effect_id TEXT PRIMARY KEY,org_id TEXT NOT NULL,invoice_id TEXT NOT NULL,credit_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0)) STRICT;
    CREATE INDEX IF NOT EXISTS integration_credit_application_invoice ON integration_credit_applications(org_id,invoice_id);
    CREATE INDEX IF NOT EXISTS integration_credit_application_credit ON integration_credit_applications(org_id,credit_id);
  `);
    this.operations = new IntegrationOperations(
      database,
      this.store,
      platform,
      identity,
      this,
    );
    this.balances = new IntegrationAccountingBalances(
      database,
      this.store,
      platform,
      identity,
      billing,
      this,
    );
    this.refunds = new IntegrationRefunds(
      database,
      this.store,
      platform,
      identity,
      billing,
      this,
    );
    this.refundCallbacks = new IntegrationRefundCallbacks(
      database,
      this.store,
      platform,
      identity,
      this,
    );
  }
  effect(actor: Actor, effectId: string): Effect {
    const row = this.store.get<Effect>(
      "SELECT * FROM integration_effects WHERE org_id=? AND id=?",
      actor.orgId,
      effectId,
    );
    check(row, "NOT_FOUND", "Provider operation not found.", 404);
    account(actor, row.account_id);
    return row;
  }
  list(actor: Actor) {
    permit(actor, ["finance", "support", "commercial", "buyer"]);
    return this.store
      .all<Effect>(
        "SELECT * FROM integration_effects WHERE org_id=? ORDER BY created_at DESC",
        actor.orgId,
      )
      .filter(
        (e) =>
          (actor.role !== "buyer" || e.account_id === actor.accountId) &&
          (!["refund", "payment", "credit", "credit-application"].includes(
            e.kind,
          ) ||
            ["admin", "finance", "support"].includes(actor.role)),
      )
      .map((e) => ({
        ...e,
        payload: undefined,
        result:
          e.result && !this.platform.recoveryHold()
            ? JSON.parse(e.result)
            : null,
        accountingBalance:
          ["admin", "finance"].includes(actor.role) &&
          e.provider === "quickbooks" &&
          e.kind === "invoice" &&
          e.state === "completed"
            ? this.balances.latest(actor, e.id)
            : undefined,
        creditApplication:
          e.provider === "quickbooks" &&
          e.kind === "credit" &&
          ["admin", "finance", "support"].includes(actor.role)
            ? this.creditApplicationCapacity(actor, e.reference)
            : undefined,
        recoveryHold: !!this.platform.recoveryHold(),
      }));
  }
  pending(actor: Actor, limit = 20) {
    permit(actor, ["finance", "support"]);
    return this.store.all<Effect>(
      "SELECT * FROM integration_effects WHERE org_id=? AND state='pending' ORDER BY created_at,id LIMIT ?",
      actor.orgId,
      integer(limit, "worker batch size", 1, 100),
    );
  }
  // Only the signature-verifying runtime calls this. Retain identifiers/hash, not raw customer data.
  receiveCallback(
    actor: Actor,
    input: {
      bindingId: string;
      eventId: string;
      sessionId: string;
      effectId: string;
      hash: string;
    },
  ) {
    permit(actor, ["finance"]);
    this.identity.organization(actor);
    return this.database.transaction(() => {
      check(
        !this.store.get(
          "SELECT id FROM integration_refund_callbacks WHERE org_id=? AND binding_id=? AND event_id=?",
          actor.orgId,
          input.bindingId,
          input.eventId,
        ),
        "EVENT_CONFLICT",
        "Signed event identity changed.",
      );
      const old = this.store.get<Callback>(
        "SELECT * FROM integration_callbacks WHERE org_id=? AND binding_id=? AND event_id=?",
        actor.orgId,
        input.bindingId,
        input.eventId,
      );
      if (old) {
        check(
          old.hash === input.hash,
          "EVENT_CONFLICT",
          "Signed event identity changed.",
        );
        return { id: old.id, duplicate: true };
      }
      const callbackId = id();
      this.store.run(
        "INSERT INTO integration_callbacks(id,org_id,binding_id,event_id,session_id,effect_id,hash,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        callbackId,
        actor.orgId,
        input.bindingId,
        input.eventId,
        input.sessionId,
        input.effectId,
        input.hash,
        "pending",
        now(),
      );
      this.platform.audit(actor, "integration.callback.received", callbackId, {
        binding: input.bindingId,
        eventId: input.eventId,
      });
      return { id: callbackId, duplicate: false };
    });
  }
  callbacks(actor: Actor) {
    permit(actor, ["finance", "support"]);
    actor = this.identity.currentActor(actor);
    permit(actor, ["finance", "support"]);
    const checkout = this.store
      .all<Callback>(
        "SELECT * FROM integration_callbacks WHERE org_id=? ORDER BY created_at DESC,id LIMIT 200",
        actor.orgId,
      )
      .map(({ hash: _hash, ...c }) => ({ ...c, kind: "checkout" as const }));
    const refunds = this.refundCallbacks
      .list(actor)
      .map(({ hash: _hash, ...c }) => c);
    return [...checkout, ...refunds]
      .sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
      )
      .slice(0, 200);
  }
  dueCallbacks(actor: Actor, bindingId: string, limit = 20) {
    permit(actor, ["finance"]);
    return this.store.all<Callback>(
      "SELECT * FROM integration_callbacks WHERE org_id=? AND binding_id=? AND state IN('pending','waiting') AND retry_at<=? ORDER BY created_at,id LIMIT ?",
      actor.orgId,
      bindingId,
      Date.now(),
      integer(limit, "worker batch size", 1, 100),
    );
  }
  claimCallback(actor: Actor, callbackId: string) {
    permit(actor, ["finance"]);
    this.platform.assertProviderAccess();
    return this.database.transaction(() => {
      const row = this.store.get<Callback>(
        "SELECT * FROM integration_callbacks WHERE org_id=? AND id=?",
        actor.orgId,
        callbackId,
      );
      check(
        row &&
          ["pending", "waiting"].includes(row.state) &&
          row.retry_at <= Date.now(),
        "STATE",
        "Callback is not ready for processing.",
      );
      this.store.run(
        "UPDATE integration_callbacks SET state='processing',started_at=?,attempts=attempts+1,error=NULL WHERE id=?",
        Date.now(),
        callbackId,
      );
      return { ...row, attempts: row.attempts + 1 };
    });
  }
  finishCallback(
    actor: Actor,
    callbackId: string,
    attempt: number,
    state: "completed" | "waiting" | "blocked" | "failed",
    error: string | null = null,
  ) {
    return this.database.transaction(() => {
      const updated = this.store.run(
        "UPDATE integration_callbacks SET state=?,error=?,retry_at=? WHERE org_id=? AND id=? AND state='processing' AND attempts=?",
        state,
        error,
        state === "waiting" ? Date.now() + 30000 : 0,
        actor.orgId,
        callbackId,
        attempt,
      );
      if (Number(updated.changes))
        this.platform.audit(
          actor,
          `integration.callback.${state}`,
          callbackId,
          {},
        );
    });
  }
  retryCallback(actor: Actor, callbackId: string) {
    if (this.refundCallbacks.has(actor, callbackId))
      return this.refundCallbacks.retry(actor, callbackId);
    permit(actor, ["finance"]);
    return this.database.transaction(() => {
      const row = this.store.get<Callback>(
        "SELECT * FROM integration_callbacks WHERE org_id=? AND id=?",
        actor.orgId,
        callbackId,
      );
      check(row, "NOT_FOUND", "Callback not found.", 404);
      check(
        ["blocked", "waiting", "failed"].includes(row.state),
        "STATE",
        "Callback cannot be retried in its current state.",
      );
      this.store.run(
        "UPDATE integration_callbacks SET state='pending',retry_at=0,error=NULL WHERE id=?",
        callbackId,
      );
      this.platform.audit(actor, "integration.callback.retry", callbackId, {});
      return { id: callbackId, state: "pending" };
    });
  }
  private queue(
    actor: Actor,
    accountId: string,
    provider: Effect["provider"],
    kind: string,
    reference: string,
    payload: unknown,
  ) {
    this.platform.assertProviderAccess();
    const version = this.identity.providerAllowed(actor, accountId, provider),
      serialized = canonical(payload),
      old = this.store.get<Effect>(
        "SELECT * FROM integration_effects WHERE org_id=? AND provider=? AND kind=? AND reference=?",
        actor.orgId,
        provider,
        kind,
        reference,
      );
    if (old) {
      check(
        old.payload === serialized,
        "EFFECT_CONFLICT",
        "This provider operation already exists with different details.",
      );
      return { id: old.id, state: old.state };
    }
    const effectId = id();
    this.store.run(
      "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,created_at,residency_version) VALUES(?,?,?,?,?,?,?,?,?,?)",
      effectId,
      actor.orgId,
      accountId,
      provider,
      kind,
      reference,
      serialized,
      "pending",
      now(),
      version,
    );
    this.platform.event(actor, "integration.intent", effectId, {
      provider,
      kind,
      reference,
    });
    return { id: effectId, state: "pending" };
  }
  checkout(actor: Actor, key: string, input: { invoiceId: string }) {
    return this.platform.command(
      actor,
      "stripe.checkout",
      key,
      input,
      () => {
        actor = this.identity.currentActor(actor);
        check(
          !this.identity.security(actor).passwordChangeRequired,
          "PASSWORD_CHANGE_REQUIRED",
          "Change your password before requesting provider work.",
          403,
        );
        permit(actor, ["finance", "buyer"]);
        const invoice = this.billing.invoice(actor, input.invoiceId);
        this.platform.assertProviderAccess();
        this.identity.providerAllowed(actor, invoice.account_id, "stripe");
      },
      () => {
        const invoice = this.billing.invoice(actor, input.invoiceId),
          balance = this.billing.totals(actor, invoice.id).balance;
        check(balance > 0, "BALANCE", "Invoice has no open balance.");
        return this.queue(
          actor,
          invoice.account_id,
          "stripe",
          "checkout",
          invoice.id,
          {
            invoiceId: invoice.id,
            amount: balance,
            currency: invoice.currency.toLowerCase(),
            number: invoice.number,
          },
        );
      },
    );
  }
  refund(actor: Actor, key: string, input: { refundId: string }) {
    actor = this.identity.workerActor(actor.orgId, actor.id);
    return this.platform.command(
      actor,
      "stripe.refund",
      key,
      input,
      () => {
        permit(actor, ["finance"]);
        this.platform.assertProviderAccess();
        const { invoice } = this.billing.refunds.get(actor, input.refundId);
        this.identity.providerAllowed(actor, invoice.account_id, "stripe");
      },
      () => {
        const { row, invoice } = this.billing.refunds.get(
          actor,
          input.refundId,
        );
        check(
          row.state === "pending",
          "STATE",
          "Only pending refunds may be queued.",
        );
        const result = this.queue(
          actor,
          invoice.account_id,
          "stripe",
          "refund",
          input.refundId,
          this.billing.refunds.intent(actor, input.refundId),
        );
        this.refunds.register(actor, result.id);
        return result;
      },
    );
  }
  accounting(
    actor: Actor,
    key: string,
    input: {
      invoiceId: string;
      customerRef: string;
      itemRefs: Record<string, string>;
      taxCodeRef: string;
      taxRateRef: string;
    },
  ) {
    return this.platform.command(
      actor,
      "quickbooks.invoice",
      key,
      input,
      () => {
        actor = this.operations.principal(actor);
        permit(actor, ["finance"]);
        const invoice = this.billing.invoice(actor, input.invoiceId);
        this.platform.assertProviderAccess();
        this.identity.providerAllowed(actor, invoice.account_id, "quickbooks");
      },
      () => {
        const invoice = this.billing.invoice(actor, input.invoiceId);
        check(
          invoice.origin !== "opening",
          "OPENING_ACCOUNTING",
          "Imported invoices already belong to the source ledger; reconcile their accounting identity rather than post a new invoice.",
        );
        const lines = this.billing.lines(actor, invoice.id).map((l) => ({
          productId: l.product_id,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unit_price,
          unitTax: l.unit_tax,
          itemRef: text(
            input.itemRefs[String(l.product_id)],
            "QuickBooks item mapping",
          ),
        }));
        text(input.customerRef, "QuickBooks customer mapping");
        text(input.taxCodeRef, "QuickBooks tax code mapping");
        text(input.taxRateRef, "QuickBooks tax rate mapping");
        return this.queue(
          actor,
          invoice.account_id,
          "quickbooks",
          "invoice",
          invoice.id,
          {
            invoice,
            lines,
            customerRef: input.customerRef,
            taxCodeRef: input.taxCodeRef,
            taxRateRef: input.taxRateRef,
          },
        );
      },
    );
  }
  accountingCredit(actor: Actor, key: string, input: { creditId: string }) {
    return this.platform.command(
      actor,
      "quickbooks.credit",
      key,
      input,
      () => {
        actor = this.operations.principal(actor);
        permit(actor, ["finance"]);
        const credit = this.billing.recordedCredit(actor, input.creditId),
          invoice = this.billing.invoice(actor, credit.invoice_id);
        this.platform.assertProviderAccess();
        this.identity.providerAllowed(actor, invoice.account_id, "quickbooks");
      },
      () => {
        const { lines, ...credit } = this.billing.recordedCredit(
            actor,
            input.creditId,
          ),
          invoice = this.billing.invoice(actor, credit.invoice_id),
          parent = this.store.get<Effect>(
            "SELECT * FROM integration_effects WHERE org_id=? AND provider='quickbooks' AND kind='invoice' AND reference=? AND state='completed'",
            actor.orgId,
            invoice.id,
          );
        check(
          parent?.external_ref,
          "ACCOUNTING_INVOICE_REQUIRED",
          "Reconcile the QuickBooks invoice before queuing its credit.",
        );
        const original = JSON.parse(parent.payload) as {
          customerRef: string;
          taxCodeRef: string;
          taxRateRef: string;
          lines: (RecordedCredit["lines"][number] & { itemRef: string })[];
        };
        const payload: AccountingCreditIntent = {
          credit,
          invoice: {
            id: invoice.id,
            number: invoice.number,
            total: invoice.total,
            currency: invoice.currency,
          },
          invoiceEffectId: parent.id,
          externalInvoiceRef: parent.external_ref,
          customerRef: text(
            original.customerRef,
            "QuickBooks customer mapping",
          ),
          taxCodeRef: text(original.taxCodeRef, "QuickBooks tax code mapping"),
          taxRateRef: text(original.taxRateRef, "QuickBooks tax rate mapping"),
          lines: lines.map((l) => {
            const mapped = original.lines.find(
              (m) =>
                m.productId === l.productId &&
                m.unitPrice === l.unitPrice &&
                m.unitTax === l.unitTax &&
                m.quantity >= l.quantity,
            );
            check(
              mapped,
              "ACCOUNTING_CREDIT_MISMATCH",
              "Credit lines differ from the posted invoice mappings.",
            );
            return {
              ...l,
              itemRef: text(mapped.itemRef, "QuickBooks item mapping"),
            };
          }),
        };
        return this.queue(
          actor,
          invoice.account_id,
          "quickbooks",
          "credit",
          credit.id,
          payload,
        );
      },
    );
  }
  accountingPayment(
    actor: Actor,
    key: string,
    input: {
      paymentId: string;
      appliedAmount: number;
      depositAccountRef: string;
    },
  ) {
    return this.platform.command(
      actor,
      "quickbooks.payment",
      key,
      input,
      () => {
        actor = this.operations.principal(actor);
        permit(actor, ["finance"]);
        const payment = this.billing.recordedPayment(actor, input.paymentId),
          invoice = this.billing.invoice(actor, payment.invoice_id);
        this.platform.assertProviderAccess();
        this.identity.providerAllowed(actor, invoice.account_id, "quickbooks");
      },
      () => {
        const payment = this.billing.recordedPayment(actor, input.paymentId),
          invoice = this.billing.invoice(actor, payment.invoice_id),
          parent = this.store.get<Effect>(
            "SELECT * FROM integration_effects WHERE org_id=? AND provider='quickbooks' AND kind='invoice' AND reference=? AND state='completed'",
            actor.orgId,
            invoice.id,
          );
        check(
          parent?.external_ref,
          "ACCOUNTING_INVOICE_REQUIRED",
          "Reconcile the QuickBooks invoice before queuing its payment.",
        );
        const original = JSON.parse(parent.payload) as { customerRef: string };
        const payload: AccountingPaymentIntent = {
          payment,
          invoice: {
            id: invoice.id,
            number: invoice.number,
            total: invoice.total,
            currency: invoice.currency,
          },
          invoiceEffectId: parent.id,
          externalInvoiceRef: parent.external_ref,
          customerRef: original.customerRef,
          depositAccountRef: text(
            input.depositAccountRef,
            "QuickBooks deposit account",
          ),
          appliedAmount: integer(
            input.appliedAmount,
            "Applied amount",
            0,
            payment.amount,
          ),
          paymentRef: `DP-${digest(payment.id).slice(0, 18)}`,
        };
        const old = this.store.get<Effect>(
          "SELECT * FROM integration_effects WHERE org_id=? AND provider='quickbooks' AND kind='payment' AND reference=?",
          actor.orgId,
          payment.id,
        );
        if (old)
          return this.queue(
            actor,
            invoice.account_id,
            "quickbooks",
            "payment",
            payment.id,
            payload,
          );
        const allocated = this.accountingAllocated(actor, invoice.id);
        check(
          allocated + payload.appliedAmount <= invoice.total,
          "ACCOUNTING_ALLOCATION",
          "Queued and delivered cash/credit applications exceed the original invoice. Leave excess unapplied and reconcile refunds separately.",
        );
        const effect = this.queue(
          actor,
          invoice.account_id,
          "quickbooks",
          "payment",
          payment.id,
          payload,
        );
        this.store.run(
          "INSERT INTO integration_payment_allocations VALUES(?,?,?,?,?)",
          effect.id,
          actor.orgId,
          invoice.id,
          payment.id,
          payload.appliedAmount,
        );
        return effect;
      },
    );
  }
  private accountingAllocated(actor: Actor, invoiceId: string) {
    return this.store.get<{ amount: number }>(
      "SELECT (SELECT COALESCE(SUM(applied_amount),0) FROM integration_payment_allocations WHERE org_id=? AND invoice_id=?) + (SELECT COALESCE(SUM(amount),0) FROM integration_credit_applications WHERE org_id=? AND invoice_id=?) AS amount",
      actor.orgId,
      invoiceId,
      actor.orgId,
      invoiceId,
    )!.amount;
  }
  private creditApplicationCapacity(actor: Actor, creditId: string) {
    const credit = this.billing.recordedCredit(actor, creditId),
      invoice = this.billing.invoice(actor, credit.invoice_id),
      reservedAmount = this.store.get<{ amount: number }>(
        "SELECT COALESCE(SUM(amount),0) AS amount FROM integration_credit_applications WHERE org_id=? AND credit_id=?",
        actor.orgId,
        creditId,
      )!.amount;
    return {
      reservedAmount,
      availableCredit: Math.max(0, credit.total - reservedAmount),
      availableInvoice: Math.max(
        0,
        invoice.total - this.accountingAllocated(actor, invoice.id),
      ),
    };
  }
  accountingCreditApplication(
    actor: Actor,
    key: string,
    input: { creditId: string; amount: number },
  ) {
    return this.platform.command(
      actor,
      "quickbooks.credit.apply",
      key,
      input,
      () => {
        actor = this.operations.principal(actor);
        permit(actor, ["finance"]);
        const credit = this.billing.recordedCredit(actor, input.creditId),
          invoice = this.billing.invoice(actor, credit.invoice_id);
        this.platform.assertProviderAccess();
        this.identity.providerAllowed(actor, invoice.account_id, "quickbooks");
      },
      () => {
        const native = this.billing.recordedCredit(actor, input.creditId),
          invoice = this.billing.invoice(actor, native.invoice_id),
          credit = this.store.get<Effect>(
            "SELECT * FROM integration_effects WHERE org_id=? AND provider='quickbooks' AND kind='credit' AND reference=? AND state='completed'",
            actor.orgId,
            input.creditId,
          );
        check(
          credit &&
            credit.external_ref &&
            credit.external_ref.startsWith("credit:"),
          "ACCOUNTING_CREDIT_REQUIRED",
          "Reconcile the QuickBooks credit before applying it.",
        );
        const original = JSON.parse(credit.payload) as AccountingCreditIntent,
          parent = this.effect(actor, original.invoiceEffectId),
          { lines: nativeLines, ...nativeCredit } = native;
        check(
          parent.provider === "quickbooks" &&
            parent.kind === "invoice" &&
            parent.state === "completed" &&
            parent.reference === invoice.id &&
            parent.account_id === invoice.account_id &&
            parent.external_ref === original.externalInvoiceRef &&
            credit.account_id === invoice.account_id &&
            original.invoice.id === invoice.id &&
            original.invoice.number === invoice.number &&
            original.invoice.total === invoice.total &&
            original.invoice.currency === invoice.currency &&
            canonical(original.credit) === canonical(nativeCredit) &&
            canonical(
              original.lines.map(({ itemRef: _mapping, ...line }) => line),
            ) === canonical(nativeLines) &&
            original.customerRef === JSON.parse(parent.payload).customerRef,
          "ACCOUNTING_CREDIT_MISMATCH",
          "Credit or original invoice accounting identity changed; reconcile before application.",
        );
        const capacity = this.creditApplicationCapacity(actor, native.id),
          amount = integer(
            input.amount,
            "Credit application amount",
            1,
            native.total,
          );
        check(
          amount <= capacity.availableCredit &&
            amount <= capacity.availableInvoice,
          "ACCOUNTING_ALLOCATION",
          "Queued and delivered applications exhaust this credit or original invoice. Reconcile pending and unknown outcomes before requesting more.",
        );
        const applicationId = id(),
          payload: AccountingCreditApplicationIntent = {
            credit: original,
            creditEffectId: credit.id,
            externalCreditRef: text(
              credit.external_ref.slice(7),
              "QuickBooks credit identity",
            ),
            amount,
            applicationRef: `DC-${digest(applicationId).slice(0, 18)}`,
            applicationDate: now().slice(0, 10),
          },
          effect = this.queue(
            actor,
            invoice.account_id,
            "quickbooks",
            "credit-application",
            applicationId,
            payload,
          );
        this.store.run(
          "INSERT INTO integration_credit_applications VALUES(?,?,?,?,?)",
          effect.id,
          actor.orgId,
          invoice.id,
          native.id,
          amount,
        );
        return effect;
      },
    );
  }
  // Crash after a provider call must enter reconciliation, never automatic re-execution.
  recoverStale(milliseconds = 120000, orgId: string | null = null) {
    return this.database.transaction(
      () =>
        this.operations.recover(milliseconds, orgId) +
        this.balances.recover(milliseconds, orgId) +
        Number(
          this.store.run(
            "UPDATE integration_effects SET state='unknown',error='Worker interrupted; reconcile provider outcome before retry.' WHERE state='running' AND started_at<? AND (? IS NULL OR org_id=?)",
            Date.now() - milliseconds,
            orgId,
            orgId,
          ).changes,
        ),
    );
  }
  recoverCallbacks(milliseconds = 120000, orgId: string | null = null) {
    return this.database.transaction(
      () =>
        this.refundCallbacks.recover(milliseconds, orgId) +
        Number(
          this.store.run(
            "UPDATE integration_callbacks SET state='waiting',retry_at=0,error='Worker interrupted; safely verify settlement again.' WHERE state='processing' AND started_at<? AND (? IS NULL OR org_id=?)",
            Date.now() - milliseconds,
            orgId,
            orgId,
          ).changes,
        ),
    );
  }
  async execute(actor: Actor, effectId: string, adapter: Adapter) {
    if (this.effect(actor, effectId).kind === "refund")
      return this.refunds.run(actor, effectId, adapter, true);
    return this.operations.run(actor, effectId, adapter, true);
  }
  async reconcile(actor: Actor, effectId: string, adapter: Adapter) {
    if (this.effect(actor, effectId).kind === "refund")
      return this.refunds.run(actor, effectId, adapter, false);
    return this.operations.run(actor, effectId, adapter, false);
  }
  async stripeSettlement(
    actor: Actor,
    event: { id: string; sessionId: string; effectId?: string },
    verify: (sessionId: string) => Promise<{
      paid: boolean;
      amount: number;
      currency: string;
      paymentId: string;
    }>,
  ) {
    // Caller must verify the raw webhook signature before entering this method.
    actor = this.identity.workerActor(actor.orgId, actor.id);
    this.platform.assertProviderAccess();
    const effect = this.store.get<Effect>(
      "SELECT * FROM integration_effects WHERE org_id=? AND provider='stripe' AND kind='checkout' AND external_ref=? AND state='completed'",
      actor.orgId,
      event.sessionId,
    );
    check(
      effect,
      "NOT_FOUND",
      "Checkout operation not yet bound; retry webhook later.",
      409,
    );
    check(
      !event.effectId || effect.id === event.effectId,
      "PAYMENT_MISMATCH",
      "Checkout identity differs from signed event.",
    );
    this.identity.providerAllowed(actor, effect.account_id, "stripe");
    const payment = await verify(event.sessionId);
    actor = this.identity.workerActor(actor.orgId, actor.id);
    check(payment.paid, "PAYMENT_PENDING", "Stripe has not confirmed payment.");
    const payload = JSON.parse(effect.payload) as {
      invoiceId: string;
      amount: number;
      currency: string;
    };
    check(
      payment.amount === payload.amount &&
        payment.currency === payload.currency,
      "PAYMENT_MISMATCH",
      "Provider money/currency differs from checkout intent.",
    );
    return this.database.transaction(() => {
      actor = this.identity.workerActor(actor.orgId, actor.id);
      this.platform.assertProviderAccess();
      const hash = digest(canonical({ event, payment })),
        old = this.store.get(
          "SELECT hash FROM integration_inbox WHERE provider='stripe' AND event_id=?",
          event.id,
        );
      if (old) {
        check(
          old.hash === hash,
          "EVENT_CONFLICT",
          "Webhook event identity changed.",
        );
        return { duplicate: true };
      }
      this.billing.verifiedPayment(
        actor,
        payload.invoiceId,
        payment.amount,
        "stripe",
        text(payment.paymentId, "Stripe payment reference"),
      );
      this.store.run(
        "INSERT INTO integration_inbox VALUES(?,?,?,?)",
        "stripe",
        event.id,
        hash,
        now(),
      );
      return { duplicate: false };
    });
  }
  accountingCsv(actor: Actor) {
    permit(actor, ["finance"]);
    const invoices = this.billing.invoices(actor),
      rows = [
        [
          "invoice",
          "account",
          "currency",
          "net_cents",
          "tax_cents",
          "total_cents",
          "credited_cents",
          "paid_cents",
          "balance_cents",
          "refunded_cents",
          "origin",
          "source_ref",
          "source_id",
          "cutoff_at",
        ],
        ...invoices.map((i) => [
          i.number,
          i.account_id,
          i.currency,
          i.net,
          i.tax,
          i.total,
          i.credited,
          i.paid,
          i.balance,
          i.refunded,
          i.origin,
          i.opening?.source_ref ?? "",
          i.opening?.source_id ?? "",
          i.opening?.cutoff_at ?? "",
        ]),
      ];
    return rows
      .map((row) =>
        row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
  }
}
