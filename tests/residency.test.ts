import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import {
  providerNames,
  type ProviderName,
} from "../src/shared/provider-choices.ts";

const payload = (accountId: string, providers: string[], version = 1) => ({
  accountId,
  region: "CA" as const,
  mode: "provider-exceptions" as const,
  providers,
  version,
  acknowledgment:
    "Synthetic reviewed named processor choices; not vendor qualification",
});
const choices = (f: ReturnType<typeof fixture>) =>
  f.app.platform
    .audits(f.actor)
    .filter((a) => a.action === "account.residency.choice");

test("each of the eight named providers is independent; withdrawal preserves versioned history and restart", (t) => {
  const f = fixture(t);
  ship(f, accept(f).id);
  const native = () => ({
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    effects: f.app.integration.list(f.actor),
  });
  const opening = native();
  let version = 1;
  for (const selected of providerNames) {
    const input = payload(f.buyer, [selected], version);
    const receipt = f.app.identity.residencyChoice(f.actor, selected, input);
    assert.equal(receipt.version, ++version);
    assert.deepEqual(
      f.app.identity.residencyChoice(f.actor, selected, input),
      receipt,
    );
    for (const provider of providerNames) {
      if (provider === selected)
        assert.equal(
          f.app.identity.providerAllowed(f.actor, f.buyer, provider),
          version,
        );
      else
        assert.throws(
          () => f.app.identity.providerAllowed(f.actor, f.buyer, provider),
          { code: "RESIDENCY_BLOCKED" },
        );
    }
  }
  const before = choices(f);
  assert.equal(before.length, 8);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.deepEqual(choices(f), before);
  assert.equal(
    f.app.identity.providerAllowed(f.actor, f.buyer, "dhl-express"),
    version,
  );
  f.app.identity.residencyChoice(f.actor, "withdraw", {
    ...payload(f.buyer, [], version),
    mode: "strict",
  });
  for (const provider of providerNames)
    assert.throws(
      () => f.app.identity.providerAllowed(f.actor, f.buyer, provider),
      { code: "RESIDENCY_BLOCKED" },
    );
  // Historical cached choices remain receipts, never a rewrite of current choice.
  assert.equal(
    f.app.identity.residencyChoice(f.actor, "ups", payload(f.buyer, ["ups"], 3))
      .version,
    4,
  );
  assert.equal(
    f.app.identity.customer(f.actor, f.buyer).residency_mode,
    "strict",
  );
  assert.equal(choices(f).length, 9);
  assert.deepEqual(native(), opening);
  for (const audit of choices(f)) {
    const detail = JSON.parse(String(audit.detail));
    assert.equal(audit.actor_id, f.actor.id);
    assert.equal(audit.reference, f.buyer);
    assert.equal(detail.region, "CA");
    assert.ok(Number.isInteger(detail.version));
    assert.ok(detail.acknowledgment.includes("Synthetic"));
  }
});

test("legacy umbrella and cached receipts survive restart without granting any named carrier", (t) => {
  const f = fixture(t),
    input = payload(f.buyer, ["carrier", "stripe"]);
  // Populate the exact old representation and command receipt as an upgrade fixture.
  f.app.platform.command(
    f.actor,
    "account.residency",
    "legacy",
    input,
    () => {},
    () => {
      f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_accounts SET residency_mode='provider-exceptions',provider_exceptions=?,residency_version=2 WHERE id=?",
          JSON.stringify(input.providers),
          f.buyer,
        );
      f.app.platform.audit(f.actor, "account.residency.choice", f.buyer, input);
      return {
        id: f.buyer,
        region: "CA",
        mode: input.mode,
        providers: input.providers,
        version: 2,
      };
    },
  );
  const before = choices(f);
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(
    f.app.identity.customer(f.actor, f.buyer).provider_exceptions,
    '["carrier","stripe"]',
  );
  assert.deepEqual(choices(f), before);
  assert.deepEqual(
    f.app.identity.residencyChoice(f.actor, "legacy", input).providers,
    input.providers,
  );
  assert.equal(f.app.identity.providerAllowed(f.actor, f.buyer, "stripe"), 2);
  for (const provider of [
    ...providerNames.filter((p) => p !== "stripe"),
    "carrier" as ProviderName,
  ])
    assert.throws(
      () => f.app.identity.providerAllowed(f.actor, f.buyer, provider),
      { code: "RESIDENCY_BLOCKED" },
    );
  f.app.identity.residencyChoice(
    f.actor,
    "review",
    payload(f.buyer, ["ups", "canada-post"], 2),
  );
  assert.equal(f.app.identity.providerAllowed(f.actor, f.buyer, "ups"), 3);
  assert.equal(
    f.app.identity.providerAllowed(f.actor, f.buyer, "canada-post"),
    3,
  );
  assert.throws(
    () => f.app.identity.providerAllowed(f.actor, f.buyer, "fedex"),
    { code: "RESIDENCY_BLOCKED" },
  );
  assert.deepEqual(
    choices(f).filter((a) => a.id === before[0]!.id),
    before,
  );
});

