import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";
import { Billing } from "../src/server/billing.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import type { Adapter } from "../src/server/integration.ts";
import type { Actor, Role } from "../src/server/core.ts";

function setup(t: Parameters<typeof fixture>[0], count = 1) {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic test permission",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      11300,
      "stripe",
      "pi_synthetic",
    ),
  );
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "CR1",
    reason: "Private credit reason",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const refunds = Array.from({ length: count }, (_, index) => {
    const refund = f.app.billing.refundRequest(f.actor, `refund-${index}`, {
      invoiceId,
      paymentId: payment.id,
      amount: count === 1 ? 11300 : 100,
      reference: `PRIVATE-REF-${index}`,
      reason: "Private refund reason",
    });
    const queued = f.app.integration.refund(f.actor, `queue-${index}`, {
      refundId: refund.id,
    });
    return { id: refund.id, effectId: queued.id };
  });
  const adapter = (status: string): Adapter => ({
    execute: async (e) => ({
      reference: `re_${e.reference.replaceAll("-", "")}`,
      result: { ...JSON.parse(e.payload), effectId: e.id, status },
    }),
    lookup: async (e) => ({
      reference: `re_${e.reference.replaceAll("-", "")}`,
      result: { ...JSON.parse(e.payload), effectId: e.id, status },
    }),
  });
  const observe = async (status: string, index = 0) => {
    const e = f.app.integration.effect(f.actor, refunds[index]!.effectId);
    if (e.state === "pending")
      await f.app.integration.execute(f.actor, e.id, adapter(status));
    else
      await f.app.integration.refunds.run(
        f.actor,
        e.id,
        adapter(status),
        false,
      );
  };
  const user = (name: string, role: Role, accountId = f.buyer): Actor => {
    const result = f.app.identity.createUser(f.actor, `user-${name}`, {
      name,
      email: `${name}@example.test`,
      password: "long-notice-test-password",
      role,
      ...(role === "buyer" ? { accountId } : {}),
      sites: [],
    });
    return f.app.identity.currentActor({ ...f.actor, id: result.id });
  };
  return Object.assign(f, { invoiceId, refunds, observe, user });
}

test("refund exceptions create one case, applied outcomes update it, and personal reads never confirm repayment", async (t) => {
  const f = setup(t),
    buyer = f.user("buyer-one", "buyer"),
    second = f.user("buyer-two", "buyer");
  const notices = () => f.app.billing.refunds.alerts;
  assert.deepEqual(notices().page(buyer), { items: [], next: null, unread: 0 });
  await f.observe("pending");
  assert.equal(notices().page(buyer).items.length, 0);
  await f.observe("requires_action");
  const first = notices().page(buyer).items[0]!;
  assert.equal(first.state, "open");
  assert.equal(first.revision, 1);
  assert.equal(first.amount, 11300);
  assert.equal(first.currency, "CAD");
  const before = f.app.billing.totals(f.actor, f.invoiceId);
  const receipt = notices().acknowledge(buyer, "lost-response", {
    noticeId: first.id,
    revision: 1,
  });
  assert.deepEqual(
    notices().acknowledge(buyer, "lost-response", {
      noticeId: first.id,
      revision: 1,
    }),
    receipt,
  );
  assert.equal(notices().page(buyer).unread, 0);
  assert.equal(notices().page(second).unread, 1);
  assert.equal(notices().page(f.actor).unread, 1);
  assert.deepEqual(f.app.billing.totals(f.actor, f.invoiceId), before);
  await f.observe("requires_action");
  assert.equal(notices().history(buyer, first.id).items.length, 1);
  await f.observe("pending");
  assert.equal(notices().page(buyer).items[0]!.state, "resolved");
  assert.match(notices().page(buyer).items[0]!.message, /not been confirmed/);
  assert.equal(notices().page(buyer).unread, 1);
  await f.observe("succeeded");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 11300);
  assert.equal(notices().page(buyer).items[0]!.revision, 3);
  await f.observe("pending"); // Delayed unapplied status must not update the case.
  assert.equal(notices().page(buyer).items[0]!.revision, 3);
  await f.observe("failed");
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.equal(notices().page(buyer).items[0]!.state, "open");
  assert.equal(notices().page(buyer).items[0]!.revision, 4);
  assert.deepEqual(
    notices()
      .history(buyer, first.id)
      .items.map((n) => n.status),
    ["failed", "succeeded", "pending", "requires_action"],
  );
  await f.observe("succeeded"); // Terminal failed state cannot be reopened by a delayed success.
  assert.equal(notices().page(buyer).items[0]!.revision, 4);
  assert.deepEqual(
    notices().acknowledge(buyer, "lost-response", {
      noticeId: first.id,
      revision: 1,
    }),
    receipt,
  );
  assert.equal(notices().page(buyer).unread, 1);
  assert.throws(
    () =>
      notices().acknowledge(buyer, "stale", {
        noticeId: first.id,
        revision: 3,
      }),
    { code: "STALE" },
  );
  notices().acknowledge(buyer, "latest", { noticeId: first.id, revision: 4 });
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(notices().page(buyer).unread, 0);
  assert.equal(notices().page(second).unread, 1);
  assert.equal(notices().history(buyer, first.id).items.length, 4);
});

