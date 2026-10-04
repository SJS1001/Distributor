import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { IntegrationOfflineCheckoutReview } from "../src/server/integration-offline-checkout-review.ts";
import {
  compareOfflineCheckoutPaidEvidence as compare,
  isCapturedOfflineCheckoutComparison as captured,
  type OfflineCheckoutEvidenceInput,
} from "../src/server/integration-offline-checkout-evidence.ts";

async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  renew = false,
) {
  const f = fixture(t, {}, region, currency),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission only",
  });
  let effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  if (renew)
    effect = f.app.integration.renewCheckout(f.actor, "renew", {
      effectId: effect.id,
      reviewVersion: f.app.integration.checkouts.reviewVersion(
        f.app.integration.effect(f.actor, effect.id),
      ),
      amount: 11300,
      reason: "Synthetic reviewed replacement",
    });
  assert.equal(
    (
      await f.app.integration.execute(f.actor, effect.id, {
        execute: async () => {
          throw Error("Synthetic lost reply; no provider IO");
        },
        lookup: async () => null,
      })
    ).state,
    "unknown",
  );
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore(
      digest("synthetic-checkout-snapshot"),
      "2026-10-01T00:00:00.000Z",
    ),
  );
  const reader = new IntegrationOfflineCheckoutReview(
    f.app.database,
    f.app.identity,
    f.app.billing,
    f.app.integration.checkouts,
  );
  const input = f.app.database.transaction(() => {
    const candidate = reader.getInTransaction(f.actor, effect.id),
      candidateStore = f.app.database.captureRestoreCandidateInTransaction();
    const amount = candidate.invoice.total,
      currency = candidate.invoice.currency.toLowerCase() as "cad" | "usd",
      metadata = { effect_id: effect.id };
    return {
      version: 1,
      profile: "stripe-first-unknown-checkout-paid-v1",
      source: structuredClone(candidate),
      candidate,
      candidateStore,
      binding: {
        provider: "stripe",
        mode: "test",
        scope: "direct-account",
        orgId: f.actor.orgId,
        accountId: f.buyer,
        runtimeBindingId: "synthetic-runtime-binding",
        stripeAccountId: "acct_synthetic",
      },
      provider: {
        stripeAccountId: "acct_synthetic",
        session: {
          object: "checkout.session",
          id: "cs_test_synthetic",
          mode: "payment",
          livemode: false,
          status: "complete",
          payment_status: "paid",
          amount_total: amount,
          currency,
          expires_at: 1893456000,
          url: null,
          metadata,
          payment_intent: {
            object: "payment_intent",
            id: "pi_synthetic",
            status: "succeeded",
            livemode: false,
            amount,
            amount_received: amount,
            currency,
            metadata,
            on_behalf_of: null,
            transfer_data: null,
            application_fee_amount: null,
          },
        },
      },
    } satisfies OfflineCheckoutEvidenceInput;
  });
  return Object.assign(f, { input, effectId: effect.id, invoiceId });
}
function deepFrozen(v: unknown) {
  if (v !== null && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(deepFrozen);
  }
}
function rehash(v: any) {
  const { factsHash, ...body } = v;
  v.factsHash = digest(canonical(body));
}
const refusal =
  /Unsupported or inconsistent|requires another owning|exceeds the fixed/;
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`actual ${region}/${currency} first unknown evidence is frozen, deterministic historical consistency only`, async (t) => {
    const f = await setup(t, region, currency),
      input = structuredClone(f.input),
      r = compare(input);
    deepFrozen(r);
    assert.ok(captured(r));
    assert.equal(captured(structuredClone(r)), false);
    assert.deepEqual(compare(f.input), r);
    assert.equal(r.outcome.settlement.amount, f.input.candidate.invoice.total);
    const { hash, ...body } = r;
    assert.equal(hash, digest(canonical(body)));
    assert.equal(
      r.inputHash,
      digest(
        canonical({
          purpose: "distributor-offline-first-unknown-checkout-paid-input-v1",
          input,
        }),
      ),
    );
    input.provider.session.payment_intent.id = "pi_changed";
    assert.equal(r.outcome.settlement.paymentId, "pi_synthetic");
    assert.ok(
      r.requiredChecks.includes(
        "qualified-stripe-account-runtime-binding-and-provider-truth",
      ),
    );
    assert.ok(
      r.requiredChecks.includes(
        "billing-proposed-payment-reference-history-contract-required",
      ),
    );
    assert.equal("allowed" in r, false);
    assert.equal("input" in r, false);
  });

