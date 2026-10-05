import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { configuredScannerLinks } from "../src/server/scanner-link-runtime.ts";
import type { ScannerLinkTransport } from "../src/server/scanner-link.ts";
const input = {
  channel: "email" as const,
  recipient: "warehouse@example.test",
};
const origin = "https://distributor.example.test";
test("scanner attempts retain exact accepted/unknown outcomes across restart and never resend on replay", async (t) => {
  const f = fixture(t);
  let sends = 0;
  const transport: ScannerLinkTransport = {
    orgId: f.actor.orgId,
    channels: ["email", "sms"],
    async send(message) {
      sends++;
      assert.equal(message.scannerUrl, `${origin}/#scanner`);
      if (message.channel === "sms") throw Error("Response lost");
      return "accepted";
    },
  };
  const first = await f.app.scannerLinks.send(
    f.actor,
    "first",
    input,
    origin,
    transport,
  );
  assert.equal(first.state, "accepted");
  assert.equal(first.recipientHint, "w•••@example.test");
  assert.deepEqual(
    await f.app.scannerLinks.send(f.actor, "first", input, origin, transport),
    first,
  );
  await assert.rejects(
    f.app.scannerLinks.send(
      f.actor,
      "first",
      { ...input, recipient: "other@example.test" },
      origin,
      transport,
    ),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const unknown = await f.app.scannerLinks.send(
    f.actor,
    "second",
    { channel: "sms", recipient: "+14165550123" },
    origin,
    transport,
  );
  assert.equal(unknown.state, "unknown");
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    await f.app.scannerLinks.send(
      f.actor,
      "second",
      { channel: "sms", recipient: "+14165550123" },
      origin,
      transport,
    ),
    unknown,
  );
  assert.equal(sends, 2);
});
test("scanner dispatch denies forged buyer authority, invalid recipients, foreign organization transports and quota excess", async (t) => {
  const f = fixture(t);
  let sends = 0;
  const transport: ScannerLinkTransport = {
    orgId: f.actor.orgId,
    channels: ["email"],
    async send() {
      sends++;
      return "confirmed";
    },
  };
  const buyer = f.app.identity.createUser(f.actor, "buyer-login", {
    name: "Buyer",
    email: "buyer@example.test",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const buyerActor = f.app.identity.currentActor({ ...f.actor, id: buyer.id });
  await assert.rejects(
    f.app.scannerLinks.send(
      { ...buyerActor, role: "admin", accountId: null },
      "forged",
      input,
      origin,
      transport,
    ),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.scannerLinks.send(f.actor, "wrong-org", input, origin, {
      ...transport,
      orgId: "other",
    }),
    { code: "DELIVERY_UNAVAILABLE" },
  );
  await assert.rejects(
    f.app.scannerLinks.send(
      f.actor,
      "bad",
      { channel: "sms", recipient: "4165550123" },
      origin,
      transport,
    ),
    { code: "VALIDATION" },
  );
  for (let n = 0; n < 5; n++)
    await f.app.scannerLinks.send(
      f.actor,
      `send-${n}`,
      input,
      origin,
      transport,
    );
  await assert.rejects(
    f.app.scannerLinks.send(f.actor, "over-limit", input, origin, transport),
    { code: "DELIVERY_LIMIT" },
  );
  assert.equal(sends, 5);
});
test("scanner HTTP delivery requires session, same origin and CSRF and never trusts caller URL", async (t) => {
  const f = fixture(t);
  let sends = 0;
  const http = await createHttp(f.app, {
    origin,
    scannerLinks: {
      orgId: f.actor.orgId,
      channels: ["email"],
      async send() {
        sends++;
        return "accepted";
      },
    },
  });
  t.after(() => http.close());
  assert.equal(
    (await http.inject({ method: "GET", url: "/api/scanner-link/config" }))
      .statusCode,
    401,
  );
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const headers = {
    origin,
    cookie,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "browser",
  };
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/scanner-link/send",
        headers: { ...headers, "x-csrf-token": "bad" },
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/scanner-link/send",
        headers,
        payload: { ...input, scannerUrl: "https://evil.example" },
      })
    ).statusCode,
    400,
  );
  const sent = await http.inject({
    method: "POST",
    url: "/api/scanner-link/send",
    headers,
    payload: input,
  });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().state, "accepted");
  assert.equal(sends, 1);
});
test("scanner relay is disabled by default and rejects incomplete or unsafe configuration", () => {
  assert.equal(configuredScannerLinks({}), undefined);
  assert.throws(
    () =>
      configuredScannerLinks({
        SCANNER_LINK_RELAY_URL: "http://relay.example/send",
      }),
    { code: "CONFIG" },
  );
  assert.throws(
    () =>
      configuredScannerLinks({
        SCANNER_LINK_RELAY_URL: "https://relay.example/send",
        SCANNER_LINK_RELAY_TOKEN: "synthetic-token",
        SCANNER_LINK_ORGANIZATION_ID: "synthetic-org",
        SCANNER_LINK_CHANNELS: "email,email",
      }),
    { code: "CONFIG" },
  );
});