test("invalid carrier families, duplicates and strict exceptions leave no choice, audit or command receipt", (t) => {
  const f = fixture(t),
    before = choices(f);
  for (const [i, providers] of [
    ["carrier"],
    ["dhl"],
    ["UPS"],
    ["ups", "ups"],
    ["stripe", "carrier"],
  ].entries())
    assert.throws(
      () =>
        f.app.identity.residencyChoice(
          f.actor,
          `invalid-${i}`,
          payload(f.buyer, providers),
        ),
      { code: "VALIDATION" },
    );
  assert.throws(
    () =>
      f.app.identity.residencyChoice(
        f.actor,
        "sparse-invalid",
        payload(f.buyer, Array<string>(1)),
      ),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.identity.residencyChoice(f.actor, "strict-invalid", {
        ...payload(f.buyer, ["ups"]),
        mode: "strict",
      }),
    { code: "VALIDATION" },
  );
  assert.equal(f.app.identity.customer(f.actor, f.buyer).residency_version, 1);
  assert.deepEqual(choices(f), before);
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS total FROM platform_commands WHERE name='account.residency'",
      )!.total,
    0,
  );
});

test("US choices keep USD and require reviewed migration for Canada without changing account or receipt", (t) => {
  const f = fixture(t),
    app = new Application(f.path + ".us", "US");
  try {
    const actor = app.identity.bootstrap(
      "Synthetic US distributor",
      "us@example.test",
      "long-test-only-password",
      "USD",
    );
    const accountId = app.identity.createCustomer(actor, "buyer", {
      name: "Synthetic US buyer",
      tier: "standard",
      creditLimit: 10000,
    }).id;
    const input = {
      ...payload(accountId, ["usps", "fedex"]),
      region: "US" as const,
    };
    assert.equal(
      app.identity.residencyChoice(actor, "choice", input).version,
      2,
    );
    assert.equal(app.identity.providerAllowed(actor, accountId, "usps"), 2);
    assert.throws(
      () => app.identity.providerAllowed(actor, accountId, "canada-post"),
      { code: "RESIDENCY_BLOCKED" },
    );
    assert.throws(
      () =>
        app.identity.residencyChoice(actor, "migrate", {
          ...input,
          region: "CA",
          version: 2,
        }),
      { code: "REGIONAL_MIGRATION_REQUIRED" },
    );
    assert.equal(app.identity.organization(actor).region, "US");
    assert.equal(app.identity.customer(actor, accountId).currency, "USD");
    assert.equal(app.identity.customer(actor, accountId).residency_version, 2);
  } finally {
    app.close();
  }
});