test("notice access rereads account, role, activation and credential grants before reads and cached acknowledgments", async (t) => {
  const f = setup(t);
  await f.observe("canceled");
  const buyer = f.user("notice-buyer", "buyer"),
    finance = f.user("notice-finance", "finance"),
    support = f.user("notice-support", "support"),
    commercial = f.user("notice-commercial", "commercial");
  const otherAccount = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other account",
    tier: "standard",
    creditLimit: 100000,
  }).id;
  const other = f.user("other-buyer", "buyer", otherAccount),
    alerts = f.app.billing.refunds.alerts,
    id = f.refunds[0]!.id;
  assert.equal(alerts.page(finance).items[0]!.accountId, f.buyer);
  assert.equal(alerts.page(support).items.length, 1);
  assert.equal(alerts.page(other).unread, 0);
  assert.throws(() => alerts.history(other, id), { code: "NOT_FOUND" });
  assert.throws(
    () => alerts.acknowledge(other, "guess", { noticeId: id, revision: 1 }),
    { code: "NOT_FOUND" },
  );
  assert.throws(() => alerts.page(commercial), { code: "FORBIDDEN" });
  const projected = JSON.stringify({
    page: alerts.page(buyer),
    history: alerts.history(buyer, id),
  });
  for (const privateValue of [
    "Private",
    "PRIVATE-REF",
    "pi_synthetic",
    "re_",
    "accountId",
    "org_id",
    "actor_id",
    "external_ref",
  ])
    assert.ok(!projected.includes(privateValue), privateValue);
  alerts.acknowledge(buyer, "read", { noticeId: id, revision: 1 });
  const iam = f.app.database.owned("iam");
  iam.run(
    "UPDATE iam_users SET account_id=? WHERE id=?",
    otherAccount,
    buyer.id,
  );
  assert.equal(alerts.page(buyer).items.length, 0);
  assert.throws(
    () => alerts.acknowledge(buyer, "read", { noticeId: id, revision: 1 }),
    { code: "NOT_FOUND" },
  );
  iam.run(
    "UPDATE iam_users SET account_id=?,role='warehouse' WHERE id=?",
    f.buyer,
    buyer.id,
  );
  assert.throws(
    () => alerts.acknowledge(buyer, "read", { noticeId: id, revision: 1 }),
    { code: "FORBIDDEN" },
  );
  iam.run("UPDATE iam_users SET role='buyer',active=0 WHERE id=?", buyer.id);
  assert.throws(() => alerts.page(buyer), { code: "FORBIDDEN" });
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", buyer.id);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    buyer.id,
  );
  assert.throws(
    () => alerts.acknowledge(buyer, "read", { noticeId: id, revision: 1 }),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
});

test("foreign organizations cannot list, count, inspect or acknowledge another organization's refund notices", async (t) => {
  const f = setup(t);
  await f.observe("requires_action");
  const other = fixture(t),
    foreign = other.actor;
  const org = other.app.identity.organization(foreign);
  const user = other.app.database
    .owned("iam")
    .get("SELECT * FROM iam_users WHERE id=?", foreign.id)!;
  const iam = f.app.database.owned("iam");
  iam.run(
    "INSERT INTO iam_organizations VALUES(?,?,?,?,?)",
    org.id,
    org.name,
    org.region,
    org.currency,
    org.policy,
  );
  iam.run(
    "INSERT INTO iam_users(id,org_id,email,name,role,sites,salt,password_hash) VALUES(?,?,?,?,?,?,?,?)",
    String(user.id),
    String(user.org_id),
    "foreign-notice@example.test",
    String(user.name),
    String(user.role),
    String(user.sites),
    String(user.salt),
    String(user.password_hash),
  );
  const alerts = f.app.billing.refunds.alerts,
    id = f.refunds[0]!.id;
  assert.deepEqual(alerts.page(foreign), { items: [], next: null, unread: 0 });
  assert.throws(() => alerts.history(foreign, id), { code: "NOT_FOUND" });
  assert.throws(
    () =>
      alerts.acknowledge(foreign, "foreign-read", {
        noticeId: id,
        revision: 1,
      }),
    { code: "NOT_FOUND" },
  );
  assert.equal(alerts.page(f.actor).unread, 1);
  assert.equal(
    f.app.database
      .owned("billing")
      .all("SELECT * FROM billing_refund_alert_reads").length,
    0,
  );
});

