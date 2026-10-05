import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fixture, accept, ship } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { digest, type Actor } from "../src/server/core.ts";
import { receiptStatement } from "../src/server/billing-delivery.ts";
import { createHttp } from "../src/server/http.ts";

function reader(
  f: ReturnType<typeof fixture>,
  suffix: string,
  role: "buyer" | "finance" | "commercial" = "buyer",
  accountId = f.buyer,
): Actor {
  const email = `${suffix}@example.test`;
  f.app.identity.createUser(f.actor, suffix, {
    email,
    name: `Synthetic ${suffix}`,
    password: "long-test-only-password",
    role,
    ...(role === "buyer" ? { accountId } : {}),
    sites: [],
  });
  return f.app.identity.login(email, "long-test-only-password").actor;
}
async function published(f: ReturnType<typeof fixture>) {
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const reviewed = await f.app.billing.documents.download(
    f.actor,
    "review",
    "invoice",
    invoiceId,
  );
  const input = {
    downloadId: reviewed.receipt.id,
    reason: "Synthetic review of exact original account PDF",
  };
  const publication = f.app.billing.delivery.publish(f.actor, "publish", input);
  return { invoiceId, reviewed, input, publication, buyer: reader(f, "buyer") };
}
function confirm(
  publicationId: string,
  receipt: { id: string; contentHash: string },
) {
  return {
    publicationId,
    downloadId: receipt.id,
    contentHash: receipt.contentHash,
    confirmation: "received" as const,
  };
}

