import Stripe from "stripe";
import { refundStatuses, type RefundIntent } from "./billing-refunds.ts";
import { check, integer } from "./core.ts";
import {
  type AccountingPaymentIntent,
  type Adapter,
  type Effect,
  type EffectResult,
} from "./integration.ts";
import { type CommercialLine, type Invoice } from "./billing.ts";

export class StripeAdapter implements Adapter {
  client: Stripe;
  constructor(
    key: string,
    private origin: string,
    private enabled = false,
  ) {
    check(
      /^sk_test_/.test(key),
      "PROVIDER_CONFIG",
      "Only Stripe test credentials are supported before live qualification.",
      500,
    );
    this.client = new Stripe(key, { timeout: 20000, maxNetworkRetries: 0 });
  }
  private allow() {
    check(
      this.enabled,
      "PROVIDER_DISABLED",
      "Outbound provider access is disabled.",
    );
  }
  private checkoutResult(
    effect: Effect,
    session: Stripe.Checkout.Session,
  ): EffectResult {
    const payload = JSON.parse(effect.payload) as {
      amount: number;
      currency: string;
    };
    check(
      session.mode === "payment" &&
        !session.livemode &&
        session.metadata?.effect_id === effect.id &&
        session.amount_total === payload.amount &&
        session.currency === payload.currency,
      "PAYMENT_MISMATCH",
      "Stripe checkout identity or money differs from the intent.",
    );
    if (session.url) {
      const url = new URL(session.url);
      check(
        url.protocol === "https:" &&
          url.hostname === "checkout.stripe.com" &&
          !url.username &&
          !url.password,
        "PROVIDER_RESPONSE",
        "Stripe returned an unsupported checkout URL.",
      );
    }
    return {
      reference: session.id,
      result: {
        checkoutUrl: session.url,
        amount: payload.amount,
        currency: payload.currency,
      },
    };
  }
  private async refundPayment(effect: Effect) {
    const p = JSON.parse(effect.payload) as RefundIntent;
    const payment = await this.client.paymentIntents.retrieve(p.paymentId);
    check(
      payment.id === p.paymentId &&
        payment.livemode === false &&
        payment.status === "succeeded" &&
        payment.amount_received === p.paymentAmount &&
        payment.currency === p.currency &&
        p.amount > 0 &&
        p.amount <= p.paymentAmount,
      "REFUND_MISMATCH",
      "Stripe payment is not the expected settled test payment.",
    );
    return p;
  }
  private refundResult(effect: Effect, refund: Stripe.Refund): EffectResult {
    const p = JSON.parse(effect.payload) as RefundIntent;
    const paymentId =
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : refund.payment_intent?.id;
    check(
      refund.object === "refund" &&
        /^re_[a-zA-Z0-9_]+$/.test(refund.id) &&
        refund.amount === p.amount &&
        refund.currency === p.currency &&
        paymentId === p.paymentId &&
        refund.metadata?.effect_id === effect.id &&
        refund.metadata?.refund_id === p.refundId &&
        refundStatuses.includes(
          refund.status as (typeof refundStatuses)[number],
        ),
      "REFUND_MISMATCH",
      "Stripe refund identity, status or money differs from the intent.",
    );
    return {
      reference: refund.id,
      result: {
        effectId: effect.id,
        refundId: p.refundId,
        paymentId,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
      },
    };
  }
  private async refundLookup(effect: Effect) {
    const p = await this.refundPayment(effect);
    if (effect.external_ref)
      return this.refundResult(
        effect,
        await this.client.refunds.retrieve(effect.external_ref),
      );
    let after: string | undefined;
    let found: Stripe.Refund | undefined;
    for (let page = 0; page < 10; page++) {
      const rows = await this.client.refunds.list({
        payment_intent: p.paymentId,
        limit: 100,
        ...(after ? { starting_after: after } : {}),
      });
      for (const row of rows.data)
        if (row.metadata?.effect_id === effect.id) {
          check(
            !found,
            "REFUND_DUPLICATE",
            "Multiple provider refunds require finance review.",
          );
          found = row;
        }
      if (!rows.has_more)
        return found ? this.refundResult(effect, found) : null;
      check(
        rows.data.length > 0,
        "PROVIDER_RESPONSE",
        "Stripe pagination made no progress.",
      );
      after = rows.data.at(-1)!.id;
    }
    check(
      false,
      "REFUND_LOOKUP_LIMIT",
      "Refund lookup exceeded the review limit; absence is not confirmed.",
    );
  }
  async execute(effect: Effect): Promise<EffectResult> {
    this.allow();
    if (effect.kind === "refund") {
      const p = await this.refundPayment(effect);
      return this.refundResult(
        effect,
        await this.client.refunds.create(
          {
            payment_intent: p.paymentId,
            amount: p.amount,
            metadata: { effect_id: effect.id, refund_id: p.refundId },
          },
          { idempotencyKey: `distributor:${effect.id}` },
        ),
      );
    }
    check(
      effect.kind === "checkout",
      "PROVIDER_OPERATION",
      "Unsupported Stripe operation.",
    );
    const p = JSON.parse(effect.payload) as {
      invoiceId: string;
      amount: number;
      currency: string;
      number: string;
    };
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: p.currency,
              unit_amount: p.amount,
              product_data: { name: `Invoice ${p.number}` },
            },
          },
        ],
        metadata: { effect_id: effect.id },
        payment_intent_data: { metadata: { effect_id: effect.id } },
        success_url: `${this.origin}/?checkout=complete`,
        cancel_url: `${this.origin}/?checkout=cancelled`,
      },
      { idempotencyKey: `distributor:${effect.id}` },
    );
    return this.checkoutResult(effect, session);
  }
  async lookup(effect: Effect): Promise<EffectResult | null> {
    this.allow();
    if (effect.kind === "refund") return this.refundLookup(effect);
    check(
      effect.kind === "checkout",
      "PROVIDER_OPERATION",
      "Unsupported Stripe operation.",
    );
    const created = Math.floor(Date.parse(effect.created_at) / 1000);
    let inspected = 0;
    for await (const s of this.client.checkout.sessions.list({
      created: { gte: created - 60 },
      limit: 100,
    })) {
      if (s.metadata?.effect_id === effect.id)
        return this.checkoutResult(effect, s);
      if (++inspected >= 1000) break;
    }
    return null;
  }
  verifyWebhook(raw: Buffer, signature: string, secret: string) {
    return this.client.webhooks.constructEvent(raw, signature, secret, 300);
  }
  async verifySettlement(sessionId: string) {
    this.allow();
    const session = await this.client.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
    const intent = session.payment_intent as Stripe.PaymentIntent | null;
    check(
      session.mode === "payment" && !session.livemode,
      "PAYMENT_MISMATCH",
      "Unsupported Stripe settlement mode.",
    );
    const paid =
      session.payment_status === "paid" && intent?.status === "succeeded";
    if (paid)
      check(
        intent!.livemode === false &&
          intent!.amount_received === session.amount_total &&
          intent!.currency === session.currency &&
          intent!.metadata?.effect_id === session.metadata?.effect_id,
        "PAYMENT_MISMATCH",
        "Stripe payment identity or received money differs from checkout.",
      );
    return {
      paid,
      amount: integer(session.amount_total, "Stripe amount", 0, 1e12),
      currency: session.currency ?? "",
      effectId: session.metadata?.effect_id ?? "",
      livemode: session.livemode,
      paymentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (intent?.id ?? ""),
    };
  }
}
type QboPayload = {
  invoice: Invoice;
  lines: (CommercialLine & { itemRef: string })[];
  customerRef: string;
  taxCodeRef: string;
  taxRateRef: string;
};
type QboInvoice = {
  Id: string;
  DocNumber: string;
  TotalAmt: number;
  CurrencyRef?: { value: string };
  SyncToken: string;
  PrivateNote?: string;
  CustomerRef?: { value: string };
  Balance?: number;
};
type QboPayment = {
  Id: string;
  TotalAmt: number;
  UnappliedAmt: number;
  CustomerRef?: { value: string };
  CurrencyRef?: { value: string };
  DepositToAccountRef?: { value: string };
  PaymentRefNum?: string;
  PrivateNote?: string;
  TxnDate?: string;
  ProcessPayment?: boolean;
  Line?: { Amount: number; LinkedTxn?: { TxnId: string; TxnType: string }[] }[];
};
const amount = (cents: number) =>
  Number(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
export class QuickBooksAdapter implements Adapter {
  private base: string;
  constructor(
    private realm: string,
    private token: () => Promise<string>,
    private enabled = false,
  ) {
    check(
      /^\d+$/.test(realm),
      "PROVIDER_CONFIG",
      "Invalid QuickBooks company ID.",
      500,
    );
    this.base = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}`;
  }
  private async request(path: string, body?: unknown) {
    check(
      this.enabled,
      "PROVIDER_DISABLED",
      "Outbound provider access is disabled.",
    );
    const response = await fetch(this.base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    check(
      response.ok,
      "PROVIDER_RESPONSE",
      `QuickBooks returned HTTP ${response.status}.`,
    );
    return (await response.json()) as {
      Invoice?: QboInvoice;
      Payment?: QboPayment;
      QueryResponse?: { Invoice?: QboInvoice[]; Payment?: QboPayment[] };
    };
  }
  private result(
    invoice: QboInvoice,
    payload: QboPayload,
    effectId: string,
  ): EffectResult {
    check(
      typeof invoice.Id === "string" &&
        invoice.Id.trim().length > 0 &&
        invoice.PrivateNote === `Distributor effect ${effectId}` &&
        invoice.DocNumber === payload.invoice.number &&
        invoice.TotalAmt === amount(payload.invoice.total) &&
        invoice.CustomerRef?.value === payload.customerRef &&
        invoice.CurrencyRef?.value === payload.invoice.currency,
      "ACCOUNTING_MISMATCH",
      "QuickBooks totals/currency differ; reconcile before marking delivered.",
    );
    return {
      reference: invoice.Id,
      result: {
        number: invoice.DocNumber,
        total: payload.invoice.total,
        currency: payload.invoice.currency,
        syncToken: invoice.SyncToken,
      },
    };
  }
  private paymentResult(effect: Effect, payment: QboPayment): EffectResult {
    const p = JSON.parse(effect.payload) as AccountingPaymentIntent,
      lines = payment.Line ?? [];
    check(
      typeof payment.Id === "string" &&
        payment.Id.trim().length > 0 &&
        payment.PrivateNote === `Distributor effect ${effect.id}` &&
        payment.PaymentRefNum === p.paymentRef &&
        payment.TotalAmt === amount(p.payment.amount) &&
        payment.UnappliedAmt === amount(p.payment.amount - p.appliedAmount) &&
        payment.CustomerRef?.value === p.customerRef &&
        payment.CurrencyRef?.value === p.invoice.currency &&
        payment.DepositToAccountRef?.value === p.depositAccountRef &&
        payment.TxnDate === p.payment.created_at.slice(0, 10) &&
        (payment.ProcessPayment === undefined ||
          payment.ProcessPayment === false) &&
        (p.appliedAmount === 0
          ? lines.length === 0
          : lines.length === 1 &&
            lines[0]!.Amount === amount(p.appliedAmount) &&
            lines[0]!.LinkedTxn?.length === 1 &&
            lines[0]!.LinkedTxn[0]!.TxnId === p.externalInvoiceRef &&
            lines[0]!.LinkedTxn[0]!.TxnType === "Invoice"),
      "ACCOUNTING_MISMATCH",
      "QuickBooks payment identity, money or application differs; reconcile before marking delivered.",
    );
    // Entity-qualified identity avoids collisions with QuickBooks invoice IDs.
    return {
      reference: `payment:${payment.Id}`,
      result: {
        providerId: payment.Id,
        paymentId: p.payment.id,
        invoiceId: p.invoice.id,
        amount: p.payment.amount,
        appliedAmount: p.appliedAmount,
        unappliedAmount: p.payment.amount - p.appliedAmount,
        currency: p.invoice.currency,
        customerRef: p.customerRef,
        depositAccountRef: p.depositAccountRef,
        paymentRef: p.paymentRef,
      },
    };
  }
  private async sendPayment(effect: Effect) {
    const p = JSON.parse(effect.payload) as AccountingPaymentIntent;
    const response = await this.request(
      `/invoice/${encodeURIComponent(p.externalInvoiceRef)}`,
    );
    const invoice = response.Invoice;
    check(
      invoice &&
        invoice.Id === p.externalInvoiceRef &&
        invoice.PrivateNote === `Distributor effect ${p.invoiceEffectId}` &&
        invoice.DocNumber === p.invoice.number &&
        invoice.CustomerRef?.value === p.customerRef &&
        invoice.CurrencyRef?.value === p.invoice.currency &&
        invoice.TotalAmt === amount(p.invoice.total) &&
        typeof invoice.Balance === "number" &&
        Number.isFinite(invoice.Balance) &&
        invoice.Balance >= amount(p.appliedAmount) &&
        invoice.Balance <= invoice.TotalAmt &&
        invoice.Balance === amount(Math.round(invoice.Balance * 100)),
      "ACCOUNTING_INVOICE_MISMATCH",
      "QuickBooks invoice identity or available balance differs. Reconcile external edits before posting cash.",
    );
    const posted = await this.request(
      `/payment?requestid=${encodeURIComponent(effect.id)}`,
      {
        TotalAmt: amount(p.payment.amount),
        CustomerRef: { value: p.customerRef },
        CurrencyRef: { value: p.invoice.currency },
        DepositToAccountRef: { value: p.depositAccountRef },
        PaymentRefNum: p.paymentRef,
        PrivateNote: `Distributor effect ${effect.id}`,
        TxnDate: p.payment.created_at.slice(0, 10),
        ProcessPayment: false,
        Line:
          p.appliedAmount === 0
            ? []
            : [
                {
                  Amount: amount(p.appliedAmount),
                  LinkedTxn: [
                    { TxnId: p.externalInvoiceRef, TxnType: "Invoice" },
                  ],
                },
              ],
      },
    );
    check(
      posted.Payment,
      "PROVIDER_RESPONSE",
      "QuickBooks omitted the payment.",
    );
    return this.paymentResult(effect, posted.Payment);
  }
  async execute(effect: Effect) {
    if (effect.kind === "payment") return this.sendPayment(effect);
    check(
      effect.kind === "invoice",
      "PROVIDER_OPERATION",
      "Unsupported QuickBooks operation.",
    );
    const p = JSON.parse(effect.payload) as QboPayload;
    const body = {
      DocNumber: p.invoice.number,
      CustomerRef: { value: p.customerRef },
      CurrencyRef: { value: p.invoice.currency },
      PrivateNote: `Distributor effect ${effect.id}`,
      Line: p.lines.map((l) => ({
        Amount: amount(l.quantity * l.unitPrice),
        Description: l.description,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: l.itemRef },
          Qty: l.quantity,
          UnitPrice: amount(l.unitPrice),
          TaxCodeRef: { value: p.taxCodeRef },
        },
      })),
      TxnTaxDetail: {
        TotalTax: amount(p.invoice.tax),
        TaxLine: [
          {
            Amount: amount(p.invoice.tax),
            DetailType: "TaxLineDetail",
            TaxLineDetail: {
              TaxRateRef: { value: p.taxRateRef },
              NetAmountTaxable: amount(p.invoice.net),
            },
          },
        ],
      },
    };
    const response = await this.request(
      `/invoice?requestid=${encodeURIComponent(effect.id)}`,
      body,
    );
    check(
      response.Invoice,
      "PROVIDER_RESPONSE",
      "QuickBooks omitted the invoice.",
    );
    return this.result(response.Invoice, p, effect.id);
  }
  async lookup(effect: Effect) {
    if (effect.kind === "payment") {
      const p = JSON.parse(effect.payload) as AccountingPaymentIntent;
      check(
        /^DP-[a-f0-9]{18}$/.test(p.paymentRef),
        "PROVIDER_QUERY",
        "Invalid payment reference.",
      );
      const response = await this.request(
        `/query?query=${encodeURIComponent(`select * from Payment where PaymentRefNum = '${p.paymentRef}' maxresults 2`)}`,
      );
      const rows = response.QueryResponse?.Payment ?? [];
      check(
        rows.length <= 1,
        "ACCOUNTING_DUPLICATE",
        "Multiple QuickBooks payments require finance review.",
      );
      return rows[0] ? this.paymentResult(effect, rows[0]) : null;
    }
    check(
      effect.kind === "invoice",
      "PROVIDER_OPERATION",
      "Unsupported QuickBooks operation.",
    );
    const p = JSON.parse(effect.payload) as QboPayload;
    check(
      /^[A-Z0-9-]+$/.test(p.invoice.number),
      "PROVIDER_QUERY",
      "Invalid document number.",
    );
    const response = await this.request(
      `/query?query=${encodeURIComponent(`select * from Invoice where DocNumber = '${p.invoice.number}'`)}`,
    );
    const rows = response.QueryResponse?.Invoice ?? [];
    check(
      rows.length <= 1,
      "ACCOUNTING_DUPLICATE",
      "Multiple QuickBooks documents need manual reconciliation.",
    );
    return rows[0] ? this.result(rows[0], p, effect.id) : null;
  }
}
