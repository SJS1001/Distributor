import { paymentScenarios, type PaymentScenario } from "./scenarios.ts";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import { evidenceMaxBytes } from "../shared/warranty-evidence.ts";
import helmet from "@fastify/helmet";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createDemoInstance,
  type DemoInput,
  type DemoInstance,
} from "./runtime.ts";
import { demoHtml, demoCss, demoScript } from "./onboarding.ts";

const selectorName = "distributor_demo";
const bootstrapName = "distributor_demo_start";
const opaque = () => randomBytes(32).toString("hex");
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
interface Entry {
  id: string;
  csrf: string;
  input: DemoInput;
  instance: DemoInstance;
  created: number;
  touched: number;
  leases: number;
  retired: boolean;
  closed?: Promise<void>;
}
export interface DemoGatewayOptions {
  origin: string;
  staticRoot: string;
  secureCookies?: boolean;
  maxInstances?: number;
  idleTtlMs?: number;
  maxLifetimeMs?: number;
  requestsPerMinute?: number;
  startsPerMinute?: number;
  /** Trusted construction seams for focused tests; never user configuration. */
  now?: () => number;
  createInstance?: (input: DemoInput) => Promise<DemoInstance>;
}

export async function createDemoGateway(options: DemoGatewayOptions) {
  const origin = new URL(options.origin).origin;
  const secureCookies = options.secureCookies ?? false;
  if (
    new URL(origin).protocol !== "http:" &&
    new URL(origin).protocol !== "https:"
  )
    throw new Error("Demo origin must use HTTP or HTTPS.");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname) &&
    (!secureCookies || new URL(origin).protocol !== "https:")
  )
    throw new Error("Remote demo origin requires HTTPS and secure cookies.");
  const maxInstances = options.maxInstances ?? 8;
  const idleTtlMs = options.idleTtlMs ?? 30 * 60_000;
  const maxLifetimeMs = options.maxLifetimeMs ?? 4 * 60 * 60_000;
  const requestLimit = options.requestsPerMinute ?? 600;
  const startLimit = options.startsPerMinute ?? 5;
  for (const n of [
    maxInstances,
    idleTtlMs,
    maxLifetimeMs,
    requestLimit,
    startLimit,
  ])
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error("Demo limits must be positive integers.");
  const clock = options.now ?? Date.now;
  const secret = randomBytes(32);
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  const entries = new Map<string, Entry>();
  const allocated = new Set<Entry>();
  const rates = new Map<
    string,
    { until: number; requests: number; starts: number }
  >();
  let creating = 0;
  const http = Fastify({
    logger: false,
    // Permit the largest native evidence request; the inner routes retain their own limits.
    bodyLimit: 4 * Math.ceil(evidenceMaxBytes / 3) + 16 * 1024,
    trustProxy: false,
  });
  await http.register(cookie);
  await http.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  });
  // The outer gateway must never parse/re-encode native JSON, uploads or binary data.
  http.removeAllContentTypeParsers();
  http.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict" as const,
    path: "/",
  };
  const fail = (
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
  ) => reply.code(status).send({ code, message });
  const expired = (entry: Entry) =>
    clock() - entry.touched >= idleTtlMs ||
    clock() - entry.created >= maxLifetimeMs;
  const close = (entry: Entry) => {
    if (!entry.retired || entry.leases) return;
    entry.closed ??= entry.instance
      .close()
      .finally(() => allocated.delete(entry));
    // Cleanup failure is observable on shutdown, never an unhandled rejection.
    void entry.closed.catch(() => {});
  };
  const retire = (entry: Entry) => {
    entry.retired = true;
    entries.delete(entry.id);
    close(entry);
  };
  const sweep = () => {
    for (const entry of entries.values()) if (expired(entry)) retire(entry);
    for (const [ip, rate] of rates) if (rate.until <= clock()) rates.delete(ip);
  };
  const acquire = (request: FastifyRequest) => {
    const id = request.cookies[selectorName];
    const entry = id ? entries.get(id) : undefined;
    if (!entry) return;
    if (expired(entry)) {
      retire(entry);
      return;
    }
    entry.leases++;
    entry.touched = clock();
    return entry;
  };
  const release = (entry: Entry) => {
    entry.leases--;
    close(entry);
  };
  const clearCookies = (reply: FastifyReply) => {
    reply.clearCookie(selectorName, cookieOptions);
    reply.clearCookie("distributor_session", cookieOptions);
  };
  const bootstrap = (request: FastifyRequest) => {
    const token = request.cookies[bootstrapName];
    if (!token) return;
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      !/^[a-f0-9]{64}$/.test(parts[0]!) ||
      !/^\d+$/.test(parts[1]!) ||
      !/^[a-f0-9]{64}$/.test(parts[2]!)
    )
      return;
    const unsigned = parts.slice(0, 2).join(".");
    if (Number(parts[1]) <= clock() || !equal(sign(unsigned), parts[2]!))
      return;
    return sign(`csrf:${token}`);
  };
  const authorize = (
    request: FastifyRequest,
    reply: FastifyReply,
    csrf: string | undefined,
  ) => {
    if (request.headers.origin !== origin) {
      fail(
        reply,
        403,
        "ORIGIN",
        "Demo requests require the configured origin.",
      );
      return false;
    }
    const candidate = request.headers["x-demo-csrf"];
    if (!csrf || typeof candidate !== "string" || !equal(candidate, csrf)) {
      fail(
        reply,
        403,
        "DEMO_CSRF",
        "Refresh the demo controls before trying again.",
      );
      return false;
    }
    return true;
  };
  const body = (
    request: FastifyRequest,
  ): Record<string, unknown> | undefined => {
    if (request.headers["content-type"]?.split(";")[0] !== "application/json")
      return;
    try {
      const value = JSON.parse((request.body as Buffer).toString("utf8"));
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
    } catch {
      return;
    }
  };
  http.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Distributor-Demo", "native")
      .header("Referrer-Policy", "no-referrer");
    sweep();
    const ip = request.ip;
    let rate = rates.get(ip);
    if (!rate) {
      if (rates.size >= 1000)
        return fail(
          reply,
          429,
          "DEMO_RATE",
          "Demo request capacity reached. Try again later.",
        );
      rates.set(
        ip,
        (rate = { until: clock() + 60_000, requests: 0, starts: 0 }),
      );
    }
    if (++rate.requests > requestLimit)
      return fail(
        reply.header("Retry-After", "60"),
        429,
        "DEMO_RATE",
        "Too many demo requests. Try again in a minute.",
      );
  });
  http.get("/demo", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(demoHtml),
  );
  http.get("/demo/style.css", async (_request, reply) =>
    reply.type("text/css; charset=utf-8").send(demoCss),
  );
  http.get("/demo/control.js", async (_request, reply) =>
    reply.type("application/javascript; charset=utf-8").send(demoScript),
  );
  http.get("/demo/api/status", async (request, reply) => {
    const entry = acquire(request);
    if (entry) {
      try {
        return {
          active: true,
          csrf: entry.csrf,
          ...entry.input,
          accounts: entry.instance.accounts,
          idleTtlMs,
          maxLifetimeMs,
        };
      } finally {
        release(entry);
      }
    }
    clearCookies(reply);
    let csrf = bootstrap(request);
    if (!csrf) {
      const unsigned = `${opaque()}.${clock() + 15 * 60_000}`;
      const token = `${unsigned}.${sign(unsigned)}`;
      reply.setCookie(bootstrapName, token, { ...cookieOptions, maxAge: 900 });
      csrf = sign(`csrf:${token}`);
    }
    return { active: false, csrf };
  });
  http.post("/demo/api/start", async (request, reply) => {
    if (!authorize(request, reply, bootstrap(request))) return;
    const existing = acquire(request);
    if (existing) {
      release(existing);
      return fail(
        reply,
        409,
        "DEMO_EXISTS",
        "Reset your existing demo before creating another.",
      );
    }
    const data = body(request);
    if (
      !data ||
      Object.keys(data).some(
        (key) => !["companyName", "region", "paymentScenario"].includes(key),
      ) ||
      typeof data.companyName !== "string" ||
      data.companyName.trim().length < 1 ||
      data.companyName.trim().length > 80 ||
      !["CA", "US"].includes(data.region as string) ||
      (data.paymentScenario !== undefined &&
        !paymentScenarios.includes(data.paymentScenario as PaymentScenario))
    )
      return fail(
        reply,
        400,
        "DEMO_INPUT",
        "Provide a fictional company name, CA or US region and a supported payment scenario.",
      );
    const rate = rates.get(request.ip)!;
    if (++rate.starts > startLimit)
      return fail(
        reply.header("Retry-After", "60"),
        429,
        "DEMO_START_RATE",
        "Too many demo creations. Try again in a minute.",
      );
    if (allocated.size + creating >= maxInstances)
      return fail(
        reply,
        503,
        "DEMO_CAPACITY",
        "All temporary demo slots are occupied. Try again after a workspace expires.",
      );
    creating++;
    try {
      const input: DemoInput = {
        companyName: data.companyName.trim(),
        region: data.region as DemoInput["region"],
        paymentScenario:
          (data.paymentScenario as PaymentScenario | undefined) ?? "success",
      };
      const instance = await (
        options.createInstance ??
        ((input) =>
          createDemoInstance(input, {
            origin,
            secureCookies,
            staticRoot: options.staticRoot,
          }))
      )(input);
      const entry: Entry = {
        id: opaque(),
        csrf: opaque(),
        input,
        instance,
        created: clock(),
        touched: clock(),
        leases: 0,
        retired: false,
      };
      entries.set(entry.id, entry);
      allocated.add(entry);
      reply.setCookie(selectorName, entry.id, {
        ...cookieOptions,
        maxAge: Math.ceil(maxLifetimeMs / 1000),
      });
      reply.clearCookie(bootstrapName, cookieOptions);
      reply.clearCookie("distributor_session", cookieOptions);
      return { active: true };
    } catch {
      return fail(
        reply,
        500,
        "DEMO_START_FAILED",
        "Could not initialize this fictional workspace. Try again.",
      );
    } finally {
      creating--;
    }
  });
  http.post("/demo/api/reset", async (request, reply) => {
    const entry = acquire(request);
    if (!entry)
      return fail(
        reply,
        410,
        "DEMO_EXPIRED",
        "Demo expired. Open /demo to start again.",
      );
    try {
      if (!authorize(request, reply, entry.csrf)) return;
      retire(entry);
      clearCookies(reply);
      return { active: false };
    } finally {
      release(entry);
    }
  });
  http.post("/demo/api/role", async (request, reply) => {
    const entry = acquire(request);
    if (!entry)
      return fail(
        reply,
        410,
        "DEMO_EXPIRED",
        "Demo expired. Open /demo to start again.",
      );
    try {
      if (!authorize(request, reply, entry.csrf)) return;
      const data = body(request);
      const account =
        data &&
        Object.keys(data).length === 1 &&
        entry.instance.accounts.find((account) => account.role === data.role);
      if (!account)
        return fail(
          reply,
          400,
          "DEMO_ROLE",
          "Choose one of this workspace's sample roles.",
        );
      const result = await entry.instance.http.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { email: account.email, password: account.password },
      });
      if (result.statusCode === 200) {
        // Revoke the previous native session without bypassing native login or MFA.
        const prior = await entry.instance.http.inject({
          url: "/api/session",
          headers: { cookie: request.headers.cookie ?? "" },
        });
        if (prior.statusCode === 200)
          await entry.instance.http.inject({
            method: "POST",
            url: "/api/logout",
            headers: {
              origin,
              cookie: request.headers.cookie ?? "",
              "x-csrf-token": prior.json().csrf,
            },
          });
      }
      return forward(reply, result);
    } finally {
      release(entry);
    }
  });
  const forward = (
    reply: FastifyReply,
    response: Awaited<ReturnType<DemoInstance["http"]["inject"]>>,
  ) => {
    reply.code(response.statusCode);
    for (const [name, value] of Object.entries(response.headers))
      if (
        value !== undefined &&
        !["connection", "keep-alive", "transfer-encoding"].includes(
          name.toLowerCase(),
        )
      )
        reply.header(name, value);
    reply.header("X-Distributor-Demo", "native");
    // Inner asset/API headers must not weaken this temporary workspace policy.
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    return reply.send(response.rawPayload);
  };
  http.all("/*", async (request, reply) => {
    if (request.url.startsWith("/demo/"))
      return fail(reply, 404, "NOT_FOUND", "Demo route not found.");
    const entry = acquire(request);
    if (!entry) {
      clearCookies(reply);
      return request.url.startsWith("/api/") ||
        request.url.startsWith("/webhooks/")
        ? fail(
            reply,
            410,
            "DEMO_EXPIRED",
            "Open /demo to create a temporary workspace.",
          )
        : reply.redirect("/demo");
    }
    try {
      const response = await entry.instance.http.inject({
        method: request.method as "GET",
        url: request.url,
        headers: request.headers,
        payload: request.body as Buffer | undefined,
        remoteAddress: request.ip,
      });
      return forward(reply, response);
    } finally {
      release(entry);
    }
  });
  const maintenance = setInterval(sweep, 30_000).unref();
  http.addHook("onClose", async () => {
    clearInterval(maintenance);
    for (const entry of allocated) retire(entry);
    await Promise.all([...allocated].map((entry) => entry.closed));
  });
  return http;
}