test("portal publishes immutable reviewed originals, separates downloads from buyer confirmation and retains evidence across restart/withdrawal/republication", async (t) => {
  const f = fixture(t),
    p = await published(f);
  const before = f.app.dashboard(f.actor);
  assert.equal(p.publication.state, "available");
  assert.equal(p.publication.content_hash, digest(p.reviewed.bytes));
  assert.deepEqual(
    f.app.billing.delivery.publish(f.actor, "publish", p.input),
    p.publication,
  );
  assert.equal(
    f.app.billing.delivery.list(p.buyer)[0]!.acknowledgments.length,
    0,
  );
  const download = f.app.billing.delivery.download(
    p.buyer,
    "download",
    String(p.publication.id),
  );
  assert.deepEqual(download.bytes, p.reviewed.bytes);
  assert.equal(download.receipt.state, "prepared");
  assert.equal(
    f.app.billing.delivery.list(f.actor)[0]!.acknowledgments.length,
    0,
  );
  const input = confirm(String(p.publication.id), download.receipt);
  const ack = f.app.billing.delivery.acknowledge(p.buyer, "ack", input);
  assert.equal(ack.content_hash, p.publication.content_hash);
  assert.equal(ack.actor_id, p.buyer.id);
  assert.equal(ack.statement, receiptStatement);
  assert.deepEqual(
    f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    ack,
  );
  assert.deepEqual(
    f.app.billing.delivery.acknowledge(p.buyer, "new-ack", input),
    ack,
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.billing.delivery.download(
      p.buyer,
      "download",
      String(p.publication.id),
    ),
    download,
  );
  assert.deepEqual(
    f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    ack,
  );
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId: p.invoiceId,
    reference: "RETURN-1",
    reason: "Synthetic original return",
    lines: [
      { lineId: f.app.billing.lines(f.actor, p.invoiceId)[0]!.id, quantity: 1 },
    ],
  });
  const creditReview = await f.app.billing.documents.download(
    f.actor,
    "credit-review",
    "credit",
    credit.id,
  );
  const creditPub = f.app.billing.delivery.publish(f.actor, "credit-publish", {
    downloadId: creditReview.receipt.id,
    reason: "Synthetic credit review",
  });
  const creditDownload = f.app.billing.delivery.download(
    p.buyer,
    "credit-download",
    String(creditPub.id),
  );
  assert.deepEqual(creditDownload.bytes, creditReview.bytes);
  assert.equal(
    f.app.billing.delivery.list(p.buyer).find((x) => x.id === creditPub.id)!
      .acknowledgments.length,
    0,
  );
  assert.equal(f.app.billing.invoice(f.actor, p.invoiceId).total, 22600);
  assert.equal(f.app.billing.invoices(f.actor)[0]!.balance, 11300);
  assert.deepEqual(f.app.dashboard(f.actor).stock, before.stock);
  assert.deepEqual(f.app.dashboard(f.actor).orders, before.orders);
  assert.deepEqual(f.app.dashboard(f.actor).shipments, before.shipments);
  const withdrawal = {
    publicationId: String(p.publication.id),
    revision: 1,
    reason: "Synthetic routing correction, invoice remains payable",
  };
  assert.throws(
    () =>
      f.app.billing.delivery.withdraw(f.actor, "stale", {
        ...withdrawal,
        revision: 2,
      }),
    { code: "STALE_REVISION" },
  );
  const withdrawn = f.app.billing.delivery.withdraw(
    f.actor,
    "withdraw",
    withdrawal,
  );
  assert.deepEqual(
    f.app.billing.delivery.withdraw(f.actor, "withdraw", withdrawal),
    withdrawn,
  );
  assert.equal(
    f.app.billing.delivery.publish(f.actor, "publish", p.input).state,
    "withdrawn",
  );
  assert.throws(
    () =>
      f.app.billing.delivery.download(
        p.buyer,
        "download",
        String(p.publication.id),
      ),
    { code: "DOCUMENT_WITHDRAWN" },
  );
  assert.throws(
    () => f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    { code: "DOCUMENT_WITHDRAWN" },
  );
  assert.deepEqual(
    f.app.billing.delivery
      .list(p.buyer)
      .find((x) => x.id === p.publication.id)!
      .acknowledgments.map((row) => ({ ...row })),
    [ack],
  );
  const republished = f.app.billing.delivery.publish(
    f.actor,
    "republish",
    p.input,
  );
  assert.notEqual(republished.id, p.publication.id);
  assert.equal(republished.content_hash, p.publication.content_hash);
  const reDownload = f.app.billing.delivery.download(
    p.buyer,
    "redownload",
    String(republished.id),
  );
  assert.throws(
    () =>
      f.app.billing.delivery.acknowledge(
        p.buyer,
        "wrong-publication",
        confirm(String(republished.id), download.receipt),
      ),
    { code: "RECEIPT_MISMATCH" },
  );
  assert.equal(
    f.app.billing.delivery.acknowledge(
      p.buyer,
      "reack",
      confirm(String(republished.id), reDownload.receipt),
    ).publication_id,
    republished.id,
  );
  assert.equal(f.app.billing.invoices(f.actor)[0]!.balance, 11300);
});

test("portal current grants and account/organization scope precede cached publish/download/acknowledgment results", async (t) => {
  const f = fixture(t),
    p = await published(f),
    pubId = String(p.publication.id);
  const otherAccount = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other buyer",
    tier: "standard",
    creditLimit: 100000,
  }).id;
  const foreignBuyer = reader(f, "foreign", "buyer", otherAccount);
  assert.deepEqual(f.app.billing.delivery.list(foreignBuyer), []);
  assert.throws(
    () => f.app.billing.delivery.download(foreignBuyer, "foreign", pubId),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.billing.delivery.download(f.actor, "admin", pubId),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.billing.delivery.publish(p.buyer, "buyer-publish", p.input),
    { code: "FORBIDDEN" },
  );
  const other = fixture(t);
  assert.deepEqual(other.app.billing.delivery.list(other.actor), []);
  assert.throws(
    () =>
      other.app.billing.delivery.withdraw(other.actor, "foreign", {
        publicationId: pubId,
        revision: 1,
        reason: "Foreign",
      }),
    { code: "NOT_FOUND" },
  );
  const download = f.app.billing.delivery.download(p.buyer, "download", pubId),
    input = confirm(pubId, download.receipt);
  f.app.billing.delivery.acknowledge(p.buyer, "ack", input);
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET account_id=? WHERE id=?",
      otherAccount,
      p.buyer.id,
    );
  assert.deepEqual(f.app.billing.delivery.list(p.buyer), []);
  assert.throws(
    () => f.app.billing.delivery.download(p.buyer, "download", pubId),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET account_id=?,role='commercial' WHERE id=?",
      f.buyer,
      p.buyer.id,
    );
  assert.throws(
    () => f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    { code: "FORBIDDEN" },
  );
  const finance = reader(f, "finance", "finance");
  const review = await f.app.billing.documents.download(
    finance,
    "review",
    "invoice",
    p.invoiceId,
  );
  f.app.billing.delivery.withdraw(finance, "withdraw", {
    publicationId: pubId,
    revision: 1,
    reason: "Finance test",
  });
  const financeInput = {
    downloadId: review.receipt.id,
    reason: "Finance review",
  };
  f.app.billing.delivery.publish(finance, "finance-publish", financeInput);
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET role='commercial' WHERE id=?", finance.id);
  assert.throws(
    () =>
      f.app.billing.delivery.publish(finance, "finance-publish", financeInput),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () =>
      f.app.billing.delivery.withdraw(finance, "withdraw", {
        publicationId: pubId,
        revision: 1,
        reason: "Finance test",
      }),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", finance.id);
  assert.throws(() => f.app.billing.delivery.list(finance), {
    code: "FORBIDDEN",
  });
});

