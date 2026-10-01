import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import {
  ProviderRuntime,
  type StripeGateway,
} from "../src/server/provider-runtime.ts";
import type { Adapter, EffectResult } from "../src/server/integration.ts";
import { check, type Actor } from "../src/server/core.ts";
const cleanup: (() => void)[] = [];
const f = fixture(
  { after: (fn) => cleanup.push(fn) },
  { mfaEncryptionKey: "a1".repeat(32) },
);
const residencyBuyer = f.app.identity.createCustomer(
  f.actor,
  "named-carrier-buyer",
  {
    name: "Synthetic named carrier buyer",
    tier: "standard",
    creditLimit: 10000,
  },
).id;
f.app.identity.createUser(f.actor, "named-carrier-user", {
  email: "named-carriers@example.test",
  name: "Named carrier buyer",
  password: "long-test-only-password",
  role: "buyer",
  accountId: residencyBuyer,
  sites: [],
});
// Old family consent is historical data, never expanded into named exceptions.
f.app.database
  .owned("iam")
  .run(
    "UPDATE iam_accounts SET residency_mode='provider-exceptions',provider_exceptions='[\"carrier\"]',residency_version=2 WHERE id=?",
    residencyBuyer,
  );
for (const [sku, serialized] of [
  ["OPEN-S", true],
  ["OPEN-B", false],
] as const) {
  f.app.catalog.create(f.actor, `opening-${sku}`, {
    sku,
    name: `Synthetic opening ${sku}`,
    serialized,
    unitPrice: 10000,
    taxBasisPoints: 1300,
  });
}
const product = f.app.catalog.create(f.actor, "bulk", {
  sku: "SUP-1",
  name: "Synthetic supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const po = f.app.procurement.create(f.actor, "bulk-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: product, quantity: 5, unitCost: 1000 }],
}).id;
const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
  .lines[0]!;
