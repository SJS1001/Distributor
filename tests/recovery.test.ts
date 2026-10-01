import { test } from "node:test";
import assert from "node:assert/strict";
import {
  randomBytes,
  createDecipheriv,
  createCipheriv,
  createHash,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { type Adapter } from "../src/server/integration.ts";
import { ProviderRuntime } from "../src/server/provider-runtime.ts";
import { createHttp } from "../src/server/http.ts";
import { chooseProviders, fixture, accept, ship } from "./fixtures.ts";

function paths(f: ReturnType<typeof fixture>) {
  return {
    archive: join(dirname(f.path), "cutoff.distributor-backup"),
    recovered: join(dirname(f.path), "recovered.db"),
    key: randomBytes(32),
  };
}
function noStaging(f: ReturnType<typeof fixture>) {
  assert.equal(
    readdirSync(dirname(f.path)).filter((n) => n.startsWith(".recovery-"))
      .length,
    0,
  );
}
function cli(args: string[], key: Buffer) {
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/server/recovery-cli.ts", ...args],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err += b));
      child.on("close", (code) => resolve({ code, out, err }));
      child.stdin.end(key.toString("hex") + "\n");
    },
  );
}

test("live WAL snapshot restores independent stock/cost/money and durable command identities without later writes or copied sessions", async (t) => {
  const f = fixture(t),
    p = paths(f);
  const shipped = ship(f, accept(f).id);
  f.app.billing.manualPayment(f.actor, "cash", {
    invoiceId: shipped.invoiceId,
    amount: 4000,
    reference: "BANK-CUTOFF",
    reason: "Synthetic cutoff bank evidence",
  });
  const login = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  assert.ok(existsSync(f.path + "-wal"));
  assert.ok(statSync(f.path + "-wal").size > 0);
  const receipt = await createBackup(f.path, p.archive, "CA", p.key);
  assert.equal(statSync(p.archive).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(p.archive).includes(Buffer.from("Synthetic Distributor")),
    false,
  );
  f.app.billing.manualPayment(f.actor, "later-cash", {
    invoiceId: shipped.invoiceId,
    amount: 2000,
    reference: "BANK-AFTER",
    reason: "After cutoff",
  });
  ship(f, accept(f, 1, "later-order").id);
  const result = await restoreBackup(p.archive, p.recovered, "CA", p.key);
  assert.equal(result.snapshotHash, receipt.snapshotHash);
  assert.equal(result.invalidatedSessions, 1);
  assert.equal(statSync(p.recovered).mode & 0o777, 0o600);
  let restored = new Application(p.recovered);
  try {
    const stock = restored.inventory.stock(f.actor);
    const physical = stock.filter((u) => u.state === "stock");
    assert.equal(
      physical.reduce((n, u) => n + u.quantity, 0),
      2,
    );
    assert.equal(
      physical.reduce((n, u) => n + u.quantity * u.cost, 0),
      12000,
    );
    assert.equal(restored.inventory.trace(f.actor, "S1").unit.state, "sold");
    assert.deepEqual(restored.billing.totals(f.actor, shipped.invoiceId), {
      credited: 0,
      paid: 4000,
      refunded: 0,
      balance: 7300,
    });
    assert.equal(
      restored.billing.invoice(f.actor, shipped.invoiceId).total,
      11300,
    );
    assert.equal(restored.orders.list(f.actor).length, 1);
    assert.throws(() => restored.identity.session(login.token), {
      code: "UNAUTHENTICATED",
    });
    restored.billing.manualPayment(f.actor, "cash", {
      invoiceId: shipped.invoiceId,
      amount: 4000,
      reference: "BANK-CUTOFF",
      reason: "Synthetic cutoff bank evidence",
    });
    assert.equal(
      restored.billing.totals(f.actor, shipped.invoiceId).paid,
      4000,
    );
    assert.ok(restored.dashboard(f.actor).recoveryHold);
  } finally {
    restored.close();
  }
  restored = new Application(p.recovered);
  try {
    assert.ok(restored.platform.recoveryHold());
  } finally {
    restored.close();
  }
  assert.equal(f.app.orders.list(f.actor).length, 2);
  assert.equal(f.app.billing.totals(f.actor, shipped.invoiceId).paid, 6000);
  assert.equal(f.app.identity.session(login.token).actor.id, f.actor.id);
  noStaging(f);
});

