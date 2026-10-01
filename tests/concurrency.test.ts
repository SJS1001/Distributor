import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fixture } from "./fixtures.ts";
type Result = { ok: boolean; result?: { id: string }; code?: string };
async function contend(
  t: { after: (fn: () => void) => void },
  f: ReturnType<typeof fixture>,
  same = false,
) {
  let revision = 0;
  const quotes = [0, 1].map((i) => {
    const cart = f.app.orders.saveCart(f.actor, `cart-${i}`, {
      accountId: f.buyer,
      warehouseId: f.w1,
      revision,
      lines: [{ productId: f.product, quantity: 1 }],
    });
    revision = cart.revision;
    return f.app.orders.quote(f.actor, `quote-${i}`, {
      cartId: cart.id,
      revision: cart.revision,
    }).id;
  });
  const children: ChildProcess[] = [],
    results: Promise<Result>[] = [],
    ready: Promise<void>[] = [];
  for (let i = 0; i < 2; i++) {
    const child = fork(new URL("./reservation-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let readyResolve: () => void,
      resultResolve: (r: Result) => void,
      reject: (e: Error) => void;
    ready.push(new Promise<void>((r) => (readyResolve = r)));
    results.push(
      new Promise<Result>((r, j) => {
        resultResolve = r;
        reject = j;
      }),
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("message", (message: any) =>
      message.ready ? readyResolve() : resultResolve(message),
    );
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code !== 0)
        reject(new Error(`Reservation process exited ${code}: ${stderr}`));
    });
    child.send({
      action: "init",
      input: {
        path: f.path,
        actor: f.actor,
        quoteId: same ? quotes[0] : quotes[i],
        key: same ? "shared-attempt" : `attempt-${i}`,
      },
    });
  }
  t.after(() => children.forEach((child) => child.kill()));
  await Promise.all(ready);
  children.forEach((child) => child.send({ action: "go" }));
  return Promise.all(results);
}
test(
  "separate processes contend for the final usable serial: exactly one order and one exposure commit",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    for (const serial of ["S2", "S3"]) {
      const unit = f.app.inventory.trace(f.actor, serial).unit;
      f.app.inventory.inspect(f.actor, `quarantine-${serial}`, {
        unitId: unit.id,
        revision: unit.revision,
        condition: "quarantine",
        reason: "Synthetic final-stock fixture",
      });
    }
    const results = await contend(t, f);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "STOCK");
    assert.equal(f.app.orders.list(f.actor).length, 1);
    assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 0);
    assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
  },
);
test(
  "separate processes cannot exceed a shared customer credit limit",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    f.app.database
      .owned("iam")
      .run("UPDATE iam_accounts SET credit_limit=? WHERE id=?", 11300, f.buyer);
    const results = await contend(t, f);
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.find((r) => !r.ok)?.code, "CREDIT_LIMIT");
    assert.equal(f.app.billing.exposure(f.actor, f.buyer).total, 11300);
    assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  },
);
test(
  "same command raced from separate processes returns a single durable business receipt",
  { timeout: 10000 },
  async (t) => {
    const f = fixture(t),
      results = await contend(t, f, true);
    assert.ok(results.every((r) => r.ok));
    assert.equal(results[0]?.result?.id, results[1]?.result?.id);
    assert.equal(f.app.orders.list(f.actor).length, 1);
    assert.equal(f.app.inventory.availability(f.actor, f.product, f.w1), 2);
  },
);
