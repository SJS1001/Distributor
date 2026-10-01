import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, accept, ship } from "./fixtures.ts";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { renderDocument } from "../src/server/document-pdf.ts";
import type { DocumentFacts } from "../src/server/billing-documents.ts";

async function parsed(bytes: Uint8Array) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i),
      text = await page.getTextContent();
    const items = text.items.filter(
      (v): v is Extract<typeof v, { str: string }> => "str" in v,
    );
    for (const item of items)
      assert.ok(
        item.transform[4] >= 49 &&
          item.transform[4] + item.width <= 563 &&
          item.transform[5] >= 31 &&
          item.transform[5] <= 757,
        "text stays within page margins",
      );
    pages.push(items.map((i) => i.str).join(" "));
  }
  await task.destroy();
  return pages;
}
function profile(
  f: ReturnType<typeof fixture>,
  accountId: string | null,
  name: string,
  termDays: number | null = 30,
) {
  const previous =
    accountId === null
      ? f.app.billing.documents.profiles(f.actor).issuer
      : f.app.billing.documents
          .profiles(f.actor)
          .customers.find((c) => c.accountId === accountId)!;
  return f.app.billing.documents.configure(f.actor, `profile-${name}`, {
    accountId,
    name,
    address: "123 rue de Québec\nMontréal QC",
    taxRegistration: "SYNTHETIC-TAX",
    termDays: accountId === null ? null : termDays,
    version: previous.version,
    reason: "Synthetic identity and terms evidence",
  });
}
function user(
  f: ReturnType<typeof fixture>,
  role: "buyer" | "warehouse",
  accountId?: string,
): Actor {
  const email = `${role}${accountId ?? ""}@example.test`;
  f.app.identity.createUser(f.actor, email, {
    email,
    name: "Synthetic reader",
    password: "long-test-only-password",
    role,
    accountId,
    sites: [f.w1],
  });
  return f.app.identity.login(email, "long-test-only-password").actor;
}
function opening(
  f: ReturnType<typeof fixture>,
  dueDays: number,
  number: string,
  description = "Original French équipement",
) {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const due = new Date(midnight.getTime() - dueDays * 86400000).toISOString(),
    issued = new Date(Date.parse(due) - 30 * 86400000).toISOString(),
    cutoff = new Date(Math.max(Date.now(), Date.parse(issued))).toISOString();
  const d = {
    sourceId: number,
    accountId: f.buyer,
    number,
    issuedAt: issued,
    dueAt: due,
    net: 20000,
    tax: 2600,
    total: 22600,
    credited: 0,
    paid: 5000,
    refunded: 1000,
    balance: 18600,
    lines: [
      {
        productId: f.product,
        description,
        quantity: 2,
        unitPrice: 10000,
        unitTax: 1300,
        creditedQuantity: 0,
      },
    ],
  };
  const review = f.app.billing.opening.review(f.actor, d, cutoff);
  return f.app.database.transaction(() =>
    f.app.billing.opening.apply(f.actor, review, {
      sourceRef: "SYNTHETIC-DOCUMENT-SOURCE",
      sourceHash: digest(number),
      cutoffAt: cutoff,
      batchId: number,
    }),
  );
}

