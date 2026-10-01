import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import type {
  CarrierAddress,
  CarrierPrepare,
} from "../src/shared/carrier-booking.ts";
import type {
  CanadaPostGroupPrepare,
  CarrierAdapter,
} from "../src/server/carrier-bookings.ts";

const configurationHash = "a".repeat(64);
const origin: CarrierAddress = {
  name: "Synthetic warehouse",
  line1: "1 Test Street",
  line2: "",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 1A1",
  country: "CA",
  phone: "4165550100",
};
function setup(
  t: Parameters<typeof fixture>[0],
  count = 1,
  overrides: Partial<CarrierPrepare>[] = [],
) {
  const f = fixture(t);
  chooseProviders(f, f.actor, "canada-post-choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post", "ups"],
    version: 1,
    acknowledgment: "Synthetic explicit Canada Post processing choice",
  });
  const shipments: string[] = [],
    entries = [];
  for (let i = 0; i < count; i++) {
    const orderId = accept(f, 1, `order-${i}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const item of picks)
      f.app.fulfillment.pick(f.actor, `pick-${item.id}`, {
        orderId,
        allocationId: item.id,
        serial: item.serial,
      });
    const address = "Synthetic receiver, 2 Test Street, Ottawa ON K1A 0B1, CA";
    const shipmentId = f.app.fulfillment.pack(f.actor, `pack-${i}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((item) => ({
        allocationId: item.id,
        quantity: item.quantity,
      })),
    }).id;
    const booking = f.app.carriers.prepare(f.actor, `prepare-${i}`, {
      shipmentId,
      previousId: null,
      provider: "canada-post",
      service: "Synthetic domestic",
      origin,
      destination: {
        ...origin,
        name: "Synthetic receiver",
        line1: "2 Test Street",
        city: "Ottawa",
        postalCode: "K1A 0B1",
      },
      parcel: { weightGrams: 1000, lengthMm: 100, widthMm: 100, heightMm: 100 },
      reviewedDestination: address,
      acknowledgment: "Synthetic reviewed shipment and parcel",
      ...overrides[i],
    });
    entries.push({ bookingId: booking.id, reviewHash: booking.reviewHash });
    shipments.push(shipmentId);
  }
  const input: CanadaPostGroupPrepare = { configurationHash, entries };
  return Object.assign(f, { input, shipments });
}
type F = ReturnType<typeof setup>;
function native(f: F) {
  return {
    stock: f.app.inventory.stock(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    orders: f.app.orders.list(f.actor),
    shipments: f.shipments.map((id) => f.app.fulfillment.shipment(f.actor, id)),
  };
}
function raw(f: F, sql: string, ...args: (string | number)[]) {
  const db = new DatabaseSync(f.path);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
}

function allRows(f: F) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    return Object.fromEntries(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all()
        .map(({ name }) => [
          String(name),
          db
            .prepare(
              `SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`,
            )
            .all(),
        ]),
    );
  } finally {
    db.close();
  }
}

for (const operation of ["prepare", "cancel"] as const)
  test(`late ${operation} audit failure rolls back membership, native facts, events, command receipts and audit sequence`, (t) => {
    const f = setup(t, 2);
    const group =
      operation === "cancel"
        ? f.app.carriers.prepareCanadaPostGroup(f.actor, "initial", f.input)
        : null;
    const before = allRows(f),
      original = f.app.platform.audit.bind(f.app.platform);
    const mock = t.mock.method(
      f.app.platform,
      "audit",
      (...args: Parameters<typeof original>) => {
        original(...args);
        throw new Error("synthetic late audit failure");
      },
    );
    const act = () =>
      operation === "prepare"
        ? f.app.carriers.prepareCanadaPostGroup(f.actor, "retryable", f.input)
        : f.app.carriers.cancelCanadaPostGroup(f.actor, "retryable", {
            groupId: group!.id,
            reviewHash: group!.reviewHash,
            reason: "Synthetic cancel",
          });
    assert.throws(act, /synthetic late audit failure/);
    assert.deepEqual(allRows(f), before);
    mock.mock.restore();
    const result = act();
    assert.deepEqual(act(), result);
    assert.equal(
      f.app.carriers.reviewCanadaPostGroup(f.actor, result.id).state,
      operation === "prepare" ? "prepared" : "canceled",
    );
  });

