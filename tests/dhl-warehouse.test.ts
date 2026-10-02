import { test } from "node:test";
import assert from "node:assert/strict";
import { dhlWarehouse } from "./dhl-warehouse-fixture.ts";
import { readDhlDeclaration } from "../src/web/dhl-declaration.tsx";

for (const country of ["US", "CA"] as const)
  for (const bulk of [false, true])
    test(`carrier goods review exposes only actual packed ${country} ${bulk ? "bulk quantities" : "serials"} and no prices`, (t) => {
      const f = dhlWarehouse(t, country, bulk);
      const before = f.app.fulfillment.shipment(f.actor, f.shipmentId);
      const goods = f.app.carriers.review(f.actor, f.shipmentId).packedGoods;
      assert.deepEqual(
        goods.map(({ allocationId, quantity }) => ({ allocationId, quantity })),
        JSON.parse(before.lines),
      );
      assert.deepEqual(
        goods.map((g) => g.serial),
        bulk ? [null] : ["S1", "S2"],
      );
      assert.equal(
        goods.reduce((n, g) => n + g.quantity, 0),
        2,
      );
      for (const g of goods) {
        assert.deepEqual(Object.keys(g).sort(), [
          "allocationId",
          "description",
          "quantity",
          "serial",
        ]);
        assert.match(g.description, /Synthetic.*equipment/);
      }
      assert.deepEqual(
        f.app.fulfillment.shipment(f.actor, f.shipmentId),
        before,
      );
    });
test("packed goods rechecks current role, site and organization instead of trusting caller claims", (t) => {
  const f = dhlWarehouse(t, "US");
  const userId = f.app.identity.createUser(f.actor, "dhl-ui-user", {
    email: "dhl-warehouse@example.test",
    name: "Synthetic warehouse",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  }).id;
  const actor = f.app.identity.currentActor({ ...f.actor, id: userId });
  assert.equal(
    f.app.carriers.review(actor, f.shipmentId).packedGoods.length,
    2,
  );
  const iam = f.app.database.owned("iam");
  const reads = [
    () => f.app.fulfillment.packedGoods(actor, f.shipmentId),
    () => f.app.carriers.review(actor, f.shipmentId),
  ];
  iam.run(
    "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
    actor.id,
  );
  for (const read of reads) assert.throws(read, /Change your password/);
  iam.run(
    "UPDATE iam_user_security SET password_change_required=0 WHERE user_id=?",
    actor.id,
  );
  iam.run("UPDATE iam_users SET active=0 WHERE id=?", actor.id);
  for (const read of reads) assert.throws(read);
  iam.run("UPDATE iam_users SET active=1 WHERE id=?", actor.id);
  iam.run("UPDATE iam_users SET sites='[]' WHERE id=?", actor.id);
  assert.throws(() =>
    f.app.fulfillment.packedGoods(
      { ...actor, sites: [f.w1], role: "admin" },
      f.shipmentId,
    ),
  );
  assert.throws(() =>
    f.app.carriers.review(
      { ...actor, sites: [f.w1], role: "admin" },
      f.shipmentId,
    ),
  );
  const other = dhlWarehouse(t, "US");
  assert.throws(() => other.app.carriers.review(other.actor, f.shipmentId));
  iam.run(
    "UPDATE iam_users SET role='buyer',account_id=? WHERE id=?",
    f.buyer,
    actor.id,
  );
  assert.throws(() =>
    f.app.fulfillment.packedGoods(
      { ...actor, sites: [f.w1], role: "admin" },
      f.shipmentId,
    ),
  );
});
function entry(amount: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    localTime: "2026-10-03T10:30",
    offset: "-04:00",
    shipper: "Reviewed shipper",
    receiver: "Reviewed receiver",
    description: "Reviewed equipment",
    incoterm: "DAP",
    currency: "CAD",
    invoiceType: "returns",
    invoiceNumber: "SYNTHETIC-DECLARATION",
    invoiceDate: "2026-10-01",
    exportReason: "return",
    customsAcknowledgment: "Explicit goods review",
    customsConfirmed: "on",
    "line.0.value": amount,
    "line.0.description": "Explicit goods",
    "line.0.country": "CA",
    "line.0.commodity": "001234",
    "line.0.weight": "500",
  }))
    form.set(`dhl.${key}`, value);
  return form;
}
const goods = [
  {
    allocationId: "packed-only",
    quantity: 2,
    description: "Native description",
    serial: null,
  },
];
test("DHL money entry preserves cents, explicit time offset, leading commodity zeros and full native quantity", () => {
  for (const [amount, minor] of [
    ["0.01", 1],
    ["123.4", 12340],
    ["10000000000.00", 1e12],
  ] as const) {
    const declaration = readDhlDeclaration(entry(amount), goods, true);
    assert.equal(declaration.plannedShippingAt, "2026-10-03T10:30:00-04:00");
    assert.equal(declaration.customs!.lines[0]!.unitValueMinor, minor);
    assert.equal(declaration.customs!.lines[0]!.quantity, 2);
    assert.equal(declaration.customs!.lines[0]!.allocationId, "packed-only");
    assert.equal(declaration.customs!.lines[0]!.commodityCode, "001234");
    assert.equal(declaration.customs!.invoiceType, "returns");
  }
});
test("DHL form rejects guessed currency formats, rounding, nonpositive values, excessive money and missing packed review", () => {
  for (const amount of [
    "123,45",
    "1e2",
    " 1.00",
    "1.001",
    "0",
    "-1",
    "10000000000.01",
    "1.",
    "",
    "Infinity",
  ])
    assert.throws(() => readDhlDeclaration(entry(amount), goods, true), amount);
  const form = entry("1.00");
  form.delete("dhl.customsConfirmed");
  assert.throws(() => readDhlDeclaration(form, goods, true));
  assert.throws(() => readDhlDeclaration(entry("1.00"), [], true));
  assert.equal(
    readDhlDeclaration(entry("1.00"), goods, false).customs,
    undefined,
  );
});
