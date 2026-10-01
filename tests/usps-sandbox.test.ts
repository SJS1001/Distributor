import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { canonical, digest, DomainError } from "../src/server/core.ts";
import {
  UspsSandbox,
  type UspsSandboxConfig,
} from "../src/server/usps-sandbox.ts";
import { configuredCarriers } from "../src/server/carrier-config.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { CarrierIntent } from "../src/server/carrier-bookings.ts";
import type { CarrierPrepare } from "../src/shared/carrier-booking.ts";
const doc = await PDFDocument.create();
doc.addPage([288, 432]).drawText("Original synthetic USPS TEM fixture");
const pdf = Buffer.from(await doc.save()),
  tracking = "9405500000000000000001";
function setup(
  t: Parameters<typeof fixture>[0],
  configure?: (config: UspsSandboxConfig) => void,
) {
  const f = fixture(t, {}, "US"),
    orderId = accept(f).id;
  chooseProviders(f, f.actor, "usps-choice", {
    accountId: f.buyer,
    region: "US",
    mode: "provider-exceptions",
    providers: ["usps"],
    version: 1,
    acknowledgment: "Synthetic named USPS exception",
  });
  const picks = f.app.fulfillment.picks(f.actor, orderId);
  for (const p of picks)
    f.app.fulfillment.pick(f.actor, `usps-pick-${p.id}`, {
      orderId,
      allocationId: p.id,
      serial: p.serial,
    });
  const address = "Synthetic reviewed USPS destination";
  const shipmentId = f.app.fulfillment.pack(f.actor, "usps-pack", {
    orderId,
    revision: f.app.orders.order(f.actor, orderId).revision,
    mode: "carrier",
    address,
    lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
  }).id;
  const origin = {
    name: "Synthetic origin",
    line1: "10 Test Road",
    line2: "",
    city: "Buffalo",
    province: "NY",
    postalCode: "14201",
    country: "US" as const,
    phone: "+14165550100",
  };
  const input: CarrierPrepare = {
    shipmentId,
    previousId: null,
    provider: "usps",
    service: "Reviewed USPS ground",
    origin,
    destination: {
      ...origin,
      name: "Synthetic recipient",
      line1: "20 Test Road",
    },
    parcel: { weightGrams: 1234, lengthMm: 303, widthMm: 202, heightMm: 101 },
    reviewedDestination: address,
    acknowledgment: "Synthetic ordinary parcel and address review",
  };
  const config: UspsSandboxConfig = {
    orgId: f.actor.orgId,
    clientId: "synthetic-usps-client",
    clientSecret: "synthetic-usps-secret",
    crid: "12345678",
    mid: "123456",
    manifestMid: "123456",
    epsAccount: "1234",
    mailingDate: "2026-10-01",
    services: [
      {
        service: input.service,
        code: "USPS_GROUND_ADVANTAGE",
        processingCategory: "NONSTANDARD",
      },
    ],
  };
  configure?.(config);
  const configuration = new UspsSandbox(config).configuration;
  input.configurationHash = configuration.hash;
  const prepared = f.app.carriers.prepare(
    f.actor,
    "usps-prepare",
    input,
    configuration,
  );
  const intent = JSON.parse(
    f.app.database
      .owned("integration")
      .get<{ intent: string }>(
        "SELECT intent FROM integration_carrier_bookings WHERE id=?",
        prepared.id,
      )!.intent,
  ) as CarrierIntent;
  return Object.assign(f, {
    orderId,
    shipmentId,
    input,
    prepared,
    intent,
    config,
  });
}
type F = ReturnType<typeof setup>;
function native(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    order: f.app.orders.order(f.actor, f.orderId),
    invoices: f.app.billing.invoices(f.actor),
    shipment: f.app.fulfillment.shipment(f.actor, f.shipmentId),
  };
}
function revise(intent: CarrierIntent, change: Partial<CarrierIntent>) {
  const { bookingId, reviewHash: _old, ...review } = { ...intent, ...change };
  return { ...review, bookingId, reviewHash: digest(canonical(review)) };
}
function environment(config: UspsSandboxConfig): NodeJS.ProcessEnv {
  return {
    CARRIERS_ENABLED: "true",
    USPS_TEM_ENABLED: "true",
    USPS_TEM_CREDENTIALS_ACK: "tem-only",
    CARRIER_ORG_ID: config.orgId,
    USPS_CLIENT_ID: config.clientId,
    USPS_CLIENT_SECRET: config.clientSecret,
    USPS_CRID: config.crid,
    USPS_MID: config.mid,
    USPS_MANIFEST_MID: config.manifestMid,
    USPS_EPS_ACCOUNT: config.epsAccount,
    USPS_MAILING_DATE: config.mailingDate,
    USPS_SERVICES_JSON: JSON.stringify(config.services),
  };
}
function multipart(
  body: Record<string, unknown>,
  encoded = pdf.toString("base64"),
  disposition = 'attachment; filename="label-image.pdf"',
) {
  return `--local-usps\r\nContent-Disposition: form-data; name="labelMetadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n--local-usps\r\nContent-Disposition: ${disposition}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}\r\n--local-usps--\r\n`;
}
function metadata() {
  return {
    trackingNumber: tracking,
    labelAddress: {
      streetAddress: "20 TEST ROAD",
      secondaryAddress: "",
      city: "BUFFALO",
      state: "NY",
      ZIPCode: "14201",
    },
  };
}
type Call = { url: string; init: RequestInit; body: Record<string, any> };
function simulator(
  replace?: (call: Call) => Response | Promise<Response> | undefined,
) {
  const calls: Call[] = [];
  const transport: typeof fetch = async (url, init) => {
    const call = {
      url: String(url),
      init: init!,
      body: JSON.parse(String(init!.body)),
    };
    calls.push(call);
    const replacement = await replace?.(call);
    if (replacement) return replacement;
    if (call.url.endsWith("/token"))
      return Response.json({
        token_type: "Bearer",
        access_token: "synthetic.oauth",
        expires_in: "28800",
      });
    if (call.url.endsWith("/payment-authorization"))
      return Response.json({
        paymentAuthorizationToken: "synthetic.payment.token",
        roles: call.body.roles,
      });
    return new Response(multipart(metadata()), {
      headers: { "content-type": "multipart/form-data; boundary=local-usps" },
    });
  };
  return { calls, transport };
}
test("USPS TEM startup is disabled, performs no I/O and captures exact configuration", async (t) => {
  const f = setup(t),
    sim = simulator();
  assert.equal(configuredCarriers(f.app, {}, sim.transport), undefined);
  const env = environment(f.config),
    runtime = configuredCarriers(f.app, env, sim.transport)!;
  assert.equal(sim.calls.length, 0);
  env.USPS_EPS_ACCOUNT = "changed";
  const before = native(f);
  const result = await runtime.execute(f.actor, f.prepared.id);
  assert.equal(result.state, "booked");
  assert.deepEqual(native(f), before);
  assert.deepEqual(f.app.carriers.label(f.actor, f.prepared.id).bytes, pdf);
  assert.equal(sim.calls.length, 3);
  const [auth, payment, label] = sim.calls;
  assert.equal(auth!.url, "https://apis-tem.usps.com/oauth2/v3/token");
  assert.deepEqual(auth!.body, {
    grant_type: "client_credentials",
    client_id: f.config.clientId,
    client_secret: f.config.clientSecret,
  });
  assert.equal(payment!.body.roles[0].accountNumber, "1234");
  assert.equal(payment!.body.roles[1].roleName, "LABEL_OWNER");
  assert.equal(label!.init.redirect, "error");
  assert.ok(label!.init.signal);
  const headers = new Headers(label!.init.headers);
  assert.equal(headers.get("accept"), "multipart/form-data");
  assert.equal(
    new Headers(auth!.init.headers).get("accept"),
    "application/json",
  );
  assert.equal(headers.get("x-idempotency-key"), f.prepared.id);
  assert.equal(
    headers.get("x-payment-authorization-token"),
    "synthetic.payment.token",
  );
  assert.equal(label!.body.fromAddress.firm, f.input.origin.name);
  assert.equal(
    label!.body.packageDescription.customerReference[0].referenceNumber.length,
    30,
  );
  assert.deepEqual(label!.body.imageInfo, {
    imageType: "PDF",
    labelType: "4X6LABEL",
    receiptOption: "NONE",
    returnLabel: false,
  });
  const p = label!.body.packageDescription;
  assert.equal(p.weight, 2.73);
  assert.equal(p.length, 11.93);
  assert.equal(p.width, 7.96);
  assert.equal(p.height, 3.98);
  assert.equal(p.mailingDate, "2026-10-01");
  assert.deepEqual(p.extraServices, []);
  await assert.rejects(() => runtime.execute(f.actor, f.prepared.id), {
    code: "STATE",
  });
  assert.equal(sim.calls.length, 3);
});
for (const [name, change] of [
  ["bad CRID", { crid: "abc" }],
  ["coerced MID", { mid: 123456 }],
  ["bad manifest MID", { manifestMid: "12345" }],
  ["missing EPS", { epsAccount: "" }],
  ["invalid day", { mailingDate: "2026-02-30" }],
  ["empty services", { services: [] }],
  ["sparse services", { services: new Array(1) }],
  [
    "deprecated service",
    {
      services: [
        {
          service: "Reviewed USPS ground",
          code: "FIRST-CLASS_PACKAGE_SERVICE",
          processingCategory: "NONSTANDARD",
        },
      ],
    },
  ],
] as [string, Record<string, unknown>][])
  test(`USPS TEM rejects ${name} before I/O`, (t) => {
    const f = setup(t),
      sim = simulator();
    assert.throws(
      () =>
        new UspsSandbox(
          { ...f.config, ...change } as UspsSandboxConfig,
          sim.transport,
        ),
      { code: "CARRIER_CONFIG" },
    );
    assert.equal(sim.calls.length, 0);
  });