test("native invoice and credit PDFs retain original identity, terms, tax and exact bytes across payments, profile edits and restart", async (t) => {
  const f = fixture(t);
  profile(f, null, "Distributeur Québec");
  profile(f, f.buyer, "Acheteur Montréal", 30);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  const facts = f.app.billing.documents.facts(f.actor, "invoice", invoiceId)!;
  assert.equal(facts.facts.total, 22600);
  assert.equal(facts.facts.tax, 2600);
  assert.equal(
    Date.parse(facts.facts.dueAt!) - Date.parse(facts.facts.issuedAt),
    30 * 86400000,
  );
  profile(f, f.buyer, "Changed identity", 0);
  const first = await f.app.billing.documents.download(
    f.actor,
    "download",
    "invoice",
    invoiceId,
  );
  const text = (await parsed(first.bytes)).join(" ");
  // Text extraction alone accepted a variable-font PDF with missing visible glyphs.
  // Independently rasterize the fixed Invoice title; the retained failed candidate
  // has 282 dark pixels in this crop, the static-font candidate has 610.
  const visualTask = getDocument({
    data: new Uint8Array(first.bytes),
    useSystemFonts: false,
  });
  const visualPdf = await visualTask.promise,
    visualPage = await visualPdf.getPage(1);
  const viewport = visualPage.getViewport({ scale: 1.5 }),
    canvas = createCanvas(viewport.width, viewport.height),
    context = canvas.getContext("2d");
  await visualPage.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const pixels = context.getImageData(75, 55, 120, 40).data;
  let darkPixels = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i]! < 100 && pixels[i + 1]! < 100 && pixels[i + 2]! < 100)
      darkPixels++;
  assert.ok(
    darkPixels > 500,
    "visible Invoice glyphs survive font embedding, beyond text extraction",
  );
  await visualTask.destroy();
  assert.match(text, /Acheteur Montréal/);
  assert.match(text, /Distributeur Québec/);
  assert.match(text, /CAD 226.00/);
  assert.match(text, /CAD 26.00/);
  assert.match(text, /30 calendar days/);
  assert.doesNotMatch(text, /Changed identity/);
  f.app.billing.manualPayment(f.actor, "payment", {
    invoiceId,
    reference: "BANK-1",
    amount: 10000,
    reason: "Verified synthetic bank payment",
  });
  const credit = f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "CREDIT-1",
    reason: "Original taxed equipment returned",
    lines: [
      { lineId: f.app.billing.lines(f.actor, invoiceId)[0]!.id, quantity: 1 },
    ],
  });
  const creditPdf = await f.app.billing.documents.download(
    f.actor,
    "credit-download",
    "credit",
    credit.id,
  );
  const creditText = (await parsed(creditPdf.bytes)).join(" ");
  assert.match(creditText, /Credit note/);
  assert.match(creditText, /CAD 113.00/);
  assert.match(creditText, /CAD 13.00/);
  assert.match(creditText, /Acheteur Montréal/);
  assert.match(creditText, /Original invoice:/);
  assert.equal(
    f.app.billing.documents.aging(f.actor).accounts[0]!.notDue,
    1300,
  );
  f.app.close();
  f.app = new Application(f.path);
  const retry = await f.app.billing.documents.download(
    f.actor,
    "download",
    "invoice",
    invoiceId,
  );
  assert.deepEqual(retry, first);
  assert.equal(f.app.billing.documents.downloads(f.actor).length, 2);
  const next = await f.app.billing.documents.download(
    f.actor,
    "second-request",
    "invoice",
    invoiceId,
  );
  assert.deepEqual(next.bytes, first.bytes);
  assert.notEqual(next.receipt.id, first.receipt.id);
  assert.equal(f.app.billing.documents.downloads(f.actor).length, 3);
});

test("opening reconstruction preserves source totals/due date and states unavailable identity; payment changes aging without rewriting PDF", async (t) => {
  const f = fixture(t),
    o = opening(f, 31, "OLD-INV");
  profile(f, f.buyer, "Current identity", 365);
  const first = await f.app.billing.documents.download(
    f.actor,
    "opening",
    "invoice",
    o.invoiceId,
  );
  const text = (await parsed(first.bytes)).join(" ");
  assert.match(text, /Reconstructed opening invoice/);
  assert.match(text, /not the original source PDF/);
  assert.match(text, /original identities unavailable/);
  assert.match(text, /CAD 226.00/);
  assert.match(text, /payments CAD 50.00/);
  assert.match(text, /refunds CAD 10.00/);
  assert.match(text, /outstanding CAD 186.00/);
  assert.equal(
    f.app.billing.documents.facts(f.actor, "invoice", o.invoiceId)!.facts.terms
      .days,
    null,
  );
  const before = f.app.billing.documents.aging(f.actor).accounts[0]!;
  assert.equal(before.days31to60, 18600);
  f.app.billing.manualPayment(f.actor, "opening-payment", {
    invoiceId: o.invoiceId,
    reference: "OLD-BANK",
    amount: 8600,
    reason: "Post cutoff synthetic payment",
  });
  assert.equal(
    f.app.billing.documents.aging(f.actor).accounts[0]!.days31to60,
    10000,
  );
  assert.deepEqual(
    (
      await f.app.billing.documents.download(
        f.actor,
        "opening",
        "invoice",
        o.invoiceId,
      )
    ).bytes,
    first.bytes,
  );
});

