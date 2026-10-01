import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import {
  fixture,
  reviewedChoiceInput,
  syntheticDisclosure,
  accept,
  ship,
} from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type { ProviderName } from "../src/shared/provider-choices.ts";
import { createHttp } from "../src/server/http.ts";

const choice = (
  f: ReturnType<typeof fixture>,
  providers: ProviderName[],
  version = 1,
  actor = f.actor,
) =>
  reviewedChoiceInput(f.app, actor, {
    accountId: f.buyer,
    region: "CA",
    mode: providers.length ? "provider-exceptions" : "strict",
    providers,
    version,
    acknowledgment: "Synthetic customer reviewed named terms",
  });
const head = (f: ReturnType<typeof fixture>, provider: ProviderName) =>
  f.app.identity.residency
    .current(f.actor)
    .find((d) => d.provider === provider)!;
const update = (
  f: ReturnType<typeof fixture>,
  provider: ProviderName,
  version = "synthetic-v2",
) =>
  f.app.identity.residency.publish(
    f.actor,
    `publish-${provider}-${version}`,
    syntheticDisclosure(f.app, provider, head(f, provider).id, version),
  );
const buyer = (f: ReturnType<typeof fixture>) => {
  const uid = f.app.identity.createUser(f.actor, "disclosure-buyer", {
    email: "disclosure-buyer@example.test",
    name: "Actual synthetic buyer",
    password: "long-test-only-password",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  }).id;
  return f.app.identity.currentActor({ ...f.actor, id: uid });
};

test("exceptions require explicit exact customer acceptance; staff acknowledgments alone authorize nothing", (t) => {
  const f = fixture(t),
    input = choice(f, ["stripe", "quickbooks"]),
    before = f.app.identity.customer(f.actor, f.buyer);
  const without = { ...input };
  delete without.acceptance;
  assert.throws(
    () => f.app.identity.residencyChoice(f.actor, "missing", without),
    { code: "CUSTOMER_ACCEPTANCE_REQUIRED" },
  );
  for (const acceptance of [
    { ...input.acceptance!, representative: " " },
    { ...input.acceptance!, evidenceRef: " " },
    { ...input.acceptance!, basis: "buyer" as const },
    {
      ...input.acceptance!,
      disclosures: input.acceptance!.disclosures.slice(0, 1),
    },
    {
      ...input.acceptance!,
      disclosures: [
        input.acceptance!.disclosures[0]!,
        input.acceptance!.disclosures[0]!,
      ],
    },
    {
      ...input.acceptance!,
      disclosures: [
        input.acceptance!.disclosures[0]!,
        { provider: "ups" as const, disclosureId: head(f, "ups").id },
      ],
    },
  ])
    assert.throws(() =>
      f.app.identity.residencyChoice(f.actor, "invalid", {
        ...input,
        acceptance,
      }),
    );
  assert.deepEqual(f.app.identity.customer(f.actor, f.buyer), before);
  assert.deepEqual(
    f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    [],
  );
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS n FROM platform_commands WHERE name='account.residency'",
      )!.n,
    0,
  );
  const result = f.app.identity.residencyChoice(f.actor, "review", input);
  assert.equal(result.version, 2);
  const records = f.app.identity.residency.acceptances(f.actor, f.buyer, 2);
  assert.equal(records.length, 2);
  for (const r of records) {
    const d = head(f, r.provider as ProviderName);
    assert.equal(r.disclosure_id, d.id);
    assert.equal(r.disclosure_hash, d.hash);
    assert.equal(r.actor_id, f.actor.id);
    assert.equal(r.basis, "recorded");
    assert.equal(r.evidence_ref, input.acceptance!.evidenceRef);
    assert.equal(r.representative, input.acceptance!.representative);
    assert.ok(!Number.isNaN(Date.parse(String(r.accepted_at))));
  }
  assert.throws(
    () =>
      f.app.identity.residencyChoice(f.actor, "withdraw-invalid", {
        ...choice(f, [], 2),
        acceptance: input.acceptance,
      }),
    { code: "VALIDATION" },
  );
});