for (const [name, change] of [
  ["Canadian address", { destination: { country: "CA" } }],
  ["military address", { destination: { province: "AE" } }],
  ["unmapped service", { service: "other" }],
  ["overweight", { parcel: { weightGrams: 31752 } }],
  ["oversize", { parcel: { lengthMm: 3000 } }],
  ["undersize", { parcel: { heightMm: 1 } }],
  ["fractional weight", { parcel: { weightGrams: 1.1 } }],
] as [string, any][])
  test(`USPS TEM refuses ${name} before authentication`, async (t) => {
    const f = setup(t),
      sim = simulator();
    const patch = {
      ...change,
      ...(change.destination
        ? { destination: { ...f.intent.destination, ...change.destination } }
        : {}),
      ...(change.parcel
        ? { parcel: { ...f.intent.parcel, ...change.parcel } }
        : {}),
    };
    await assert.rejects(
      () =>
        new UspsSandbox(f.config, sim.transport).book(
          revise(f.intent, patch),
          () => {},
        ),
      { code: "CARRIER_UNSUPPORTED" },
    );
    assert.equal(sim.calls.length, 0);
  });
test("USPS TEM captures intent/configuration and runs guard once immediately before sole label write", async (t) => {
  const f = setup(t);
  const original = structuredClone(f.intent);
  let guards = 0;
  const sim = simulator((call) => {
    if (call.url.endsWith("/token")) {
      f.intent.destination.line1 = "Unreviewed later mutation";
      f.config.services[0]!.code = "PRIORITY_MAIL";
    }
    if (call.url.endsWith("/label")) assert.equal(guards, 1);
    return undefined;
  });
  const client = new UspsSandbox(f.config, sim.transport);
  const result = await client.book(f.intent, () => {
    assert.equal(sim.calls.length, 2);
    guards++;
  });
  assert.equal(guards, 1);
  assert.equal(result.reviewHash, original.reviewHash);
  assert.equal(
    sim.calls[2]!.body.toAddress.streetAddress,
    original.destination.line1,
  );
  assert.equal(
    sim.calls[2]!.body.packageDescription.mailClass,
    "USPS_GROUND_ADVANTAGE",
  );
});
test("USPS TEM native guard refusal is preserved and no label is purchased", async (t) => {
  const f = setup(t),
    sim = simulator();
  await assert.rejects(
    () =>
      new UspsSandbox(f.config, sim.transport).book(f.intent, () => {
        throw new DomainError("CHOICE_WITHDRAWN", "Synthetic refusal");
      }),
    { code: "CHOICE_WITHDRAWN" },
  );
  assert.equal(sim.calls.length, 2);
});
test("USPS TEM lost response stays unknown; neither send replay nor lookup repurchases or consumes a reprint", async (t) => {
  const f = setup(t),
    before = native(f),
    sim = simulator((call) => {
      if (call.url.endsWith("/label"))
        throw new Error("synthetic-usps-secret synthetic.payment.token");
      return undefined;
    }),
    client = new UspsSandbox(f.config, sim.transport);
  await assert.rejects(
    () => f.app.carriers.execute(f.actor, f.prepared.id, client),
    (error) => {
      assert.equal((error as DomainError).code, "CARRIER_TRANSPORT");
      assert.doesNotMatch(String(error), /synthetic/);
      return true;
    },
  );
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  await assert.rejects(
    () => f.app.carriers.execute(f.actor, f.prepared.id, client),
    { code: "STATE" },
  );
  await assert.rejects(
    () => f.app.carriers.reconcile(f.actor, f.prepared.id, client),
    { code: "CARRIER_RECOVERY_UNSUPPORTED" },
  );
  assert.equal(sim.calls.length, 3);
  assert.deepEqual(native(f), before);
  f.app.close();
  f.app = new Application(f.path, "US");
  const restarted = configuredCarriers(
    f.app,
    environment(f.config),
    sim.transport,
  )!;
  await assert.rejects(() => restarted.execute(f.actor, f.prepared.id), {
    code: "STATE",
  });
  await assert.rejects(() => restarted.reconcile(f.actor, f.prepared.id), {
    code: "CARRIER_RECOVERY_UNSUPPORTED",
  });
  assert.throws(
    () =>
      f.app.carriers.cancel(f.actor, "usps-cancel-unknown", {
        bookingId: f.prepared.id,
        reviewHash: f.prepared.reviewHash,
        reason: "Uncertain purchase",
      }),
    { code: "STATE" },
  );
  assert.throws(
    () =>
      restarted.prepare(f.actor, "usps-replace-unknown", {
        ...f.input,
        previousId: f.prepared.id,
      }),
    { code: "CARRIER_BOOKING_ACTIVE" },
  );
  assert.throws(() =>
    f.app.fulfillment.commit(f.actor, "usps-unknown-handover", {
      shipmentId: f.shipmentId,
      carrier: "usps",
      tracking,
      handoverEvidence: "Unconfirmed label must block handover",
    }),
  );
  assert.deepEqual(native(f), before);
  assert.equal(sim.calls.length, 3);
});
for (const [name, response] of [
  [
    "wrong recipient",
    () =>
      new Response(
        multipart({
          ...metadata(),
          labelAddress: {
            ...metadata().labelAddress,
            firm: "Different recipient",
          },
        }),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        },
      ),
  ],
  [
    "wrong destination",
    () =>
      new Response(
        multipart({
          ...metadata(),
          labelAddress: { ...metadata().labelAddress, ZIPCode: "00000" },
        }),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        },
      ),
  ],
  [
    "bad tracking",
    () =>
      new Response(
        multipart({ ...metadata(), trackingNumber: "private-url" }),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        },
      ),
  ],
  [
    "duplicate metadata",
    () =>
      new Response(
        multipart(metadata()).replace(
          'attachment; filename="label-image.pdf"',
          'form-data; name="labelMetadata"',
        ),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        },
      ),
  ],
  [
    "truncated MIME",
    () =>
      new Response(multipart(metadata()).slice(0, -20), {
        headers: { "content-type": "multipart/form-data; boundary=local-usps" },
      }),
  ],
  [
    "wrong PDF",
    () =>
      new Response(
        multipart(metadata(), Buffer.from("not a PDF").toString("base64")),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        },
      ),
  ],
  [
    "external label URL",
    () =>
      new Response(
        multipart(metadata(), "https://example.invalid/private.pdf"),
        {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        },
      ),
  ],
  [
    "unexpected JSON",
    () => Response.json({ labelImage: pdf.toString("base64"), ...metadata() }),
  ],
  ["redirect", () => new Response("secret", { status: 302 })],
  [
    "oversized length",
    () => new Response("secret", { headers: { "content-length": "2097153" } }),
  ],
  [
    "oversized stream",
    () =>
      new Response(Buffer.alloc(2097153), {
        headers: { "content-type": "multipart/form-data; boundary=local-usps" },
      }),
  ],
] as [string, () => Response][])
  test(`USPS TEM rejects ${name} without native changes or another purchase`, async (t) => {
    const f = setup(t),
      before = native(f),
      sim = simulator((call) =>
        call.url.endsWith("/label") ? response() : undefined,
      );
    await assert.rejects(() =>
      f.app.carriers.execute(
        f.actor,
        f.prepared.id,
        new UspsSandbox(f.config, sim.transport),
      ),
    );
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
    assert.deepEqual(native(f), before);
    assert.equal(sim.calls.length, 3);
    assert.throws(() => f.app.carriers.label(f.actor, f.prepared.id));
  });
