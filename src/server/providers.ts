import Stripe from "stripe";
import { checkoutUrl } from "../shared/checkout.ts";
import { refundStatuses, type RefundIntent } from "./billing-refunds.ts";
import { check, integer } from "./core.ts";
import {
  type AccountingPaymentIntent,
  type AccountingCreditIntent,
  type AccountingCreditApplicationIntent,
  type AccountingRefundIntent,
  type AccountingRefundApplicationIntent,
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
      session.object === "checkout.session" &&
        /^cs_test_[a-zA-Z0-9_]+$/.test(session.id) &&
        (!effect.external_ref || session.id === effect.external_ref) &&
        ["open", "complete", "expired"].includes(session.status ?? "") &&
        ["unpaid", "paid", "no_payment_required"].includes(
          session.payment_status,
        ) &&
        Number.isSafeInteger(session.expires_at) &&
        session.expires_at > 0 &&
        session.mode === "payment" &&
        session.livemode === false &&
        session.metadata?.effect_id === effect.id &&
        session.amount_total === payload.amount &&
        session.currency === payload.currency,
      "PAYMENT_MISMATCH",
      "Stripe checkout identity or money differs from the intent.",
    );
    check(
      !session.url || checkoutUrl(session.url),
      "PROVIDER_RESPONSE",
      "Stripe returned an unsupported checkout URL.",
    );
    return {
      reference: session.id,
      result: {
        checkoutUrl: session.url,
        amount: payload.amount,
        currency: payload.currency,
        status: session.status,
        paymentStatus: session.payment_status,
        expiresAt: session.expires_at,
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
  async execute(
    effect: Effect,
    beforeWrite: () => void = () => {},
  ): Promise<EffectResult> {
    this.allow();
    if (effect.kind === "refund") {
      const p = await this.refundPayment(effect);
      beforeWrite();
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
    beforeWrite();
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
    if (effect.external_ref)
      return this.checkoutResult(
        effect,
        await this.client.checkout.sessions.retrieve(effect.external_ref),
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
  ARAccountRef?: { value: string };
  Line?: { Amount: number; LinkedTxn?: { TxnId: string; TxnType: string }[] }[];
};
type QboPurchase = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  PrivateNote?: string;
  TotalAmt: number;
  PaymentType?: string;
  Credit?: boolean;
  AccountRef?: { value: string };
  EntityRef?: { value: string; type?: string };
  CurrencyRef?: { value: string };
  LinkedTxn?: unknown[];
  Line?: {
    Amount: number;
    DetailType: string;
    AccountBasedExpenseLineDetail?: {
      AccountRef?: { value: string };
      CustomerRef?: { value: string };
      BillableStatus?: string;
      TaxCodeRef?: { value: string };
    };
  }[];
  TxnTaxDetail?: { TotalTax: number; TaxLine?: { Amount: number }[] };
};
type QboCredit = QboInvoice & {
  RemainingCredit: number;
  TxnDate?: string;
  LinkedTxn?: unknown[];
  Line?: {
    Amount: number;
    DetailType: string;
    SalesItemLineDetail?: {
      ItemRef?: { value: string };
      Qty: number;
      UnitPrice: number;
      TaxCodeRef?: { value: string };
    };
  }[];
  TxnTaxDetail?: {
    TotalTax: number;
    TaxLine?: {
      Amount: number;
      DetailType: string;
      TaxLineDetail?: {
        TaxRateRef?: { value: string };
        NetAmountTaxable: number;
      };
    }[];
  };
};
const amount = (cents: number) =>
  Number(`${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
export class QuickBooksAdapter implements Adapter {
  private base: string;
  private writeChecks = new WeakMap<Effect, () => void>();
  constructor(
    private realm: string,
    private token: (effect: Effect) => Promise<string>,
    private enabled = false,
    private beforeWrite?: (effect: Effect) => void | Promise<void>,
  ) {
    check(
      /^\d+$/.test(realm),
      "PROVIDER_CONFIG",
      "Invalid QuickBooks company ID.",
      500,
    );
    this.base = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realm}`;
  }
  private async request(effect: Effect, path: string, body?: unknown) {
    check(
      this.enabled,
      "PROVIDER_DISABLED",
      "Outbound provider access is disabled.",
    );
    const token = await this.token(effect);
    if (body) {
      await this.beforeWrite?.(effect);
      this.writeChecks.get(effect)?.();
    }
    const response = await fetch(this.base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
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
      CreditMemo?: QboCredit;
      Purchase?: QboPurchase;
      Account?: {
        Id: string;
        Active?: boolean;
        AccountType?: string;
        CurrencyRef?: { value: string };
      };
      Preferences?: { SalesFormsPrefs?: { AutoApplyCredit?: boolean } };
      QueryResponse?: {
        Invoice?: QboInvoice[];
        Payment?: QboPayment[];
        CreditMemo?: QboCredit[];
        Purchase?: QboPurchase[];
      };
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
  async readInvoiceBalance(effect: Effect) {
    check(
      effect.provider === "quickbooks" &&
        effect.kind === "invoice" &&
        effect.state === "completed" &&
        effect.external_ref,
      "ACCOUNTING_INVOICE_REQUIRED",
      "A completed invoice is required for a balance read.",
    );
    const payload = JSON.parse(effect.payload) as QboPayload;
    const response = await this.request(
      effect,
      `/invoice/${encodeURIComponent(effect.external_ref)}`,
    );
    check(
      response.Invoice,
      "ACCOUNTING_MISMATCH",
      "QuickBooks did not return the requested invoice.",
    );
    const invoice = response.Invoice;
    this.result(invoice, payload, effect.id);
    const cents = Math.round(Number(invoice.Balance) * 100);
    check(
      invoice.Id === effect.external_ref &&
        typeof invoice.Balance === "number" &&
        Number.isSafeInteger(cents) &&
        cents >= 0 &&
        cents <= payload.invoice.total &&
        amount(cents) === invoice.Balance &&
        typeof invoice.SyncToken === "string" &&
        /^\d{1,160}$/.test(invoice.SyncToken),
      "ACCOUNTING_MISMATCH",
      "QuickBooks balance or exact invoice identity differs; finance review required.",
    );
    return {
      reference: invoice.Id,
      total: payload.invoice.total,
      currency: payload.invoice.currency,
      balance: cents,
      syncToken: invoice.SyncToken,
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
  private creditResult(
    effect: Effect,
    credit: QboCredit,
    allowApplied = false,
  ): EffectResult {
    const p = JSON.parse(effect.payload) as AccountingCreditIntent;
    const expected = p.lines.map((l) => ({
      item: l.itemRef,
      quantity: l.quantity,
      price: amount(l.unitPrice),
      net: amount(l.quantity * l.unitPrice),
      tax: p.taxCodeRef,
    }));
    const actual = (credit.Line ?? [])
      .filter((l) => l.DetailType === "SalesItemLineDetail")
      .map((l) => ({
        item: l.SalesItemLineDetail?.ItemRef?.value,
        quantity: l.SalesItemLineDetail?.Qty,
        price: l.SalesItemLineDetail?.UnitPrice,
        net: l.Amount,
        tax: l.SalesItemLineDetail?.TaxCodeRef?.value,
      }));
    // QuickBooks may reorder lines or append one subtotal. Compare the sales
    // line multiset and reject all other monetary adjustments.
    const encoded = (lines: unknown[]) =>
      lines
        .map((l) => JSON.stringify(l))
        .sort()
        .join("\n");
    const other = (credit.Line ?? []).filter(
        (l) => l.DetailType !== "SalesItemLineDetail",
      ),
      taxes = credit.TxnTaxDetail?.TaxLine ?? [];
    check(
      typeof credit.Id === "string" &&
        credit.Id.trim().length > 0 &&
        credit.PrivateNote === `Distributor effect ${effect.id}` &&
        credit.DocNumber === p.credit.number &&
        credit.TxnDate === p.credit.created_at.slice(0, 10) &&
        credit.TotalAmt === amount(p.credit.total) &&
        (allowApplied
          ? typeof credit.RemainingCredit === "number" &&
            Number.isFinite(credit.RemainingCredit) &&
            credit.RemainingCredit >= 0 &&
            credit.RemainingCredit <= amount(p.credit.total) &&
            credit.RemainingCredit ===
              amount(Math.round(credit.RemainingCredit * 100))
          : credit.RemainingCredit === amount(p.credit.total)) &&
        credit.CustomerRef?.value === p.customerRef &&
        credit.CurrencyRef?.value === p.invoice.currency &&
        (allowApplied || (credit.LinkedTxn ?? []).length === 0) &&
        encoded(actual) === encoded(expected) &&
        other.length <= 1 &&
        other.every(
          (l) =>
            l.DetailType === "SubTotalLineDetail" &&
            l.Amount === amount(p.credit.net),
        ) &&
        credit.TxnTaxDetail?.TotalTax === amount(p.credit.tax) &&
        taxes.length === 1 &&
        taxes[0]!.Amount === amount(p.credit.tax) &&
        taxes[0]!.DetailType === "TaxLineDetail" &&
        taxes[0]!.TaxLineDetail?.TaxRateRef?.value === p.taxRateRef &&
        taxes[0]!.TaxLineDetail?.NetAmountTaxable === amount(p.credit.net),
      "ACCOUNTING_MISMATCH",
      "QuickBooks credit identity, lines, tax or unapplied amount differs; reconcile before marking delivered.",
    );
    return {
      reference: `credit:${credit.Id}`,
      result: {
        providerId: credit.Id,
        creditId: p.credit.id,
        invoiceId: p.invoice.id,
        number: p.credit.number,
        total: p.credit.total,
        unappliedAmount: Math.round(credit.RemainingCredit * 100),
        currency: p.invoice.currency,
      },
    };
  }
  private creditApplicationResult(
    effect: Effect,
    payment: QboPayment,
  ): EffectResult {
    const p = JSON.parse(effect.payload) as AccountingCreditApplicationIntent,
      lines = payment.Line ?? [],
      links = lines.map((line) => ({
        amount: line.Amount,
        links: line.LinkedTxn,
      }));
    check(
      typeof payment.Id === "string" &&
        payment.Id.trim().length > 0 &&
        payment.PrivateNote === `Distributor effect ${effect.id}` &&
        payment.PaymentRefNum === p.applicationRef &&
        payment.TotalAmt === 0 &&
        payment.UnappliedAmt === 0 &&
        payment.CustomerRef?.value === p.credit.customerRef &&
        payment.CurrencyRef?.value === p.credit.invoice.currency &&
        payment.TxnDate === p.applicationDate &&
        (payment.ProcessPayment === undefined ||
          payment.ProcessPayment === false) &&
        links.length === 2 &&
        links.every(
          (l) => l.amount === amount(p.amount) && l.links?.length === 1,
        ) &&
        links.filter(
          (l) =>
            l.links?.[0]?.TxnType === "Invoice" &&
            l.links[0].TxnId === p.credit.externalInvoiceRef,
        ).length === 1 &&
        links.filter(
          (l) =>
            l.links?.[0]?.TxnType === "CreditMemo" &&
            l.links[0].TxnId === p.externalCreditRef,
        ).length === 1,
      "ACCOUNTING_MISMATCH",
      "QuickBooks credit application identity, money or links differ; reconcile before marking delivered.",
    );
    return {
      reference: `payment:${payment.Id}`,
      result: {
        providerId: payment.Id,
        creditId: p.credit.credit.id,
        invoiceId: p.credit.invoice.id,
        amount: p.amount,
        currency: p.credit.invoice.currency,
        applicationRef: p.applicationRef,
        applicationDate: p.applicationDate,
      },
    };
  }
  private async sendCreditApplication(effect: Effect) {
    const p = JSON.parse(effect.payload) as AccountingCreditApplicationIntent;
    const preferences = await this.request(effect, "/preferences");
    check(
      preferences.Preferences?.SalesFormsPrefs?.AutoApplyCredit === false,
      "ACCOUNTING_CREDIT_AUTOMATION",
      "Confirm automatic credit application is off before applying a credit.",
    );
    const parent = await this.request(
        effect,
        `/invoice/${encodeURIComponent(p.credit.externalInvoiceRef)}`,
      ),
      invoice = parent.Invoice;
    check(
      invoice &&
        invoice.Id === p.credit.externalInvoiceRef &&
        invoice.PrivateNote ===
          `Distributor effect ${p.credit.invoiceEffectId}` &&
        invoice.DocNumber === p.credit.invoice.number &&
        invoice.TotalAmt === amount(p.credit.invoice.total) &&
        invoice.CustomerRef?.value === p.credit.customerRef &&
        invoice.CurrencyRef?.value === p.credit.invoice.currency &&
        typeof invoice.Balance === "number" &&
        Number.isFinite(invoice.Balance) &&
        invoice.Balance >= amount(p.amount) &&
        invoice.Balance <= invoice.TotalAmt &&
        invoice.Balance === amount(Math.round(invoice.Balance * 100)),
      "ACCOUNTING_INVOICE_MISMATCH",
      "QuickBooks original invoice identity or available balance differs; reconcile before applying credit.",
    );
    const response = await this.request(
        effect,
        `/creditmemo/${encodeURIComponent(p.externalCreditRef)}`,
      ),
      credit = response.CreditMemo;
    check(
      credit && credit.Id === p.externalCreditRef,
      "ACCOUNTING_MISMATCH",
      "QuickBooks omitted the exact original credit.",
    );
    this.creditResult(
      { ...effect, id: p.creditEffectId, payload: JSON.stringify(p.credit) },
      credit,
      true,
    );
    check(
      credit.RemainingCredit >= amount(p.amount),
      "ACCOUNTING_ALLOCATION",
      "QuickBooks remaining credit cannot cover the application; reconcile external edits.",
    );
    const posted = await this.request(
      effect,
      `/payment?requestid=${encodeURIComponent(effect.id)}`,
      {
        TotalAmt: 0,
        CustomerRef: { value: p.credit.customerRef },
        CurrencyRef: { value: p.credit.invoice.currency },
        PaymentRefNum: p.applicationRef,
        PrivateNote: `Distributor effect ${effect.id}`,
        TxnDate: p.applicationDate,
        ProcessPayment: false,
        Line: [
          {
            Amount: amount(p.amount),
            LinkedTxn: [
              { TxnId: p.credit.externalInvoiceRef, TxnType: "Invoice" },
            ],
          },
          {
            Amount: amount(p.amount),
            LinkedTxn: [{ TxnId: p.externalCreditRef, TxnType: "CreditMemo" }],
          },
        ],
      },
    );
    check(
      posted.Payment,
      "PROVIDER_RESPONSE",
      "QuickBooks omitted the credit application.",
    );
    return this.creditApplicationResult(effect, posted.Payment);
  }
  private async sendCredit(effect: Effect) {
    const p = JSON.parse(effect.payload) as AccountingCreditIntent;
    check(
      /^[A-Z0-9-]{1,21}$/.test(p.credit.number),
      "PROVIDER_QUERY",
      "Invalid credit document number.",
    );
    const preferences = await this.request(effect, "/preferences");
    check(
      preferences.Preferences?.SalesFormsPrefs?.AutoApplyCredit === false,
      "ACCOUNTING_CREDIT_AUTOMATION",
      "Confirm automatic credit application is off before posting an unapplied credit.",
    );
    const parent = await this.request(
        effect,
        `/invoice/${encodeURIComponent(p.externalInvoiceRef)}`,
      ),
      invoice = parent.Invoice;
    check(
      invoice &&
        invoice.Id === p.externalInvoiceRef &&
        invoice.PrivateNote === `Distributor effect ${p.invoiceEffectId}` &&
        invoice.DocNumber === p.invoice.number &&
        invoice.TotalAmt === amount(p.invoice.total) &&
        invoice.CustomerRef?.value === p.customerRef &&
        invoice.CurrencyRef?.value === p.invoice.currency,
      "ACCOUNTING_INVOICE_MISMATCH",
      "QuickBooks parent invoice differs; reconcile before posting its credit.",
    );
    const posted = await this.request(
      effect,
      `/creditmemo?requestid=${encodeURIComponent(effect.id)}`,
      {
        DocNumber: p.credit.number,
        TxnDate: p.credit.created_at.slice(0, 10),
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
          TotalTax: amount(p.credit.tax),
          TaxLine: [
            {
              Amount: amount(p.credit.tax),
              DetailType: "TaxLineDetail",
              TaxLineDetail: {
                TaxRateRef: { value: p.taxRateRef },
                NetAmountTaxable: amount(p.credit.net),
              },
            },
          ],
        },
      },
    );
    check(
      posted.CreditMemo,
      "PROVIDER_RESPONSE",
      "QuickBooks omitted the credit memo.",
    );
    return this.creditResult(effect, posted.CreditMemo);
  }
  private async sendPayment(effect: Effect) {
    const p = JSON.parse(effect.payload) as AccountingPaymentIntent;
    const response = await this.request(
      effect,
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
      effect,
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
  private refundExpenseResult(
    effect: Effect,
    expense: QboPurchase,
  ): EffectResult {
    const p = JSON.parse(effect.payload) as AccountingRefundIntent,
      lines = expense.Line ?? [],
      detail = lines[0]?.AccountBasedExpenseLineDetail;
    check(
      typeof expense.Id === "string" &&
        expense.Id.trim().length > 0 &&
        expense.DocNumber === p.expenseRef &&
        expense.PrivateNote === `Distributor effect ${effect.id}` &&
        expense.TxnDate === p.expenseDate &&
        expense.PaymentType === "Cash" &&
        (expense.Credit === undefined || expense.Credit === false) &&
        expense.EntityRef?.value === p.credit.customerRef &&
        expense.EntityRef.type === "Customer" &&
        expense.AccountRef?.value === p.bankAccountRef &&
        expense.CurrencyRef?.value === p.credit.invoice.currency &&
        expense.TotalAmt === amount(p.amount) &&
        lines.length === 1 &&
        lines[0]!.Amount === amount(p.amount) &&
        lines[0]!.DetailType === "AccountBasedExpenseLineDetail" &&
        detail?.AccountRef?.value === p.receivableAccountRef &&
        detail.CustomerRef?.value === p.credit.customerRef &&
        detail.BillableStatus === "NotBillable" &&
        detail.TaxCodeRef?.value === p.nonTaxCodeRef &&
        (!expense.TxnTaxDetail ||
          (expense.TxnTaxDetail.TotalTax === 0 &&
            (expense.TxnTaxDetail.TaxLine ?? []).every(
              (line) => line.Amount === 0,
            ))),
      "ACCOUNTING_MISMATCH",
      "QuickBooks refund expense identity, accounts, money or tax differs; reconcile before marking delivered.",
    );
    return {
      reference: `expense:${expense.Id}`,
      result: {
        providerId: expense.Id,
        refundId: p.refundId,
        invoiceId: p.credit.invoice.id,
        creditId: p.credit.credit.id,
        amount: p.amount,
        currency: p.credit.invoice.currency,
        expenseRef: p.expenseRef,
        expenseDate: p.expenseDate,
      },
    };
  }
  private refundApplicationResult(
    effect: Effect,
    payment: QboPayment,
  ): EffectResult {
    const p = JSON.parse(effect.payload) as AccountingRefundApplicationIntent,
      refund = p.refund,
      lines = payment.Line ?? [];
    check(
      typeof payment.Id === "string" &&
        payment.Id.trim().length > 0 &&
        payment.PrivateNote === `Distributor effect ${effect.id}` &&
        payment.PaymentRefNum === p.applicationRef &&
        payment.TotalAmt === 0 &&
        payment.UnappliedAmt === 0 &&
        payment.CustomerRef?.value === refund.credit.customerRef &&
        payment.CurrencyRef?.value === refund.credit.invoice.currency &&
        payment.ARAccountRef?.value === refund.receivableAccountRef &&
        payment.DepositToAccountRef?.value === refund.bankAccountRef &&
        payment.TxnDate === refund.expenseDate &&
        (payment.ProcessPayment === undefined ||
          payment.ProcessPayment === false) &&
        lines.length === 2 &&
        lines.every(
          (line) =>
            line.Amount === amount(refund.amount) &&
            line.LinkedTxn?.length === 1,
        ) &&
        lines.filter(
          (line) =>
            line.LinkedTxn?.[0]?.TxnType === "Expense" &&
            line.LinkedTxn[0].TxnId === p.externalExpenseRef,
        ).length === 1 &&
        lines.filter(
          (line) =>
            line.LinkedTxn?.[0]?.TxnType === "CreditMemo" &&
            line.LinkedTxn[0].TxnId === refund.externalCreditRef,
        ).length === 1,
      "ACCOUNTING_MISMATCH",
      "QuickBooks refund application identity, accounts, zero-cash money or links differ; reconcile before marking delivered.",
    );
    return {
      reference: `payment:${payment.Id}`,
      result: {
        providerId: payment.Id,
        refundId: refund.refundId,
        invoiceId: refund.credit.invoice.id,
        creditId: refund.credit.credit.id,
        amount: refund.amount,
        currency: refund.credit.invoice.currency,
        applicationRef: p.applicationRef,
        expenseRef: refund.expenseRef,
      },
    };
  }
  private async refundPreflight(effect: Effect, p: AccountingRefundIntent) {
    const preferences = await this.request(effect, "/preferences");
    check(
      preferences.Preferences?.SalesFormsPrefs?.AutoApplyCredit === false,
      "ACCOUNTING_CREDIT_AUTOMATION",
      "Turn off automatic credit application and reconcile existing allocations before recording a refund.",
    );
    const { Invoice: invoice } = await this.request(
      effect,
      `/invoice/${encodeURIComponent(p.credit.externalInvoiceRef)}`,
    );
    check(
      invoice &&
        invoice.Id === p.credit.externalInvoiceRef &&
        invoice.PrivateNote ===
          `Distributor effect ${p.credit.invoiceEffectId}` &&
        invoice.DocNumber === p.credit.invoice.number &&
        invoice.TotalAmt === amount(p.credit.invoice.total) &&
        invoice.CustomerRef?.value === p.credit.customerRef &&
        invoice.CurrencyRef?.value === p.credit.invoice.currency &&
        invoice.Balance === 0,
      "ACCOUNTING_INVOICE_MISMATCH",
      "QuickBooks original invoice must match and be fully paid before recording its refund.",
    );
    const { Payment: payment } = await this.request(
      effect,
      `/payment/${encodeURIComponent(p.externalPaymentRef)}`,
    );
    check(
      payment && payment.Id === p.externalPaymentRef,
      "ACCOUNTING_MISMATCH",
      "QuickBooks omitted the original received payment.",
    );
    this.paymentResult(
      { ...effect, id: p.paymentEffectId, payload: JSON.stringify(p.payment) },
      payment,
    );
    const { CreditMemo: credit } = await this.request(
      effect,
      `/creditmemo/${encodeURIComponent(p.externalCreditRef)}`,
    );
    check(
      credit && credit.Id === p.externalCreditRef,
      "ACCOUNTING_MISMATCH",
      "QuickBooks omitted the original refund credit.",
    );
    this.creditResult(
      { ...effect, id: p.creditEffectId, payload: JSON.stringify(p.credit) },
      credit,
      true,
    );
    check(
      credit.RemainingCredit >= amount(p.amount),
      "ACCOUNTING_ALLOCATION",
      "QuickBooks remaining credit cannot cover this refund; reconcile external allocations.",
    );
    for (const [reference, type] of [
      [p.bankAccountRef, "Bank"],
      [p.receivableAccountRef, "Accounts Receivable"],
    ]) {
      const { Account: account } = await this.request(
        effect,
        `/account/${encodeURIComponent(reference!)}`,
      );
      check(
        account &&
          account.Id === reference &&
          account.Active === true &&
          account.AccountType === type &&
          account.CurrencyRef?.value === p.credit.invoice.currency,
        "ACCOUNTING_ACCOUNT_MISMATCH",
        "Refund accounts must be active bank and accounts receivable accounts in the invoice currency.",
      );
    }
  }
  private async sendRefundExpense(effect: Effect) {
    const p = JSON.parse(effect.payload) as AccountingRefundIntent;
    check(
      /^DR-[a-f0-9]{18}$/.test(p.expenseRef),
      "PROVIDER_QUERY",
      "Invalid refund expense reference.",
    );
    await this.refundPreflight(effect, p);
    const { Purchase: expense } = await this.request(
      effect,
      `/purchase?requestid=${encodeURIComponent(effect.id)}`,
      {
        PaymentType: "Cash",
        Credit: false,
        AccountRef: { value: p.bankAccountRef },
        EntityRef: { value: p.credit.customerRef, type: "Customer" },
        CurrencyRef: { value: p.credit.invoice.currency },
        DocNumber: p.expenseRef,
        TxnDate: p.expenseDate,
        PrivateNote: `Distributor effect ${effect.id}`,
        TotalAmt: amount(p.amount),
        Line: [
          {
            Amount: amount(p.amount),
            DetailType: "AccountBasedExpenseLineDetail",
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: p.receivableAccountRef },
              CustomerRef: { value: p.credit.customerRef },
              BillableStatus: "NotBillable",
              TaxCodeRef: { value: p.nonTaxCodeRef },
            },
          },
        ],
        TxnTaxDetail: { TotalTax: 0 },
      },
    );
    check(
      expense,
      "PROVIDER_RESPONSE",
      "QuickBooks omitted the refund expense.",
    );
    return this.refundExpenseResult(effect, expense);
  }
  private async sendRefundApplication(effect: Effect) {
    const p = JSON.parse(effect.payload) as AccountingRefundApplicationIntent;
    check(
      /^DA-[a-f0-9]{18}$/.test(p.applicationRef),
      "PROVIDER_QUERY",
      "Invalid refund application reference.",
    );
    await this.refundPreflight(effect, p.refund);
    const { Purchase: expense } = await this.request(
      effect,
      `/purchase/${encodeURIComponent(p.externalExpenseRef)}`,
    );
    check(
      expense &&
        expense.Id === p.externalExpenseRef &&
        (expense.LinkedTxn ?? []).length === 0,
      "ACCOUNTING_MISMATCH",
      "QuickBooks omitted the exact unapplied refund expense.",
    );
    this.refundExpenseResult(
      { ...effect, id: p.expenseEffectId, payload: JSON.stringify(p.refund) },
      expense,
    );
    const { Payment: payment } = await this.request(
      effect,
      `/payment?requestid=${encodeURIComponent(effect.id)}`,
      {
        TotalAmt: 0,
        CustomerRef: { value: p.refund.credit.customerRef },
        CurrencyRef: { value: p.refund.credit.invoice.currency },
        ARAccountRef: { value: p.refund.receivableAccountRef },
        DepositToAccountRef: { value: p.refund.bankAccountRef },
        PaymentRefNum: p.applicationRef,
        PrivateNote: `Distributor effect ${effect.id}`,
        TxnDate: p.refund.expenseDate,
        ProcessPayment: false,
        Line: [
          {
            Amount: amount(p.refund.amount),
            LinkedTxn: [{ TxnId: p.externalExpenseRef, TxnType: "Expense" }],
          },
          {
            Amount: amount(p.refund.amount),
            LinkedTxn: [
              { TxnId: p.refund.externalCreditRef, TxnType: "CreditMemo" },
            ],
          },
        ],
      },
    );
    check(
      payment,
      "PROVIDER_RESPONSE",
      "QuickBooks omitted the refund application.",
    );
    return this.refundApplicationResult(effect, payment);
  }
  async execute(effect: Effect, beforeWrite?: () => void) {
    if (beforeWrite) this.writeChecks.set(effect, beforeWrite);
    try {
      return await this.send(effect);
    } finally {
      this.writeChecks.delete(effect);
    }
  }
  private async send(effect: Effect) {
    if (effect.kind === "refund-expense") return this.sendRefundExpense(effect);
    if (effect.kind === "refund-application")
      return this.sendRefundApplication(effect);
    if (effect.kind === "credit-application")
      return this.sendCreditApplication(effect);
    if (effect.kind === "credit") return this.sendCredit(effect);
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
      effect,
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
    if (
      effect.kind === "refund-expense" ||
      effect.kind === "refund-application"
    ) {
      const expense = effect.kind === "refund-expense",
        p = JSON.parse(effect.payload) as AccountingRefundIntent &
          AccountingRefundApplicationIntent,
        reference = expense ? p.expenseRef : p.applicationRef;
      check(
        (expense ? /^DR-[a-f0-9]{18}$/ : /^DA-[a-f0-9]{18}$/).test(reference),
        "PROVIDER_QUERY",
        "Invalid refund accounting reference.",
      );
      const entity = expense ? "Purchase" : "Payment",
        field = expense ? "DocNumber" : "PaymentRefNum";
      const response = await this.request(
        effect,
        `/query?query=${encodeURIComponent(`select * from ${entity} where ${field} = '${reference}' maxresults 2`)}`,
      );
      const rows = expense
        ? (response.QueryResponse?.Purchase ?? [])
        : (response.QueryResponse?.Payment ?? []);
      check(
        rows.length <= 1,
        "ACCOUNTING_DUPLICATE",
        "Multiple QuickBooks refund accounting records require finance review.",
      );
      if (!rows[0]) return null;
      return expense
        ? this.refundExpenseResult(effect, rows[0] as QboPurchase)
        : this.refundApplicationResult(effect, rows[0] as QboPayment);
    }
    if (effect.kind === "credit-application") {
      const p = JSON.parse(effect.payload) as AccountingCreditApplicationIntent;
      check(
        /^DC-[a-f0-9]{18}$/.test(p.applicationRef),
        "PROVIDER_QUERY",
        "Invalid credit application reference.",
      );
      const response = await this.request(
        effect,
        `/query?query=${encodeURIComponent(`select * from Payment where PaymentRefNum = '${p.applicationRef}' maxresults 2`)}`,
      );
      const rows = response.QueryResponse?.Payment ?? [];
      check(
        rows.length <= 1,
        "ACCOUNTING_DUPLICATE",
        "Multiple QuickBooks credit applications require finance review.",
      );
      return rows[0] ? this.creditApplicationResult(effect, rows[0]) : null;
    }
    if (effect.kind === "credit") {
      const p = JSON.parse(effect.payload) as AccountingCreditIntent;
      check(
        /^[A-Z0-9-]{1,21}$/.test(p.credit.number),
        "PROVIDER_QUERY",
        "Invalid credit document number.",
      );
      const response = await this.request(
        effect,
        `/query?query=${encodeURIComponent(`select * from CreditMemo where DocNumber = '${p.credit.number}' maxresults 2`)}`,
      );
      const rows = response.QueryResponse?.CreditMemo ?? [];
      check(
        rows.length <= 1,
        "ACCOUNTING_DUPLICATE",
        "Multiple QuickBooks credits require finance review.",
      );
      return rows[0] ? this.creditResult(effect, rows[0]) : null;
    }
    if (effect.kind === "payment") {
      const p = JSON.parse(effect.payload) as AccountingPaymentIntent;
      check(
        /^DP-[a-f0-9]{18}$/.test(p.paymentRef),
        "PROVIDER_QUERY",
        "Invalid payment reference.",
      );
      const response = await this.request(
        effect,
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
      effect,
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
