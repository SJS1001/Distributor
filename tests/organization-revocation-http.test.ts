import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, syntheticDisclosure } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { OrganizationQuickBooksBrowser } from "../src/server/organization-quickbooks-browser.ts";
import { Application } from "../src/server/application.ts";

const origin = "http://127.0.0.1:3000";
const password = "long-test-only-password";
const security = { providerEncryptionKey: "ab".repeat(32) };
const endpoint = "/api/quickbooks/organization/revocation";
type T = Parameters<typeof fixture>[0];
function setup(t: T, region: "CA" | "US" = "CA") {
  const f = fixture(t, security, region);
  const residency = f.app.identity.organizationResidency;
  const { provider: _, ...terms } = syntheticDisclosure(f.app, "quickbooks");
  residency.publish(f.actor, "organization-terms", terms);
  const binding = {
    id: "synthetic-org-revocation-http",
    orgId: f.actor.orgId,
    workerUserId: f.actor.id,
    realm: "1234",
    clientId: "synthetic-client",
    redirectUri: `${origin}/quickbooks/organization/callback`,
  };
  const current = residency.current(f.actor);
  residency.choose(f.actor, "organization-choice", {
    region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: binding.realm,
    acknowledgment: "Synthetic acceptance",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic representative",
      evidenceRef: "synthetic:review",
    },
  });
  const authority = residency.permission(f.actor, binding.realm);
  const vault = f.app.providerCredentials.ledger;
  vault.install(
    binding,
    0,
    {
      accessToken: "synthetic-org-access",
      refreshToken: "synthetic-org-refresh",
      accessExpiresAt: Date.now() + 3600000,
      refreshExpiresAt: Date.now() + 86400000,
    },
    authority,
  );
  f.app.identity.createUser(f.actor, "finance", {
    email: "finance@example.test",
    name: "Synthetic finance",
    password,
    role: "finance",
    sites: [],
  });
  const session = f.app.identity.login("finance@example.test", password);
  const browser = new OrganizationQuickBooksBrowser(
    f.app,
    binding,
    "synthetic-secret",
    origin,
  );
  return { ...f, binding, authority, vault, session, browser };
}
function headers(session: { token: string; csrf: string }) {
  return {
    origin,
    cookie: `distributor_session=${session.token}`,
    "x-csrf-token": session.csrf,
  };
}
function mock(t: T, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
for (const region of ["CA", "US"] as const)
  test(`organization ${region} HTTP revocation disables before one explicit request and recovers the original receipt`, async (t) => {
    const f = setup(t, region);
    const http = await createHttp(f.app, {
      origin,
      staticRoot: "/missing-browser-build",
      organizationQuickbooksBrowser: f.browser,
    });
    t.after(() => http.close());
    let calls = 0;
    mock(t, async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
      );
      assert.equal(options?.method, "POST");
      assert.equal(options?.redirect, "error");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        token: "synthetic-org-refresh",
      });
      assert.equal(f.vault.status(f.binding).state, "disabled");
      return new Response(null, { status: 200 });
    });
    const payload = {
      receiptId: "reviewed-original-revocation",
      revision: 1,
      authority: f.authority,
    };
    const first = await http.inject({
      method: "POST",
      url: endpoint,
      headers: headers(f.session),
      payload,
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().state, "confirmed");
    assert.equal(first.json().confirmationSource, "provider-response");
    const replay = await http.inject({
      method: "POST",
      url: endpoint,
      headers: headers(f.session),
      payload,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), first.json());
    assert.equal(calls, 1);
    assert.equal(f.vault.status(f.binding).revision, 2);
    const audit = f.app.platform
      .audits(f.actor)
      .filter((row) =>
        String(row.action).startsWith("provider.ledger-revocation."),
      );
    assert.equal(audit.length, 2);
    assert.ok(audit.every((row) => row.actor_id === f.session.actor.id));
    assert.doesNotMatch(
      first.body,
      /synthetic-secret|synthetic-org-refresh|synthetic-org-access/,
    );
  });