test("review and confirmation must refer to the same actor's exact original/publication, with explicit confirmation and immutable receipts", async (t) => {
  const f = fixture(t),
    p = await published(f),
    buyer2 = reader(f, "buyer2"),
    finance = reader(f, "finance", "finance"),
    pubId = String(p.publication.id);
  assert.throws(
    () => f.app.billing.delivery.publish(finance, "foreign-review", p.input),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      f.app.billing.delivery.publish(f.actor, "missing", {
        ...p.input,
        downloadId: "missing",
      }),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () => f.app.billing.delivery.publish(f.actor, "duplicate", p.input),
    { code: "ALREADY_PUBLISHED" },
  );
  assert.throws(
    () =>
      f.app.billing.delivery.publish(f.actor, "publish", {
        ...p.input,
        reason: "Changed",
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const download = f.app.billing.delivery.download(p.buyer, "download", pubId),
    input = confirm(pubId, download.receipt);
  assert.throws(
    () => f.app.billing.delivery.acknowledge(f.actor, "admin-ack", input),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.billing.delivery.acknowledge(buyer2, "borrowed", input),
    { code: "RECEIPT_MISMATCH" },
  );
  assert.throws(
    () =>
      f.app.billing.delivery.acknowledge(p.buyer, "hash", {
        ...input,
        contentHash: "0".repeat(64),
      }),
    { code: "RECEIPT_MISMATCH" },
  );
  assert.throws(
    () =>
      f.app.billing.delivery.acknowledge(p.buyer, "missing-confirmation", {
        ...input,
        confirmation: "" as "received",
      }),
    { code: "VALIDATION" },
  );
  assert.throws(
    () =>
      f.app.billing.delivery.acknowledge(p.buyer, "staff-download", {
        ...input,
        downloadId: p.reviewed.receipt.id,
      }),
    { code: "RECEIPT_MISMATCH" },
  );
  f.app.billing.delivery.acknowledge(p.buyer, "ack", input);
  assert.throws(
    () =>
      f.app.billing.delivery.acknowledge(p.buyer, "ack", {
        ...input,
        downloadId: "missing",
      }),
    { code: "RECEIPT_MISMATCH" },
  );
  const secondDownload = f.app.billing.delivery.download(
    buyer2,
    "download",
    pubId,
  );
  f.app.billing.delivery.acknowledge(
    buyer2,
    "ack",
    confirm(pubId, secondDownload.receipt),
  );
  assert.equal(
    f.app.billing.delivery.list(p.buyer)[0]!.acknowledgments.length,
    1,
  );
  assert.equal(
    f.app.billing.delivery.list(buyer2)[0]!.acknowledgments.length,
    1,
  );
  assert.equal(
    f.app.billing.delivery.list(f.actor)[0]!.acknowledgments.length,
    2,
  );
});

test("late audit failure rolls publication/download/acknowledgment/withdrawal back atomically without changing money or erasing earlier evidence", async (t) => {
  const f = fixture(t),
    p = await published(f),
    pubId = String(p.publication.id),
    store = f.app.database.owned("billing"),
    platform = f.app.database.owned("platform");
  const snapshot = () =>
    JSON.stringify({
      pub: store.all("SELECT * FROM billing_publications"),
      downloads: store.all("SELECT * FROM billing_portal_downloads"),
      acks: store.all("SELECT * FROM billing_acknowledgments"),
      commands: platform.all("SELECT * FROM platform_commands"),
      events: platform.all("SELECT * FROM platform_events"),
      audits: platform.all("SELECT * FROM platform_audit"),
      invoices: f.app.billing.invoices(f.actor),
      stock: f.app.inventory.stock(f.actor),
    });
  const fail = (action: string, operation: () => unknown) => {
    platform.migrate(
      `CREATE TRIGGER platform_delivery_abort BEFORE INSERT ON platform_audit WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'synthetic late delivery audit fault'); END;`,
    );
    const before = snapshot();
    assert.throws(operation, /synthetic late delivery audit fault/);
    assert.equal(snapshot(), before);
    platform.migrate("DROP TRIGGER platform_delivery_abort");
  };
  fail("billing.portal.download", () =>
    f.app.billing.delivery.download(p.buyer, "failed-download", pubId),
  );
  const download = f.app.billing.delivery.download(p.buyer, "download", pubId);
  fail("billing.portal.acknowledge", () =>
    f.app.billing.delivery.acknowledge(
      p.buyer,
      "failed-ack",
      confirm(pubId, download.receipt),
    ),
  );
  const ack = f.app.billing.delivery.acknowledge(
    p.buyer,
    "ack",
    confirm(pubId, download.receipt),
  );
  const withdrawal = {
    publicationId: pubId,
    revision: 1,
    reason: "Synthetic withdrawal",
  };
  fail("billing.portal.withdraw", () =>
    f.app.billing.delivery.withdraw(f.actor, "failed-withdraw", withdrawal),
  );
  f.app.billing.delivery.withdraw(f.actor, "withdraw", withdrawal);
  fail("billing.portal.publish", () =>
    f.app.billing.delivery.publish(f.actor, "failed-publish", p.input),
  );
  assert.equal(
    f.app.billing.delivery.list(p.buyer)[0]!.acknowledgments[0]!.id,
    ack.id,
  );
  assert.equal(f.app.billing.invoices(f.actor)[0]!.balance, 22600);
});

test("publication detects corrupted original facts/bytes/linkage even on cached downloads and acknowledgments", async (t) => {
  const f = fixture(t),
    p = await published(f),
    pubId = String(p.publication.id),
    store = f.app.database.owned("billing");
  const download = f.app.billing.delivery.download(p.buyer, "download", pubId),
    input = confirm(pubId, download.receipt);
  f.app.billing.delivery.acknowledge(p.buyer, "ack", input);
  store.run(
    "UPDATE billing_document_renditions SET bytes=? WHERE document_id=?",
    Buffer.from("invalid"),
    p.invoiceId,
  );
  assert.throws(
    () => f.app.billing.delivery.download(p.buyer, "download", pubId),
    { code: "DOCUMENT_INTEGRITY" },
  );
  assert.throws(
    () => f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    { code: "DOCUMENT_INTEGRITY" },
  );
  assert.throws(
    () => f.app.billing.delivery.publish(f.actor, "publish", p.input),
    { code: "DOCUMENT_INTEGRITY" },
  );
  store.run(
    "UPDATE billing_document_renditions SET bytes=? WHERE document_id=?",
    p.reviewed.bytes,
    p.invoiceId,
  );
  store.run(
    "UPDATE billing_publications SET content_hash=? WHERE id=?",
    "0".repeat(64),
    pubId,
  );
  assert.throws(
    () => f.app.billing.delivery.download(p.buyer, "download", pubId),
    { code: "DOCUMENT_INTEGRITY" },
  );
  store.run(
    "UPDATE billing_publications SET content_hash=? WHERE id=?",
    digest(p.reviewed.bytes),
    pubId,
  );
  store.run(
    "UPDATE billing_document_facts SET hash=? WHERE document_id=?",
    "0".repeat(64),
    p.invoiceId,
  );
  assert.throws(
    () => f.app.billing.delivery.acknowledge(p.buyer, "ack", input),
    { code: "DOCUMENT_INTEGRITY" },
  );
  assert.equal(store.all("SELECT * FROM billing_acknowledgments").length, 1);
  assert.equal(store.all("SELECT * FROM billing_portal_downloads").length, 1);
});

type RaceInput = {
  actor: Actor;
  key: string;
  operation: "publish" | "acknowledge" | "withdraw";
  payload: unknown;
};
async function race(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  inputs: RaceInput[],
) {
  const children: ChildProcess[] = [];
  const ready: Promise<void>[] = [],
    outcomes: Promise<{ ok: boolean; result?: any; code?: string }>[] = [];
  for (const input of inputs) {
    const child = fork(
      new URL("./billing-delivery-child.ts", import.meta.url),
      [],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    children.push(child);
    let readyResolve: () => void,
      resultResolve: (v: any) => void,
      readyReject: (e: Error) => void,
      resultReject: (e: Error) => void;
    ready.push(
      new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      }),
    );
    outcomes.push(
      new Promise((resolve, reject) => {
        resultResolve = resolve;
        resultReject = reject;
      }),
    );
    let stderr = "",
      complete = false;
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("message", (message: any) => {
      if (message.ready) readyResolve();
      else {
        complete = true;
        resultResolve(message);
      }
    });
    child.on("error", (e) => {
      readyReject(e);
      resultReject(e);
    });
    child.on("exit", (code) => {
      if (!complete || code !== 0) {
        const e = new Error(`Delivery process exited ${code}: ${stderr}`);
        readyReject(e);
        resultReject(e);
      }
    });
    child.send({ action: "init", path: f.path, ...input });
  }
  t.after(() => children.forEach((child) => child.kill()));
  await Promise.all(ready);
  children.forEach((child) => child.send({ action: "go" }));
  return Promise.all(outcomes);
}

test(
  "independent publication and acknowledgment processes conserve one active document and one personal confirmation",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      p = await published(f),
      pubId = String(p.publication.id);
    f.app.billing.delivery.withdraw(f.actor, "withdraw", {
      publicationId: pubId,
      revision: 1,
      reason: "Synthetic race setup",
    });
    const publications = await race(
      t,
      f,
      [0, 1].map((i) => ({
        actor: f.actor,
        key: `publish-${i}`,
        operation: "publish",
        payload: p.input,
      })),
    );
    assert.equal(publications.filter((p) => p.ok).length, 1);
    assert.equal(publications.find((p) => !p.ok)!.code, "ALREADY_PUBLISHED");
    const active = f.app.billing.delivery
      .list(p.buyer)
      .find((p) => p.state === "available")!;
    const download = f.app.billing.delivery.download(
      p.buyer,
      "download",
      String(active.id),
    );
    const acks = await race(
      t,
      f,
      [0, 1].map((i) => ({
        actor: p.buyer,
        key: `ack-${i}`,
        operation: "acknowledge",
        payload: confirm(String(active.id), download.receipt),
      })),
    );
    assert.ok(acks.every((a) => a.ok));
    assert.equal(acks[0]!.result.id, acks[1]!.result.id);
    assert.equal(
      f.app.billing.delivery.list(p.buyer).find((p) => p.id === active.id)!
        .acknowledgments.length,
      1,
    );
    assert.equal(f.app.billing.invoices(f.actor)[0]!.balance, 22600);
  },
);

test(
  "independent withdrawal/acknowledgment processes preserve custody of confirmation evidence in either serialization order",
  { timeout: 20000 },
  async (t) => {
    const f = fixture(t),
      p = await published(f),
      pubId = String(p.publication.id),
      download = f.app.billing.delivery.download(p.buyer, "download", pubId);
    const outcomes = await race(t, f, [
      {
        actor: f.actor,
        key: "withdraw",
        operation: "withdraw",
        payload: {
          publicationId: pubId,
          revision: 1,
          reason: "Synthetic competing withdrawal",
        },
      },
      {
        actor: p.buyer,
        key: "ack",
        operation: "acknowledge",
        payload: confirm(pubId, download.receipt),
      },
    ]);
    assert.equal(outcomes[0]!.ok, true);
    const row = f.app.billing.delivery.list(p.buyer)[0]!;
    assert.equal(row.state, "withdrawn");
    assert.equal(row.downloads.length, 1);
    assert.equal(row.acknowledgments.length, outcomes[1]!.ok ? 1 : 0);
    if (!outcomes[1]!.ok) assert.equal(outcomes[1]!.code, "DOCUMENT_WITHDRAWN");
    assert.throws(
      () => f.app.billing.delivery.download(p.buyer, "download", pubId),
      { code: "DOCUMENT_WITHDRAWN" },
    );
  },
);

test("HTTP portal requires current buyer session, exact JSON/key/origin/CSRF and serves the original PDF with private integrity headers", async (t) => {
  const f = fixture(t),
    p = await published(f),
    pubId = String(p.publication.id),
    origin = "http://127.0.0.1:3000";
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
  });
  await http.ready();
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "buyer@example.test",
      password: "long-test-only-password",
    },
  });
  // The fixture's test-only buyer is explicitly allowed past the first-login change here.
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
      p.buyer.id,
    );
  const headers = {
      origin,
      cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "download",
    },
    url = `/api/billing/inbox/${pubId}/pdf`;
  const post = (
    h: Record<string, string> = headers,
    payload: Record<string, unknown> = {},
    path = url,
  ) => http.inject({ method: "POST", url: path, headers: h, payload });
  assert.equal(
    (await post({ ...headers, origin: "http://foreign.test" })).statusCode,
    403,
  );
  assert.equal(
    (await post({ ...headers, "x-csrf-token": "wrong" })).statusCode,
    403,
  );
  assert.equal(
    (await post({ ...headers, "idempotency-key": "" })).statusCode,
    400,
  );
  assert.equal((await post(headers, { accountId: f.buyer })).statusCode, 400);
  const response = await post();
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.rawPayload, p.reviewed.bytes);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(
    response.headers["x-document-sha256"],
    digest(response.rawPayload),
  );
  const retry = await post();
  assert.equal(
    retry.headers["x-download-receipt"],
    response.headers["x-download-receipt"],
  );
  const acknowledgment = {
    publicationId: pubId,
    downloadId: String(response.headers["x-download-receipt"]),
    contentHash: digest(response.rawPayload),
    confirmation: "received",
  };
  assert.equal(
    (
      await post(
        headers,
        { ...acknowledgment, confirmation: "" },
        "/api/commands/billing.portal.acknowledge",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await post(
        headers,
        acknowledgment,
        "/api/commands/billing.portal.acknowledge",
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await post(
        headers,
        { ...p.input, accountId: f.buyer },
        "/api/commands/billing.portal.publish",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await post(headers, p.input, "/api/commands/billing.portal.publish"))
      .statusCode,
    403,
  );
  assert.equal(
    (await http.inject({ url: "/api/billing/inbox", headers })).json()[0]
      .acknowledgments.length,
    1,
  );
  const page = await http.inject({
    url: "/api/billing/inbox/page?limit=1",
    headers,
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.headers["cache-control"], "no-store");
  assert.equal(page.json().items[0].id, pubId);
  assert.equal(page.json().next, null);
  const history = await http.inject({
    url: `/api/billing/inbox/${pubId}/history/downloads?limit=1`,
    headers,
  });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().items[0].actor_id, p.buyer.id);
  assert.equal(
    (
      await http.inject({
        url: `/api/billing/inbox/${pubId}/history/acknowledgments`,
        headers,
      })
    ).json().items.length,
    1,
  );
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "limit=01",
    "limit=1&limit=2",
    "after=",
    "after=invalid",
    "accountId=foreign",
  ]) {
    assert.equal(
      (await http.inject({ url: `/api/billing/inbox/page?${query}`, headers }))
        .statusCode,
      400,
      query,
    );
  }
  assert.equal(
    (
      await http.inject({
        url: `/api/billing/inbox/${pubId}/history/unknown`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await http.inject({ url: "/api/billing/inbox/page" })).statusCode,
    401,
  );
  f.app.database
    .owned("iam")
    .run("DELETE FROM iam_sessions WHERE user_id=?", p.buyer.id);
  assert.equal((await post()).statusCode, 401);
  assert.equal(
    (await http.inject({ url: "/api/billing/inbox", headers })).statusCode,
    401,
  );
});

test("inbox pages retain complete publication history beyond 200 records while new insertions and tied timestamps cannot skip earlier pages", async (t) => {
  // Compare business effects at one reporting instant, independent of test duration.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(t),
    p = await published(f),
    delivery = f.app.billing.delivery;
  const olderInvoiceId = ship(f, accept(f, 1, "older-invoice").id).invoiceId;
  const olderReview = await f.app.billing.documents.download(
    f.actor,
    "older-review",
    "invoice",
    olderInvoiceId,
  );
  const olderActive = delivery.publish(f.actor, "older-publish", {
    downloadId: olderReview.receipt.id,
    reason: "Synthetic older available invoice",
  });
  const before = f.app.dashboard(f.actor);
  const ids = [String(p.publication.id)];
  let current = p.publication;
  for (let i = 1; i < 205; i++) {
    delivery.withdraw(f.actor, `page-withdraw-${i}`, {
      publicationId: String(current.id),
      revision: 1,
      reason: "Synthetic history correction",
    });
    current = delivery.publish(f.actor, `page-publish-${i}`, p.input);
    ids.push(String(current.id));
  }
  // Test-only timestamp fixture: enumeration must not depend on wall-clock order.
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_publications SET published_at=?",
      "2026-01-01T00:00:00.000Z",
    );
  const first = delivery.page(p.buyer, { limit: 100 });
  assert.equal(first.items.length, 100);
  assert.ok(first.next);
  assert.deepEqual(
    first.items.map((x) => x.id),
    ids.slice().reverse().slice(0, 100),
  );
  delivery.withdraw(f.actor, "page-later-withdraw", {
    publicationId: String(current.id),
    revision: 1,
    reason: "Synthetic later insertion",
  });
  const later = delivery.publish(f.actor, "page-later-publish", p.input);
  const found = first.items.map((x) => x.id);
  let next: string | null = first.next;
  while (next) {
    const page = delivery.page(p.buyer, { after: next, limit: 100 });
    found.push(...page.items.map((x) => x.id));
    next = page.next;
  }
  assert.deepEqual(found, [...ids.slice(1).reverse(), olderActive.id, ids[0]]);
  assert.equal(new Set(found).size, 206);
  assert.equal(delivery.page(p.buyer).items[0]!.id, later.id);
  assert.equal(delivery.list(p.buyer).length, 200);
  assert.ok(!delivery.page(p.buyer).items.some((x) => x.id === olderActive.id));
  assert.equal(
    f.app.billing.invoices(f.actor).find((i) => i.id === olderInvoiceId)!
      .hasActivePublication,
    true,
  );
  assert.deepEqual(f.app.dashboard(f.actor), before);
  for (const limit of [0, 101, 1.5, NaN])
    assert.throws(() => delivery.page(p.buyer, { limit }), {
      code: "VALIDATION",
    });
  assert.throws(() => delivery.page(f.actor, { after: first.next! }), {
    code: "INVALID_CURSOR",
  });
  const otherAccount = f.app.identity.createCustomer(
    f.actor,
    "page-other-account",
    { name: "Other synthetic account", tier: "standard", creditLimit: 1000000 },
  ).id;
  const otherBuyer = reader(f, "page-other-buyer", "buyer", otherAccount);
  assert.deepEqual(delivery.page(otherBuyer), { items: [], next: null });
  assert.throws(
    () => delivery.history(otherBuyer, String(p.publication.id), "downloads"),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_users SET account_id=? WHERE id=?",
      otherAccount,
      p.buyer.id,
    );
  assert.throws(() => delivery.page(p.buyer, { after: first.next! }), {
    code: "INVALID_CURSOR",
  });
  assert.deepEqual(delivery.page(p.buyer), { items: [], next: null });
});