test("restored pending/completed effects and callbacks stay unchanged while every provider IO entry point and checkout link is held", async (t) => {
  const f = fixture(t),
    p = paths(f),
    shipped = ship(f, accept(f).id);
  chooseProviders(f, f.actor, "consent", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe", "quickbooks"],
    version: 1,
    acknowledgment: "Synthetic named processor choice",
  });
  const checkout = f.app.integration.checkout(f.actor, "checkout", {
    invoiceId: shipped.invoiceId,
  });
  let calls = 0;
  const adapter: Adapter = {
    execute: async () => {
      calls++;
      return {
        reference: "cs_test_cutoff",
        result: { checkoutUrl: "https://checkout.stripe.com/test-cutoff" },
      };
    },
    lookup: async () => {
      calls++;
      return null;
    },
  };
  await f.app.integration.execute(f.actor, checkout.id, adapter);
  const pending = f.app.integration.accounting(f.actor, "accounting", {
    invoiceId: shipped.invoiceId,
    customerRef: "c",
    itemRefs: { [f.product]: "i" },
    taxCodeRef: "t",
    taxRateRef: "r",
  });
  const callback = f.app.integration.receiveCallback(f.actor, {
    bindingId: "synthetic",
    eventId: "evt_cutoff",
    sessionId: "cs_test_cutoff",
    effectId: checkout.id,
    hash: "test-only-hash",
  });
  await createBackup(f.path, p.archive, "CA", p.key);
  // Provider succeeds after the cutoff. Restoring its pending snapshot must not send again.
  await f.app.integration.execute(f.actor, pending.id, adapter);
  const countAtRestore = calls;
  await restoreBackup(p.archive, p.recovered, "CA", p.key);
  const app = new Application(p.recovered);
  try {
    assert.equal(app.integration.effect(f.actor, pending.id).state, "pending");
    assert.equal(
      app.integration.effect(f.actor, checkout.id).state,
      "completed",
    );
    assert.equal(app.integration.callbacks(f.actor)[0]?.state, "pending");
    assert.equal(
      app.integration.list(f.actor).find((e) => e.id === checkout.id)?.result,
      null,
    );
    await assert.rejects(
      app.integration.execute(f.actor, pending.id, adapter),
      { code: "RECOVERY_HOLD" },
    );
    await assert.rejects(
      app.integration.reconcile(f.actor, pending.id, adapter),
      { code: "RECOVERY_HOLD" },
    );
    await assert.rejects(
      app.integration.stripeSettlement(
        f.actor,
        { id: "evt_cutoff", sessionId: "cs_test_cutoff" },
        async () => {
          calls++;
          return {
            paid: true,
            amount: 11300,
            currency: "cad",
            paymentId: "pi_cutoff",
          };
        },
      ),
      { code: "RECOVERY_HOLD" },
    );
    assert.throws(() => app.integration.claimCallback(f.actor, callback.id), {
      code: "RECOVERY_HOLD",
    });
    assert.throws(
      () =>
        app.integration.checkout(f.actor, "new-intent", {
          invoiceId: shipped.invoiceId,
        }),
      { code: "RECOVERY_HOLD" },
    );
    const runtime = new ProviderRuntime(app, [
      {
        id: "synthetic",
        orgId: f.actor.orgId,
        workerUserId: f.actor.id,
        quickbooks: adapter,
      },
    ]);
    await assert.rejects(runtime.tick(), { code: "RECOVERY_HOLD" });
    assert.equal(calls, countAtRestore);
    assert.equal(app.billing.totals(f.actor, shipped.invoiceId).paid, 0);
  } finally {
    app.close();
  }
  noStaging(f);
});