test("aging assigns independent current cash totals at UTC bucket boundaries, keeps unknown due, credit balances and pending refunds separate", (t) => {
  const f = fixture(t);
  for (const days of [-1, 0, 1, 30, 31, 60, 61, 90, 91])
    opening(f, days, `AGING-${days}`);
  const invoiceId = ship(f, accept(f).id).invoiceId;
  assert.equal(
    f.app.billing.documents.aging(f.actor).accounts[0]!.unknownDue,
    11300,
  );
  const p = f.app.billing.manualPayment(f.actor, "allpaid", {
    invoiceId,
    reference: "FULLBANK",
    amount: 11300,
    reason: "Synthetic settled cash",
  });
  f.app.billing.issueCredit(f.actor, "allcredit", {
    invoiceId,
    reference: "FULLCREDIT",
    reason: "Synthetic return",
    lines: [
      { lineId: f.app.billing.lines(f.actor, invoiceId)[0]!.id, quantity: 1 },
    ],
  });
  const refund = f.app.billing.refundRequest(f.actor, "refund", {
    invoiceId,
    paymentId: p.id,
    amount: 3000,
    reference: "REF-1",
    reason: "Synthetic pending refund",
  });
  const a = f.app.billing.documents.aging(f.actor).accounts[0]!;
  assert.deepEqual(
    [
      a.notDue,
      a.days1to30,
      a.days31to60,
      a.days61to90,
      a.daysOver90,
      a.unknownDue,
      a.open,
      a.creditBalance,
      a.net,
      a.pendingRefunds,
    ],
    [37200, 37200, 37200, 37200, 18600, 0, 167400, 11300, 156100, 3000],
  );
  f.app.billing.manualRefund(f.actor, "refundproof", {
    refundId: refund.id,
    reference: "BANK-REFUND",
    reason: "Verified synthetic bank refund",
  });
  const after = f.app.billing.documents.aging(f.actor).accounts[0]!;
  assert.equal(after.creditBalance, 8300);
  assert.equal(after.net, 159100);
  assert.equal(after.pendingRefunds, 0);
});