for (const [name, change] of [
  ["missing TEM acknowledgment", { USPS_TEM_CREDENTIALS_ACK: undefined }],
  [
    "untrusted fields",
    {
      USPS_SERVICES_JSON:
        '[{"service":"x","code":"PRIORITY_MAIL","processingCategory":"NONSTANDARD","endpoint":"production"}]',
    },
  ],
  ["invalid switch", { USPS_TEM_ENABLED: "yes" }],
] as [string, NodeJS.ProcessEnv][])
  test(`USPS startup rejects ${name}`, (t) => {
    const f = setup(t),
      sim = simulator();
    assert.throws(
      () =>
        configuredCarriers(
          f.app,
          { ...environment(f.config), ...change },
          sim.transport,
        ),
      { code: "CARRIER_CONFIG" },
    );
    assert.equal(sim.calls.length, 0);
  });

for (const name of [
  "missing roles",
  "wrong payer",
  "wrong MID",
  "wrong owner",
  "duplicate payer",
  "missing owner",
  "insufficient funds",
  "unknown role",
])
  test(`USPS refuses payment authorization with ${name} before the label write`, async (t) => {
    const f = setup(t),
      before = native(f);
    const sim = simulator((call) => {
      if (!call.url.endsWith("/payment-authorization")) return undefined;
      const roles = structuredClone(call.body.roles);
      if (name === "wrong payer") roles[0].accountNumber = "9876";
      if (name === "wrong MID") roles[0].MID = "987654";
      if (name === "wrong owner") roles[1].CRID = "98765432";
      if (name === "duplicate payer") roles.push(roles[0]);
      if (name === "missing owner") roles.pop();
      if (name === "insufficient funds") roles[0].sufficientFunds = false;
      if (name === "unknown role") roles.push({ roleName: "UNDOCUMENTED" });
      return Response.json({
        paymentAuthorizationToken: "synthetic.payment.token",
        ...(name === "missing roles" ? {} : { roles }),
      });
    });
    await assert.rejects(
      () =>
        configuredCarriers(
          f.app,
          environment(f.config),
          sim.transport,
        )!.execute(f.actor, f.prepared.id),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 2);
    assert.deepEqual(native(f), before);
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
  });