test("paged personal PDF history survives withdrawal, bounds previews and rechecks access for every cursor", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture(t),
    p = await published(f),
    delivery = f.app.billing.delivery;
  const pubId = String(p.publication.id),
    colleague = reader(f, "history-colleague");
  const before = f.app.dashboard(f.actor),
    ids: string[] = [];
  for (let i = 0; i < 205; i++)
    ids.push(
      delivery.download(p.buyer, `history-download-${i}`, pubId).receipt.id,
    );
  const last = delivery.download(
    colleague,
    "history-colleague-download",
    pubId,
  );
  const colleagueAck = delivery.acknowledge(
    colleague,
    "history-colleague-ack",
    confirm(pubId, last.receipt),
  );
  const personalDownload = delivery.download(
    p.buyer,
    "history-personal-download",
    pubId,
  );
  ids.push(personalDownload.receipt.id);
  const personalAck = delivery.acknowledge(
    p.buyer,
    "history-personal-ack",
    confirm(pubId, personalDownload.receipt),
  );
  const preview = delivery.page(p.buyer).items[0]!;
  assert.equal(preview.downloads.length, 5);
  assert.equal(preview.downloadCount, 206);
  assert.equal(preview.acknowledgmentCount, 1);
  const staff = delivery.page(f.actor).items[0]!;
  assert.equal(staff.downloadCount, 207);
  assert.equal(staff.acknowledgmentCount, 2);
  assert.equal(
    delivery.history(p.buyer, pubId, "acknowledgments").items[0]!.id,
    personalAck.id,
  );
  assert.equal(
    delivery.history(colleague, pubId, "acknowledgments").items[0]!.id,
    colleagueAck.id,
  );
  const first = delivery.history(p.buyer, pubId, "downloads", { limit: 100 });
  assert.ok(first.next);
  const inserted = delivery.download(
    p.buyer,
    "history-after-first-page",
    pubId,
  );
  delivery.withdraw(f.actor, "history-withdraw", {
    publicationId: pubId,
    revision: 1,
    reason: "Synthetic withdrawal retaining evidence",
  });
  const found = first.items.map((x) => x.id);
  let next: string | null = first.next;
  while (next) {
    const page = delivery.history(p.buyer, pubId, "downloads", {
      after: next,
      limit: 100,
    });
    assert.ok(page.items.every((x) => x.actor_id === p.buyer.id));
    found.push(...page.items.map((x) => x.id));
    next = page.next;
  }
  assert.deepEqual(found, ids.slice().reverse());
  assert.equal(
    delivery.history(p.buyer, pubId, "downloads").items[0]!.id,
    inserted.receipt.id,
  );
  assert.throws(
    () =>
      delivery.history(colleague, pubId, "downloads", { after: first.next! }),
    { code: "INVALID_CURSOR" },
  );
  assert.throws(
    () =>
      delivery.history(p.buyer, pubId, "acknowledgments", {
        after: first.next!,
      }),
    { code: "INVALID_CURSOR" },
  );
  assert.throws(
    () => delivery.history(p.buyer, pubId, "downloads", { after: "invalid" }),
    { code: "INVALID_CURSOR" },
  );
  assert.deepEqual(f.app.dashboard(f.actor), {
    ...before,
    invoices: before.invoices.map((i) =>
      i.id === p.invoiceId ? { ...i, hasActivePublication: false } : i,
    ),
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", p.buyer.id);
  assert.throws(
    () => delivery.history(p.buyer, pubId, "downloads", { after: first.next! }),
    { code: "FORBIDDEN" },
  );
});