test("current buyer/account, organization, role and session authority protect cached documents, profiles, aging and download history", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId,
    buyer = user(f, "buyer", f.buyer),
    warehouse = user(f, "warehouse");
  const other = f.app.identity.createCustomer(f.actor, "other", {
      name: "Other buyer",
      tier: "standard",
      creditLimit: 100000,
    }).id,
    foreignBuyer = user(f, "buyer", other);
  await f.app.billing.documents.download(buyer, "buyer", "invoice", invoiceId);
  assert.equal(f.app.billing.documents.aging(buyer).accounts.length, 1);
  assert.equal(f.app.billing.documents.downloads(buyer).length, 1);
  assert.equal(f.app.billing.documents.downloads(foreignBuyer).length, 0);
  await assert.rejects(
    f.app.billing.documents.download(
      foreignBuyer,
      "foreign",
      "invoice",
      invoiceId,
    ),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.billing.documents.download(
      warehouse,
      "warehouse",
      "invoice",
      invoiceId,
    ),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.billing.documents.download(
      { ...buyer, orgId: "foreign" },
      "buyer",
      "invoice",
      invoiceId,
    ),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => f.app.billing.documents.profiles(buyer), {
    code: "FORBIDDEN",
  });
  assert.throws(() => f.app.billing.documents.agingCsv(buyer), {
    code: "FORBIDDEN",
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", buyer.id);
  await assert.rejects(
    f.app.billing.documents.download(buyer, "buyer", "invoice", invoiceId),
    { code: "FORBIDDEN" },
  );
  const before = f.app.billing.documents.downloads(f.actor).length;
  await assert.rejects(
    f.app.billing.documents.download(
      f.actor,
      "logout",
      "invoice",
      invoiceId,
      () => {
        throw Object.assign(new Error("Expired session"), {
          code: "UNAUTHENTICATED",
        });
      },
    ),
    { code: "UNAUTHENTICATED" },
  );
  assert.equal(f.app.billing.documents.downloads(f.actor).length, before);
});

test("simultaneous rendering chooses one rendition and receipt; late receipt fault rolls back bytes/log/command before a safe retry", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId,
    store = f.app.database.owned("billing");
  store.migrate(
    "CREATE TRIGGER billing_fail_download BEFORE INSERT ON billing_downloads BEGIN SELECT RAISE(ABORT,'injected download failure'); END;",
  );
  await assert.rejects(
    f.app.billing.documents.download(f.actor, "race", "invoice", invoiceId),
    /injected download failure/,
  );
  assert.equal(
    store.all("SELECT * FROM billing_document_renditions").length,
    0,
  );
  assert.equal(store.all("SELECT * FROM billing_downloads").length, 0);
  assert.equal(
    f.app.database
      .owned("platform")
      .all(
        "SELECT * FROM platform_commands WHERE name='billing.document.download'",
      ).length,
    0,
  );
  store.migrate("DROP TRIGGER billing_fail_download;");
  const [a, b] = await Promise.all([
    f.app.billing.documents.download(f.actor, "race", "invoice", invoiceId),
    f.app.billing.documents.download(f.actor, "race", "invoice", invoiceId),
  ]);
  assert.deepEqual(a, b);
  assert.equal(
    store.all("SELECT * FROM billing_document_renditions").length,
    1,
  );
  assert.equal(store.all("SELECT * FROM billing_downloads").length, 1);
  store.run(
    "UPDATE billing_document_renditions SET bytes=? WHERE document_id=?",
    Buffer.from("corrupt"),
    invoiceId,
  );
  await assert.rejects(
    f.app.billing.documents.download(f.actor, "race", "invoice", invoiceId),
    { code: "DOCUMENT_INTEGRITY" },
  );
  store.run(
    "UPDATE billing_document_facts SET facts='{}' WHERE document_id=?",
    invoiceId,
  );
  await assert.rejects(
    f.app.billing.documents.download(f.actor, "other", "invoice", invoiceId),
    { code: "DOCUMENT_INTEGRITY" },
  );
});

test("long French documents paginate, retain all lines/money and footer; unsupported glyphs fail without a prepared download", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  const facts = f.app.billing.documents.facts(
    f.actor,
    "invoice",
    invoiceId,
  )!.facts;
  const long: DocumentFacts = {
    ...facts,
    lines: Array.from({ length: 40 }, (_, i) => ({
      description: `Équipement-${i} ${"é".repeat(950)}`,
      quantity: 1,
      unitPrice: 10000,
      unitTax: 1300,
    })),
    net: 400000,
    tax: 52000,
    total: 452000,
  };
  const pages = await parsed(
    await renderDocument(long, digest(canonical(long))),
  );
  assert.ok(pages.length > 5);
  const text = pages.join(" ");
  assert.match(text, /Équipement-39/);
  assert.match(text, /CAD 4520.00/);
  assert.match(text, /CAD 520.00/);
  pages.forEach((text, i) =>
    assert.match(text, new RegExp(`Page ${i + 1} of ${pages.length}`)),
  );
  const other = ship(f, accept(f, 1, "unsupported").id).invoiceId;
  const row = f.app.billing.documents.facts(f.actor, "invoice", other)!.facts;
  row.customer.name = "中文";
  f.app.database
    .owned("billing")
    .run(
      "UPDATE billing_document_facts SET facts=?,hash=? WHERE document_id=?",
      canonical(row),
      digest(canonical(row)),
      other,
    );
  await assert.rejects(
    f.app.billing.documents.download(f.actor, "glyph", "invoice", other),
    { code: "DOCUMENT_GLYPH" },
  );
  assert.equal(f.app.billing.documents.downloads(f.actor).length, 0);
});