test("USPS accepts documented extra payment parties, mapped priority and folded form-data PDF", async (t) => {
  const f = setup(t, (config) => {
    config.services[0]!.code = "PRIORITY_MAIL";
    config.services[0]!.processingCategory = "MACHINABLE";
  });
  const sim = simulator((call) => {
    if (call.url.endsWith("/payment-authorization"))
      return Response.json({
        paymentAuthorizationToken: "synthetic.payment.token",
        roles: [
          ...call.body.roles,
          {
            roleName: "RATE_HOLDER",
            CRID: f.config.crid,
            accountType: "EPS",
            accountNumber: f.config.epsAccount,
          },
        ],
      });
    if (call.url.endsWith("/label"))
      return new Response(
        multipart(
          metadata(),
          pdf
            .toString("base64")
            .match(/.{1,76}/g)!
            .join("\r\n"),
          'form-data; name="labelImage"; filename="inline.pdf"',
        ),
        {
          headers: {
            "content-type": 'multipart/form-data; boundary="local-usps"',
            "x-idempotency-key": f.prepared.id,
          },
        },
      );
    return undefined;
  });
  assert.equal(
    (
      await configuredCarriers(
        f.app,
        environment(f.config),
        sim.transport,
      )!.execute(f.actor, f.prepared.id)
    ).state,
    "booked",
  );
  assert.equal(
    sim.calls[2]!.body.packageDescription.mailClass,
    "PRIORITY_MAIL",
  );
  assert.equal(
    sim.calls[2]!.body.packageDescription.processingCategory,
    "MACHINABLE",
  );
  assert.deepEqual(f.app.carriers.label(f.actor, f.prepared.id).bytes, pdf);
});

