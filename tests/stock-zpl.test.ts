import { test } from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import jsQRModule from "jsqr";
import { renderZpl, zplRendererHash } from "../src/server/label-zpl.ts";
import { renderLabel, type LabelFacts } from "../src/server/label-pdf.ts";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";

const jsQR = jsQRModule as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;
// Independent ZPL reader accepts only a single fixed graphic per complete label.
// Decode printed dots rather than the PDF used by the production renderer.
function readDots(bytes: Uint8Array, density: 8 | 12, copies: number) {
  const text = Buffer.from(bytes).toString("ascii");
  const labels = text.match(/\^XA[\s\S]*?\^XZ\n/g) ?? [];
  assert.equal(labels.join(""), text);
  assert.equal(labels.length, copies);
  const width = density * 100,
    height = density * 50,
    rowBytes = width / 8;
  const graphics = labels.map((label) => {
    const match =
      /^\^XA\n\^PW(\d+)\n\^LL(\d+)\n\^LH0,0\n\^LS0\n\^LT0\n\^PON\n\^FWN\n\^LRN\n\^FO0,0\n\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS\n\^PQ1\n\^XZ\n$/.exec(
        label,
      );
    assert.ok(
      match,
      "only reviewed geometry, graphic and single-copy commands",
    );
    assert.equal(Number(match[1]), width);
    assert.equal(Number(match[2]), height);
    assert.equal(Number(match[3]), rowBytes * height);
    assert.equal(Number(match[4]), rowBytes * height);
    assert.equal(Number(match[5]), rowBytes);
    const graphic = Buffer.from(match[6]!, "hex");
    assert.equal(graphic.length, rowBytes * height);
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const dark =
          (graphic[y * rowBytes + Math.floor(x / 8)]! & (128 >> (x % 8))) !== 0;
        const i = (y * width + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = dark ? 0 : 255;
        pixels[i + 3] = 255;
      }
    return pixels;
  });
  for (const graphic of graphics) assert.deepEqual(graphic, graphics[0]);
  return { pixels: graphics[0]!, width, height };
}
async function compareOriginal(
  facts: LabelFacts,
  density: 8 | 12,
  pixels: Uint8ClampedArray,
) {
  const pdfTask = getDocument({
    data: new Uint8Array(await renderLabel({ ...facts, copies: 1 })),
    useSystemFonts: false,
  });
  try {
    const page = await (await pdfTask.promise).getPage(1);
    const text = (await page.getTextContent()).items
      .filter((i): i is Extract<typeof i, { str: string }> => "str" in i)
      .map((i) => i.str)
      .join("");
    assert.ok(text.includes(facts.sku));
    if (facts.serial !== null) assert.ok(text.includes(facts.serial));
    const canvas = createCanvas(density * 100, density * 50),
      ctx = canvas.getContext("2d");
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale: (25.4 * density) / 72 }),
      background: "rgb(255,255,255)",
    }).promise;
    const original = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let p = 0; p < pixels.length; p += 4) {
      const luminance =
        (299 * original[p]! + 587 * original[p + 1]! + 114 * original[p + 2]!) /
        1000;
      assert.equal(
        pixels[p],
        luminance < 128 ? 0 : 255,
        `printed dot ${p / 4} equals complete identity image`,
      );
    }
  } finally {
    await pdfTask.destroy();
  }
}
for (const density of [8, 12] as const) {
  for (const serial of [
    "S1",
    "Québec-équipement-123",
    "e\u0301-NON-NORMALIZED",
    "W".repeat(160),
    "^XZ~JA,command-looking",
    null,
  ]) {
    test(`ZPL ${density} dots/mm independently decodes full identity ${serial?.slice(0, 24) ?? "bulk"}`, async () => {
      const facts = {
        unitId: "test",
        warehouseId: "test",
        revision: 1,
        sku: "BULK-QUÉBEC",
        serial,
        copies: 2,
      };
      const bytes = await renderZpl(facts, density),
        image = readDots(bytes, density, 2);
      assert.equal(
        jsQR(image.pixels, image.width, image.height)?.data,
        serial ?? facts.sku,
      );
      await compareOriginal(facts, density, image.pixels);
      assert.ok(bytes.length < 4000000);
    });
  }
}
test("ZPL maximum copies are bounded, output resolution and unsafe identities fail closed", async () => {
  const facts = {
    unitId: "test",
    warehouseId: "test",
    revision: 1,
    sku: "A",
    serial: "S1",
    copies: 20,
  };
  const bytes = await renderZpl(facts, 12);
  readDots(bytes, 12, 20);
  assert.ok(bytes.length < 4000000);
  for (const copies of [0, 21, 1.5, NaN])
    await assert.rejects(renderZpl({ ...facts, copies }, 8), {
      code: "VALIDATION",
    });
  await assert.rejects(renderZpl(facts, 9 as 8), { code: "VALIDATION" });
  await assert.rejects(renderZpl({ ...facts, serial: "A\nB" }, 8), {
    code: "LABEL_TEXT",
  });
  await assert.rejects(renderZpl({ ...facts, serial: "💥" }, 8), {
    code: "LABEL_GLYPH",
  });
});
test("PDF historical retry remains exact; ZPL profiles persist independently across restart and conserve stock", async (t) => {
  const f = fixture(t),
    u = f.app.inventory.stock(f.actor)[0]!,
    input = { revision: u.revision, copies: 2 };
  const before = f.app.inventory.stock(f.actor),
    movements = f.app.database
      .owned("inventory")
      .all("SELECT * FROM inventory_movements");
  const pdf = await f.app.labels.download(f.actor, "pdf", u.id, input);
  assert.deepEqual(
    await f.app.labels.download(f.actor, "pdf", u.id, {
      ...input,
      output: "pdf",
    }),
    pdf,
  );
  const results = [];
  for (const output of ["zpl-8", "zpl-12"] as const) {
    const result = await f.app.labels.download(f.actor, output, u.id, {
      ...input,
      output,
    });
    readDots(result.bytes, output === "zpl-8" ? 8 : 12, 2);
    assert.equal(result.receipt.filename, `Stock_${u.id}_${output}.zpl`);
    assert.equal(result.receipt.contentHash, digest(result.bytes));
    results.push({ output, result });
  }
  assert.notEqual(
    results[0]!.result.receipt.contentHash,
    results[1]!.result.receipt.contentHash,
  );
  const rows = f.app.database
    .owned("inventory")
    .all("SELECT * FROM inventory_label_renditions");
  assert.equal(rows.length, 3);
  assert.ok(
    rows
      .filter((r) => JSON.parse(String(r.facts)).output)
      .every((r) => r.renderer_hash === zplRendererHash),
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    await f.app.labels.download(f.actor, "pdf", u.id, {
      ...input,
      output: "pdf",
    }),
    pdf,
  );
  for (const { output, result } of results) {
    assert.deepEqual(
      await f.app.labels.download(f.actor, output, u.id, { ...input, output }),
      result,
    );
    await assert.rejects(
      f.app.labels.download(f.actor, output, u.id, { ...input, output: "pdf" }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    await assert.rejects(
      f.app.labels.download(f.actor, output, u.id, {
        ...input,
        copies: 1,
        output,
      }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
  }
  for (const output of [null, "zpl", "zpl-9"])
    await assert.rejects(
      f.app.labels.download(f.actor, "invalid", u.id, {
        ...input,
        output: output as any,
      }),
      { code: "VALIDATION" },
    );
  assert.equal(f.app.labels.downloads(f.actor).length, 3);
  assert.deepEqual(f.app.inventory.stock(f.actor), before);
  assert.deepEqual(
    f.app.database.owned("inventory").all("SELECT * FROM inventory_movements"),
    movements,
  );
});
test("ZPL current authority, password changes, organization and stock drift are enforced before cached and rendered bytes", async (t) => {
  const f = fixture(t),
    u = f.app.inventory.stock(f.actor)[0]!,
    input = { revision: u.revision, copies: 1, output: "zpl-8" as const };
  const iam = f.app.database.owned("iam");
  f.app.identity.createUser(f.actor, "operator", {
    email: "zpl@example.test",
    name: "ZPL operator",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  const actor = f.app.identity.login(
    "zpl@example.test",
    "long-test-only-password",
  ).actor;
  await f.app.labels.download(actor, "cached", u.id, input);
  iam.run(
    "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
    actor.id,
    new Date().toISOString(),
  );
  for (const output of ["pdf", "zpl-8", "zpl-12"] as const) {
    await assert.rejects(
      f.app.labels.download(actor, "cached", u.id, { ...input, output }),
      { code: "PASSWORD_CHANGE_REQUIRED" },
    );
  }
  assert.throws(() => f.app.labels.downloads(actor), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    actor.id,
  );
  iam.run(
    "UPDATE iam_users SET sites=? WHERE id=?",
    JSON.stringify([f.w2]),
    actor.id,
  );
  await assert.rejects(
    f.app.labels.download(
      { ...actor, role: "admin", sites: [f.w1] },
      "cached",
      u.id,
      input,
    ),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.labels.downloads(actor).length, 0);
  iam.run(
    "UPDATE iam_users SET sites=?,role='buyer',account_id=? WHERE id=?",
    JSON.stringify([f.w1]),
    f.buyer,
    actor.id,
  );
  await assert.rejects(
    f.app.labels.download({ ...actor, role: "admin" }, "cached", u.id, input),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.labels.download(
      { ...f.actor, orgId: "foreign" },
      "cached",
      u.id,
      input,
    ),
  );
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  await assert.rejects(f.app.labels.download(actor, "cached", u.id, input));
  const history = f.app.labels.downloads(f.actor).length;
  await assert.rejects(
    f.app.labels.download(
      f.actor,
      "during-password-change",
      u.id,
      { ...input, output: "zpl-12" },
      () => {
        iam.run(
          "INSERT INTO iam_user_security VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET password_change_required=1",
          f.actor.id,
          new Date().toISOString(),
        );
        return f.actor;
      },
    ),
    { code: "PASSWORD_CHANGE_REQUIRED" },
  );
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    f.actor.id,
  );
  await assert.rejects(
    f.app.labels.download(
      f.actor,
      "during-principal-change",
      u.id,
      input,
      () => ({ ...f.actor, id: actor.id }),
    ),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    f.app.labels.download(f.actor, "during-stock-change", u.id, input, () => {
      f.app.inventory.inspect(f.actor, "inspect", {
        unitId: u.id,
        revision: u.revision,
        condition: "quarantine",
        reason: "Synthetic inspection",
      });
      return f.actor;
    }),
    { code: "STALE_REVISION" },
  );
  assert.equal(f.app.labels.downloads(f.actor).length, history);
});
test("ZPL late receipt rollback, concurrent retry and persisted corruption refuse extra preparations", async (t) => {
  const f = fixture(t),
    u = f.app.inventory.stock(f.actor)[0]!,
    input = { revision: u.revision, copies: 1, output: "zpl-12" as const },
    store = f.app.database.owned("inventory");
  const audits = f.app.platform.audits(f.actor).length;
  store.migrate(
    "CREATE TRIGGER inventory_fail_zpl BEFORE INSERT ON inventory_label_downloads BEGIN SELECT RAISE(ABORT,'synthetic ZPL failure'); END;",
  );
  await assert.rejects(
    f.app.labels.download(f.actor, "zpl", u.id, input),
    /synthetic ZPL failure/,
  );
  assert.equal(store.all("SELECT * FROM inventory_label_renditions").length, 0);
  assert.equal(f.app.platform.audits(f.actor).length, audits);
  assert.equal(
    f.app.database
      .owned("platform")
      .all(
        "SELECT * FROM platform_commands WHERE name='inventory.label.download'",
      ).length,
    0,
  );
  store.migrate("DROP TRIGGER inventory_fail_zpl");
  const [a, b] = await Promise.all([
    f.app.labels.download(f.actor, "zpl", u.id, input),
    f.app.labels.download(f.actor, "zpl", u.id, input),
  ]);
  assert.deepEqual(a, b);
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
  store.run(
    "UPDATE inventory_label_renditions SET bytes=?",
    Buffer.from("^XA~JA^XZ"),
  );
  await assert.rejects(f.app.labels.download(f.actor, "zpl", u.id, input), {
    code: "LABEL_INTEGRITY",
  });
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
});
test("ZPL HTTP validates output, scoped session and request protections, and retains a committed lost-response identity", async (t) => {
  const f = fixture(t),
    u = f.app.inventory.stock(f.actor)[0]!,
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
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const headers = {
      origin,
      cookie: `${login.cookies[0]!.name}=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "zpl-http",
    },
    url = `/api/stock/${u.id}/label`,
    payload = { revision: u.revision, copies: 2, output: "zpl-8" };
  for (const output of [null, "zpl", "zpl-9", 0])
    assert.equal(
      (
        await http.inject({
          method: "POST",
          url,
          headers,
          payload: { ...payload, output },
        })
      ).statusCode,
      400,
    );
  for (const request of [
    { headers: { ...headers, "x-csrf-token": "wrong" }, payload },
    { headers: { ...headers, origin: "http://foreign.test" }, payload },
    { headers: { ...headers, "idempotency-key": "" }, payload },
    { headers, payload: { ...payload, unexpected: true } },
  ])
    assert.ok(
      (await http.inject({ method: "POST", url, ...request })).statusCode >=
        400,
    );
  const a = await http.inject({ method: "POST", url, headers, payload }),
    b = await http.inject({ method: "POST", url, headers, payload });
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.rawPayload, b.rawPayload);
  assert.equal(a.headers["content-type"], "application/octet-stream");
  assert.equal(
    a.headers["content-disposition"],
    `attachment; filename="Stock_${u.id}_zpl-8.zpl"`,
  );
  assert.equal(a.headers["x-document-sha256"], digest(a.rawPayload));
  assert.equal(
    a.headers["x-download-receipt"],
    b.headers["x-download-receipt"],
  );
  readDots(a.rawPayload, 8, 2);
  f.app.database.owned("iam").run("DELETE FROM iam_sessions");
  assert.equal(
    (await http.inject({ method: "POST", url, headers, payload })).statusCode,
    401,
  );
  assert.equal(f.app.labels.downloads(f.actor).length, 1);
});

for (const region of ["US", "CA"] as const) {
  test(`ZPL native bulk stock ${region} retains full SKU, distinct profile and original quantity/cost`, async (t) => {
    const f = fixture(t, {}, region);
    const sku = "Bulk-Québec-^XZ~JA";
    const product = f.app.catalog.create(f.actor, "bulk-sku", {
      sku,
      name: "Synthetic bulk",
      serialized: false,
      unitPrice: 1000,
      taxBasisPoints: 0,
    }).id;
    const po = f.app.procurement.create(f.actor, "bulk-po", {
      supplierId: f.supplier,
      warehouseId: f.w2,
      lines: [{ productId: product, quantity: 2, unitCost: 500 }],
    }).id;
    const line = f.app.procurement.orders(f.actor).find((p) => p.id === po)!
      .lines[0]!;
    f.app.procurement.receive(f.actor, "bulk-receive", {
      poId: po,
      lineId: String(line.id),
      deliveryRef: "SYNTHETIC-BULK",
      quantity: 2,
      serials: [],
      bin: "B-1",
      quarantine: false,
    });
    const u = f.app.inventory
      .stock(f.actor)
      .find((s) => s.product_id === product)!;
    const before = f.app.inventory.stock(f.actor),
      movements = f.app.database
        .owned("inventory")
        .all("SELECT * FROM inventory_movements");
    for (const output of ["zpl-8", "zpl-12"] as const) {
      const result = await f.app.labels.download(f.actor, output, u.id, {
        revision: u.revision,
        copies: 2,
        output,
      });
      const image = readDots(result.bytes, output === "zpl-8" ? 8 : 12, 2);
      assert.equal(jsQR(image.pixels, image.width, image.height)?.data, sku);
      const receipt = f.app.labels
        .downloads(f.actor)
        .find((r) => r.id === result.receipt.id)!;
      assert.equal(receipt.warehouse_id, f.w2);
      assert.equal(receipt.facts.sku, sku);
      assert.equal(receipt.facts.serial, null);
      assert.equal(receipt.facts.output, output);
    }
    assert.deepEqual(f.app.inventory.stock(f.actor), before);
    assert.deepEqual(
      f.app.database
        .owned("inventory")
        .all("SELECT * FROM inventory_movements"),
      movements,
    );
  });
}
