import { purchaseQueueBrowser } from "./purchase-queue-browser-fixture.ts";
import { orderQueueBrowser } from "./order-queue-browser-fixture.ts";
import { replacementCarrierBrowser } from "./replacement-carrier-browser-fixture.ts";
import { shipmentCoverageBrowser } from "./shipment-coverage-browser-fixture.ts";
import { reconciliationBrowser } from "./reconciliation-browser-fixture.ts";
import { claimQueueBrowser } from "./claim-queue-browser-fixture.ts";
import {
  setup as canadaPostSetup,
  configurationHash as canadaPostHash,
} from "./canada-post-fixture.ts";
import { claimBrowser } from "./carrier-claim-browser-fixture.ts";
import { dhlBrowser } from "./dhl-warehouse-fixture.ts";
import { configurationBrowser } from "./carrier-configuration-browser-fixture.ts";
import { coveragePolicyBrowser } from "./coverage-policy-browser-fixture.ts";
import { countPolicyBrowser } from "./count-policy-browser-fixture.ts";
import { client as canadaPostCreation } from "./canada-post-creation-fixture.ts";
import { manifestClient as canadaPostManifest } from "./canada-post-manifest-fixture.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { QuickBooksBrowser } from "../src/server/quickbooks-browser.ts";
import {
  ProviderRuntime,
  type StripeGateway,
} from "../src/server/provider-runtime.ts";
import type { Adapter, EffectResult } from "../src/server/integration.ts";
import { check, type Actor } from "../src/server/core.ts";
const cleanup: (() => void)[] = [];
const f = fixture(
  { after: (fn) => cleanup.push(fn) },
  { mfaEncryptionKey: "a1".repeat(32), mfaRequiredRoles: ["warranty"] },
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
// Isolated synthetic acceptance history. Strict choices intentionally leave gaps;
// every provider acceptance is made through the actual IAM command.
const historyBuyer = f.app.identity.createCustomer(f.actor, "history-buyer", {
  name: "Synthetic acceptance history buyer",
  tier: "standard",
  creditLimit: 0,
}).id;
const historyUser = f.app.identity.createUser(f.actor, "history-user", {
  email: "history-buyer@example.test",
  name: "Synthetic history representative",
  password: "long-test-only-password",
  role: "buyer",
  accountId: historyBuyer,
  sites: [],
}).id;
const historyActor = f.app.identity.currentActor({
  ...f.actor,
  id: historyUser,
});
for (let version = 1; version <= 27; version++)
  chooseProviders(
    f,
    version === 26 ? historyActor : f.actor,
    `history-${version}`,
    {
      accountId: historyBuyer,
      region: "CA",
      mode: version === 12 || version === 27 ? "strict" : "provider-exceptions",
      providers:
        version === 12 || version === 27
          ? []
          : version === 26
            ? [
                "stripe",
                "quickbooks",
                "ups",
                "fedex",
                "usps",
                "canada-post",
                "purolator",
                "dhl-express",
              ]
            : ["stripe", "quickbooks"],
      version,
      acknowledgment: "Synthetic test-only review of customer terms",
    },
  );
const emptyHistoryBuyer = f.app.identity.createCustomer(
  f.actor,
  "empty-history-buyer",
  {
    name: "Synthetic account without acceptances",
    tier: "standard",
    creditLimit: 0,
  },
).id;
f.app.identity.createUser(f.actor, "empty-history-user", {
  email: "empty-history@example.test",
  name: "Synthetic other history buyer",
  password: "long-test-only-password",
  role: "buyer",
  accountId: emptyHistoryBuyer,
  sites: [],
});
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
f.app.identity.createUser(f.actor, "replacement-mfa-browser-user", {
  name: "Synthetic authenticator replacement operator",
  email: "replacement-mfa@example.test",
  password: "long-replacement-mfa-password",
  role: "warranty",
  sites: [f.w1],
});
f.app.identity.createUser(f.actor, "renewal-mfa-browser-user", {
  name: "Synthetic recovery renewal operator",
  email: "renewal-mfa@example.test",
  password: "long-renewal-mfa-password",
  role: "warranty",
  sites: [f.w1],
});
f.app.identity.createUser(f.actor, "required-mfa-browser-user", {
  name: "Synthetic required authenticator operator",
  email: "required-mfa@example.test",
  password: "long-required-mfa-password",
  role: "warranty",
  sites: [f.w1],
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
// Independent invoice checkout fixture. Hosted navigation is intercepted by the
// browser test; these values never contact Stripe or represent received cash.
const checkoutBuyer = f.app.identity.createCustomer(f.actor, "checkout-buyer", {
  name: "Synthetic checkout buyer",
  tier: "standard",
  creditLimit: 1000000,
}).id;
f.app.identity.createUser(f.actor, "checkout-user", {
  email: "checkout-buyer@example.test",
  name: "Synthetic checkout buyer",
  password: "long-test-only-password",
  role: "buyer",
  accountId: checkoutBuyer,
  sites: [],
});
chooseProviders(f, f.actor, "checkout-permission", {
  accountId: checkoutBuyer,
  region: "CA",
  mode: "provider-exceptions",
  providers: ["stripe"],
  version: 1,
  acknowledgment: "Synthetic browser acceptance",
});
const checkoutProduct = f.app.catalog.create(f.actor, "checkout-product", {
  sku: "CHECKOUT-1",
  name: "Synthetic checkout item",
  serialized: false,
  unitPrice: 10000,
  taxBasisPoints: 1300,
}).id;
const checkoutPo = f.app.procurement.create(f.actor, "checkout-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: checkoutProduct, quantity: 3, unitCost: 6000 }],
}).id;
f.app.procurement.receive(f.actor, "checkout-stock", {
  poId: checkoutPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === checkoutPo)!
      .lines[0]!.id,
  ),
  deliveryRef: "CHECKOUT-STOCK",
  quantity: 3,
  serials: [],
  bin: "CHECKOUT-1",
  quarantine: false,
});
const checkoutFixture = {
  ...f,
  buyer: checkoutBuyer,
  product: checkoutProduct,
};
const checkoutResult = (
  effect: import("../src/server/integration.ts").Effect,
  status = "open",
) => ({
  reference: `cs_test_${effect.id.replaceAll("-", "")}`,
  result: {
    amount: JSON.parse(effect.payload).amount,
    currency: "cad",
    status,
    paymentStatus: "unpaid",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    checkoutUrl: "https://checkout.stripe.com/synthetic-browser",
  },
});
for (let i = 0; i < 3; i++) {
  const invoiceId = ship(
    checkoutFixture,
    accept(checkoutFixture, 1, `checkout-order-${i}`).id,
  ).invoiceId;
  const effect = f.app.integration.checkout(f.actor, `checkout-queue-${i}`, {
    invoiceId,
  });
  if (i < 2)
    await f.app.integration.execute(f.actor, effect.id, {
      execute: async (e) => checkoutResult(e),
      lookup: async (e) => checkoutResult(e),
    });
  // Retain enough immutable observations for paging without changing the current
  // open checkout projection or creating orders in the shared buyer account.
  if (i === 0)
    for (let observation = 0; observation < 24; observation++)
      await f.app.integration.refreshCheckout(f.actor, effect.id, {
        execute: async (e) => checkoutResult(e),
        lookup: async (e) => checkoutResult(e),
      });
}
const refundResult = (
  effect: import("../src/server/integration.ts").Effect,
  status: string,
) => ({
  reference: `re_${effect.reference.replaceAll("-", "")}`,
  result: { ...JSON.parse(effect.payload), effectId: effect.id, status },
});
const syntheticRefunds: StripeGateway = {
  execute: async (effect) =>
    effect.kind === "checkout" && effect.account_id === checkoutBuyer
      ? checkoutResult(effect)
      : refundResult(effect, "requires_action"),
  lookup: async (effect) => {
    if (effect.kind === "checkout" && effect.account_id === checkoutBuyer)
      return checkoutResult(effect, "expired");
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
    // Synthetic refund and isolated checkout fixtures preserve the existing
    // buyer's disabled-provider journey. Reject before acquiring its claim.
    check(
      effect.provider !== "stripe" ||
        effect.kind === "refund" ||
        effect.account_id === checkoutBuyer,
      "PROVIDER_DISABLED",
      "Stripe checkout is disabled in this browser fixture.",
      503,
    );
    return super.execute(actor, effectId);
  }
}
// Independent packed carrier fixture: no stock used by existing browser journeys.
const carrierBuyer = f.app.identity.createCustomer(
  f.actor,
  "carrier-browser-buyer",
  {
    name: "Synthetic carrier journey buyer",
    tier: "standard",
    creditLimit: 1000000,
  },
).id;
chooseProviders(f, f.actor, "carrier-browser-choice", {
  accountId: carrierBuyer,
  region: "CA",
  mode: "provider-exceptions",
  providers: ["ups"],
  version: 1,
  acknowledgment: "Synthetic named UPS acceptance",
});
const carrierProduct = f.app.catalog.create(
  f.actor,
  "carrier-browser-product",
  {
    sku: "CARRIER-BROWSER-1",
    name: "Synthetic carrier journey parcel",
    serialized: false,
    unitPrice: 2500,
    taxBasisPoints: 1300,
  },
).id;
const carrierPo = f.app.procurement.create(f.actor, "carrier-browser-po", {
  supplierId: f.supplier,
  warehouseId: f.w1,
  lines: [{ productId: carrierProduct, quantity: 2, unitCost: 1000 }],
}).id;
f.app.procurement.receive(f.actor, "carrier-browser-stock", {
  poId: carrierPo,
  lineId: String(
    f.app.procurement.orders(f.actor).find((p) => p.id === carrierPo)!.lines[0]!
      .id,
  ),
  deliveryRef: "SYNTHETIC-CARRIER-STOCK",
  quantity: 2,
  serials: [],
  bin: "CARRIER-1",
  quarantine: false,
});
const carrierOrder = accept(
  { ...f, buyer: carrierBuyer, product: carrierProduct },
  1,
  "carrier-browser-order",
);
const carrierPicks = f.app.fulfillment.picks(f.actor, carrierOrder.id);
for (const pick of carrierPicks)
  f.app.fulfillment.pick(f.actor, `carrier-browser-pick-${pick.id}`, {
    orderId: carrierOrder.id,
    allocationId: pick.id,
    serial: pick.serial,
  });