test("encrypted recovery preserves actual group reservations and blocks individual sends", async (t) => {
  const f = setup(t, 2),
    before = native(f),
    group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input),
    view = f.app.carriers.reviewCanadaPostGroup(f.actor, group.id),
    key = randomBytes(32),
    archive = join(dirname(f.path), "groups.backup"),
    target = join(dirname(f.path), "groups-restored.db");
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  try {
    assert.deepEqual(
      restored.carriers.reviewCanadaPostGroup(f.actor, group.id),
      view,
    );
    assert.deepEqual(native({ ...f, app: restored }), before);
    let calls = 0;
    const adapter: CarrierAdapter = {
      provider: "canada-post",
      sandbox: true,
      async book() {
        calls++;
        throw new Error("must not send");
      },
      async lookup() {
        calls++;
        throw new Error("must not read");
      },
    };
    const entry = f.input.entries[0]!;
    await assert.rejects(
      restored.carriers.execute(f.actor, entry.bookingId, adapter),
      { code: "CARRIER_GROUP_ACTIVE" },
    );
    assert.equal(calls, 0);
  } finally {
    restored.close();
  }
});

test("two actual native shipments reserve immutable sorted group membership, exact retries and durable restart without handover", (t) => {
  const f = setup(t, 2),
    before = native(f);
  const result = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "group",
    f.input,
  );
  assert.deepEqual(
    f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input),
    result,
  );
  const view = f.app.carriers.reviewCanadaPostGroup(f.actor, result.id);
  assert.equal(view.state, "prepared");
  assert.equal(view.reviewHash, result.reviewHash);
  assert.equal(view.configurationHash, configurationHash);
  assert.match(view.providerGroupId, /^[a-f0-9]{32}$/);
  assert.deepEqual(
    view.entries,
    [...f.input.entries]
      .sort((a, b) => (a.bookingId < b.bookingId ? -1 : 1))
      .map((entry) => ({ ...entry, state: "pending" })),
  );
  assert.throws(
    () =>
      f.app.carriers.prepareCanadaPostGroup(f.actor, "group", {
        ...f.input,
        configurationHash: "b".repeat(64),
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.carriers.reviewCanadaPostGroup(f.actor, result.id),
    view,
  );
  assert.deepEqual(native(f), before);
  for (const id of f.shipments)
    assert.equal(f.app.carriers.review(f.actor, id).booking!.state, "pending");
});

test("group ownership blocks competing preparation, individual cancellation, generic send and reconcile with no adapter call", async (t) => {
  const f = setup(t),
    before = native(f);
  const result = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "group",
    f.input,
  );
  const entry = f.input.entries[0]!;
  assert.throws(
    () =>
      f.app.carriers.prepareCanadaPostGroup(f.actor, "competing", {
        ...f.input,
        configurationHash: "b".repeat(64),
      }),
    { code: "CARRIER_GROUP_ACTIVE" },
  );
  assert.throws(
    () =>
      f.app.carriers.cancel(f.actor, "cancel", {
        ...entry,
        reason: "Synthetic cancellation",
      }),
    { code: "CARRIER_GROUP_ACTIVE" },
  );
  let calls = 0;
  const adapter: CarrierAdapter = {
    provider: "canada-post",
    sandbox: true,
    book: async () => {
      calls++;
      throw Error("unexpected write");
    },
    lookup: async () => {
      calls++;
      throw Error("unexpected read");
    },
  };
  await assert.rejects(
    f.app.carriers.execute(f.actor, entry.bookingId, adapter),
    { code: "CARRIER_GROUP_ACTIVE" },
  );
  await assert.rejects(
    f.app.carriers.reconcile(f.actor, entry.bookingId, adapter),
    { code: "CARRIER_GROUP_ACTIVE" },
  );
  assert.equal(calls, 0);
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, result.id).state,
    "prepared",
  );
  assert.deepEqual(native(f), before);
});