test("current actual account, role, active and password grants precede cached choices and provider permission", (t) => {
  const f = fixture(t),
    other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other synthetic buyer",
      tier: "standard",
      creditLimit: 10000,
    }).id;
  const uid = f.app.identity.createUser(f.actor, "buyer-user", {
    email: "residency@example.test",
    name: "Residency buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  }).id;
  const actor = f.app.identity.login(
    "residency@example.test",
    "long-test-only-password",
  ).actor;
  const input = payload(f.buyer, ["ups"]);
  f.app.identity.residencyChoice(actor, "choice", input);
  const store = f.app.database.owned("iam");
  store.run("UPDATE iam_users SET account_id=? WHERE id=?", other, uid);
  for (const supplied of [actor, { ...actor, role: "admin" as const }]) {
    assert.throws(
      () => f.app.identity.residencyChoice(supplied, "choice", input),
      { code: "FORBIDDEN" },
    );
    assert.throws(
      () => f.app.identity.providerAllowed(supplied, f.buyer, "ups"),
      { code: "FORBIDDEN" },
    );
  }
  store.run(
    "UPDATE iam_users SET account_id=?,role='warehouse' WHERE id=?",
    f.buyer,
    uid,
  );
  assert.throws(() => f.app.identity.residencyChoice(actor, "choice", input), {
    code: "FORBIDDEN",
  });
  store.run("UPDATE iam_users SET role='buyer',active=0 WHERE id=?", uid);
  assert.throws(() => f.app.identity.residencyChoice(actor, "choice", input), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.identity.providerAllowed(actor, f.buyer, "ups"), {
    code: "FORBIDDEN",
  });
  store.run("UPDATE iam_users SET active=1 WHERE id=?", uid);
  store.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    uid,
  );
  assert.throws(() => f.app.identity.residencyChoice(actor, "choice", input), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(() => f.app.identity.providerAllowed(actor, f.buyer, "ups"), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  assert.throws(
    () =>
      f.app.identity.providerAllowed(
        { ...actor, orgId: "foreign-org" },
        f.buyer,
        "ups",
      ),
    { code: "FORBIDDEN" },
  );
  assert.equal(choices(f).length, 1);
});

test("late choice audit failure rolls back account version, exception list, audit and receipt before safe retry", (t) => {
  const f = fixture(t),
    original = f.app.platform.audit.bind(f.app.platform),
    input = payload(f.buyer, ["ups", "usps"]);
  f.app.platform.audit = (actor, action, ref, detail) => {
    original(actor, action, ref, detail);
    if (action === "account.residency.choice")
      throw new Error("Synthetic final choice audit fault");
  };
  assert.throws(
    () => f.app.identity.residencyChoice(f.actor, "choice", input),
    /Synthetic final choice audit fault/,
  );
  assert.equal(f.app.identity.customer(f.actor, f.buyer).residency_version, 1);
  assert.equal(
    f.app.identity.customer(f.actor, f.buyer).provider_exceptions,
    "[]",
  );
  assert.equal(choices(f).length, 0);
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS total FROM platform_commands WHERE name='account.residency'",
      )!.total,
    0,
  );
  f.app.platform.audit = original;
  assert.equal(
    f.app.identity.residencyChoice(f.actor, "choice", input).version,
    2,
  );
});

test("HTTP accepts named choices and rejects umbrella, duplicates, unknown and extra fields before mutation", async (t) => {
  const f = fixture(t),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const headers = {
    origin,
    cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
    "x-csrf-token": login.json().csrf,
    "idempotency-key": "http-choice",
  };
  const send = (body: unknown, h = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/account.residency",
      headers: h,
      payload: body as Record<string, unknown>,
    });
  for (const providers of [
    ["carrier"],
    ["ups", "ups"],
    ["dhl"],
    ["Canada Post"],
  ])
    assert.equal((await send(payload(f.buyer, providers))).statusCode, 400);
  assert.equal(
    (await send({ ...payload(f.buyer, ["ups"]), authorization: true }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await send(payload(f.buyer, ["ups"]), {
        ...headers,
        "x-csrf-token": "bad",
      })
    ).statusCode,
    403,
  );
  assert.equal(f.app.identity.customer(f.actor, f.buyer).residency_version, 1);
  const input = payload(f.buyer, providerNames);
  assert.equal((await send(input)).statusCode, 200);
  assert.deepEqual((await send(input)).json().providers, providerNames);
  assert.equal(choices(f).length, 1);
});

test(
  "separate processes choosing different named providers at one version commit exactly one choice",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t);
    type Result = {
      ok: boolean;
      code?: string;
      result?: { providers: string[] };
    };
    const children = ["ups", "fedex"].map((provider, i) => {
      const child = fork(new URL("./residency-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      t.after(() => {
        if (!child.killed) child.kill();
      });
      let readyResolve!: () => void,
        resultResolve!: (r: Result) => void,
        resultReject!: (e: Error) => void;
      const ready = new Promise<void>((r) => {
        readyResolve = r;
      });
      const result = new Promise<Result>((r, j) => {
        resultResolve = r;
        resultReject = j;
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", resultReject);
      child.on("exit", (code) => {
        if (code !== 0)
          resultReject(new Error(`Choice process exited ${code}: ${stderr}`));
      });
      child.on("message", (message: any) =>
        message.ready ? readyResolve() : resultResolve(message),
      );
      child.send({
        action: "init",
        input: {
          path: f.path,
          actor: f.actor,
          key: `choice-${i}`,
          payload: payload(f.buyer, [provider]),
        },
      });
      return { child, ready, result };
    });
    await Promise.all(children.map((c) => c.ready));
    children.forEach((c) => c.child.send({ action: "go" }));
    const results = await Promise.all(children.map((c) => c.result));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "REVISION");
    const selected = results.find((r) => r.ok)!.result!.providers;
    assert.deepEqual(
      JSON.parse(f.app.identity.customer(f.actor, f.buyer).provider_exceptions),
      selected,
    );
    assert.equal(choices(f).length, 1);
    assert.equal(
      f.app.identity.customer(f.actor, f.buyer).residency_version,
      2,
    );
  },
);
