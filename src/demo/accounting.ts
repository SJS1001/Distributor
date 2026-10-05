import { canonical, check, digest } from "../server/core.ts";
import type {
  Adapter,
  Effect,
  EffectResult,
  AccountingPaymentIntent,
  AccountingCreditIntent,
  AccountingCreditApplicationIntent,
  AccountingRefundIntent,
  AccountingRefundApplicationIntent,
} from "../server/integration.ts";
import type { AccountingBalance } from "../server/integration-accounting-balances.ts";

type InvoiceIntent = {
  invoice: { id: string; number: string; total: number; currency: string };
  customerRef: string;
};
type Entry = { hash: string; effect: Effect; result: EffectResult };
type Credit = { available: number; reserved: number };

/** An isolated fictional accounting ledger, never an Intuit transport. Native
 * integration commands remain responsible for permissions, consent and cash facts. */
export class DemoAccounting implements Adapter {
  private readonly entries = new Map<string, Entry>();
  private readonly invoices = new Map<string, AccountingBalance>();
  private readonly credits = new Map<string, Credit>();
  private readonly appliedExpenses = new Set<string>();

  private hash(effect: Effect) {
    return digest(
      canonical({
        org: effect.org_id,
        account: effect.account_id,
        provider: effect.provider,
        kind: effect.kind,
        reference: effect.reference,
        payload: effect.payload,
      }),
    );
  }
  private previous(effect: Effect) {
    check(
      effect.provider === "quickbooks",
      "PROVIDER_OPERATION",
      "This simulator only supports QuickBooks operations.",
    );
    const entry = this.entries.get(effect.id);
    check(
      !entry || entry.hash === this.hash(effect),
      "ACCOUNTING_MISMATCH",
      "Simulated accounting request changed after delivery.",
    );
    return entry;
  }
  private parent(effect: Effect, id: string, reference: string, kind: string) {
    const entry = this.entries.get(id);
    check(
      entry &&
        entry.effect.org_id === effect.org_id &&
        entry.effect.account_id === effect.account_id &&
        entry.effect.kind === kind &&
        entry.result.reference === reference,
      "ACCOUNTING_MISMATCH",
      "Accounting parent must belong to this simulated workspace and customer.",
    );
    return entry;
  }
  private invoice(
    effect: Effect,
    p: {
      invoiceEffectId: string;
      externalInvoiceRef: string;
      invoice: InvoiceIntent["invoice"];
      customerRef: string;
    },
  ) {
    const entry = this.parent(
      effect,
      p.invoiceEffectId,
      p.externalInvoiceRef,
      "invoice",
    );
    const original = JSON.parse(entry.effect.payload) as InvoiceIntent;
    check(
      original.invoice.id === p.invoice.id &&
        original.invoice.number === p.invoice.number &&
        original.invoice.total === p.invoice.total &&
        original.invoice.currency === p.invoice.currency &&
        original.customerRef === p.customerRef,
      "ACCOUNTING_MISMATCH",
      "Simulated invoice identity changed.",
    );
    return this.invoices.get(p.invoiceEffectId)!;
  }
  private credit(
    effect: Effect,
    id: string,
    reference: string,
    intent: AccountingCreditIntent,
  ) {
    const entry = this.parent(effect, id, `credit:${reference}`, "credit");
    check(
      canonical(JSON.parse(entry.effect.payload)) === canonical(intent),
      "ACCOUNTING_MISMATCH",
      "Simulated credit identity changed.",
    );
    return this.credits.get(id)!;
  }
  async execute(
    effect: Effect,
    beforeWrite: () => void = () => {},
  ): Promise<EffectResult> {
    const previous = this.previous(effect);
    if (previous) return structuredClone(previous.result);
    const providerId = `DEMO-${effect.id}`;
    let reference = providerId;
    let result: Record<string, unknown>;
    let commit = () => {};
    switch (effect.kind) {
      case "invoice": {
        const p = JSON.parse(effect.payload) as InvoiceIntent;
        result = {
          number: p.invoice.number,
          total: p.invoice.total,
          currency: p.invoice.currency,
          syncToken: "0",
        };
        commit = () =>
          this.invoices.set(effect.id, {
            reference,
            total: p.invoice.total,
            currency: p.invoice.currency,
            balance: p.invoice.total,
            syncToken: "0",
          });
        break;
      }
      case "payment": {
        const p = JSON.parse(effect.payload) as AccountingPaymentIntent;
        const invoice = this.invoice(effect, p);
        check(
          p.appliedAmount >= 0 &&
            p.appliedAmount <= p.payment.amount &&
            p.appliedAmount <= invoice.balance,
          "ACCOUNTING_MISMATCH",
          "Simulated payment exceeds the invoice balance.",
        );
        reference = `payment:${providerId}`;
        result = {
          providerId,
          paymentId: p.payment.id,
          invoiceId: p.invoice.id,
          amount: p.payment.amount,
          appliedAmount: p.appliedAmount,
          unappliedAmount: p.payment.amount - p.appliedAmount,
          currency: p.invoice.currency,
          customerRef: p.customerRef,
          depositAccountRef: p.depositAccountRef,
          paymentRef: p.paymentRef,
        };
        commit = () => {
          invoice.balance -= p.appliedAmount;
          invoice.syncToken = String(Number(invoice.syncToken) + 1);
        };
        break;
      }
      case "credit": {
        const p = JSON.parse(effect.payload) as AccountingCreditIntent;
        this.invoice(effect, p);
        reference = `credit:${providerId}`;
        result = {
          providerId,
          creditId: p.credit.id,
          invoiceId: p.invoice.id,
          number: p.credit.number,
          total: p.credit.total,
          unappliedAmount: p.credit.total,
          currency: p.invoice.currency,
        };
        commit = () =>
          this.credits.set(effect.id, {
            available: p.credit.total,
            reserved: 0,
          });
        break;
      }
      case "credit-application": {
        const p = JSON.parse(
          effect.payload,
        ) as AccountingCreditApplicationIntent;
        const invoice = this.invoice(effect, p.credit);
        const credit = this.credit(
          effect,
          p.creditEffectId,
          p.externalCreditRef,
          p.credit,
        );
        check(
          p.amount > 0 &&
            p.amount <= invoice.balance &&
            p.amount <= credit.available - credit.reserved,
          "ACCOUNTING_MISMATCH",
          "Simulated credit application exceeds available credit or invoice balance.",
        );
        reference = `payment:${providerId}`;
        result = {
          providerId,
          creditId: p.credit.credit.id,
          invoiceId: p.credit.invoice.id,
          amount: p.amount,
          currency: p.credit.invoice.currency,
          applicationRef: p.applicationRef,
          applicationDate: p.applicationDate,
        };
        commit = () => {
          credit.available -= p.amount;
          invoice.balance -= p.amount;
          invoice.syncToken = String(Number(invoice.syncToken) + 1);
        };
        break;
      }
      case "refund-expense": {
        const p = JSON.parse(effect.payload) as AccountingRefundIntent;
        this.invoice(effect, p.credit);
        const credit = this.credit(
          effect,
          p.creditEffectId,
          p.externalCreditRef,
          p.credit,
        );
        const payment = this.parent(
          effect,
          p.paymentEffectId,
          `payment:${p.externalPaymentRef}`,
          "payment",
        );
        check(
          canonical(JSON.parse(payment.effect.payload)) ===
            canonical(p.payment) &&
            p.amount > 0 &&
            p.amount <= credit.available - credit.reserved,
          "ACCOUNTING_MISMATCH",
          "Simulated refund exceeds available credit or has a different payment.",
        );
        reference = `expense:${providerId}`;
        result = {
          providerId,
          refundId: p.refundId,
          invoiceId: p.credit.invoice.id,
          creditId: p.credit.credit.id,
          amount: p.amount,
          currency: p.credit.invoice.currency,
          expenseRef: p.expenseRef,
          expenseDate: p.expenseDate,
        };
        commit = () => {
          credit.reserved += p.amount;
        };
        break;
      }
      case "refund-application": {
        const p = JSON.parse(
          effect.payload,
        ) as AccountingRefundApplicationIntent;
        const expense = this.parent(
          effect,
          p.expenseEffectId,
          `expense:${p.externalExpenseRef}`,
          "refund-expense",
        );
        check(
          canonical(JSON.parse(expense.effect.payload)) ===
            canonical(p.refund) && !this.appliedExpenses.has(p.expenseEffectId),
          "ACCOUNTING_MISMATCH",
          "Simulated refund expense changed or is already applied.",
        );
        const credit = this.credit(
          effect,
          p.refund.creditEffectId,
          p.refund.externalCreditRef,
          p.refund.credit,
        );
        check(
          p.refund.amount <= credit.reserved &&
            p.refund.amount <= credit.available,
          "ACCOUNTING_MISMATCH",
          "Simulated refund credit is unavailable.",
        );
        reference = `payment:${providerId}`;
        result = {
          providerId,
          refundId: p.refund.refundId,
          invoiceId: p.refund.credit.invoice.id,
          creditId: p.refund.credit.credit.id,
          amount: p.refund.amount,
          currency: p.refund.credit.invoice.currency,
          applicationRef: p.applicationRef,
          expenseRef: p.refund.expenseRef,
        };
        commit = () => {
          credit.available -= p.refund.amount;
          credit.reserved -= p.refund.amount;
          this.appliedExpenses.add(p.expenseEffectId);
        };
        break;
      }
      default:
        check(
          false,
          "PROVIDER_OPERATION",
          "Unsupported simulated QuickBooks operation.",
        );
    }
    const delivered = { reference, result: { ...result!, simulated: true } };
    // No await separates the final authorization check from the fictional write.
    beforeWrite();
    commit();
    this.entries.set(effect.id, {
      hash: this.hash(effect),
      effect: structuredClone(effect),
      result: structuredClone(delivered),
    });
    return structuredClone(delivered);
  }
  async lookup(effect: Effect) {
    return structuredClone(this.previous(effect)?.result ?? null);
  }
  async readInvoiceBalance(effect: Effect) {
    const entry = this.previous(effect);
    check(
      entry &&
        effect.kind === "invoice" &&
        effect.state === "completed" &&
        entry.result.reference === effect.external_ref,
      "ACCOUNTING_INVOICE_REQUIRED",
      "A delivered simulated invoice is required.",
    );
    return structuredClone(this.invoices.get(effect.id)!);
  }
}