test("bounded notice and history pages preserve their cursor when new cases and updates arrive", async (t) => {
  const f = setup(t, 4),
    alerts = f.app.billing.refunds.alerts;
  for (let i = 0; i < 3; i++) await f.observe("requires_action", i);
  const first = alerts.page(f.actor, { limit: 2 });
  assert.deepEqual(
    first.items.map((n) => n.id),
    [f.refunds[2]!.id, f.refunds[1]!.id],
  );
  assert.ok(first.next);
  await f.observe("requires_action", 3);
  const next = alerts.page(f.actor, { limit: 2, after: first.next! });
  assert.deepEqual(
    next.items.map((n) => n.id),
    [f.refunds[0]!.id],
  );
  assert.equal(next.next, null);
  await f.observe("pending", 0);
  await f.observe("requires_action", 0);
  await f.observe("succeeded", 0);
  const history = alerts.history(f.actor, f.refunds[0]!.id, { limit: 2 });
  assert.deepEqual(
    history.items.map((n) => n.revision),
    [4, 3],
  );
  await f.observe("failed", 0);
  assert.deepEqual(
    alerts
      .history(f.actor, f.refunds[0]!.id, { limit: 2, after: history.next! })
      .items.map((n) => n.revision),
    [2, 1],
  );
  for (const input of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { after: -1 },
    { after: NaN },
  ]) {
    assert.throws(() => alerts.page(f.actor, input), { code: "VALIDATION" });
    assert.throws(() => alerts.history(f.actor, f.refunds[0]!.id, input), {
      code: "VALIDATION",
    });
  }
});

test("a late audit failure rolls back refund cash, exception resolution, immutable history and acknowledgment", async (t) => {
  const f = setup(t);
  await f.observe("requires_action");
  const alerts = f.app.billing.refunds.alerts,
    id = f.refunds[0]!.id;
  const before = alerts.page(f.actor);
  f.app.database
    .owned("platform")
    .migrate(
      "CREATE TRIGGER platform_fail_notice BEFORE INSERT ON platform_audit WHEN NEW.action='billing.refund.observed' BEGIN SELECT RAISE(ABORT,'synthetic late notice failure'); END;",
    );
  await assert.rejects(f.observe("succeeded"), /synthetic late notice failure/);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  assert.deepEqual(alerts.page(f.actor), before);
  assert.equal(alerts.history(f.actor, id).items.length, 1);
  f.app.database
    .owned("platform")
    .migrate(
      "DROP TRIGGER platform_fail_notice; CREATE TRIGGER platform_fail_read BEFORE INSERT ON platform_audit WHEN NEW.action='billing.refund.notice.acknowledge' BEGIN SELECT RAISE(ABORT,'synthetic read failure'); END;",
    );
  assert.throws(
    () => alerts.acknowledge(f.actor, "read", { noticeId: id, revision: 1 }),
    /synthetic read failure/,
  );
  assert.equal(alerts.page(f.actor).unread, 1);
  f.app.database.owned("platform").migrate("DROP TRIGGER platform_fail_read;");
  alerts.acknowledge(f.actor, "read", { noticeId: id, revision: 1 });
  assert.equal(alerts.page(f.actor).unread, 0);
});