f.app.procurement.receive(f.actor, "bulk-receipt", {
  poId: po,
  lineId: String(line.id),
  deliveryRef: "BULK-1",
  quantity: 5,
  serials: [],
  bin: "C-1",
  quarantine: false,
});
const transferProduct = f.app.catalog.create(f.actor, "transfer-product", {
  sku: "TR-1",
  name: "Synthetic transfer supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const transferPo = f.app.procurement.create(f.actor, "transfer-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: transferProduct, quantity: 6, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "transfer-receipt", {
  poId: transferPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === transferPo)!
      .lines[0]!.id,
  ),
  deliveryRef: "TRANSFER-STOCK-1",
  quantity: 6,
  serials: [],
  bin: "T-1",
  quarantine: false,
});
const lossProduct = f.app.catalog.create(f.actor, "loss-product", {
  sku: "LOSS-1",
  name: "Synthetic reconciliation supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const lossPo = f.app.procurement.create(f.actor, "loss-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: lossProduct, quantity: 4, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "loss-receipt", {
  poId: lossPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === lossPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "LOSS-STOCK-1",
  quantity: 4,
  serials: [],
  bin: "L-1",
  quarantine: false,
});
const countProduct = f.app.catalog.create(f.actor, "count-product", {
  sku: "COUNT-1",
  name: "Synthetic count supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const countPo = f.app.procurement.create(f.actor, "count-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: countProduct, quantity: 6, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "count-receipt", {
  poId: countPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === countPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "COUNT-STOCK-1",
  quantity: 6,
  serials: [],
  bin: "COUNT-1",
  quarantine: false,
});
const returnProduct = f.app.catalog.create(f.actor, "return-product", {
  sku: "SUPRET-1",
  name: "Synthetic supplier return supplies",
  serialized: false,
  unitPrice: 2500,
  taxBasisPoints: 1300,
}).id;
const returnPo = f.app.procurement.create(f.actor, "return-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: returnProduct, quantity: 6, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "return-receipt", {
  poId: returnPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === returnPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "SUPPLIER-RETURN-STOCK",
  quantity: 6,
  serials: [],
  bin: "RET-1",
  quarantine: false,
});
f.app.identity.createUser(f.actor, "mfa-browser-user", {
  name: "Synthetic authenticator operator",
  email: "mfa-browser@example.test",
  password: "long-mfa-browser-password",
  role: "warehouse",
  sites: [f.w1],
});
for (const [name, warehouseId] of [
  ["source", f.w1],
  ["destination", f.w2],
] as const) {
  f.app.identity.createUser(f.actor, `operator-${name}`, {
    name: `Synthetic ${name} operator`,
    email: `${name}@example.test`,
    password: "long-warehouse-test-password",
    role: "warehouse",
    sites: [warehouseId],
  });
}
// Browser-only accounting fixture: store a synthetic external result, then lose
// the send response. No provider SDK, token or network call is used.
const accountingResults = new Map<string, EffectResult>();
const syntheticAccounting: Adapter = {
  execute: async (effect) => {
    const p = JSON.parse(effect.payload);
    accountingResults.set(effect.id, {
      reference:
        effect.kind === "payment" ||
        effect.kind === "credit-application" ||
        effect.kind === "refund-application"
          ? `payment:${effect.id}`
          : effect.kind === "credit"
            ? `credit:${effect.id}`
            : effect.kind === "refund-expense"
              ? `expense:${effect.id}`
              : `synthetic-invoice-${effect.id}`,
      result:
        effect.kind === "refund-expense" || effect.kind === "refund-application"
          ? {
              refundId: effect.reference,
              amount:
                effect.kind === "refund-expense" ? p.amount : p.refund.amount,
              currency:
                effect.kind === "refund-expense"
                  ? p.credit.invoice.currency
                  : p.refund.credit.invoice.currency,
            }
          : effect.kind === "payment"
            ? {
                paymentId: p.payment.id,
                amount: p.payment.amount,
                appliedAmount: p.appliedAmount,
                currency: p.invoice.currency,
              }
            : effect.kind === "credit-application"
              ? {
                  creditId: p.credit.credit.id,
                  invoiceId: p.credit.invoice.id,
                  amount: p.amount,
                  currency: p.credit.invoice.currency,
                }
              : {
                  number: p.invoice.number,
                  total: p.invoice.total,
                  currency: p.invoice.currency,
                },
    });
    throw Error("Synthetic lost accounting send response");
  },
  lookup: async (effect) => accountingResults.get(effect.id) ?? null,
  readInvoiceBalance: async (effect) => {
    const p = JSON.parse(effect.payload),
      paid = f.app.integration
        .list(f.actor)
        .filter(
          (e) =>
            ["payment", "credit-application"].includes(e.kind) &&
            e.state === "completed",
        )
        .map((e) => JSON.parse(f.app.integration.effect(f.actor, e.id).payload))
        .filter(
          (p) => (p.credit?.invoiceEffectId ?? p.invoiceEffectId) === effect.id,
        )
        .reduce((sum, p) => sum + (p.amount ?? p.appliedAmount), 0);
    return {
      reference: effect.external_ref!,
      total: p.invoice.total,
      currency: p.invoice.currency,
      balance: p.invoice.total - paid,
      syncToken: "1",
    };
  },
};
// Independent browser-only refund fixture. No SDK, token or provider network is used.
const noticeBuyer = f.app.identity.createCustomer(f.actor, "notice-account", {
  name: "Synthetic refund account",
  tier: "standard",
  creditLimit: 1000000,
}).id;
const noticeProduct = f.app.catalog.create(f.actor, "notice-product", {
  sku: "NOTICE-1",
  name: "Synthetic notice item",
  serialized: false,
  unitPrice: 10000,
  taxBasisPoints: 1300,
}).id;
const noticePo = f.app.procurement.create(f.actor, "notice-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: noticeProduct, quantity: 1, unitCost: 6000 }],
}).id;
f.app.procurement.receive(f.actor, "notice-stock", {
  poId: noticePo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === noticePo)!.lines[0]!
      .id,
  ),
  deliveryRef: "NOTICE-STOCK",
  quantity: 1,
  serials: [],
  bin: "N-1",
  quarantine: false,
});
const noticeFixture = { ...f, buyer: noticeBuyer, product: noticeProduct };
const noticeInvoice = ship(
  noticeFixture,
  accept(noticeFixture, 1, "notice-order").id,
).invoiceId;
chooseProviders(f, f.actor, "notice-permission", {
  accountId: noticeBuyer,
  region: "CA",
  mode: "provider-exceptions",
  providers: ["stripe"],
  version: 1,
  acknowledgment: "Synthetic browser permission",
});
const noticePayment = f.app.database.transaction(() =>
  f.app.billing.verifiedPayment(
    f.actor,
    noticeInvoice,
    11300,
    "stripe",
    "pi_browser_synthetic",
  ),
);
f.app.billing.issueCredit(f.actor, "notice-credit", {
  invoiceId: noticeInvoice,
  reference: "NOTICE-CR",
  reason: "Private browser credit",
  lines: [
    {
      lineId: String(f.app.billing.lines(f.actor, noticeInvoice)[0]!.id),
      quantity: 1,
    },
  ],
});
for (const [email, accountId] of [
  ["refund-buyer@example.test", noticeBuyer],
  ["refund-other@example.test", f.buyer],
]) {
  f.app.identity.createUser(f.actor, email!, {
    name: email!,
    email: email!,
    password: "long-notice-test-password",
    role: "buyer",
    accountId: accountId!,
    sites: [],
  });
}
const refundReads = new Map<string, number>();
const refundResult = (
  effect: import("../src/server/integration.ts").Effect,
  status: string,
) => ({
  reference: `re_${effect.reference.replaceAll("-", "")}`,
  result: { ...JSON.parse(effect.payload), effectId: effect.id, status },
});
const syntheticRefunds: StripeGateway = {
  execute: async (effect) => refundResult(effect, "requires_action"),
  lookup: async (effect) => {
    const reads = (refundReads.get(effect.id) ?? 0) + 1;
    refundReads.set(effect.id, reads);
    return refundResult(effect, reads === 1 ? "succeeded" : "failed");
  },
  verifyWebhook: () => {
    throw Error("Browser fixture has no webhook path");
  },
  verifySettlement: async () => {
    throw Error("Browser fixture has no checkout path");
  },
};
for (let i = 0; i < 27; i++) {
  const refund = f.app.billing.refundRequest(f.actor, `notice-refund-${i}`, {
    invoiceId: noticeInvoice,
    paymentId: noticePayment.id,
    amount: 400,
    reference: `NOTICE-REF-${i}`,
    reason: "Private browser refund",
  });
  const effectId = f.app.integration.refund(f.actor, `notice-queue-${i}`, {
    refundId: refund.id,
  }).id;
  await f.app.integration.execute(f.actor, effectId, syntheticRefunds);
  if (i === 26) {
    // More than one bounded history page, all verified through the owning transaction.
    for (let j = 0; j < 26; j++) {
      const effect = f.app.integration.effect(f.actor, effectId);
      const intent = f.app.billing.refunds.intent(f.actor, refund.id);
      const result = refundResult(
        effect,
        j % 2 === 0 ? "pending" : "requires_action",
      );
      f.app.database.transaction(() =>
        f.app.billing.refunds.observe(
          f.actor,
          intent,
          result.reference,
          result.result,
        ),
      );
    }
  }
}
// Synthetic report failures exercise the actual local delivery/review paths.
// No worker is scheduled; these foreground fixture batches end before listen.
for (const role of ["admin", "support"] as const)
  f.app.identity.createUser(f.actor, `event-${role}`, {
    name: `Synthetic event ${role}`,
    email: `event-${role}@example.test`,
    password: "long-event-test-password",
    role,
    sites: [f.w1, f.w2],
  });