test("organization US HTTP receipt review remains offline after withdrawal, logout and loss of the vault key", async (t) => {
  const f = setup(t, "US");
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: f.browser,
  });
  t.after(() => http.close());
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("synthetic-private-provider-body");
  });
  const payload = {
    receiptId: "uncertain-original",
    revision: 1,
    authority: f.authority,
  };
  const response = await http.inject({
    method: "POST",
    url: endpoint,
    headers: headers(f.session),
    payload,
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.equal(response.json().code, "REVOCATION_UNKNOWN");
  assert.doesNotMatch(response.body, /synthetic-private-provider-body/);
  f.app.identity.organizationResidency.choose(f.actor, "withdraw", {
    region: "US",
    revision: f.app.identity.organizationResidency.current(f.actor).choice
      .revision,
    mode: "strict",
    realm: null,
    acknowledgment: "Synthetic withdrawal",
  });
  f.app.identity.logout(f.session.token);
  f.app.platform.isolateRestore("synthetic-restore", new Date().toISOString());
  const app = new Application(f.path, "US");
  t.after(() => app.close());
  const session = app.identity.login("finance@example.test", password);
  const offline = await createHttp(app, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: new OrganizationQuickBooksBrowser(
      app,
      f.binding,
      "synthetic-secret",
      origin,
    ),
  });
  t.after(() => offline.close());
  const read = await offline.inject({
    method: "GET",
    url: `${endpoint}?receiptId=uncertain-original`,
    headers: headers(session),
  });
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().state, "unknown");
  assert.equal(read.json().disabledRevision, 2);
  const review = {
    receiptId: payload.receiptId,
    revision: 2,
    resolution: "provider-unconfirmed",
    evidence: "synthetic:externally-reviewed-outcome",
  };
  const reviewed = await offline.inject({
    method: "POST",
    url: `${endpoint}/review`,
    headers: headers(session),
    payload: review,
  });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  assert.equal(reviewed.json().state, "released");
  assert.equal(reviewed.json().providerRevocationConfirmed, false);
  assert.equal(
    app.providerCredentials.ledger.status(f.binding).state,
    "disabled",
  );
  const replay = await offline.inject({
    method: "POST",
    url: `${endpoint}/review`,
    headers: headers(session),
    payload: review,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), reviewed.json());
  assert.equal(calls, 1);
  assert.throws(
    () => app.platform.assertProviderAccess(),
    (error: unknown) => (error as { code: string }).code === "RECOVERY_HOLD",
  );
  const conflict = await offline.inject({
    method: "POST",
    url: `${endpoint}/review`,
    headers: headers(session),
    payload: { ...review, resolution: "provider-confirmed" },
  });
  assert.equal(conflict.json().code, "IDEMPOTENCY_CONFLICT");
  assert.equal(calls, 1);
});