test("legacy invoices retain unknown terms despite current profiles and profile edits require current finance and revision", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId;
  f.app.database
    .owned("billing")
    .run("DELETE FROM billing_document_facts WHERE document_id=?", invoiceId);
  profile(f, f.buyer, "Later terms", 30);
  assert.equal(
    f.app.billing.documents.aging(f.actor).accounts[0]!.unknownDue,
    11300,
  );
  await f.app.billing.documents.download(
    f.actor,
    "legacy",
    "invoice",
    invoiceId,
  );
  const facts = f.app.billing.documents.facts(
    f.actor,
    "invoice",
    invoiceId,
  )!.facts;
  assert.equal(facts.dueAt, null);
  assert.equal(facts.terms.days, null);
  assert.match(facts.terms.basis, /Legacy/);
  const input = {
    accountId: f.buyer,
    name: "Stale",
    address: "",
    taxRegistration: "",
    termDays: 10,
    version: 0,
    reason: "Synthetic edit",
  };
  assert.throws(
    () => f.app.billing.documents.configure(f.actor, "stale", input),
    { code: "STALE_REVISION" },
  );
  assert.throws(
    () =>
      f.app.billing.documents.configure(
        user(f, "warehouse"),
        "forbidden",
        input,
      ),
    { code: "FORBIDDEN" },
  );
  f.app.database
    .owned("iam")
    .run(
      "UPDATE iam_accounts SET name=? WHERE id=?",
      ' =HYPERLINK("x")',
      f.buyer,
    );
  const csv = f.app.billing.documents.agingCsv(f.actor);
  assert.match(csv, /unknown_due_cents/);
  assert.match(csv, /"' =HYPERLINK/);
  const exports = f.app.database
    .owned("platform")
    .all(
      "SELECT result FROM platform_commands WHERE name='billing.aging.export'",
    );
  assert.equal(exports.length, 1);
  assert.deepEqual(JSON.parse(String(exports[0]!.result)), {
    observedAt: JSON.parse(csv.split("\r\n")[1]!.split(",")[0]!),
    contentHash: digest(csv),
    accountIds: [f.buyer],
    state: "prepared",
  });
});

test("HTTP PDF download requires session, origin, CSRF, exact body/kind and key; serves verified private bytes and a prepared receipt", async (t) => {
  const f = fixture(t),
    invoiceId = ship(f, accept(f).id).invoiceId,
    origin = "http://127.0.0.1:3000",
    http = await createHttp(f.app, {
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
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const headers = {
      origin,
      cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "HTTP-PDF",
    },
    url = `/api/billing/documents/invoice/${invoiceId}/pdf`;
  assert.equal(
    (await http.inject({ method: "POST", url, payload: {} })).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, origin: "http://foreign.test" },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { accountId: f.buyer },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: url.replace("/invoice/", "/invalid/"),
        headers,
        payload: {},
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "idempotency-key": "" },
        payload: {},
      })
    ).statusCode,
    400,
  );
  const response = await http.inject({
    method: "POST",
    url,
    headers,
    payload: {},
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/pdf");
  assert.match(
    String(response.headers["content-disposition"]),
    /attachment; filename="Invoice_/,
  );
  assert.match(String(response.headers["cache-control"]), /no-store/);
  assert.equal(
    digest(response.rawPayload),
    response.headers["x-document-sha256"],
  );
  assert.equal(response.rawPayload.subarray(0, 5).toString(), "%PDF-");
  const retry = await http.inject({
    method: "POST",
    url,
    headers,
    payload: {},
  });
  assert.deepEqual(retry.rawPayload, response.rawPayload);
  assert.equal(
    retry.headers["x-download-receipt"],
    response.headers["x-download-receipt"],
  );
  await http.inject({
    method: "POST",
    url: "/api/logout",
    headers,
    payload: {},
  });
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload: {} }))
      .statusCode,
    401,
  );
});