test("buyer acceptance binds actual identity, prevents fabricated representative and foreign account reads", (t) => {
  const f = fixture(t),
    actor = buyer(f),
    input = choice(f, ["fedex"], 1, actor);
  assert.throws(
    () =>
      f.app.identity.residencyChoice(actor, "forged", {
        ...input,
        acceptance: { ...input.acceptance!, representative: "Forged signer" },
      }),
    { code: "VALIDATION" },
  );
  f.app.identity.residencyChoice(
    { ...actor, name: "Forged display", role: "admin" },
    "accept",
    input,
  );
  const records = f.app.identity.residency.acceptances(
    { ...actor, name: "Forged display" },
    f.buyer,
    2,
  );
  assert.equal(records[0]!.representative, "Actual synthetic buyer");
  assert.equal(records[0]!.basis, "buyer");
  assert.equal(records[0]!.evidence_ref, null);
  const other = f.app.identity.createCustomer(f.actor, "other-account", {
    name: "Other account",
    tier: "standard",
    creditLimit: 1,
  }).id;
  assert.throws(
    () =>
      f.app.identity.residency.acceptances(
        { ...actor, accountId: other, role: "admin" },
        other,
        2,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.identity.residency.publish(
        { ...actor, role: "admin" },
        "publish",
        syntheticDisclosure(f.app, "fedex", head(f, "fedex").id, "forged"),
      ),
    { code: "FORBIDDEN" },
  );
  const store = f.app.database.owned("iam");
  store.run("UPDATE iam_users SET role='warehouse' WHERE id=?", actor.id);
  assert.throws(
    () =>
      f.app.identity.residency.acceptances(
        { ...actor, role: "admin" },
        f.buyer,
        2,
      ),
    { code: "FORBIDDEN" },
  );
  store.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  assert.throws(() => f.app.identity.residency.current(actor), {
    code: "FORBIDDEN",
  });
});

test("new immutable terms stop only their provider, stale reviews fail, and historical retries never restore old terms or choice", (t) => {
  const f = fixture(t),
    input = choice(f, ["stripe", "quickbooks"]);
  const receipt = f.app.identity.residencyChoice(f.actor, "choice", input),
    old = head(f, "stripe"),
    records = f.app.identity.residency.acceptances(f.actor, f.buyer, 2);
  const publicBody = { ...old };
  delete (publicBody as any).id;
  delete (publicBody as any).hash;
  delete (publicBody as any).createdAt;
  assert.equal(digest(canonical(publicBody)), old.hash);
  const newInput = syntheticDisclosure(f.app, "stripe", old.id, "synthetic-v2"),
    fresh = f.app.identity.residency.publish(f.actor, "new-terms", newInput);
  assert.notEqual(fresh.hash, old.hash);
  assert.notEqual(fresh.id, old.id);
  assert.deepEqual(f.app.identity.residency.disclosure(f.actor, old.id), old);
  assert.deepEqual(
    f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    records,
  );
  assert.throws(
    () => f.app.identity.providerAllowed(f.actor, f.buyer, "stripe"),
    { code: "DISCLOSURE_REVIEW_REQUIRED" },
  );
  assert.equal(
    f.app.identity.providerAllowed(f.actor, f.buyer, "quickbooks"),
    2,
  );
  const status = f.app
    .dashboard(f.actor)
    .accounts.find((a) => a.id === f.buyer)!.providerReviews;
  assert.equal(status.find((r) => r.provider === "stripe")!.current, 0);
  assert.equal(status.find((r) => r.provider === "quickbooks")!.current, 1);
  assert.throws(
    () =>
      f.app.identity.residencyChoice(f.actor, "stale", {
        ...input,
        version: 2,
      }),
    { code: "DISCLOSURE_REVIEW_REQUIRED" },
  );
  assert.deepEqual(
    f.app.identity.residencyChoice(f.actor, "choice", input),
    receipt,
  );
  assert.equal(
    f.app.identity.residencyChoice(
      f.actor,
      "fresh-review",
      choice(f, ["stripe", "quickbooks"], 2),
    ).version,
    3,
  );
  assert.equal(f.app.identity.providerAllowed(f.actor, f.buyer, "stripe"), 3);
  const latest = update(f, "stripe", "synthetic-v3");
  assert.deepEqual(
    f.app.identity.residency.publish(f.actor, "new-terms", newInput),
    fresh,
  );
  assert.equal(head(f, "stripe").id, latest.id);
  f.app.identity.residencyChoice(f.actor, "withdraw-choice", choice(f, [], 3));
  assert.deepEqual(
    f.app.identity.residencyChoice(f.actor, "choice", input),
    receipt,
  );
  assert.equal(
    f.app.identity.customer(f.actor, f.buyer).residency_mode,
    "strict",
  );
  assert.deepEqual(
    f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    records,
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  assert.equal(head(f, "stripe").id, latest.id);
  assert.deepEqual(f.app.identity.residency.disclosure(f.actor, old.id), old);
  assert.deepEqual(
    f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    records,
  );
});

test("withdrawn disclosures cannot be reused and historical acceptance remains; strict choice needs no external evidence", (t) => {
  const f = fixture(t),
    input = choice(f, ["ups"]);
  f.app.identity.residencyChoice(f.actor, "choice", input);
  const old = head(f, "ups"),
    before = f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    withdrawal = {
      provider: "ups" as const,
      disclosureId: old.id,
      reason: "Synthetic reviewed vendor change",
    };
  const receipt = f.app.identity.residency.withdraw(
    f.actor,
    "withdraw",
    withdrawal,
  );
  assert.ok(
    !f.app.identity.residency
      .current(f.actor)
      .some((d) => d.provider === "ups"),
  );
  assert.throws(() => f.app.identity.providerAllowed(f.actor, f.buyer, "ups"), {
    code: "DISCLOSURE_REVIEW_REQUIRED",
  });
  assert.throws(
    () =>
      f.app.identity.residencyChoice(f.actor, "stale", {
        ...input,
        version: 2,
      }),
    { code: "DISCLOSURE_REVIEW_REQUIRED" },
  );
  assert.throws(
    () =>
      f.app.identity.residency.publish(
        f.actor,
        "reuse",
        syntheticDisclosure(f.app, "ups", null, old.version),
      ),
    { code: "DISCLOSURE_VERSION_USED" },
  );
  const fresh = f.app.identity.residency.publish(
    f.actor,
    "new",
    syntheticDisclosure(f.app, "ups", null, "synthetic-v2"),
  );
  assert.deepEqual(
    f.app.identity.residency.withdraw(f.actor, "withdraw", withdrawal),
    receipt,
  );
  assert.equal(head(f, "ups").id, fresh.id);
  assert.throws(() => f.app.identity.providerAllowed(f.actor, f.buyer, "ups"), {
    code: "DISCLOSURE_REVIEW_REQUIRED",
  });
  f.app.identity.residencyChoice(f.actor, "strict", choice(f, [], 2));
  assert.equal(
    f.app.identity.customer(f.actor, f.buyer).residency_mode,
    "strict",
  );
  assert.deepEqual(
    f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    before,
  );
  assert.deepEqual(f.app.identity.residency.disclosure(f.actor, old.id), old);
});

test("fresh publication/withdrawal authority precedes cached receipts and regional or fabricated grants", (t) => {
  const f = fixture(t),
    before = head(f, "usps"),
    input = syntheticDisclosure(f.app, "usps", before.id, "synthetic-v2"),
    terms = f.app.identity.residency.publish(f.actor, "publish", input),
    withdrawal = {
      provider: "usps" as const,
      disclosureId: terms.id,
      reason: "Synthetic withdrawal",
    };
  f.app.identity.residency.withdraw(f.actor, "withdraw", withdrawal);
  const store = f.app.database.owned("iam");
  store.run("UPDATE iam_users SET role='support' WHERE id=?", f.actor.id);
  assert.throws(
    () =>
      f.app.identity.residency.publish(
        { ...f.actor, role: "admin" },
        "publish",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.identity.residency.withdraw(
        { ...f.actor, role: "admin" },
        "withdraw",
        withdrawal,
      ),
    { code: "FORBIDDEN" },
  );
  store.run(
    "UPDATE iam_users SET role='admin',active=0 WHERE id=?",
    f.actor.id,
  );
  assert.throws(
    () => f.app.identity.residency.publish(f.actor, "publish", input),
    { code: "FORBIDDEN" },
  );
  store.run("UPDATE iam_users SET active=1 WHERE id=?", f.actor.id);
  store.run(
    "INSERT INTO iam_user_security(user_id,revision,password_change_required,updated_at) VALUES(?,1,1,'synthetic') ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    f.actor.id,
  );
  assert.throws(
    () => f.app.identity.residency.withdraw(f.actor, "withdraw", withdrawal),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  assert.throws(() => f.app.identity.residency.disclosure(f.actor, before.id), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  store.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  assert.throws(
    () => f.app.identity.residency.current({ ...f.actor, orgId: "foreign" }),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.identity.residency.publish(f.actor, "foreign-region", {
        ...input,
        previousDisclosureId: null,
        region: "US",
      }),
    { code: "REGIONAL_MIGRATION_REQUIRED" },
  );
  store.run(
    "UPDATE iam_provider_disclosures SET org_id='foreign-org' WHERE id=?",
    before.id,
  );
  assert.throws(() => f.app.identity.residency.disclosure(f.actor, before.id), {
    code: "NOT_FOUND",
  });
});

test("invalid terms and late audit failures leave no immutable row, head, acceptance, audit or receipt", (t) => {
  const f = fixture(t),
    before = head(f, "stripe"),
    input = syntheticDisclosure(f.app, "stripe", before.id, "synthetic-v2");
  for (const changed of [
    { minimumData: [] },
    { processingCountries: ["ca"] },
    { processingCountries: ["CA", "CA"] },
    { minimumData: Array<string>(1) },
    { subprocessors: ["same", "same"] },
    { retention: " " },
    { reviewEvidence: " " },
    { version: "x".repeat(161) },
  ])
    assert.throws(
      () =>
        f.app.identity.residency.publish(f.actor, "invalid", {
          ...input,
          ...changed,
        }),
      { code: "VALIDATION" },
    );
  const original = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (a, action, ref, detail) => {
    original(a, action, ref, detail);
    if (
      [
        "provider.disclosure.published",
        "provider.disclosure.withdrawn",
        "account.residency.choice",
      ].includes(action)
    )
      throw new Error("Synthetic late audit fault");
  };
  assert.throws(
    () => f.app.identity.residency.publish(f.actor, "publish", input),
    /Synthetic late audit fault/,
  );
  assert.equal(head(f, "stripe").id, before.id);
  assert.equal(
    f.app.database
      .owned("iam")
      .get(
        "SELECT COUNT(*) AS n FROM iam_provider_disclosures WHERE version='synthetic-v2'",
      )!.n,
    0,
  );
  assert.throws(
    () =>
      f.app.identity.residency.withdraw(f.actor, "withdraw", {
        provider: "stripe",
        disclosureId: before.id,
        reason: "Synthetic fault",
      }),
    /Synthetic late audit fault/,
  );
  assert.equal(head(f, "stripe").id, before.id);
  assert.throws(
    () =>
      f.app.identity.residencyChoice(
        f.actor,
        "choice",
        choice(f, ["stripe", "quickbooks"]),
      ),
    /Synthetic late audit fault/,
  );
  assert.deepEqual(
    f.app.identity.residency.acceptances(f.actor, f.buyer, 2),
    [],
  );
  assert.equal(f.app.identity.customer(f.actor, f.buyer).residency_version, 1);
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS n FROM platform_commands WHERE key IN ('publish','withdraw','choice','invalid')",
      )!.n,
    0,
  );
  f.app.platform.audit = original;
  assert.ok(f.app.identity.residency.publish(f.actor, "publish", input).id);
  assert.equal(
    f.app.identity.residencyChoice(f.actor, "choice", choice(f, ["stripe"]))
      .version,
    2,
  );
});

test("changed terms block new intents, pending sends and unknown reconciliation without changing native facts", async (t) => {
  const f = fixture(t),
    shipment = ship(f, accept(f).id);
  f.app.identity.residencyChoice(f.actor, "choice", choice(f, ["stripe"]));
  const pending = f.app.integration.checkout(f.actor, "pending", {
    invoiceId: shipment.invoiceId,
  });
  const native = {
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
  };
  update(f, "stripe");
  assert.throws(
    () =>
      f.app.integration.checkout(f.actor, "new-intent", {
        invoiceId: shipment.invoiceId,
      }),
    { code: "DISCLOSURE_REVIEW_REQUIRED" },
  );
  let calls = 0;
  const adapter = {
    execute: async () => {
      calls++;
      return { reference: "synthetic", result: {} };
    },
    lookup: async () => {
      calls++;
      return null;
    },
  };
  await assert.rejects(
    f.app.integration.execute(f.actor, pending.id, adapter),
    { code: "DISCLOSURE_REVIEW_REQUIRED" },
  );
  assert.equal(f.app.integration.effect(f.actor, pending.id).state, "pending");
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='unknown' WHERE id=?",
      pending.id,
    );
  await assert.rejects(
    f.app.integration.reconcile(f.actor, pending.id, adapter),
    { code: "DISCLOSURE_REVIEW_REQUIRED" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    {
      stock: f.app.inventory.stock(f.actor),
      orders: f.app.orders.list(f.actor),
      invoices: f.app.billing.invoices(f.actor),
    },
    native,
  );
});

test("tampered disclosure or acceptance hashes block provider permission rather than granting new terms", (t) => {
  const f = fixture(t);
  f.app.identity.residencyChoice(f.actor, "choice", choice(f, ["stripe"]));
  const terms = head(f, "stripe"),
    store = f.app.database.owned("iam");
  store.run(
    "UPDATE iam_provider_acceptances SET disclosure_hash='tampered' WHERE provider='stripe'",
  );
  assert.throws(
    () => f.app.identity.providerAllowed(f.actor, f.buyer, "stripe"),
    { code: "DISCLOSURE_INTEGRITY" },
  );
  store.run(
    "UPDATE iam_provider_acceptances SET disclosure_hash=? WHERE provider='stripe'",
    terms.hash,
  );
  store.run(
    "UPDATE iam_provider_disclosures SET body=? WHERE id=?",
    JSON.stringify({ ...terms, purposes: "Tampered purposes" }),
    terms.id,
  );
  assert.throws(
    () => f.app.identity.providerAllowed(f.actor, f.buyer, "stripe"),
    { code: "DISCLOSURE_INTEGRITY" },
  );
  assert.throws(() => f.app.identity.residency.disclosure(f.actor, terms.id), {
    code: "DISCLOSURE_INTEGRITY",
  });
});

test("HTTP protects private evidence, exact nested consent, CSRF and account/version scopes", async (t) => {
  const f = fixture(t),
    actor = buyer(f),
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  t.after(() => http.close());
  const login = async (email: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password: "long-test-only-password" },
    });
    assert.equal(r.statusCode, 200);
    return {
      origin,
      cookie: `${r.cookies[0]!.name}=${r.cookies[0]!.value}`,
      "x-csrf-token": r.json().csrf,
      "idempotency-key": "http-disclosure-choice",
    };
  };
  const headers = await login("disclosure-buyer@example.test"),
    admin = await login("admin@example.test"),
    input = choice(f, ["fedex"], 1, actor),
    terms = head(f, "fedex");
  const get = async (url: string, h = headers) =>
    http.inject({ url, headers: h });
  const publicResult = await get(`/api/provider-disclosures/${terms.id}`);
  assert.equal(publicResult.statusCode, 200);
  assert.deepEqual(publicResult.json(), terms);
  assert.ok(!JSON.stringify(publicResult.json()).includes("reviewEvidence"));
  assert.ok(
    !JSON.stringify(publicResult.json()).includes("fixture qualification"),
  );
  const send = async (payload: unknown, h = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/account.residency",
      headers: h,
      payload: payload as any,
    });
  assert.equal(
    (
      await send({
        ...input,
        acceptance: { ...input.acceptance!, adminOverride: true },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await send({
        ...input,
        acceptance: {
          ...input.acceptance!,
          disclosures: [
            { ...input.acceptance!.disclosures[0], hash: terms.hash },
          ],
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await send(input, { ...headers, "x-csrf-token": "bad" })).statusCode,
    403,
  );
  assert.equal((await send(input)).statusCode, 200);
  assert.equal((await send(input)).statusCode, 200);
  const url = `/api/accounts/${f.buyer}/provider-acceptances?version=2`;
  const fetched = await get(url);
  assert.equal(fetched.statusCode, 200, fetched.body);
  assert.equal(fetched.json()[0].representative, "Actual synthetic buyer");
  assert.equal((await get(url + "&extra=true")).statusCode, 400);
  assert.equal(
    (await get(`/api/accounts/${f.buyer}/provider-acceptances?version=0`))
      .statusCode,
    400,
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other buyer",
    tier: "standard",
    creditLimit: 0,
  }).id;
  assert.equal(
    (await get(`/api/accounts/${other}/provider-acceptances?version=2`))
      .statusCode,
    403,
  );
  const publication = syntheticDisclosure(
    f.app,
    "fedex",
    terms.id,
    "synthetic-http-v2",
  );
  const publish = (payload: unknown, h = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/provider.disclosure.publish",
      headers: h,
      payload: payload as any,
    });
  assert.equal((await publish(publication)).statusCode, 403);
  assert.equal(
    (await publish({ ...publication, unexpected: true }, admin)).statusCode,
    400,
  );
  assert.equal(
    (await publish(publication, { ...admin, "x-csrf-token": "bad" }))
      .statusCode,
    403,
  );
  assert.equal((await publish(publication, admin)).statusCode, 200);
  assert.equal((await get(url)).json()[0].disclosure_id, terms.id);
});

test(
  "concurrent disclosure publication and customer acceptance cannot leave stale permission active",
  { timeout: 15000 },
  async (t) => {
    const f = fixture(t),
      previous = head(f, "stripe"),
      input = choice(f, ["stripe"]);
    type Result = { ok: boolean; code?: string };
    const lanes = [
      {
        kind: "publish",
        payload: syntheticDisclosure(
          f.app,
          "stripe",
          previous.id,
          "synthetic-race-v2",
        ),
      },
      { kind: "choice", payload: input },
    ].map((task, i) => {
      const child = fork(
        new URL("./disclosure-child.ts", import.meta.url),
        [],
        {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      t.after(() => {
        if (!child.killed) child.kill();
      });
      let readyResolve!: () => void,
        resultResolve!: (r: Result) => void,
        resultReject!: (e: Error) => void,
        stderr = "";
      const ready = new Promise<void>((r) => (readyResolve = r)),
        result = new Promise<Result>((r, j) => {
          resultResolve = r;
          resultReject = j;
        });
      child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
      child.on("error", resultReject);
      child.on("exit", (code) => {
        if (code !== 0)
          resultReject(
            new Error(`Disclosure process exited ${code}: ${stderr}`),
          );
      });
      child.on("message", (message: any) =>
        message.ready ? readyResolve() : resultResolve(message),
      );
      child.send({
        action: "init",
        input: { ...task, path: f.path, actor: f.actor, key: `race-${i}` },
      });
      return { child, ready, result };
    });
    await Promise.all(lanes.map((l) => l.ready));
    lanes.forEach((l) => l.child.send({ action: "go" }));
    const results = await Promise.all(lanes.map((l) => l.result));
    assert.equal(results[0]!.ok, true);
    if (!results[1]!.ok)
      assert.equal(results[1]!.code, "DISCLOSURE_REVIEW_REQUIRED");
    assert.notEqual(head(f, "stripe").id, previous.id);
    assert.throws(
      () => f.app.identity.providerAllowed(f.actor, f.buyer, "stripe"),
      {
        code: results[1]!.ok
          ? "DISCLOSURE_REVIEW_REQUIRED"
          : "RESIDENCY_BLOCKED",
      },
    );
    const records = f.app.identity.residency.acceptances(f.actor, f.buyer, 2);
    assert.equal(records.length, results[1]!.ok ? 1 : 0);
    if (records.length) assert.equal(records[0]!.disclosure_id, previous.id);
  },
);