test("organization HTTP revocation requires configured enablement, current finance, Origin, CSRF and exact bounded inputs", async (t) => {
  const f = setup(t);
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("unexpected provider request");
  });
  const disabled = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
  });
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: f.browser,
  });
  t.after(() => disabled.close());
  t.after(() => http.close());
  const payload = { receiptId: "refused", revision: 1, authority: f.authority };
  for (const request of [
    { method: "POST" as const, url: endpoint, payload },
    { method: "GET" as const, url: `${endpoint}?receiptId=refused` },
    {
      method: "POST" as const,
      url: `${endpoint}/review`,
      payload: {
        receiptId: "refused",
        revision: 2,
        resolution: "provider-confirmed",
        evidence: "synthetic:evidence",
      },
    },
  ]) {
    const response = await disabled.inject({
      ...request,
      headers: headers(f.session),
    });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().code, "PROVIDER_DISABLED");
  }
  const unauthenticated = await http.inject({
    method: "POST",
    url: endpoint,
    payload,
    headers: { origin },
  });
  assert.equal(unauthenticated.statusCode, 401);
  for (const badHeaders of [
    { ...headers(f.session), origin: "https://other.example.test" },
    { origin, cookie: `distributor_session=${f.session.token}` },
    { ...headers(f.session), "x-csrf-token": "wrong" },
  ]) {
    const response = await http.inject({
      method: "POST",
      url: endpoint,
      payload,
      headers: badHeaders,
    });
    assert.equal(response.statusCode, 403, response.body);
  }
  for (const bad of [
    { ...payload, revision: "1" },
    { ...payload, revision: 0 },
    { ...payload, revision: 1.5 },
    { ...payload, receiptId: "x".repeat(129) },
    { ...payload, receiptId: "" },
    { revision: 1, authority: f.authority },
    { ...payload, accountId: f.buyer },
    { ...payload, realm: "9999" },
    { ...payload, clientSecret: "synthetic-substitution" },
    { ...payload, authority: { ...f.authority, accountId: f.buyer } },
    { ...payload, authority: { ...f.authority, purpose: "buyer-accounting" } },
  ]) {
    const response = await http.inject({
      method: "POST",
      url: endpoint,
      payload: bad,
      headers: headers(f.session),
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  const oversized = await http.inject({
    method: "POST",
    url: endpoint,
    headers: { ...headers(f.session), "content-type": "application/json" },
    payload: JSON.stringify(payload) + " ".repeat(32768),
  });
  assert.equal(oversized.statusCode, 413);
  for (const query of [
    "",
    "?receiptId=x&realm=1234",
    "?receiptId=x&receiptId=y",
  ]) {
    const response = await http.inject({
      method: "GET",
      url: endpoint + query,
      headers: headers(f.session),
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  f.app.identity.createUser(f.actor, "support", {
    email: "support@example.test",
    name: "Synthetic support",
    password,
    role: "support",
    sites: [],
  });
  const support = f.app.identity.login("support@example.test", password);
  f.app.identity.createUser(f.actor, "buyer-login", {
    email: "buyer@example.test",
    name: "Synthetic buyer",
    password,
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const buyer = f.app.identity.login("buyer@example.test", password);
  for (const session of [support, buyer]) {
    const response = await http.inject({
      method: "POST",
      url: endpoint,
      headers: headers(session),
      payload,
    });
    assert.equal(response.statusCode, 403, response.body);
    const read = await http.inject({
      method: "GET",
      url: `${endpoint}?receiptId=missing`,
      headers: headers(session),
    });
    assert.equal(read.statusCode, 403, read.body);
  }
  const changedCompany = await http.inject({
    method: "POST",
    url: endpoint,
    headers: headers(f.session),
    payload: { ...payload, authority: { ...f.authority, realm: "9999" } },
  });
  assert.equal(changedCompany.statusCode, 403);
  assert.equal(calls, 0);
  assert.equal(f.vault.status(f.binding).state, "ready");
  assert.equal(f.vault.status(f.binding).revision, 1);
});

for (const change of ["logout", "role", "password"] as const)
  test(`organization HTTP ${change} during an outstanding request cannot accept its late confirmation`, async (t) => {
    const f = setup(t);
    const http = await createHttp(f.app, {
      origin,
      staticRoot: "/missing-browser-build",
      organizationQuickbooksBrowser: f.browser,
    });
    t.after(() => http.close());
    let calls = 0;
    mock(t, async () => {
      calls++;
      if (change === "logout") f.app.identity.logout(f.session.token);
      else {
        const user = f.app.identity
          .users(f.actor)
          .find((u) => u.id === f.session.actor.id)!;
        if (change === "role")
          f.app.identity.updateUser(f.actor, "changed-role", {
            userId: user.id,
            revision: user.revision,
            email: user.email,
            name: user.name,
            role: "support",
            sites: [],
            active: true,
            currentPassword: password,
            reason: "Synthetic role change",
          });
        else
          f.app.identity.resetPassword(f.actor, "reset-password", {
            userId: user.id,
            revision: user.revision,
            password: "new-synthetic-only-password",
            currentPassword: password,
            reason: "Synthetic password reset",
          });
      }
      return new Response(null, { status: 200 });
    });
    const response = await http.inject({
      method: "POST",
      url: endpoint,
      headers: headers(f.session),
      payload: { receiptId: "late-reply", revision: 1, authority: f.authority },
    });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().code, "REVOCATION_UNKNOWN");
    assert.equal(
      f.vault.revocation.status(f.binding, "late-reply").state,
      "unknown",
    );
    assert.equal(f.vault.status(f.binding).state, "disabled");
    assert.equal(calls, 1);
    assert.ok(
      !f.app.platform
        .audits(f.actor)
        .some((row) => row.action === "provider.ledger-revocation.confirmed"),
    );
  });

for (const requirement of ["password", "mfa"] as const)
  test(`organization HTTP and native browser revocation enforce current ${requirement} requirements before sending or reading`, async (t) => {
    const f = setup(t);
    let app = f.app;
    let session = f.session;
    if (requirement === "mfa") {
      app = new Application(f.path, "CA", {
        ...security,
        mfaEncryptionKey: "cd".repeat(32),
        mfaRequiredRoles: ["finance"],
      });
      t.after(() => app.close());
    } else {
      const user = app.identity
        .users(f.actor)
        .find((u) => u.id === session.actor.id)!;
      app.identity.resetPassword(f.actor, "force-password-change", {
        userId: user.id,
        revision: user.revision,
        password: "new-synthetic-only-password",
        currentPassword: password,
        reason: "Synthetic reset",
      });
      session = app.identity.login(
        "finance@example.test",
        "new-synthetic-only-password",
      );
    }
    const browser = new OrganizationQuickBooksBrowser(
      app,
      f.binding,
      "synthetic-secret",
      origin,
    );
    const http = await createHttp(app, {
      origin,
      staticRoot: "/missing-browser-build",
      organizationQuickbooksBrowser: browser,
    });
    t.after(() => http.close());
    let calls = 0;
    mock(t, async () => {
      calls++;
      throw new Error("unexpected provider request");
    });
    const payload = {
      receiptId: "security-refused",
      revision: 1,
      authority: f.authority,
    };
    const response = await http.inject({
      method: "POST",
      url: endpoint,
      headers: headers(session),
      payload,
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(
      response.json().code,
      requirement === "mfa"
        ? "MFA_ENROLLMENT_REQUIRED"
        : "PASSWORD_CHANGE_REQUIRED",
    );
    await assert.rejects(
      browser.revoke(session.token, payload.receiptId, 1, f.authority),
      (error: unknown) =>
        (error as { code: string }).code === "REVOCATION_SECURITY",
    );
    assert.throws(
      () => browser.revocationStatus(session.token, "missing"),
      (error: unknown) =>
        (error as { code: string }).code === "REVOCATION_SECURITY",
    );
    assert.throws(
      () =>
        browser.reviewRevocation(
          session.token,
          "missing",
          2,
          "provider-confirmed",
          "synthetic:evidence",
        ),
      (error: unknown) =>
        (error as { code: string }).code === "REVOCATION_SECURITY",
    );
    assert.equal(calls, 0);
    assert.equal(
      app.providerCredentials.ledger.status(f.binding).state,
      "ready",
    );
  });

test("organization HTTP review validates exact disabled revision and explicit evidence and records finance confirmation offline", async (t) => {
  const f = setup(t);
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/missing-browser-build",
    organizationQuickbooksBrowser: f.browser,
  });
  t.after(() => http.close());
  let calls = 0;
  mock(t, async () => {
    calls++;
    throw new Error("synthetic-unknown");
  });
  const original = {
    receiptId: "finance-review",
    revision: 1,
    authority: f.authority,
  };
  const response = await http.inject({
    method: "POST",
    url: endpoint,
    headers: headers(f.session),
    payload: original,
  });
  assert.equal(response.json().code, "REVOCATION_UNKNOWN");
  const review = {
    receiptId: original.receiptId,
    revision: 2,
    resolution: "provider-confirmed",
    evidence: "synthetic:recorded-independent-provider-outcome",
  };
  for (const bad of [
    { ...review, evidence: "" },
    { ...review, evidence: "x".repeat(2001) },
    { ...review, resolution: "success" },
    { ...review, revision: "2" },
    { ...review, workerUserId: f.actor.id },
    { ...review, authority: f.authority },
  ]) {
    const result = await http.inject({
      method: "POST",
      url: `${endpoint}/review`,
      headers: headers(f.session),
      payload: bad,
    });
    assert.equal(result.statusCode, 400, result.body);
  }
  const stale = await http.inject({
    method: "POST",
    url: `${endpoint}/review`,
    headers: headers(f.session),
    payload: { ...review, revision: 1 },
  });
  assert.equal(stale.json().code, "REVISION");
  const repeatDifferentId = await http.inject({
    method: "POST",
    url: endpoint,
    headers: headers(f.session),
    payload: { ...original, receiptId: "other-receipt" },
  });
  assert.equal(repeatDifferentId.json().code, "REVOCATION_REVIEW");
  const reviewed = await http.inject({
    method: "POST",
    url: `${endpoint}/review`,
    headers: headers(f.session),
    payload: review,
  });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  assert.equal(reviewed.json().state, "confirmed");
  assert.equal(reviewed.json().confirmationSource, "operator-evidence");
  assert.equal(calls, 1);
  assert.equal(f.vault.status(f.binding).state, "disabled");
  const audit = f.app.platform
    .audits(f.actor)
    .find((row) => row.action === "provider.ledger-revocation.review")!;
  assert.equal(audit.actor_id, f.session.actor.id);
  assert.ok(String(audit.detail).includes(review.evidence));
  const second = f.app.identity.login("finance@example.test", password);
  const recovery = await http.inject({
    method: "GET",
    url: `${endpoint}?receiptId=finance-review`,
    headers: headers(second),
  });
  assert.deepEqual(recovery.json(), reviewed.json());
  f.app.identity.logout(second.token);
  const expired = await http.inject({
    method: "GET",
    url: `${endpoint}?receiptId=finance-review`,
    headers: headers(second),
  });
  assert.equal(expired.statusCode, 401);
});