test("USPS current customer withdrawal during authorization prevents label purchase", async (t) => {
  const f = setup(t),
    before = native(f);
  const sim = simulator((call) => {
    if (call.url.endsWith("/payment-authorization"))
      chooseProviders(f, f.actor, "usps-withdraw", {
        accountId: f.buyer,
        region: "US",
        mode: "strict",
        providers: [],
        version: 2,
        acknowledgment: "Synthetic withdrawal before label purchase",
      });
    return undefined;
  });
  await assert.rejects(() =>
    configuredCarriers(f.app, environment(f.config), sim.transport)!.execute(
      f.actor,
      f.prepared.id,
    ),
  );
  assert.equal(sim.calls.length, 2);
  assert.equal(
    f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
    "unknown",
  );
  assert.deepEqual(native(f), before);
});

for (const name of [
  "bad expiry",
  "header injection",
  "invalid UTF8",
  "wrong authorization MIME",
])
  test(`USPS rejects OAuth ${name} without payment or label requests`, async (t) => {
    const f = setup(t);
    const sim = simulator((call) => {
      if (!call.url.endsWith("/token")) return undefined;
      if (name === "invalid UTF8")
        return new Response(Buffer.from([0xff]), {
          headers: { "content-type": "application/json" },
        });
      if (name === "wrong authorization MIME")
        return new Response("{}", { headers: { "content-type": "text/html" } });
      return Response.json({
        token_type: "Bearer",
        expires_in: name === "bad expiry" ? "30" : 28800,
        access_token:
          name === "header injection"
            ? "secret\r\nInjected: secret"
            : "synthetic.oauth",
      });
    });
    await assert.rejects(
      () =>
        configuredCarriers(
          f.app,
          environment(f.config),
          sim.transport,
        )!.execute(f.actor, f.prepared.id),
      { code: "CARRIER_RESULT" },
    );
    assert.equal(sim.calls.length, 1);
  });