test("wholly unsent group cancellation retains history, releases bookings and never reuses provider group identity", (t) => {
  const f = setup(t),
    before = native(f);
  const result = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "group",
    f.input,
  );
  const input = {
    groupId: result.id,
    reviewHash: result.reviewHash,
    reason: "Synthetic unused batch cancellation",
  };
  assert.throws(
    () =>
      f.app.carriers.cancelCanadaPostGroup(f.actor, "wrong", {
        ...input,
        reviewHash: "0".repeat(64),
      }),
    { code: "CARRIER_MISMATCH" },
  );
  const canceled = f.app.carriers.cancelCanadaPostGroup(
    f.actor,
    "cancel",
    input,
  );
  assert.deepEqual(
    f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel", input),
    canceled,
  );
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, result.id).state,
    "canceled",
  );
  const next = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "successor",
    f.input,
  );
  assert.notEqual(next.id, result.id);
  assert.notEqual(
    f.app.carriers.reviewCanadaPostGroup(f.actor, next.id).providerGroupId,
    f.app.carriers.reviewCanadaPostGroup(f.actor, result.id).providerGroupId,
  );
  f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel-successor", {
    groupId: next.id,
    reviewHash: next.reviewHash,
    reason: "Synthetic unused successor",
  });
  f.app.carriers.cancel(f.actor, "cancel-booking", {
    ...f.input.entries[0]!,
    reason: "Synthetic unsent booking",
  });
  assert.equal(
    f.app.carriers.review(f.actor, f.shipments[0]!).booking!.state,
    "canceled",
  );
  assert.deepEqual(native(f), before);
});

for (const input of [
  { configurationHash: "bad", entries: [] },
  { configurationHash, entries: [] },
  {
    configurationHash,
    entries: Array(101).fill({ bookingId: "x", reviewHash: "y" }),
  },
  { configurationHash, entries: [null] },
] as unknown as CanadaPostGroupPrepare[])
  test(`malformed group review rejects without durable membership ${JSON.stringify(input).slice(0, 80)}`, (t) => {
    const f = setup(t),
      before = native(f);
    assert.throws(
      () => f.app.carriers.prepareCanadaPostGroup(f.actor, "invalid", input),
      { code: "VALIDATION" },
    );
    const db = new DatabaseSync(f.path);
    try {
      assert.equal(
        db
          .prepare("SELECT count(*) AS n FROM integration_canada_post_groups")
          .get()!.n,
        0,
      );
    } finally {
      db.close();
    }
    assert.deepEqual(native(f), before);
  });

test("duplicate, stale, foreign and canceled members cannot partially reserve any native booking", (t) => {
  const f = setup(t, 2),
    before = native(f),
    first = f.input.entries[0]!;
  for (const entries of [
    [first, first],
    [first, { ...f.input.entries[1]!, reviewHash: "0".repeat(64) }],
    [first, { bookingId: "unavailable", reviewHash: "a".repeat(64) }],
  ])
    assert.throws(() =>
      f.app.carriers.prepareCanadaPostGroup(f.actor, "invalid", {
        ...f.input,
        entries,
      }),
    );
  f.app.carriers.cancel(f.actor, "cancel-one", {
    ...first,
    reason: "Synthetic canceled member",
  });
  assert.throws(() =>
    f.app.carriers.prepareCanadaPostGroup(f.actor, "canceled", f.input),
  );
  const db = new DatabaseSync(f.path);
  try {
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM integration_canada_post_members")
        .get()!.n,
      0,
    );
  } finally {
    db.close();
  }
  assert.deepEqual(native(f), before);
});