test("simultaneous scanner retries share the committed attempt and never invoke the relay twice", async (t) => {
  const f = fixture(t);
  let finish!: (state: "accepted") => void;
  let calls = 0;
  const transport: ScannerLinkTransport = {
    orgId: f.actor.orgId,
    channels: ["email"],
    send() {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const first = f.app.scannerLinks.send(
    f.actor,
    "concurrent",
    input,
    origin,
    transport,
  );
  const pending = await f.app.scannerLinks.send(
    f.actor,
    "concurrent",
    input,
    origin,
    transport,
  );
  assert.equal(pending.state, "unknown");
  assert.equal(calls, 1);
  finish("accepted");
  const completed = await first;
  assert.equal(completed.id, pending.id);
  assert.equal(completed.state, "accepted");
  assert.deepEqual(
    await f.app.scannerLinks.send(
      f.actor,
      "concurrent",
      input,
      origin,
      transport,
    ),
    completed,
  );
  assert.equal(calls, 1);
});

test("revocation blocks both in-flight completion reads and cached scanner receipts", async (t) => {
  const f = fixture(t);
  const user = f.app.identity.createUser(f.actor, "scanner-staff", {
    name: "Scanner staff",
    email: "scanner@example.test",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  const staff = f.app.identity.currentActor({ ...f.actor, id: user.id });
  let finish!: (state: "confirmed") => void;
  let calls = 0;
  const transport: ScannerLinkTransport = {
    orgId: f.actor.orgId,
    channels: ["email"],
    send() {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const sending = f.app.scannerLinks.send(
    staff,
    "revoked",
    input,
    origin,
    transport,
  );
  const row = f.app.identity.users(f.actor).find((u) => u.id === staff.id)!;
  f.app.identity.updateUser(f.actor, "deactivate-scanner", {
    userId: staff.id,
    revision: row.revision,
    name: staff.name,
    email: row.email,
    role: "warehouse",
    sites: [f.w1],
    active: false,
    currentPassword: "long-test-only-password",
    reason: "Scanner access revoked",
  });
  finish("confirmed");
  await assert.rejects(sending, { code: "FORBIDDEN" });
  await assert.rejects(
    f.app.scannerLinks.send(staff, "revoked", input, origin, transport),
    { code: "FORBIDDEN" },
  );
  assert.equal(calls, 1);
});

test("restore outbound hold blocks new scanner attempts while retaining safe receipt recovery", async (t) => {
  const f = fixture(t);
  let calls = 0;
  const transport: ScannerLinkTransport = {
    orgId: f.actor.orgId,
    channels: ["email"],
    async send() {
      calls++;
      return "accepted";
    },
  };
  const first = await f.app.scannerLinks.send(
    f.actor,
    "before-restore",
    input,
    origin,
    transport,
  );
  f.app.platform.isolateRestore("synthetic-snapshot", new Date().toISOString());
  await assert.rejects(
    f.app.scannerLinks.send(f.actor, "after-restore", input, origin, transport),
    { code: "RECOVERY_HOLD" },
  );
  assert.deepEqual(
    await f.app.scannerLinks.send(
      f.actor,
      "before-restore",
      input,
      origin,
      transport,
    ),
    first,
  );
  assert.equal(calls, 1);
});

test("scanner timeout remains unknown even if an uncooperative adapter later resolves", async (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (state: "confirmed") => void;
  let signal!: AbortSignal;
  let calls = 0;
  const transport: ScannerLinkTransport = {
    orgId: f.actor.orgId,
    channels: ["email"],
    send(message) {
      calls++;
      signal = message.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  };
  const sending = f.app.scannerLinks.send(
    f.actor,
    "timeout",
    input,
    origin,
    transport,
  );
  t.mock.timers.tick(10000);
  const timedOut = await sending;
  assert.equal(timedOut.state, "unknown");
  assert.equal(signal.aborted, true);
  finish("confirmed");
  await Promise.resolve();
  assert.deepEqual(
    await f.app.scannerLinks.send(f.actor, "timeout", input, origin, transport),
    timedOut,
  );
  assert.equal(calls, 1);
});

test("relay responses are bounded, cancelled and interpreted without leaking arbitrary payloads", async (t) => {
  const env = {
    SCANNER_LINK_RELAY_URL: "https://relay.example.test/send",
    SCANNER_LINK_RELAY_TOKEN: "synthetic-token",
    SCANNER_LINK_ORGANIZATION_ID: "synthetic-org",
    SCANNER_LINK_CHANNELS: "email",
  };
  const transport = configuredScannerLinks(env)!;
  const request = {
    ...input,
    attemptId: "synthetic-attempt",
    scannerUrl: `${origin}/#scanner`,
    signal: new AbortController().signal,
  };
  for (const mode of [
    "too-large",
    "bad-status",
    "bad-type",
    "bad-json",
    "unknown-state",
    "accepted",
  ] as const) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          Buffer.from(
            mode === "too-large"
              ? "x".repeat(4097)
              : mode === "bad-json"
                ? "{"
                : mode === "unknown-state"
                  ? '{"state":"sent"}'
                  : '{"state":"accepted"}',
          ),
        );
        if (!["too-large", "bad-status", "bad-type"].includes(mode))
          controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
        assert.equal(String(url), env.SCANNER_LINK_RELAY_URL);
        assert.equal(options?.redirect, "error");
        assert.equal(
          (options?.headers as Record<string, string>)["Idempotency-Key"],
          request.attemptId,
        );
        assert.deepEqual(JSON.parse(String(options?.body)), {
          template: "distributor-scanner-link",
          channel: input.channel,
          recipient: input.recipient,
          scannerUrl: request.scannerUrl,
        });
        return new Response(stream, {
          status: mode === "bad-status" ? 500 : 200,
          headers: {
            "content-type":
              mode === "bad-type"
                ? "application/json-untrusted"
                : "application/json; charset=utf-8",
          },
        });
      },
    );
    if (mode === "accepted")
      assert.equal(await transport.send(request), "accepted");
    else await assert.rejects(transport.send(request));
    if (["too-large", "bad-status", "bad-type"].includes(mode))
      assert.equal(cancelled, true, mode);
    fetchMock.mock.restore();
  }
  assert.throws(
    () => configuredScannerLinks({ ...env, SCANNER_LINK_RELAY_URL: "invalid" }),
    { code: "CONFIG" },
  );
});
