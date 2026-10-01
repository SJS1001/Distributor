import { test } from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import jsQRModule from "jsqr";
const jsQR = jsQRModule as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;
import { fixture } from "./fixtures.ts";
import { renderLabel } from "../src/server/label-pdf.ts";
import { Application } from "../src/server/application.ts";
import { digest, type Actor } from "../src/server/core.ts";
import { createHttp } from "../src/server/http.ts";

async function decode(
  bytes: Uint8Array,
  identity: string,
  copies: number,
  dpi = 203,
) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  assert.equal(pdf.numPages, copies);
  for (let i = 1; i <= copies; i++) {
    const page = await pdf.getPage(i),
      viewport = page.getViewport({ scale: dpi / 72 });
    assert.ok(Math.abs(page.view[2]! - (100 * 72) / 25.4) < 0.01);
    assert.ok(Math.abs(page.view[3]! - (50 * 72) / 25.4) < 0.01);
    const text = await page.getTextContent();
    const items = text.items.filter(
      (v): v is Extract<typeof v, { str: string }> => "str" in v,
    );
    for (const item of items)
      assert.ok(
        item.transform[4] >= (48 * 72) / 25.4 &&
          item.transform[4] + item.width <= (97 * 72) / 25.4 &&
          item.transform[5] >= (3 * 72) / 25.4,
        "identity text remains inside label bounds",
      );
    assert.ok(
      items
        .map((v) => v.str)
        .join("")
        .includes(identity),
      "human identity is complete",
    );
    const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      ),
      context = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    assert.equal(
      jsQR(new Uint8ClampedArray(pixels.data), canvas.width, canvas.height)
        ?.data,
      identity,
      "independent reader decodes actual PDF pixels",
    );
  }
  await task.destroy();
}