for (const name of [
  "wrong correlation key",
  "extra MIME part",
  "duplicate MIME header",
  "invalid base64 padding",
  "wrong response length",
])
  test(`USPS refuses ${name} after its sole send`, async (t) => {
    const f = setup(t),
      before = native(f);
    const sim = simulator((call) => {
      if (!call.url.endsWith("/label")) return undefined;
      let body = multipart(metadata());
      const headers: Record<string, string> = {
        "content-type": "multipart/form-data; boundary=local-usps",
      };
      if (name === "wrong correlation key")
        headers["x-idempotency-key"] = "different-booking";
      if (name === "extra MIME part")
        body = body.replace(
          "--local-usps--\r\n",
          "--local-usps\r\nContent-Type: text/plain\r\n\r\nextra\r\n--local-usps--\r\n",
        );
      if (name === "duplicate MIME header")
        body = body.replace(
          "Content-Type: application/pdf",
          "Content-Type: application/pdf\r\ncontent-type: text/html",
        );
      if (name === "invalid base64 padding")
        body = multipart(metadata(), "JVBERi0xLjQ=Z");
      if (name === "wrong response length")
        headers["content-length"] = String(Buffer.byteLength(body) + 1);
      return new Response(body, { headers });
    });
    await assert.rejects(() =>
      configuredCarriers(f.app, environment(f.config), sim.transport)!.execute(
        f.actor,
        f.prepared.id,
      ),
    );
    assert.equal(sim.calls.length, 3);
    assert.deepEqual(native(f), before);
    assert.equal(
      f.app.carriers.review(f.actor, f.shipmentId).booking!.state,
      "unknown",
    );
  });