while (
  f.app.eventDelivery.tick("event-report", { enabled: true, limit: 100 })
    .claimed
) {}
const eventStore = f.app.database.owned("platform");
for (let i = 0; i < 24; i++)
  eventStore.run(
    "INSERT INTO platform_events VALUES(?,?,'SyntheticBrowserFact',999,?,?,?)",
    `ui-event-${String(i).padStart(2, "0")}`,
    f.actor.orgId,
    `synthetic-event-${i}`,
    JSON.stringify({ private: "private event payload" }),
    new Date().toISOString(),
  );
f.app.eventDelivery.tick("event-report", { enabled: true, limit: 100 });
for (let i = 0; i < 22; i++) {
  const row = eventStore.get(
    "SELECT revision FROM platform_deliveries WHERE consumer_id='event-report' AND event_id='ui-event-23'",
  )!;
  f.app.eventDelivery.retry(f.actor, `fixture-event-retry-${i}`, {
    consumerId: "event-report",
    eventId: "ui-event-23",
    revision: Number(row.revision),
    reason: "Synthetic compatibility review; unsupported version retained.",
  });
  f.app.eventDelivery.tick("event-report", { enabled: true, limit: 100 });
}
class BrowserProviders extends ProviderRuntime {
  override async execute(actor: Actor, effectId: string) {
    const effect = f.app.integration.effect(actor, effectId);
    // The new refund-read fixture must not enable checkout sends for the
    // existing disabled-provider journey. Reject before acquiring its claim.
    check(
      effect.provider !== "stripe" || effect.kind === "refund",
      "PROVIDER_DISABLED",
      "Stripe checkout is disabled in this browser fixture.",
      503,
    );
    return super.execute(actor, effectId);
  }
}
const http = await createHttp(f.app, {
  origin: "http://127.0.0.1:3117",
  providers: new BrowserProviders(f.app, [
    {
      id: "browser-synthetic-accounting",
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      quickbooks: syntheticAccounting,
      stripe: {
        adapter: syntheticRefunds,
        webhookSecret: "whsec_browser_synthetic",
      },
    },
  ]),
});
await http.listen({ host: "127.0.0.1", port: 3117 });
const stop = async () => {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
