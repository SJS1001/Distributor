import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import {
  createDemoGateway,
  type DemoGatewayOptions,
} from "../src/demo/gateway.ts";
import type { DemoInstance } from "../src/demo/runtime.ts";

const origin = "http://127.0.0.1:3100";
const options = { origin, staticRoot: "/nonexistent-distributor-demo-test" };
type Gateway = Awaited<ReturnType<typeof createDemoGateway>>;
class Browser {
  cookies = new Map<string, string>();
  csrf = "";
  constructor(readonly http: Gateway) {}
  get cookie() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
  async request(
    url: string,
    payload?: object,
    extra: Record<string, string> = {},
  ) {
    const response = await this.http.inject({
      method: payload ? "POST" : "GET",
      url,
      headers: {
        origin,
        cookie: this.cookie,
        "x-demo-csrf": this.csrf,
        ...extra,
      },
      ...(payload ? { payload } : {}),
    });
    for (const c of response.cookies) {
      if (c.maxAge === 0 || c.value === "") this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return response;
  }
  async start(region: "CA" | "US" = "CA") {
    this.csrf = (await this.request("/demo/api/status")).json().csrf;
    const started = await this.request("/demo/api/start", {
      companyName: `Fictional ${region}`,
      region,
    });
    assert.equal(started.statusCode, 200, started.body);
    const status = (await this.request("/demo/api/status")).json();
    this.csrf = status.csrf;
    return status;
  }
  async login() {
    const login = await this.request("/demo/api/role", { role: "admin" });
    assert.equal(login.statusCode, 200, login.body);
    return login.json().csrf as string;
  }
}
async function gateway(
  t: { after(fn: () => Promise<void>): void },
  extra: Partial<DemoGatewayOptions> = {},
) {
  const http = await createDemoGateway({ ...options, ...extra });
  t.after(() => http.close());
  return http;
}

test("native demo isolates two databases, native auth, mutations and credential replay", async (t) => {
  const http = await gateway(t);
  const a = new Browser(http),
    b = new Browser(http);
  const first = await a.start("CA"),
    second = await b.start("US");
  assert.notEqual(first.accounts[0].password, second.accounts[0].password);
  const acsrf = await a.login();
  const bcsrf = await b.login();
  assert.notEqual(acsrf, bcsrf);
  const sessionCookie = a.cookies.get("distributor_session")!;
  const replay = await http.inject({
    url: "/api/session",
    headers: {
      cookie: `distributor_demo=${b.cookies.get("distributor_demo")}; distributor_session=${sessionCookie}`,
    },
  });
  assert.equal(replay.statusCode, 401);
  const wrongPassword = await b.request("/api/login", {
    email: first.accounts[0].email,
    password: first.accounts[0].password,
  });
  assert.equal(wrongPassword.statusCode, 401);
  const created = await a.request(
    "/api/commands/product.create",
    {
      sku: "VISITOR-A-ONLY",
      name: "Visitor A private fictional SKU",
      serialized: false,
      unitPrice: 12300,
      taxBasisPoints: 1300,
    },
    { "x-csrf-token": acsrf, "idempotency-key": "visitor-a-product" },
  );
  assert.equal(created.statusCode, 200, created.body);
  const adash = await a.request("/api/dashboard"),
    bdash = await b.request("/api/dashboard");
  assert.match(adash.body, /VISITOR-A-ONLY/);
  for (const warehouse of adash.json().warehouses) {
    const candidates = await a.request(
      `/api/warehouses/${warehouse.id}/canada-post/candidates`,
    );
    assert.equal(candidates.statusCode, 200, candidates.body);
    assert.equal(candidates.json().enabled, true);
  }
  assert.doesNotMatch(bdash.body, /VISITOR-A-ONLY/);
  assert.equal((await a.request("/api/health")).json().region, "CA");
  assert.equal((await b.request("/api/health")).json().region, "US");
  const csv = await a.request("/api/billing/aging.csv");
  assert.equal(csv.statusCode, 200, csv.body);
  assert.match(String(csv.headers["content-type"]), /text\/csv/);
  assert.match(
    String(csv.headers["content-disposition"]),
    /distributor-aging.csv/,
  );
  assert.ok(csv.rawPayload.length > 0);
  const pdf = await a.request(
    `/api/billing/documents/invoice/${adash.json().invoices[0].id}/pdf`,
    {},
    { "x-csrf-token": acsrf, "idempotency-key": "native-demo-pdf" },
  );
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
  assert.equal(
    createHash("sha256").update(pdf.rawPayload).digest("hex"),
    pdf.headers["x-document-sha256"],
  );
  const evidenceBytes = Buffer.alloc(300 * 1024, 65);
  const claimId = adash.json().claims[0].id;
  const evidence = await a.request(
    `/api/warranty/claims/${claimId}/evidence`,
    {
      filename: "fictional-evidence.txt",
      mediaType: "text/plain",
      audience: "staff",
      description: "Fictional native demo upload",
      contentBase64: evidenceBytes.toString("base64"),
    },
    { "x-csrf-token": acsrf, "idempotency-key": "native-demo-evidence" },
  );
  assert.equal(evidence.statusCode, 200, evidence.body);
  const downloaded = await a.request(
    `/api/warranty/claims/${claimId}/evidence/${evidence.json().id}/download`,
    {},
    {
      "x-csrf-token": acsrf,
      "idempotency-key": "native-demo-evidence-download",
    },
  );
  assert.equal(downloaded.statusCode, 200, downloaded.body);
  assert.deepEqual(downloaded.rawPayload, evidenceBytes);
  const apiCsrf = await a.request(
    "/api/commands/warehouse.create",
    { name: "blocked" },
    { "idempotency-key": "csrf-test" },
  );
  assert.equal(apiCsrf.statusCode, 403);
  assert.equal(apiCsrf.json().code, "CSRF");
  assert.equal((await a.request("/api/nonexistent")).statusCode, 404);
});

test("onboarding and reset require exact same-origin CSRF; foreign selector cannot reset", async (t) => {
  const http = await gateway(t);
  const browser = new Browser(http);
  browser.csrf = (await browser.request("/demo/api/status")).json().csrf;
  const payload = { companyName: "Fictional", region: "CA" };
  assert.equal(
    (
      await browser.request("/demo/api/start", payload, {
        origin: "https://elsewhere.test",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await browser.request("/demo/api/start", payload, {
        "x-demo-csrf": "a".repeat(64),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await browser.request("/demo/api/start", { ...payload, region: "GB" }))
      .statusCode,
    400,
  );
  await browser.start();
  const selector = browser.cookies.get("distributor_demo")!;
  const status = await browser.request("/demo/api/status");
  assert.equal(status.headers["cache-control"], "no-store");
  assert.equal(
    (
      await browser.request(
        "/demo/api/reset",
        {},
        { origin: "https://elsewhere.test" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await browser.request(
        "/demo/api/reset",
        {},
        { "x-demo-csrf": "é".repeat(64) },
      )
    ).statusCode,
    403,
  );
  assert.equal((await browser.request("/demo/api/reset", {})).statusCode, 200);
  assert.equal(
    (
      await http.inject({
        url: "/api/session",
        headers: { cookie: `distributor_demo=${selector}` },
      })
    ).statusCode,
    410,
  );
  assert.equal(
    (await browser.request("/demo/api/status")).json().active,
    false,
  );
});

async function fakeInstance(): Promise<DemoInstance> {
  const http = Fastify();
  http.get("/bytes", async (_request, reply) =>
    reply
      .code(206)
      .header("cache-control", "public, max-age=3600")
      .header("referrer-policy", "unsafe-url")
      .header("content-disposition", 'attachment; filename="demo.bin"')
      .header("set-cookie", ["one=1; HttpOnly", "two=2; HttpOnly"])
      .type("application/octet-stream")
      .send(Buffer.from([0, 255, 128, 13, 10])),
  );
  http.removeAllContentTypeParsers();
  http.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (_request, value, done) => done(null, value),
  );
  http.post("/echo", async (request, reply) =>
    reply.type("application/octet-stream").send(request.body),
  );
  return { http, accounts: [], close: () => http.close() };
}
test("native demo wiring settles a queued fictional checkout through the worker", async (t) => {
  const http = await gateway(t);
  const browser = new Browser(http);
  await browser.start();
  const csrf = await browser.login();
  const dashboard = (await browser.request("/api/dashboard")).json();
  const invoice = dashboard.invoices[0];
  const checkout = await browser.request(
    "/api/commands/stripe.checkout",
    { invoiceId: invoice.id },
    { "x-csrf-token": csrf, "idempotency-key": "demo-payment" },
  );
  assert.equal(checkout.statusCode, 200, checkout.body);
  let current = invoice;
  for (let attempt = 0; attempt < 30; attempt++) {
    current = (await browser.request("/api/dashboard"))
      .json()
      .invoices.find((i: { id: string }) => i.id === invoice.id);
    if (current.balance === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(current.balance, 0, JSON.stringify(current));
});
test("gateway preserves binary bodies, status, download headers and every Set-Cookie", async (t) => {
  const http = await gateway(t, { createInstance: fakeInstance });
  const browser = new Browser(http);
  await browser.start();
  const response = await browser.request("/bytes");
  assert.equal(response.statusCode, 206);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.deepEqual(response.rawPayload, Buffer.from([0, 255, 128, 13, 10]));
  assert.deepEqual(response.headers["set-cookie"], [
    "one=1; HttpOnly",
    "two=2; HttpOnly",
  ]);
  assert.equal(
    response.headers["content-disposition"],
    'attachment; filename="demo.bin"',
  );
  // Larger than the normal API limit, still within the native evidence upload limit.
  const raw = Buffer.alloc(300 * 1024, 254);
  raw[0] = 0;
  raw[1] = 255;
  const echo = await http.inject({
    method: "POST",
    url: "/echo",
    headers: {
      cookie: browser.cookie,
      "content-type": "application/octet-stream",
    },
    payload: raw,
  });
  assert.deepEqual(echo.rawPayload, raw);
});

test("expiry and reset retain active request leases; capacity and rate are bounded", async (t) => {
  let time = 1000,
    releaseRequest!: () => void,
    began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  let closes = 0;
  const http = await gateway(t, {
    now: () => time,
    maxInstances: 1,
    idleTtlMs: 100,
    maxLifetimeMs: 1000,
    createInstance: async () => {
      const instance = await fakeInstance();
      instance.http.get("/slow", async () => {
        began();
        await pending;
        return { finished: true };
      });
      return {
        ...instance,
        close: async () => {
          closes++;
          await instance.close();
        },
      };
    },
  });
  const a = new Browser(http),
    b = new Browser(http);
  await a.start();
  const active = a.request("/slow");
  await started;
  time += 101;
  b.csrf = (await b.request("/demo/api/status")).json().csrf;
  assert.equal(
    (await b.request("/demo/api/start", { companyName: "Other", region: "US" }))
      .statusCode,
    503,
  );
  assert.equal(closes, 0);
  releaseRequest();
  assert.equal((await active).statusCode, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  await b.start();
  assert.equal((await a.request("/api/session")).statusCode, 410);
  const limited = await gateway(t, {
    createInstance: fakeInstance,
    requestsPerMinute: 2,
  });
  assert.equal((await limited.inject("/demo")).statusCode, 200);
  assert.equal((await limited.inject("/demo")).statusCode, 200);
  assert.equal((await limited.inject("/demo")).statusCode, 429);
});

test("reset revokes new access immediately and waits for in-flight native work before disposal", async (t) => {
  let finish!: () => void, began!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const begun = new Promise<void>((resolve) => {
    began = resolve;
  });
  let closed = false;
  const http = await gateway(t, {
    createInstance: async () => {
      const instance = await fakeInstance();
      instance.http.get("/slow", async () => {
        began();
        await blocked;
        return "finished";
      });
      return {
        ...instance,
        close: async () => {
          closed = true;
          await instance.close();
        },
      };
    },
  });
  const browser = new Browser(http);
  await browser.start();
  const selector = browser.cookies.get("distributor_demo");
  const running = browser.request("/slow");
  await begun;
  assert.equal((await browser.request("/demo/api/reset", {})).statusCode, 200);
  assert.equal(closed, false);
  assert.equal(
    (
      await http.inject({
        url: "/api/session",
        headers: { cookie: `distributor_demo=${selector}` },
      })
    ).statusCode,
    410,
  );
  finish();
  assert.equal((await running).statusCode, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, true);
});

test("absolute expiry cannot be extended by activity, starts are rate limited and remote HTTP is rejected", async (t) => {
  let time = 1000;
  const http = await gateway(t, {
    createInstance: fakeInstance,
    now: () => time,
    idleTtlMs: 100,
    maxLifetimeMs: 150,
    startsPerMinute: 1,
  });
  const browser = new Browser(http);
  await browser.start();
  time += 90;
  assert.equal((await browser.request("/bytes")).statusCode, 206);
  time += 70;
  assert.equal((await browser.request("/api/session")).statusCode, 410);
  browser.csrf = (await browser.request("/demo/api/status")).json().csrf;
  assert.equal(
    (
      await browser.request("/demo/api/start", {
        companyName: "Again",
        region: "CA",
      })
    ).statusCode,
    429,
  );
  await assert.rejects(
    () => createDemoGateway({ ...options, origin: "http://example.test" }),
    /requires HTTPS/,
  );
});

test("demo onboarding validates and retains the selected payment scenario", async (t) => {
  const http = await gateway(t);
  const browser = new Browser(http);
  browser.csrf = (await browser.request("/demo/api/status")).json().csrf;
  const invalid = await browser.request("/demo/api/start", {
    companyName: "Fictional",
    region: "CA",
    paymentScenario: "live",
  });
  assert.equal(invalid.statusCode, 400);
  const valid = await browser.request("/demo/api/start", {
    companyName: "Fictional",
    region: "CA",
    paymentScenario: "pending-refund",
  });
  assert.equal(valid.statusCode, 200, valid.body);
  const status = (await browser.request("/demo/api/status")).json();
  assert.equal(status.paymentScenario, "pending-refund");
  assert.equal(status.active, true);
});