test("Configured USPS HTTP booking retains authenticated private PDF bytes and refuses overrides/replay", async (t) => {
  const f = setup(t),
    sim = simulator(),
    before = native(f);
  const http = await createHttp(f.app, {
    origin: "http://localhost:3100",
    staticRoot: "/nonexistent-usps-test",
    carriers: configuredCarriers(f.app, environment(f.config), sim.transport),
  });
  t.after(async () => {
    await http.close();
  });
  const login = f.app.identity.login(
      "admin@example.test",
      "long-test-only-password",
    ),
    headers = {
      cookie: `distributor_session=${login.token}`,
      origin: "http://localhost:3100",
      "x-csrf-token": login.csrf,
    },
    send = `/api/carrier/${f.prepared.id}/send`,
    label = `/api/carrier/${f.prepared.id}/label`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: send,
        headers,
        payload: { provider: "ups" },
      })
    ).statusCode,
    400,
  );
  assert.equal(sim.calls.length, 0);
  assert.equal(
    (await http.inject({ method: "POST", url: send, headers, payload: {} }))
      .statusCode,
    200,
  );
  const response = await http.inject({ method: "GET", url: label, headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.rawPayload, pdf);
  assert.equal((await PDFDocument.load(response.rawPayload)).getPageCount(), 1);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-document-sha256"], digest(pdf));
  assert.equal(response.headers["x-label-media-type"], "application/pdf");
  assert.equal(
    (await http.inject({ method: "GET", url: label })).statusCode,
    401,
  );
  assert.notEqual(
    (await http.inject({ method: "POST", url: send, headers, payload: {} }))
      .statusCode,
    200,
  );
  assert.equal(sim.calls.length, 3);
  assert.deepEqual(native(f), before);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  assert.equal(
    (await http.inject({ method: "GET", url: label, headers })).statusCode,
    401,
  );
});

test("USPS accepts its maximum inline PDF bound without recursive base64 matching", async (t) => {
  const f = setup(t),
    large = Buffer.concat([pdf, Buffer.alloc(1_048_576 - pdf.length, 32)]);
  assert.equal((await PDFDocument.load(large)).getPageCount(), 1);
  const sim = simulator((call) =>
    call.url.endsWith("/label")
      ? new Response(multipart(metadata(), large.toString("base64")), {
          headers: {
            "content-type": "multipart/form-data; boundary=local-usps",
          },
        })
      : undefined,
  );
  await configuredCarriers(
    f.app,
    environment(f.config),
    sim.transport,
  )!.execute(f.actor, f.prepared.id);
  assert.deepEqual(f.app.carriers.label(f.actor, f.prepared.id).bytes, large);
});

test("USPS cancels an oversized body stream and does not retain bytes or secrets", async (t) => {
  const f = setup(t),
    before = native(f);
  let canceled = false;
  const sim = simulator((call) =>
    call.url.endsWith("/label")
      ? new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(2_097_153));
            },
            cancel() {
              canceled = true;
            },
          }),
          {
            headers: {
              "content-type": "multipart/form-data; boundary=local-usps",
            },
          },
        )
      : undefined,
  );
  await assert.rejects(
    () =>
      configuredCarriers(f.app, environment(f.config), sim.transport)!.execute(
        f.actor,
        f.prepared.id,
      ),
    { code: "CARRIER_TRANSPORT" },
  );
  assert.equal(canceled, true);
  assert.deepEqual(native(f), before);
  assert.throws(() => f.app.carriers.label(f.actor, f.prepared.id));
});