test("wrong key, header/cipher/tag tamper and truncation publish no database and clean plaintext staging", async (t) => {
  const f = fixture(t),
    p = paths(f);
  await createBackup(f.path, p.archive, "CA", p.key);
  await assert.rejects(
    restoreBackup(p.archive, p.recovered, "CA", randomBytes(32)),
  );
  const original = readFileSync(p.archive);
  const length = original.readUInt32BE(8);
  for (const position of [
    12 + length - 5,
    12 + length + 400,
    original.length - 1,
  ]) {
    const damaged = Buffer.from(original);
    damaged[position] = damaged[position]! ^ 1;
    writeFileSync(p.archive, damaged);
    await assert.rejects(restoreBackup(p.archive, p.recovered, "CA", p.key));
    assert.equal(existsSync(p.recovered), false);
    noStaging(f);
  }
  writeFileSync(p.archive, original.subarray(0, original.length - 10));
  await assert.rejects(restoreBackup(p.archive, p.recovered, "CA", p.key), {
    code: "RECOVERY_FORMAT",
  });
  noStaging(f);
});

test("cross-region, unsupported schema, corrupt authenticated SQLite and existing destinations/sidecars fail closed", async (t) => {
  const f = fixture(t),
    p = paths(f);
  await createBackup(f.path, p.archive, "CA", p.key);
  await assert.rejects(restoreBackup(p.archive, p.recovered, "US", p.key), {
    code: "RECOVERY_REGION",
  });
  writeFileSync(p.recovered, "existing database");
  await assert.rejects(restoreBackup(p.archive, p.recovered, "CA", p.key), {
    code: "RECOVERY_EXISTS",
  });
  assert.equal(readFileSync(p.recovered, "utf8"), "existing database");
  const sidecarTarget = join(dirname(f.path), "sidecar.db");
  writeFileSync(sidecarTarget + "-wal", "preserve me");
  await assert.rejects(restoreBackup(p.archive, sidecarTarget, "CA", p.key), {
    code: "RECOVERY_EXISTS",
  });
  await assert.rejects(createBackup(f.path, p.archive, "CA", p.key), {
    code: "RECOVERY_EXISTS",
  });
  const db = new DatabaseSync(f.path);
  try {
    db.exec("CREATE TABLE future_upgrade(value TEXT)");
  } finally {
    db.close();
  }
  await assert.rejects(
    createBackup(
      f.path,
      join(dirname(f.path), "future.distributor-backup"),
      "CA",
      p.key,
    ),
    { code: "RECOVERY_SCHEMA" },
  );
  // Possession of a valid archive key is not sufficient to bypass snapshot integrity/schema validation.
  const raw = readFileSync(p.archive),
    length = raw.readUInt32BE(8),
    end = 12 + length;
  const manifest = JSON.parse(raw.subarray(12, end).toString());
  const decipher = createDecipheriv(
    "aes-256-gcm",
    p.key,
    Buffer.from(manifest.iv, "hex"),
  );
  decipher.setAAD(raw.subarray(0, end));
  decipher.setAuthTag(raw.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(raw.subarray(end, -16)),
    decipher.final(),
  ]);
  plain.fill(0, 0, 100);
  manifest.snapshotHash = createHash("sha256").update(plain).digest("hex");
  const header = Buffer.from(JSON.stringify(manifest)),
    n = Buffer.alloc(4);
  n.writeUInt32BE(header.length);
  const prefix = Buffer.concat([raw.subarray(0, 8), n, header]);
  const cipher = createCipheriv(
    "aes-256-gcm",
    p.key,
    Buffer.from(manifest.iv, "hex"),
  );
  cipher.setAAD(prefix);
  const bad = join(dirname(f.path), "corrupt.distributor-backup");
  writeFileSync(
    bad,
    Buffer.concat([
      prefix,
      cipher.update(plain),
      cipher.final(),
      cipher.getAuthTag(),
    ]),
  );
  await assert.rejects(
    restoreBackup(bad, join(dirname(f.path), "corrupt.db"), "CA", p.key),
  );
  assert.equal(existsSync(join(dirname(f.path), "corrupt.db")), false);
  noStaging(f);
});