test("synthetic Billing exceptions backfill once without inventing earlier notice history", async (t) => {
  const f = setup(t);
  await f.observe("succeeded");
  await f.observe("requires_action");
  f.app.database
    .owned("billing")
    .migrate(
      "DROP TABLE billing_refund_alert_reads; DROP TABLE billing_refund_alert_updates; DROP TABLE billing_refund_alerts;",
    );
  // Restore synthetic missing owned tables before startup validates the current schema.
  new Billing(f.app.database, f.app.platform, f.app.identity, f.app.catalog);
  f.app.close();
  f.app = new Application(f.path);
  const alerts = () => f.app.billing.refunds.alerts;
  assert.equal(alerts().page(f.actor).items[0]!.status, "requires_action");
  assert.equal(
    alerts().history(f.actor, f.refunds[0]!.id).items[0]!.source,
    "existing-state",
  );
  assert.equal(f.app.billing.refunds.list(f.actor)[0]!.observations.length, 2);
  alerts().acknowledge(f.actor, "read-upgrade", {
    noticeId: f.refunds[0]!.id,
    revision: 1,
  });
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(alerts().page(f.actor).unread, 0);
  assert.equal(alerts().history(f.actor, f.refunds[0]!.id).items.length, 1);
});

test("notice HTTP requires authentication, strict bounded schema, CSRF and personal acknowledgment", async (t) => {
  const f = setup(t);
  await f.observe("failed");
  f.user("http-buyer", "buyer");
  const http = await createHttp(f.app, {
    origin: "http://localhost",
    staticRoot: "/nonexistent",
  });
  t.after(() => http.close());
  const session = f.app.identity.login(
    "http-buyer@example.test",
    "long-notice-test-password",
  );
  const headers = {
    origin: "http://localhost",
    cookie: `distributor_session=${session.token}`,
    "x-csrf-token": session.csrf,
    "idempotency-key": "http-read",
  };
  assert.equal(
    (await http.inject({ url: "/api/billing/refund-notices" })).statusCode,
    401,
  );
  for (const query of ["limit=101", "after=0", "limit=1.5", "unknown=1"])
    assert.equal(
      (
        await http.inject({
          url: `/api/billing/refund-notices?${query}`,
          headers,
        })
      ).statusCode,
      400,
    );
  const page = await http.inject({
    url: "/api/billing/refund-notices?limit=1",
    headers,
  });
  assert.equal(page.statusCode, 200);
  assert.equal(page.json().unread, 1);
  const payload = { noticeId: f.refunds[0]!.id, revision: 1 };
  const post = (p: any, h = headers) =>
    http.inject({
      method: "POST",
      url: "/api/commands/billing.refund.notice.acknowledge",
      headers: h,
      payload: p,
    });
  assert.equal(
    (await post({ ...payload, accountId: f.buyer })).statusCode,
    400,
  );
  assert.equal(
    (await post(payload, { ...headers, "x-csrf-token": "" })).statusCode,
    403,
  );
  const read = await post(payload);
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual((await post(payload)).json(), read.json());
  assert.equal(
    (await http.inject({ url: "/api/billing/refund-notices", headers })).json()
      .unread,
    0,
  );
  assert.equal(f.app.billing.refunds.alerts.page(f.actor).unread, 1);
  assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
});

test(
  "independent processes acknowledge the same revision once under competing command keys",
  { timeout: 10000 },
  async (t) => {
    const f = setup(t);
    await f.observe("requires_action");
    const children = [0, 1].map(() =>
      fork(new URL("./refund-notice-child.ts", import.meta.url), [], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }),
    );
    t.after(() => children.forEach((c) => c.kill()));
    const ready = children.map(
      (c) =>
        new Promise<void>((resolve, reject) => {
          c.once("error", reject);
          c.once("message", () => resolve());
        }),
    );
    children.forEach((c, i) =>
      c.send({
        action: "init",
        path: f.path,
        actor: f.actor,
        noticeId: f.refunds[0]!.id,
        key: `read-${i}`,
      }),
    );
    await Promise.all(ready);
    const outcomes = children.map(
      (c) =>
        new Promise<any>((resolve, reject) => {
          c.once("error", reject);
          c.once("message", resolve);
        }),
    );
    children.forEach((c) => c.send({ action: "go" }));
    const results = await Promise.all(outcomes);
    assert.ok(
      results.every((r) => r.ok),
      JSON.stringify(results),
    );
    assert.deepEqual(results[0].value, results[1].value);
    assert.equal(
      f.app.database
        .owned("billing")
        .get("SELECT COUNT(*) AS n FROM billing_refund_alert_reads")!.n,
      1,
    );
    assert.equal(f.app.billing.refunds.alerts.page(f.actor).unread, 0);
    assert.equal(f.app.billing.totals(f.actor, f.invoiceId).refunded, 0);
  },
);