f.app.fulfillment.pack(f.actor, "carrier-browser-pack", {
  orderId: carrierOrder.id,
  revision: f.app.orders.order(f.actor, carrierOrder.id).revision,
  mode: "carrier",
  address:
    "Synthetic carrier destination, 2 Test Street, Ottawa ON K1A 0B1, CA",
  lines: carrierPicks.map((p) => ({
    allocationId: p.id,
    quantity: p.quantity,
  })),
});
f.app.identity.createUser(f.actor, "carrier-browser-reader", {
  email: "carrier-reader@example.test",
  name: "Synthetic carrier scoped reader",
  password: "long-test-only-password",
  role: "warehouse",
  sites: [f.w2],
});

// Independent US payment-history fixture; never enters the shared CA dashboard.
const paymentPages = fixture({ after: (fn) => cleanup.push(fn) }, {}, "US");
const paymentInvoice = ship(paymentPages, accept(paymentPages).id).invoiceId;
for (let i = 0; i < 43; i++)
  paymentPages.app.database.transaction(() =>
    paymentPages.app.billing.verifiedPayment(
      paymentPages.actor,
      paymentInvoice,
      1,
      "manual",
      `SYNTHETIC-USD-PAGE-${i}`,
    ),
  );
paymentPages.app.database
  .owned("billing")
  .run(
    "UPDATE billing_payments SET created_at='2026-10-01T00:00:00.000Z' WHERE org_id=?",
    paymentPages.actor.orgId,
  );
