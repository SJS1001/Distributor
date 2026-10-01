import Stripe from "stripe";
import { check, integer } from "./core.ts";
import { type Adapter, type Effect, type EffectResult } from "./integration.ts";
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
  async execute(effect: Effect): Promise<EffectResult> {
    this.allow();
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
      QueryResponse?: { Invoice?: QboInvoice[] };
    };
  }
  private result(
    invoice: QboInvoice,
    payload: QboPayload,
    effectId: string,
  ): EffectResult {
    check(
      invoice.PrivateNote === `Distributor effect ${effectId}` &&
        invoice.DocNumber === payload.invoice.number &&
        Math.round(invoice.TotalAmt * 100) === payload.invoice.total &&
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
  async execute(effect: Effect) {
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