const mutations: Record<string, (v: any) => void> = {
  version: (v) => (v.version = 2),
  profile: (v) => (v.profile = "refund"),
  extra: (v) => (v.allowed = true),
  "source disagreement": (v) => (v.source.effects[0].error = "other"),
  "native digest": (v) => (v.candidate.factsHash = "0".repeat(64)),
  "candidate region": (v) => (v.candidateStore.region = "US"),
  "candidate organization": (v) =>
    (v.candidateStore.organizations[0].id = "foreign"),
  "candidate hash": (v) => (v.candidateStore.logicalHash = "bad"),
  "binding organization": (v) => (v.binding.orgId = "foreign"),
  "binding customer": (v) => (v.binding.accountId = "foreign"),
  "binding account": (v) => (v.provider.stripeAccountId = "acct_foreign"),
  "live binding": (v) => (v.binding.mode = "live"),
  "connected account": (v) => (v.binding.scope = "connect"),
  "runtime extra credential": (v) => (v.binding.secret = "sk_secret"),
  "session type": (v) => (v.provider.session.object = "payment_intent"),
  "session live": (v) => (v.provider.session.livemode = true),
  "session open": (v) => (v.provider.session.status = "open"),
  "session unpaid": (v) => (v.provider.session.payment_status = "unpaid"),
  "session amount": (v) => v.provider.session.amount_total--,
  "session currency": (v) => (v.provider.session.currency = "usd"),
  "session identity": (v) => (v.provider.session.id = "cs_live_bad"),
  "session effect": (v) => (v.provider.session.metadata.effect_id = "foreign"),
  "session secret": (v) => (v.provider.session.client_secret = "private"),
  "payment identity": (v) => (v.provider.session.payment_intent.id = "re_bad"),
  "payment pending": (v) =>
    (v.provider.session.payment_intent.status = "processing"),
  "payment live": (v) => (v.provider.session.payment_intent.livemode = true),
  "payment amount": (v) => v.provider.session.payment_intent.amount--,
  "payment received": (v) =>
    v.provider.session.payment_intent.amount_received--,
  "payment currency": (v) =>
    (v.provider.session.payment_intent.currency = "usd"),
  "payment effect": (v) =>
    (v.provider.session.payment_intent.metadata.effect_id = "other"),
  "payment connected account": (v) =>
    (v.provider.session.payment_intent.on_behalf_of = "acct_other"),
  "payment extra": (v) =>
    (v.provider.session.payment_intent.receipt_email = "private@example.test"),
  "unsafe amount": (v) =>
    (v.provider.session.amount_total = Number.MAX_SAFE_INTEGER + 1),
  "negative zero": (v) => (v.provider.session.expires_at = -0),
  NaN: (v) => (v.provider.session.expires_at = NaN),
  NUL: (v) => (v.binding.runtimeBindingId = "synthetic\0suffix"),
  surrogate: (v) => (v.binding.runtimeBindingId = "\ud800"),
  "oversize UTF8": (v) => (v.binding.runtimeBindingId = "€".repeat(30000)),
  "oversize ASCII": (v) => (v.binding.runtimeBindingId = "x".repeat(65537)),
  "deep object": (v) => {
    let o = v;
    for (let i = 0; i < 30; i++) o = o.deep = {};
  },
  "wide object": (v) => {
    for (let i = 0; i < 65; i++) v[`extra${i}`] = 0;
  },
  "array limit": (v) => (v.source.chain = Array(129).fill("x")),
  "NUL key": (v) => (v["bad\0key"] = 1),
  "surrogate key": (v) => (v["\ud800"] = 1),
  "key byte limit": (v) => (v["€".repeat(22)] = 1),
  cycle: (v) => (v.self = v),
  "nonempty callback profile": (v) => {
    v.candidate.collections.integration_callbacks = [{}];
    rehash(v.candidate);
    v.source = structuredClone(v.candidate);
  },
  "active lease profile": (v) => {
    v.candidate.collections.integration_operation_leases[0].token = "claim";
    rehash(v.candidate);
    v.source = structuredClone(v.candidate);
  },
  "different source candidate intent": (v) => {
    v.source.invoice.total--;
    rehash(v.source);
  },
  "changed current balance cannot replace original intent": (v) => {
    v.candidate.totals.paid = 1;
    v.candidate.totals.balance--;
    rehash(v.candidate);
    v.source = structuredClone(v.candidate);
  },
  "forged reduced original amount": (v) => {
    v.candidate.invoice.total--;
    v.candidate.totals.balance--;
    rehash(v.candidate);
    v.source = structuredClone(v.candidate);
  },
};
test("fixed source/provider/resource refusals", async (t) => {
  const f = await setup(t);
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, () => {
      const v = structuredClone(f.input);
      mutate(v);
      assert.throws(() => compare(v), refusal);
    });
});
test("proxy/accessor/function/thenable rejection never executes caller hooks", async (t) => {
  const f = await setup(t);
  let calls = 0;
  const hook = () => {
    calls++;
    throw Error("PRIVATE callback");
  };
  const proxy = new Proxy(
    {},
    {
      get: hook,
      ownKeys: hook,
      getPrototypeOf: hook,
      getOwnPropertyDescriptor: hook,
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const bad of [proxy, revoked.proxy]) {
    assert.throws(() => compare(bad), refusal);
    assert.equal(captured(bad), false);
  }
  for (const make of [
    (v: any) =>
      Object.defineProperty(v, "source", { get: hook, enumerable: true }),
    (v: any) =>
      (v.provider.session.metadata = new Proxy(
        {},
        { ownKeys: hook, getPrototypeOf: hook },
      )),
    (v: any) => (v.then = hook),
    (v: any) => (v.toJSON = hook),
    (v: any) => (v.extra = hook),
    (v: any) =>
      Object.setPrototypeOf(v, {
        get then() {
          return hook();
        },
      }),
  ]) {
    const v = structuredClone(f.input);
    make(v);
    assert.throws(() => compare(v), refusal);
  }
  assert.equal(calls, 0);
});
test("real native renewal history is retained and explicitly outside first-attempt profile", async (t) => {
  const f = await setup(t, "CA", "CAD", true);
  assert.equal(f.input.candidate.chain.length, 2);
  assert.equal(f.input.candidate.renewals.length, 1);
  assert.throws(() => compare(f.input), {
    code: "OFFLINE_CHECKOUT_EVIDENCE_PROFILE",
  });
});

test("multibyte and paired Unicode capture is exact; alternative inert binding claims do not qualify truth", async (t) => {
  const f = await setup(t),
    v = structuredClone(f.input);
  v.binding.runtimeBindingId = "synthetic-é-😀";
  const r = compare(v);
  assert.equal(r.binding.runtimeBindingId, v.binding.runtimeBindingId);
  assert.notEqual(r.inputHash, compare(f.input).inputHash);
  assert.deepEqual(r.requiredChecks, compare(f.input).requiredChecks);
  const claim = structuredClone(v) as any;
  claim.qualificationHash = "a".repeat(64);
  assert.throws(() => compare(claim), { code: "OFFLINE_CHECKOUT_EVIDENCE" });
  claim.signed = true;
  assert.throws(() => compare(claim), { code: "OFFLINE_CHECKOUT_EVIDENCE" });
});
test("aggregate capture, array descriptors and property descriptors are bounded before hashing", async (t) => {
  const f = await setup(t);
  for (const mutate of [
    (v: any) => {
      v.source.effects[0].error = "x".repeat(15000);
      v.candidate.effects[0].error = "x".repeat(15000);
    },
    (v: any) =>
      Object.defineProperty(v.source.chain, "0", {
        get() {
          throw Error("PRIVATE getter");
        },
      }),
    (v: any) => delete v.source.chain[0],
    (v: any) =>
      Object.defineProperty(v, "version", { value: 1, enumerable: false }),
    (v: any) => (v[Symbol("private")] = 1),
    (v: any) =>
      Object.defineProperty(v, "__proto__", { value: {}, enumerable: true }),
  ]) {
    const v = structuredClone(f.input);
    mutate(v);
    assert.throws(() => compare(v), refusal);
  }
});

test("selected replacement character is refused, including a deliberately valid literal U+FFFD", async (t) => {
  const f = await setup(t),
    v = structuredClone(f.input);
  v.binding.runtimeBindingId = "synthetic-\ufffd";
  assert.throws(() => compare(v), { code: "OFFLINE_CHECKOUT_EVIDENCE" });
});