chooseProviders(paymentPages, paymentPages.actor, "payment-page-choice", {
  accountId: paymentPages.buyer,
  region: "US",
  mode: "provider-exceptions",
  providers: ["quickbooks"],
  version: 1,
  acknowledgment: "Synthetic named accounting choice",
});
const paymentParent = paymentPages.app.integration.accounting(
  paymentPages.actor,
  "payment-page-invoice",
  {
    invoiceId: paymentInvoice,
    customerRef: "synthetic-us-customer",
    itemRefs: { [paymentPages.product]: "synthetic-us-item" },
    taxCodeRef: "synthetic-tax",
    taxRateRef: "synthetic-rate",
  },
);
await paymentPages.app.integration.execute(
  paymentPages.actor,
  paymentParent.id,
  {
    execute: async () => ({
      reference: "invoice:synthetic-us-invoice",
      result: {},
    }),
    lookup: async () => null,
  },
);
paymentPages.app.identity.createUser(paymentPages.actor, "payment-page-buyer", {
  name: "Synthetic US buyer",
  email: "payment-pages-buyer@example.test",
  password: "long-test-only-password",
  role: "buyer",
  sites: [],
  accountId: paymentPages.buyer,
});
const paymentHttp = await createHttp(paymentPages.app, {
  origin: "http://127.0.0.1:3118",
});
await paymentHttp.listen({ host: "127.0.0.1", port: 3118 });