function unit(f: ReturnType<typeof fixture>) {
  return f.app.inventory.stock(f.actor)[0]!;
}
function worker(f: ReturnType<typeof fixture>): Actor {
  f.app.identity.createUser(f.actor, "label-user", {
    email: "label@example.test",
    name: "Label operator",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  return f.app.identity.login("label@example.test", "long-test-only-password")
    .actor;
}

test("labels independently decode PDF pixels at 203/300 dpi, preserve Unicode and longest identities, repeat deliberate copies", async () => {
  for (const identity of [
    "S1",
    "Québec-équipement-123",
    "e\u0301-NON-NORMALIZED",
    "W".repeat(160),
  ]) {
    const bytes = await renderLabel({
      unitId: "test",
      warehouseId: "test",
      revision: 1,
      sku: "EQ-1",
      serial: identity,
      copies: 2,
    });
    await decode(bytes, identity, 2, 203);
    await decode(bytes, identity, 2, 300);
  }
  const sku = "BULK-QUÉBEC";
  await decode(
    await renderLabel({
      unitId: "test",
      warehouseId: "test",
      revision: 1,
      sku,
      serial: null,
      copies: 1,
    }),
    sku,
    1,
  );
  await assert.rejects(
    renderLabel({
      unitId: "test",
      warehouseId: "test",
      revision: 1,
      sku: "A",
      serial: "A\nB",
      copies: 1,
    }),
    { code: "LABEL_TEXT" },
  );
  await assert.rejects(
    renderLabel({
      unitId: "test",
      warehouseId: "test",
      revision: 1,
      sku: "A",
      serial: "💥",
      copies: 1,
    }),
    { code: "LABEL_GLYPH" },
  );
});

test("stock label retries survive restart, share immutable bytes, and never change stock or movements", async (t) => {
  const f = fixture(t),
    u = unit(f),
    before = f.app.inventory.stock(f.actor),
    input = { revision: u.revision, copies: 2 };
  const movements = f.app.database
    .owned("inventory")
    .all("SELECT * FROM inventory_movements");
  const a = await f.app.labels.download(f.actor, "label", u.id, input);
  await decode(a.bytes, u.serial!, 2);
  assert.equal(a.receipt.contentHash, digest(a.bytes));
  assert.equal(a.receipt.state, "prepared");
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    await f.app.labels.download(f.actor, "label", u.id, input),
    a,
  );
  const b = await f.app.labels.download(f.actor, "another", u.id, input);
  assert.deepEqual(a.bytes, b.bytes);
  assert.notEqual(a.receipt.id, b.receipt.id);
  assert.equal(f.app.labels.downloads(f.actor).length, 2);
  assert.deepEqual(f.app.inventory.stock(f.actor), before);
  assert.deepEqual(
    f.app.database.owned("inventory").all("SELECT * FROM inventory_movements"),
    movements,
  );
  await assert.rejects(
    f.app.labels.download(f.actor, "label", u.id, { ...input, copies: 1 }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  for (const copies of [0, 21, 1.5])
    await assert.rejects(
      f.app.labels.download(f.actor, "invalid", u.id, { ...input, copies }),
      { code: "VALIDATION" },
    );
});

test("labels recheck current roles/sites/organization for cached bytes, preserve site-scoped history and refuse stale stock", async (t) => {
  const f = fixture(t),
    u = unit(f),
    a = worker(f),
    input = { revision: u.revision, copies: 1 };
  await f.app.labels.download(a, "label", u.id, input);
  const iam = f.app.database.owned("iam");
  iam.run(
    "UPDATE iam_users SET sites=? WHERE id=?",
    JSON.stringify([f.w2]),
    a.id,
  );
  await assert.rejects(f.app.labels.download(a, "label", u.id, input), {
    code: "FORBIDDEN",
  });
  assert.equal(f.app.labels.downloads(a).length, 0);
  iam.run(
    "UPDATE iam_users SET sites=?,role='buyer',account_id=? WHERE id=?",
    JSON.stringify([f.w1]),
    f.buyer,
    a.id,
  );
  await assert.rejects(f.app.labels.download(a, "label", u.id, input), {
    code: "FORBIDDEN",
  });
  await assert.rejects(
    f.app.labels.download(
      { ...f.actor, orgId: "foreign" },
      "label",
      u.id,
      input,
    ),
  );
  f.app.inventory.inspect(f.actor, "inspect", {
    unitId: u.id,
    revision: u.revision,
    condition: "quarantine",
    reason: "Physical inspection",
  });
  await assert.rejects(f.app.labels.download(f.actor, "new", u.id, input), {
    code: "STALE_REVISION",
  });
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
});

test("rendering reauthenticates and rejects stock or principal changes before saving bytes", async (t) => {
  const f = fixture(t),
    u = unit(f),
    input = { revision: u.revision, copies: 1 };
  await assert.rejects(
    f.app.labels.download(f.actor, "changed-principal", u.id, input, () => ({
      ...f.actor,
      id: "another",
    })),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.labels.download(f.actor, "changed-stock", u.id, input, () => {
      f.app.inventory.inspect(f.actor, "inspect", {
        unitId: u.id,
        revision: u.revision,
        condition: "quarantine",
        reason: "Inspection during render",
      });
      return f.actor;
    }),
    { code: "STALE_REVISION" },
  );
  const store = f.app.database.owned("inventory");
  assert.equal(store.all("SELECT * FROM inventory_label_renditions").length, 0);
  assert.equal(store.all("SELECT * FROM inventory_label_downloads").length, 0);
});

test("late receipt failure rolls back bytes and command/audit evidence; cached corruption is rejected", async (t) => {
  const f = fixture(t),
    u = unit(f),
    input = { revision: u.revision, copies: 1 },
    store = f.app.database.owned("inventory");
  const audits = f.app.platform.audits(f.actor).length;
  store.migrate(
    "CREATE TRIGGER inventory_fail_label BEFORE INSERT ON inventory_label_downloads BEGIN SELECT RAISE(ABORT,'synthetic late label failure'); END;",
  );
  await assert.rejects(
    f.app.labels.download(f.actor, "label", u.id, input),
    /synthetic late label failure/,
  );
  assert.equal(store.all("SELECT * FROM inventory_label_renditions").length, 0);
  assert.equal(f.app.labels.downloads(f.actor).length, 0);
  assert.equal(f.app.platform.audits(f.actor).length, audits);
  assert.equal(
    f.app.database
      .owned("platform")
      .all(
        "SELECT * FROM platform_commands WHERE name='inventory.label.download'",
      ).length,
    0,
  );
  store.migrate("DROP TRIGGER inventory_fail_label");
  const results = await Promise.all([
    f.app.labels.download(f.actor, "label", u.id, input),
    f.app.labels.download(f.actor, "label", u.id, input),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
  store.run(
    "UPDATE inventory_label_renditions SET bytes=?",
    Buffer.from("corrupt"),
  );
  await assert.rejects(f.app.labels.download(f.actor, "label", u.id, input), {
    code: "LABEL_INTEGRITY",
  });
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
});

test("label HTTP enforces JSON/CSRF/key/current session, returns verified PDF and one permanent lost-response receipt", async (t) => {
  const f = fixture(t),
    u = unit(f),
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
      "idempotency-key": "http-label",
    },
    url = `/api/stock/${u.id}/label`,
    payload = { revision: u.revision, copies: 1 };
  for (const request of [
    { headers: { ...headers, "x-csrf-token": "wrong" }, payload },
    { headers: { ...headers, origin: "http://foreign.test" }, payload },
    { headers: { ...headers, "idempotency-key": "" }, payload },
    { headers, payload: { ...payload, unexpected: true } },
    { headers, payload: { ...payload, copies: 21 } },
  ])
    assert.ok(
      (await http.inject({ method: "POST", url, ...request })).statusCode >=
        400,
    );
  const a = await http.inject({ method: "POST", url, headers, payload }),
    b = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.rawPayload, b.rawPayload);
  assert.equal(a.headers["x-document-sha256"], digest(a.rawPayload));
  assert.equal(
    a.headers["x-download-receipt"],
    b.headers["x-download-receipt"],
  );
  assert.match(String(a.headers["content-type"]), /application\/pdf/);
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
  f.app.database.owned("iam").run("DELETE FROM iam_sessions");
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload })).statusCode,
    401,
  );
});