test("current warehouse grants precede cached prepare/cancel and group review; foreign organization is hidden", (t) => {
  const f = setup(t),
    foreign = fixture(t);
  const user = f.app.identity.createUser(f.actor, "warehouse-user", {
    email: "warehouse@groups.example.test",
    name: "Synthetic group operator",
    password: "long-test-only-password",
    role: "warehouse",
    sites: [f.w1],
  });
  const actor = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const result = f.app.carriers.prepareCanadaPostGroup(actor, "group", f.input);
  const cancel = {
    groupId: result.id,
    reviewHash: result.reviewHash,
    reason: "Synthetic unused group",
  };
  f.app.carriers.cancelCanadaPostGroup(actor, "cancel", cancel);
  f.app.identity.updateUser(f.actor, "remove-site", {
    userId: user.id,
    revision: 1,
    email: "warehouse@groups.example.test",
    name: actor.name,
    role: "warehouse",
    sites: [f.w2],
    active: true,
    currentPassword: "long-test-only-password",
    reason: "Synthetic site withdrawal",
  });
  assert.throws(
    () => f.app.carriers.prepareCanadaPostGroup(actor, "group", f.input),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.carriers.cancelCanadaPostGroup(actor, "cancel", cancel),
    { code: "FORBIDDEN" },
  );
  assert.throws(() => f.app.carriers.reviewCanadaPostGroup(actor, result.id), {
    code: "FORBIDDEN",
  });
  assert.throws(
    () => foreign.app.carriers.reviewCanadaPostGroup(foreign.actor, result.id),
    { code: "NOT_FOUND" },
  );
});

test("withdrawn customer choice and restored provider hold prevent new group preparation without affecting unsent cancellation", (t) => {
  const f = setup(t),
    result = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input);
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic processing withdrawal",
  });
  f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel", {
    groupId: result.id,
    reviewHash: result.reviewHash,
    reason: "Synthetic withdrawal",
  });
  assert.throws(() =>
    f.app.carriers.prepareCanadaPostGroup(f.actor, "new-group", f.input),
  );
  chooseProviders(f, f.actor, "accept-again", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 3,
    acknowledgment: "Synthetic renewed choice",
  });
  f.app.database.transaction(() =>
    f.app.platform.isolateRestore("0".repeat(64), new Date().toISOString()),
  );
  assert.throws(
    () => f.app.carriers.prepareCanadaPostGroup(f.actor, "restored", f.input),
    { code: "RECOVERY_HOLD" },
  );
});

for (const damage of [
  "UPDATE integration_canada_post_groups SET state='creating'",
  "UPDATE integration_canada_post_groups SET token='claim'",
  "UPDATE integration_canada_post_groups SET started_at=1",
  "UPDATE integration_canada_post_groups SET observation='{}'",
  "UPDATE integration_canada_post_members SET state='unknown'",
  "UPDATE integration_canada_post_members SET token='claim'",
  "UPDATE integration_canada_post_members SET provider_shipment_id='synthetic-provider-id'",
  "UPDATE integration_carrier_bookings SET started_at=1",
  "UPDATE integration_carrier_bookings SET label_hash='synthetic-observation'",
  "UPDATE integration_carrier_bookings SET state='unknown'",
])
  test(`uncertain or claimed group cannot release native booking ownership: ${damage}`, (t) => {
    const f = setup(t),
      result = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input);
    raw(f, damage);
    assert.throws(
      () =>
        f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel", {
          groupId: result.id,
          reviewHash: result.reviewHash,
          reason: "Synthetic prohibited release",
        }),
      { code: "STATE" },
    );
    assert.throws(
      () => f.app.carriers.prepareCanadaPostGroup(f.actor, "retry", f.input),
      {
        code: damage.startsWith("UPDATE integration_carrier_bookings")
          ? "CARRIER_MISMATCH"
          : "CARRIER_GROUP_ACTIVE",
      },
    );
    assert.equal(
      f.app.database
        .owned("integration")
        .get<{ active: number }>(
          "SELECT active FROM integration_canada_post_members WHERE group_id=?",
          result.id,
        )!.active,
      1,
    );
  });