test("real operator CLI reads key through stdin, validates symlinks and concurrent restores publish exactly one isolated destination", async (t) => {
  const f = fixture(t),
    p = paths(f);
  const backed = await cli(["backup", f.path, p.archive, "CA"], p.key);
  assert.equal(backed.code, 0, backed.err);
  const results = await Promise.all([
    cli(["restore", p.archive, p.recovered, "CA"], p.key),
    cli(["restore", p.archive, p.recovered, "CA"], p.key),
  ]);
  assert.equal(
    results.filter((r) => r.code === 0).length,
    1,
    JSON.stringify(results),
  );
  for (const result of [backed, ...results]) {
    assert.equal(
      (result.out + result.err).includes(p.key.toString("hex")),
      false,
    );
    assert.equal(
      (result.out + result.err).includes("long-test-only-password"),
      false,
    );
  }
  const recovered = new Application(p.recovered);
  try {
    assert.ok(recovered.platform.recoveryHold());
    assert.equal(recovered.inventory.availability(f.actor, f.product, f.w1), 3);
  } finally {
    recovered.close();
  }
  const symlink = join(dirname(f.path), "linked.distributor-backup");
  symlinkSync(p.archive, symlink);
  await assert.rejects(
    restoreBackup(symlink, join(dirname(f.path), "link.db"), "CA", p.key),
    { code: "RECOVERY_PATH" },
  );
  noStaging(f);
});

test("recovered HTTP sessions require fresh login and authenticated dashboard discloses hold while provider command remains blocked", async (t) => {
  const f = fixture(t),
    p = paths(f),
    shipped = ship(f, accept(f).id),
    origin = "http://127.0.0.1:3000";
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region: "CA",
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic named exception",
  });
  const old = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  await createBackup(f.path, p.archive, "CA", p.key);
  await restoreBackup(p.archive, p.recovered, "CA", p.key);
  const app = new Application(p.recovered),
    http = await createHttp(app, {
      origin,
      staticRoot: "/nonexistent-distributor-test",
    });
  try {
    await http.ready();
    // Cookie name comes from an actual new login response; only its value is replaced with the copied token.
    const login = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: {
        email: "admin@example.test",
        password: "long-test-only-password",
      },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.cookies[0]!;
    assert.equal(
      (
        await http.inject({
          method: "GET",
          url: "/api/dashboard",
          headers: { cookie: `${cookie.name}=${old.token}` },
        })
      ).statusCode,
      401,
    );
    const headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "restored-checkout",
    };
    const dashboard = await http.inject({
      method: "GET",
      url: "/api/dashboard",
      headers,
    });
    assert.equal(dashboard.statusCode, 200);
    assert.ok(dashboard.json().recoveryHold);
    const response = await http.inject({
      method: "POST",
      url: "/api/commands/stripe.checkout",
      headers,
      payload: { invoiceId: shipped.invoiceId },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "RECOVERY_HOLD");
    assert.equal(app.integration.list(f.actor).length, 0);
  } finally {
    await http.close();
    app.close();
  }
  noStaging(f);
});

test("backup refuses altered schema version receipts despite unchanged DDL and preserves source evidence", async (t) => {
  for (const alteration of [
    "version=999",
    "schema_hash='" + "0".repeat(64) + "'",
    "event_reports=0",
    "region='US'",
    "initialized_at='invalid'",
    "initialized_at='2026-02-30T12:00:00.000Z'",
    "initialized_at='2025-02-29T12:00:00.000Z'",
  ]) {
    const f = fixture(t),
      p = paths(f);
    f.app.database
      .owned("platform")
      .run(
        "UPDATE platform_schema_version SET " +
          alteration +
          " WHERE singleton=1",
      );
    const before = f.app.database
      .owned("platform")
      .all("SELECT * FROM platform_schema_version");
    await assert.rejects(createBackup(f.path, p.archive, "CA", p.key), {
      code: "RECOVERY_SCHEMA",
    });
    assert.equal(existsSync(p.archive), false);
    assert.deepEqual(
      f.app.database
        .owned("platform")
        .all("SELECT * FROM platform_schema_version"),
      before,
    );
    noStaging(f);
  }
});
