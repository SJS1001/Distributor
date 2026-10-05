import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";
import type { EnrollmentSubmission } from "../src/shared/enrollment.ts";
const adminPassword = "long-test-only-password";
const buyerPassword = "synthetic-buyer-password";
const origin = "https://distributor.example.test";
const submission: EnrollmentSubmission = {
  businessName: "Synthetic Contractor Ltd",
  contactName: "Synthetic Applicant",
  email: "contractor@example.test",
  phone: "416-555-0100",
  province: "ON",
  acknowledgment: true,
};
function apply(f: ReturnType<typeof fixture>, email = submission.email) {
  f.app.enrollment.submit(f.actor.orgId, { ...submission, email });
  return f.app.enrollment.queue(f.actor).items.find((r) => r.email === email)!;
}
function approve(
  f: ReturnType<typeof fixture>,
  applicationId: string,
  actor = f.actor,
) {
  return f.app.enrollment.decide(actor, applicationId, {
    decision: "approve",
    currentPassword: adminPassword,
    reason: "Synthetic trade review complete",
    tier: "contractor",
    creditLimit: 250000,
  });
}
async function httpSetup(t: Parameters<typeof fixture>[0], enabled = true) {
  const f = fixture(t);
  const http = await createHttp(f.app, {
    origin,
    enrollmentOrganizationId: enabled ? f.actor.orgId : undefined,
  });
  t.after(() => {
    void http.close();
  });
  await http.ready();
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { email: "admin@example.test", password: adminPassword },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies[0]!;
  return {
    ...f,
    http,
    headers: {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf as string,
    },
  };
}
test("public enrollment defaults closed and validates configured CA/CAD organization", async (t) => {
  const f = await httpSetup(t, false);
  const config = await f.http.inject({
    method: "GET",
    url: "/api/enrollment/config",
  });
  assert.equal(config.json().enabled, false);
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: "/api/enrollment/applications",
        headers: { origin },
        payload: submission,
      })
    ).statusCode,
    503,
  );
  assert.throws(() => f.app.enrollment.config("other-org"), {
    code: "ENROLLMENT_CONFIGURATION",
  });
  const us = new Application(":memory:", "US");
  try {
    const admin = us.identity.bootstrap(
      "Synthetic US",
      "admin@us.test",
      adminPassword,
      "USD",
    );
    assert.throws(() => us.enrollment.config(admin.orgId), {
      code: "ENROLLMENT_CONFIGURATION",
    });
  } finally {
    us.close();
  }
});
test("public responses are generic; payload authority injection and cross-origin writes are refused", async (t) => {
  const f = await httpSetup(t);
  const post = (payload: unknown, headers = { origin }) =>
    f.http.inject({
      method: "POST",
      url: "/api/enrollment/applications",
      headers,
      payload: payload as object,
    });
  assert.equal(
    (await post(submission, { origin: "https://attacker.test" })).statusCode,
    403,
  );
  assert.equal(
    (
      await post({
        ...submission,
        role: "admin",
        orgId: "other",
        accountId: f.buyer,
      })
    ).statusCode,
    400,
  );
  const first = await post(submission);
  assert.equal(first.statusCode, 202);
  assert.deepEqual(first.json(), { received: true });
  assert.equal(first.headers["cache-control"], "no-store");
  assert.equal(first.headers["referrer-policy"], "no-referrer");
  assert.deepEqual(
    (await post({ ...submission, businessName: "Attacker changes" })).json(),
    first.json(),
  );
  assert.deepEqual(
    (await post({ ...submission, email: "ADMIN@example.test" })).json(),
    first.json(),
  );
  const rows = f.app.enrollment.queue(f.actor).items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.businessName, submission.businessName);
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: "/api/enrollment/applications",
      })
    ).statusCode,
    401,
  );
});
test("staff-approved invitation activates only its reviewed customer as a strict-residency buyer", async (t) => {
  const f = await httpSetup(t),
    application = apply(f);
  assert.throws(() => f.app.identity.login(submission.email, buyerPassword), {
    code: "LOGIN",
  });
  const url = `/api/enrollment/applications/${application.id}/decision`;
  const payload = {
    decision: "approve",
    currentPassword: adminPassword,
    reason: "Synthetic business review",
    tier: "contractor",
    creditLimit: 250000,
  };
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: { ...f.headers, "x-csrf-token": "bad" },
        payload,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: { ...payload, currentPassword: "wrong" },
      })
    ).statusCode,
    403,
  );
  const decision = await f.http.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload,
  });
  assert.equal(decision.statusCode, 200, decision.body);
  const result = decision.json();
  const record = f.app.enrollment.queue(f.actor).items[0]!;
  assert.equal(record.status, "approved");
  assert.equal(record.invitationActive, true);
  assert.equal(JSON.stringify(record).includes(result.activationToken), false);
  const persisted = f.app.database
    .owned("enrollment")
    .get("SELECT * FROM enrollment_applications WHERE id=?", application.id)!;
  assert.equal(persisted.token_hash, digest(result.activationToken));
  assert.equal(
    JSON.stringify(persisted).includes(result.activationToken),
    false,
  );
  const activate = (extra = {}) =>
    f.http.inject({
      method: "POST",
      url: "/api/enrollment/activate",
      headers: { origin },
      payload: {
        token: result.activationToken,
        password: buyerPassword,
        ...extra,
      },
    });
  assert.equal((await activate({ role: "admin" })).statusCode, 400);
  assert.equal((await activate()).statusCode, 200);
  assert.equal((await activate()).statusCode, 400);
  const session = f.app.identity.login(submission.email, buyerPassword);
  assert.equal(session.actor.role, "buyer");
  assert.deepEqual(session.actor.sites, []);
  assert.equal(session.actor.orgId, f.actor.orgId);
  assert.equal(session.actor.accountId, record.accountId);
  const customer = f.app.identity.customer(session.actor, record.accountId!);
  assert.equal(customer.tier, "contractor");
  assert.equal(customer.credit_limit, 250000);
  assert.equal(customer.residency_mode, "strict");
  assert.equal(customer.provider_exceptions, "[]");
  assert.throws(() => f.app.identity.customer(session.actor, f.buyer), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.enrollment.queue(session.actor), {
    code: "FORBIDDEN",
  });
  const audit = JSON.stringify(
    f.app.database.owned("platform").all("SELECT detail FROM platform_audit"),
  );
  assert.equal(audit.includes(result.activationToken), false);
  assert.equal(audit.includes(buyerPassword), false);
  assert.equal(audit.includes(adminPassword), false);
  assert.equal(f.app.enrollment.queue(f.actor).items[0]!.status, "activated");
});
test("expiry, revocation and reissue retain one customer and invalidate all older tokens", (t) => {
  const f = fixture(t),
    application = apply(f),
    first = approve(f, application.id);
  assert.throws(() => approve(f, application.id), {
    code: "APPLICATION_REVIEWED",
  });
  const store = f.app.database.owned("enrollment");
  store.run(
    "UPDATE enrollment_applications SET expires_at=? WHERE id=?",
    Date.now() - 1,
    application.id,
  );
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        first.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  const second = f.app.enrollment.invitation(f.actor, application.id, {
    action: "reissue",
    currentPassword: adminPassword,
    reason: "Synthetic expired invitation",
  });
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        first.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  f.app.enrollment.invitation(f.actor, application.id, {
    action: "revoke",
    currentPassword: adminPassword,
    reason: "Synthetic stop",
  });
  assert.equal(
    f.app.enrollment.queue(f.actor).items[0]!.invitationActive,
    false,
  );
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        second.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  const third = f.app.enrollment.invitation(f.actor, application.id, {
    action: "reissue",
    currentPassword: adminPassword,
    reason: "Synthetic verified handoff",
  });
  assert.equal(
    f.app.enrollment.activate(
      f.actor.orgId,
      third.activationToken!,
      buyerPassword,
    )?.activated,
    true,
  );
  assert.equal(
    f.app.identity
      .customers(f.actor)
      .filter((c) => c.name === submission.businessName).length,
    1,
  );
  assert.throws(
    () =>
      f.app.enrollment.invitation(f.actor, application.id, {
        action: "reissue",
        currentPassword: adminPassword,
        reason: "Synthetic replay",
      }),
    { code: "APPLICATION_STATE" },
  );
});
test("activation rechecks sponsor authority, identity uniqueness and retained commercial terms", (t) => {
  const f = fixture(t);
  const sponsorId = f.app.identity.createUser(f.actor, "sponsor", {
    email: "sponsor@example.test",
    name: "Synthetic Sponsor",
    role: "admin",
    password: adminPassword,
    sites: [],
  }).id;
  const sponsor = f.app.identity.currentActor({ ...f.actor, id: sponsorId });
  const application = apply(f),
    approval = approve(f, application.id, sponsor);
  f.app.identity.updateUser(f.actor, "sponsor-revoke", {
    userId: sponsorId,
    revision: 1,
    email: "sponsor@example.test",
    name: "Synthetic Sponsor",
    role: "commercial",
    sites: [],
    active: true,
    currentPassword: adminPassword,
    reason: "Synthetic access withdrawal",
  });
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        approval.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  assert.throws(
    () =>
      f.app.enrollment.decide(sponsor, application.id, {
        decision: "reject",
        currentPassword: adminPassword,
        reason: "Synthetic stale authority",
      }),
    { code: "FORBIDDEN" },
  );
  const renewed = f.app.enrollment.invitation(f.actor, application.id, {
    action: "reissue",
    currentPassword: adminPassword,
    reason: "New authorized sponsor",
  });
  const customerId = f.app.enrollment.queue(f.actor).items[0]!.accountId!;
  f.app.identity.setHold(f.actor, "hold", {
    accountId: customerId,
    held: true,
    reason: "Synthetic commercial stop",
  });
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        renewed.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  f.app.identity.setHold(f.actor, "unhold", {
    accountId: customerId,
    held: false,
    reason: "Synthetic review completed",
  });
  f.app.identity.createUser(f.actor, "email-taken", {
    email: submission.email,
    name: "Separate reviewed identity",
    role: "commercial",
    password: buyerPassword,
    sites: [],
  });
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        renewed.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  assert.equal(f.app.enrollment.queue(f.actor).items[0]!.status, "approved");
  assert.equal(
    f.app.identity.login(submission.email, buyerPassword).actor.role,
    "commercial",
  );
});
test("approval requires explicit reviewed terms and password; failures preserve pending application", (t) => {
  const f = fixture(t),
    application = apply(f);
  for (const input of [
    { decision: "approve", reason: "review", tier: "trade", creditLimit: 0 },
    { decision: "approve", currentPassword: adminPassword, reason: "review" },
    {
      decision: "approve",
      currentPassword: adminPassword,
      reason: "review",
      tier: "trade",
      creditLimit: -1,
    },
  ])
    assert.throws(() =>
      f.app.enrollment.decide(f.actor, application.id, input as never),
    );
  assert.equal(f.app.enrollment.queue(f.actor).items[0]!.status, "pending");
  assert.equal(
    f.app.identity
      .customers(f.actor)
      .filter((c) => c.name === submission.businessName).length,
    0,
  );
  f.app.enrollment.decide(f.actor, application.id, {
    decision: "reject",
    currentPassword: adminPassword,
    reason: "Synthetic review declined",
  });
  assert.equal(f.app.enrollment.queue(f.actor).items[0]!.status, "rejected");
});
test("abuse counters are durable, bounded and count malformed requests without trusting forwarded addresses", async (t) => {
  const f = await httpSetup(t);
  for (let n = 0; n < 10; n++) {
    const response = await f.http.inject({
      method: "POST",
      url: "/api/enrollment/applications",
      headers: { origin, "x-forwarded-for": `192.0.2.${n}` },
      payload: { malicious: true },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: "/api/enrollment/applications",
        headers: { origin },
        payload: submission,
      })
    ).statusCode,
    429,
  );
  const reopened = new Application(f.path);
  try {
    assert.throws(
      () => reopened.enrollment.throttle("apply", "127.0.0.1", f.actor.orgId),
      { code: "RATE_LIMIT" },
    );
  } finally {
    reopened.close();
  }
  const store = f.app.database.owned("enrollment");
  assert.equal(store.get("SELECT COUNT(*) AS n FROM enrollment_limits")!.n, 2);
  assert.equal(
    JSON.stringify(store.all("SELECT * FROM enrollment_limits")).includes(
      "127.0.0.1",
    ),
    false,
  );
  store.run("UPDATE enrollment_limits SET reset_at=0");
  f.app.enrollment.throttle("apply", "127.0.0.1", f.actor.orgId);
  assert.equal(store.get("SELECT COUNT(*) AS n FROM enrollment_limits")!.n, 2);
});
test("a full application store does not disclose existing email or application membership", (t) => {
  const f = fixture(t),
    application = apply(f),
    store = f.app.database.owned("enrollment");
  f.app.database.transaction(() => {
    for (let n = 1; n < 5000; n++)
      store.run(
        `INSERT INTO enrollment_applications(id,org_id,business_name,contact_name,email,phone,province,business_number,notes,status,created_at) SELECT ?,org_id,business_name,contact_name,?,phone,province,business_number,notes,status,created_at FROM enrollment_applications WHERE id=?`,
        `synthetic-cap-${n}`,
        `cap-${n}@example.test`,
        application.id,
      );
  });
  for (const email of [
    submission.email,
    "admin@example.test",
    "new@example.test",
  ])
    assert.throws(
      () => f.app.enrollment.submit(f.actor.orgId, { ...submission, email }),
      { code: "ENROLLMENT_UNAVAILABLE" },
    );
  assert.equal(
    store.get("SELECT COUNT(*) AS n FROM enrollment_applications")!.n,
    5000,
  );
});
test("an exhausted peer cannot drain the shared request budget", (t) => {
  const f = fixture(t);
  for (let n = 0; n < 10; n++)
    f.app.enrollment.throttle("apply", "peer-one", f.actor.orgId);
  for (let n = 0; n < 100; n++)
    assert.throws(
      () => f.app.enrollment.throttle("apply", "peer-one", f.actor.orgId),
      { code: "RATE_LIMIT" },
    );
  f.app.enrollment.throttle("apply", "peer-two", f.actor.orgId);
  assert.equal(
    f.app.database
      .owned("enrollment")
      .get("SELECT count FROM enrollment_limits WHERE key='apply:global'")!
      .count,
    11,
  );
});
for (const action of ["approve", "reject", "reissue", "revoke"] as const)
  test(`a password changed after outer authentication refuses ${action} atomically`, (t) => {
    const f = fixture(t),
      application = apply(f);
    const invitation = action === "reissue" || action === "revoke";
    if (invitation) approve(f, application.id);
    const before = f.app.database
      .owned("enrollment")
      .get("SELECT * FROM enrollment_applications WHERE id=?", application.id);
    const original = f.app.identity.enrollmentAuthority.bind(f.app.identity);
    let changed = false;
    f.app.identity.enrollmentAuthority = (actor, password, throttle = true) => {
      const result = original(actor, password, throttle);
      if (password !== undefined && throttle && !changed) {
        changed = true;
        // A second connection commits precisely between the durable outer check
        // and the enrollment transaction, as another logged-in session can.
        const other = new Application(f.path);
        try {
          other.identity.changePassword(f.actor, "concurrent-password-change", {
            currentPassword: adminPassword,
            password: "changed-synthetic-password",
          });
        } finally {
          other.close();
        }
      }
      return result;
    };
    assert.throws(
      () =>
        invitation
          ? f.app.enrollment.invitation(f.actor, application.id, {
              action: action as "reissue" | "revoke",
              currentPassword: adminPassword,
              reason: "Synthetic review",
            })
          : f.app.enrollment.decide(f.actor, application.id, {
              decision: action as "approve" | "reject",
              currentPassword: adminPassword,
              reason: "Synthetic review",
              tier: "trade",
              creditLimit: 0,
            }),
      { code: "REAUTHENTICATE" },
    );
    assert.equal(changed, true);
    assert.deepEqual(
      f.app.database
        .owned("enrollment")
        .get(
          "SELECT * FROM enrollment_applications WHERE id=?",
          application.id,
        ),
      before,
    );
    assert.equal(
      f.app.identity
        .customers(f.actor)
        .filter((c) => c.name === submission.businessName).length,
      invitation ? 1 : 0,
    );
  });