test("membership corruption fails closed and integration-owned group tables reject a foreign module writer", (t) => {
  const f = setup(t),
    result = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input);
  assert.throws(() =>
    f.app.database
      .owned("fulfillment")
      .run("DELETE FROM integration_canada_post_members"),
  );
  raw(
    f,
    "UPDATE integration_canada_post_members SET review_hash=?",
    "0".repeat(64),
  );
  assert.throws(
    () => f.app.carriers.reviewCanadaPostGroup(f.actor, result.id),
    { code: "CARRIER_MISMATCH" },
  );
  assert.throws(
    () =>
      f.app.carriers.cancelCanadaPostGroup(f.actor, "cancel", {
        groupId: result.id,
        reviewHash: result.reviewHash,
        reason: "Synthetic corrupt membership",
      }),
    { code: "CARRIER_MISMATCH" },
  );
});

function reply(child: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("Group child IPC deadline exceeded"));
    }, 20000);
    const message = (value: unknown) => {
      cleanup();
      resolve(value);
    };
    const exit = (code: number | null) => {
      cleanup();
      reject(Error(`Group child exited before reply: ${code}`));
    };
    function cleanup() {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", exit);
    }
    child.once("message", message);
    child.once("exit", exit);
  });
}

test("independent SQLite connections released through IPC reserve each native booking for exactly one group", async (t) => {
  const f = setup(t, 2),
    before = native(f);
  const children = [0, 1].map(() => {
    const child = fork(
      new URL("./canada-post-groups-child.ts", import.meta.url),
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    t.after(() => child.kill());
    return child;
  });
  const ready = await Promise.all(
    children.map((child) => {
      const answer = reply(child);
      child.send({ action: "ready", path: f.path });
      return answer;
    }),
  );
  assert.ok(ready.every((r) => r.ready));
  const outcomes = await Promise.all(
    children.map((child, index) => {
      const answer = reply(child);
      child.send({
        action: "prepare",
        actor: f.actor,
        key: `race-${index}`,
        input: f.input,
      });
      return answer;
    }),
  );
  assert.equal(
    outcomes.filter((r) => r.ok).length,
    1,
    JSON.stringify(outcomes),
  );
  const loser = outcomes.find((r) => !r.ok)!;
  assert.equal(loser.code, "CARRIER_GROUP_ACTIVE");
  const winner = outcomes.find((r) => r.ok)!.result;
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, winner.id).entries.length,
    2,
  );
  const db = new DatabaseSync(f.path);
  try {
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM integration_canada_post_groups")
        .get()!.n,
      1,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM integration_canada_post_members WHERE active=1",
        )
        .get()!.n,
      2,
    );
  } finally {
    db.close();
  }
  assert.deepEqual(native(f), before);
});

for (const override of [
  { origin: { ...origin, line1: "3 Other Street" } },
  { provider: "ups" },
  {
    destination: {
      ...origin,
      country: "US",
      province: "NY",
      postalCode: "10001",
    },
  },
] as Partial<CarrierPrepare>[])
  test(`mixed provider, origin or country cannot form a Canada Post group: ${JSON.stringify(override)}`, (t) => {
    const f = setup(t, 2, [{}, override]),
      before = native(f);
    assert.throws(
      () =>
        f.app.carriers.prepareCanadaPostGroup(
          f.actor,
          "invalid-group",
          f.input,
        ),
      { code: "CARRIER_MISMATCH" },
    );
    const db = new DatabaseSync(f.path);
    try {
      assert.equal(
        db
          .prepare("SELECT count(*) AS n FROM integration_canada_post_members")
          .get()!.n,
        0,
      );
    } finally {
      db.close();
    }
    assert.deepEqual(native(f), before);
  });