// Separate authorization fixture and synthetic fixed-endpoint transport. Browser
// navigation is intercepted in the journey; no Intuit account/network is used.
const authorizationFixture = fixture(
  { after: (fn) => cleanup.push(fn) },
  {
    providerEncryptionKey: "ac".repeat(32),
  },
);
chooseProviders(
  authorizationFixture,
  authorizationFixture.actor,
  "browser-oauth-choice",
  {
    accountId: authorizationFixture.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["quickbooks"],
    version: 1,
    acknowledgment: "Synthetic browser processing choice",
  },
);
globalThis.fetch = async (url, init) => {
  if (
    String(url) ===
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer" &&
    init?.method === "POST"
  )
    return Response.json({
      access_token: "synthetic-browser-access",
      refresh_token: "synthetic-browser-refresh",
      token_type: "bearer",
      expires_in: 3600,
      x_refresh_token_expires_in: 86400,
      x_refresh_token_hard_expires_in: 172800,
    });
  if (
    String(url) ===
    "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234"
  )
    return Response.json({ CompanyInfo: { Id: "1234" } });
  throw Error(
    "Browser fixture permits only synthetic authorization endpoints.",
  );
};
const authorizationOrigin = "http://127.0.0.1:3119";
const authorizationHttp = await createHttp(authorizationFixture.app, {
  origin: authorizationOrigin,
  quickbooksBrowser: new QuickBooksBrowser(
    authorizationFixture.app,
    {
      id: "synthetic-browser-authorization",
      orgId: authorizationFixture.actor.orgId,
      workerUserId: authorizationFixture.actor.id,
      accountId: authorizationFixture.buyer,
      realm: "1234",
      clientId: "synthetic-client",
      redirectUri: `${authorizationOrigin}/quickbooks/callback`,
    },
    "synthetic-browser-client-secret",
    authorizationOrigin,
  ),
});
await authorizationHttp.listen({ host: "127.0.0.1", port: 3119 });

// Independent, strictly synthetic warehouse fixture. Guarded writes deliberately
// lose their first replies; recovery observes the retained synthetic provider effect.
const cp = canadaPostSetup({ after: (fn) => cleanup.push(fn) }, 23);
const cpCreation = canadaPostCreation(),
  cpManifest = canadaPostManifest();
const lostMembers = new Set<string>();
let manifestLost = false;
const cpHttp = await createHttp(cp.app, {
  origin: "http://127.0.0.1:3120",
  carriers: new CarrierRuntime(
    cp.app,
    [],
    [
      {
        orgId: cp.actor.orgId,
        warehouseId: cp.w1,
        client: {
          testApplication: true,
          configurationHash: canadaPostHash,
          async create(intent, groupId, guard) {
            const observation = await cpCreation.create(intent, groupId, guard);
            if (!lostMembers.has(intent.bookingId)) {
              lostMembers.add(intent.bookingId);
              throw Error("Synthetic lost creation reply");
            }
            return observation;
          },
          lookup: cpCreation.lookup.bind(cpCreation),
          manifestIdentity: cpManifest.manifestIdentity.bind(cpManifest),
          async transmitManifest(input, guard) {
            const observation = await cpManifest.transmitManifest(input, guard);
            if (!manifestLost) {
              manifestLost = true;
              throw Error("Synthetic lost manifest reply");
            }
            return observation;
          },
          recoverManifest: cpManifest.recoverManifest.bind(cpManifest),
        },
      },
    ],
  ),
});
await cpHttp.listen({ host: "127.0.0.1", port: 3120 });
const replacementCarrierHttp = await replacementCarrierBrowser((fn) =>
  cleanup.push(fn),
);
const claimHttp = await claimBrowser((fn) => cleanup.push(fn));
const configurationHttp = await configurationBrowser((fn) => cleanup.push(fn));
const dhlHttp = await dhlBrowser((fn) => cleanup.push(fn));
const countPolicyHttp = await countPolicyBrowser((fn) => cleanup.push(fn));
const coveragePolicyHttp = await coveragePolicyBrowser((fn) =>
  cleanup.push(fn),
);

const shipmentCoverageHttp = await shipmentCoverageBrowser((fn) =>
  cleanup.push(fn),
);
const queueHttp = await claimQueueBrowser((fn) => cleanup.push(fn));
const orderQueueHttp = await orderQueueBrowser((fn) => cleanup.push(fn));
const purchaseQueueHttp = await purchaseQueueBrowser((fn) => cleanup.push(fn));
const reconciliationHttp = await reconciliationBrowser((fn) =>
  cleanup.push(fn),
);
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
  await paymentHttp.close();
  await authorizationHttp.close();
  await cpHttp.close();
  await claimHttp.close();
  await replacementCarrierHttp.close();
  await configurationHttp.close();
  await countPolicyHttp.close();
  await coveragePolicyHttp.close();
  await shipmentCoverageHttp.close();
  await queueHttp.close();
  await orderQueueHttp.close();
  await purchaseQueueHttp.close();
  await reconciliationHttp.close();
  for (const server of dhlHttp) await server.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