test("late audit failure rolls back customer creation and invitation consumption", (t) => {
  const f = fixture(t),
    application = apply(f),
    original = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = (actor, action, reference, detail) => {
    if (action === "enrollment.approve") throw Error("Synthetic audit failure");
    return original(actor, action, reference, detail);
  };
  assert.throws(() => approve(f, application.id));
  assert.equal(f.app.enrollment.queue(f.actor).items[0]!.status, "pending");
  assert.equal(
    f.app.identity
      .customers(f.actor)
      .filter((c) => c.name === submission.businessName).length,
    0,
  );
  f.app.platform.audit = original;
  const approval = approve(f, application.id);
  f.app.platform.audit = (actor, action, reference, detail) => {
    if (action === "enrollment.activate")
      throw Error("Synthetic audit failure");
    return original(actor, action, reference, detail);
  };
  assert.throws(
    () =>
      f.app.enrollment.activate(
        f.actor.orgId,
        approval.activationToken!,
        buyerPassword,
      ),
    { code: "INVITATION_INVALID" },
  );
  assert.equal(f.app.identity.enrollmentEmailAvailable(submission.email), true);
  assert.equal(f.app.enrollment.queue(f.actor).items[0]!.status, "approved");
  f.app.platform.audit = original;
  assert.equal(
    f.app.enrollment.activate(
      f.actor.orgId,
      approval.activationToken!,
      buyerPassword,
    )?.activated,
    true,
  );
});
test("two independent processes racing one invitation produce exactly one buyer", async (t) => {
  const f = fixture(t),
    application = apply(f),
    approval = approve(f, application.id);
  const children = [0, 1].map(() =>
    fork(new URL("./enrollment-activation-child.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  t.after(() => children.forEach((child) => child.kill()));
  await Promise.all(
    children.map(async (child) => {
      const ready = once(child, "message");
      child.send({ action: "ready", path: f.path });
      assert.deepEqual((await ready)[0], { ready: true });
    }),
  );
  const pending = children.map((child) => once(child, "message"));
  children.forEach((child) =>
    child.send({
      action: "activate",
      orgId: f.actor.orgId,
      token: approval.activationToken,
    }),
  );
  const outcomes = (await Promise.all(pending)).map(
    ([message]) => message as { ok: boolean; code?: string },
  );
  assert.equal(outcomes.filter((r) => r.ok).length, 1);
  assert.equal(outcomes.find((r) => !r.ok)!.code, "INVITATION_INVALID");
  assert.equal(
    f.app.identity.users(f.actor).filter((u) => u.email === submission.email)
      .length,
    1,
  );
});
