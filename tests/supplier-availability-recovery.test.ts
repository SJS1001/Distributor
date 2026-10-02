import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { fixture } from "./fixtures.ts";
import type { SupplierJob } from "./supplier-availability-child.ts";

type Outcome = { ok: boolean; result?: unknown; code?: string; error?: string };

// Both independent applications finish initialization before either command is
// released. Completion also waits for clean child exits, not just IPC replies.
async function race(jobs: SupplierJob[]): Promise<Outcome[]> {
  const children: ChildProcess[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Outcome[]>((resolve, reject) => {
      const ready = new Set<number>(),
        closed = new Set<number>();
      const results: Outcome[] = [],
        stderr: string[] = [];
      timer = setTimeout(
        () => reject(Error("Supplier process barrier timed out.")),
        20000,
      );
      for (const [index, job] of jobs.entries()) {
        const child = fork(
          new URL("./supplier-availability-child.ts", import.meta.url),
          [],
          {
            execArgv: ["--import", "tsx"],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        );
        children.push(child);
        stderr[index] = "";
        child.stderr?.on("data", (bytes) => {
          stderr[index] += String(bytes);
        });
        child.on("error", reject);
        child.on("message", (message: Outcome & { ready?: boolean }) => {
          if (message.ready) {
            ready.add(index);
            if (ready.size === jobs.length)
              children.forEach((worker) => worker.send({ action: "go" }));
          } else if (!ready.has(index)) {
            reject(
              Error(`Supplier child initialization failed: ${message.error}`),
            );
          } else {
            results[index] = message;
          }
        });
        child.on("close", (code, signal) => {
          if (code !== 0 || !results[index]) {
            reject(
              Error(
                `Supplier child ${index} closed ${code}/${signal}: ${stderr[index]}`,
              ),
            );
            return;
          }
          closed.add(index);
          if (closed.size === jobs.length) resolve(results);
        });
        child.send({ action: "init", input: job });
      }
    });
  } finally {
    clearTimeout(timer);
    children.forEach((child) => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
  }
}

// Independent read-only oracle: constructors and business queries cannot repair
// or hide missing rows. Snapshot all native business tables plus command evidence.
function facts(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const names = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name))
      .filter(
        (name) =>
          /^(procurement|inventory|catalog|billing|orders|fulfillment|warranty)_/.test(
            name,
          ) ||
          [
            "platform_commands",
            "platform_events",
            "platform_audit",
            "platform_audit_order",
            "platform_audit_clock",
          ].includes(name),
      );
    return Object.fromEntries(
      names.map((name) => [
        name,
        db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}

for (const region of ["CA", "US"] as const) {
  for (const kind of [
    "distinct-keys",
    "exact-retries",
    "key-conflict",
  ] as const)
    test(
      `supplier availability ${region}: independent ${kind} preserve one revision, history, event and receipt`,
      { timeout: 30000 },
      async (t) => {
        const f = fixture(t, {}, region);
        const identical = kind === "exact-retries";
        const losingCode =
          kind === "key-conflict" ? "IDEMPOTENCY_CONFLICT" : "REVISION";
        const before = facts(f.path);
        const payload = {
          supplierId: f.supplier,
          revision: 0,
          active: false,
          reason: "Synthetic contested review",
        };
        const jobs: Extract<SupplierJob, { operation: "availability" }>[] = [
          0, 1,
        ].map((i) => ({
          path: f.path,
          region,
          actor: f.actor,
          key: kind === "distinct-keys" ? `change-${i}` : "same-change",
          operation: "availability",
          payload: {
            ...payload,
            reason: identical
              ? payload.reason
              : `Synthetic contested review ${i}`,
          },
        }));
        const outcomes = await race(jobs);
        assert.equal(
          outcomes.filter((outcome) => outcome.ok).length,
          identical ? 2 : 1,
          JSON.stringify(outcomes),
        );
        if (identical)
          assert.deepEqual(outcomes[0]!.result, outcomes[1]!.result);
        else
          assert.equal(
            outcomes.find((outcome) => !outcome.ok)!.code,
            losingCode,
          );
        const after = facts(f.path);
        assert.equal(after.procurement_supplier_changes!.length, 1);
        const change = after.procurement_supplier_changes![0]!;
        assert.deepEqual(
          [change.revision, change.active, change.actor_id, change.reason],
          [
            1,
            0,
            f.actor.id,
            jobs[outcomes.findIndex((outcome) => outcome.ok)]!.payload.reason,
          ],
        );
        assert.equal(
          after.platform_events!.length - before.platform_events!.length,
          1,
        );
        assert.equal(
          after.platform_commands!.length - before.platform_commands!.length,
          1,
        );
        assert.equal(
          after.platform_audit!.length - before.platform_audit!.length,
          1,
        );
        assert.equal(
          after.platform_audit_order!.length -
            before.platform_audit_order!.length,
          1,
        );
        assert.deepEqual(after.inventory_units, before.inventory_units);
        assert.deepEqual(after.procurement_orders, before.procurement_orders);
        f.app.close();
        f.app = new Application(f.path, region);
        for (const [i, job] of jobs.entries()) {
          if (outcomes[i]!.ok)
            assert.deepEqual(
              f.app.procurement.supplierAvailability(
                f.actor,
                job.key,
                job.payload,
              ),
              outcomes[i]!.result,
            );
          else
            assert.throws(
              () =>
                f.app.procurement.supplierAvailability(
                  f.actor,
                  job.key,
                  job.payload,
                ),
              { code: losingCode },
            );
        }
        assert.deepEqual(facts(f.path), after);
      },
    );

  test(
    `supplier availability ${region}: independent suspension versus purchasing preserves one serializable outcome and original receipt costs`,
    { timeout: 30000 },
    async (t) => {
      const f = fixture(t, {}, region);
      const before = facts(f.path);
      const purchase = {
        supplierId: f.supplier,
        warehouseId: f.w1,
        lines: [{ productId: f.product, quantity: 2, unitCost: 1234 }],
      };
      const suspend = {
        supplierId: f.supplier,
        revision: 0,
        active: false,
        reason: "Synthetic purchase race",
      };
      const outcomes = await race([
        {
          path: f.path,
          region,
          actor: f.actor,
          key: "race-suspend",
          operation: "availability",
          payload: suspend,
        },
        {
          path: f.path,
          region,
          actor: f.actor,
          key: "race-purchase",
          operation: "purchase",
          payload: purchase,
        },
      ]);
      assert.equal(outcomes[0]!.ok, true, JSON.stringify(outcomes));
      const accepted = outcomes[1]!.ok;
      if (!accepted) assert.equal(outcomes[1]!.code, "SUPPLIER_INACTIVE");
      const after = facts(f.path);
      assert.equal(
        after.procurement_orders!.length - before.procurement_orders!.length,
        accepted ? 1 : 0,
      );
      assert.equal(
        after.procurement_lines!.length - before.procurement_lines!.length,
        accepted ? 1 : 0,
      );
      assert.equal(
        after.platform_commands!.length - before.platform_commands!.length,
        accepted ? 2 : 1,
      );
      assert.equal(
        after.platform_audit!.length - before.platform_audit!.length,
        accepted ? 2 : 1,
      );
      assert.equal(
        after.platform_events!.length - before.platform_events!.length,
        1,
      );
      assert.equal(after.procurement_supplier_changes!.length, 1);
      assert.deepEqual(after.inventory_units, before.inventory_units);
      assert.deepEqual(after.procurement_receipts, before.procurement_receipts);
      f.app.close();
      f.app = new Application(f.path, region);
      assert.deepEqual(
        f.app.procurement.supplierAvailability(
          f.actor,
          "race-suspend",
          suspend,
        ),
        outcomes[0]!.result,
      );
      if (accepted) {
        const result = outcomes[1]!.result as { id: string };
        assert.deepEqual(
          f.app.procurement.create(f.actor, "race-purchase", purchase),
          result,
        );
        const order = f.app.procurement.order(f.actor, result.id);
        assert.deepEqual(
          order.lines.map((line) => [
            line.quantity,
            line.received,
            line.unit_cost,
          ]),
          [[2, 0, 1234]],
        );
        const receipt = f.app.procurement.receive(
          f.actor,
          "race-original-receipt",
          {
            poId: result.id,
            lineId: order.lines[0]!.id,
            quantity: 1,
            serials: ["RACE-ORIGINAL"],
            deliveryRef: "RACE-ORIGINAL-DELIVERY",
            bin: "A-2",
            quarantine: false,
          },
        );
        assert.equal(
          f.app.inventory.unit(f.actor, receipt.unitIds[0]!).cost,
          1234,
        );
        assert.equal(
          f.app.procurement.order(f.actor, result.id).lines[0]!.received,
          1,
        );
      } else {
        assert.throws(
          () => f.app.procurement.create(f.actor, "race-purchase", purchase),
          { code: "SUPPLIER_INACTIVE" },
        );
        assert.deepEqual(facts(f.path), after);
      }
      assert.throws(
        () => f.app.procurement.create(f.actor, "after-suspension", purchase),
        { code: "SUPPLIER_INACTIVE" },
      );
      assert.equal(
        f.app.procurement.supplierChoice(f.actor, f.supplier).revision,
        1,
      );
    },
  );

  test(
    `supplier availability ${region}: encrypted cutoff restore preserves nonempty paged history and exact receipts, excludes later resumption and invalidates sessions`,
    { timeout: 30000 },
    async (t) => {
      const f = fixture(t, { eventReports: region === "CA" }, region);
      const purchase = {
        supplierId: f.supplier,
        warehouseId: f.w1,
        lines: [{ productId: f.product, quantity: 2, unitCost: 4321 }],
      };
      const po = f.app.procurement.create(f.actor, "cutoff-purchase", purchase);
      const attempts = Array.from({ length: 43 }, (_, revision) => ({
        key: `cutoff-change-${revision}`,
        payload: {
          supplierId: f.supplier,
          revision,
          active: revision % 2 !== 0,
          reason: `Synthetic retained review ${revision + 1}`,
        },
      }));
      const results = attempts.map((attempt) =>
        f.app.procurement.supplierAvailability(
          f.actor,
          attempt.key,
          attempt.payload,
        ),
      );
      const login = f.app.identity.login(
        "admin@example.test",
        "long-test-only-password",
      );
      const cutoff = facts(f.path);
      const archive = join(
          dirname(f.path),
          "supplier-cutoff.distributor-backup",
        ),
        target = join(dirname(f.path), "supplier-restored.db"),
        key = randomBytes(32);
      const backup = await createBackup(f.path, archive, region, key);
      assert.equal(statSync(archive).mode & 0o777, 0o600);
      assert.equal(
        readFileSync(archive).includes(
          Buffer.from(attempts[0]!.payload.reason),
        ),
        false,
      );
      f.app.procurement.supplierAvailability(f.actor, "after-cutoff-resume", {
        supplierId: f.supplier,
        revision: 43,
        active: true,
        reason: "Excluded later resumption",
      });
      f.app.procurement.create(f.actor, "after-cutoff-purchase", purchase);
      const restored = await restoreBackup(archive, target, region, key);
      assert.equal(restored.snapshotHash, backup.snapshotHash);
      assert.equal(restored.eventReports, region === "CA");
      assert.equal(restored.invalidatedSessions, 1);
      assert.equal(restored.providerHold, true);
      assert.deepEqual(facts(target), cutoff);
      let app = new Application(target, region, { eventReports: false });
      try {
        assert.throws(() => app.identity.session(login.token), {
          code: "UNAUTHENTICATED",
        });
        assert.ok(app.platform.recoveryHold());
        const changes = [];
        let cursor: string | null = null;
        do {
          const page = app.procurement.supplierAvailabilityReview(
            f.actor,
            f.supplier,
            cursor ?? undefined,
          );
          assert.ok(page.changes.length <= 20);
          assert.deepEqual(
            [page.supplier.active, page.supplier.revision],
            [false, 43],
          );
          changes.push(...page.changes);
          cursor = page.next;
        } while (cursor);
        assert.deepEqual(
          changes.map((change) => [
            change.revision,
            change.active,
            change.reason,
          ]),
          attempts
            .toReversed()
            .map((attempt) => [
              attempt.payload.revision + 1,
              attempt.payload.active,
              attempt.payload.reason,
            ]),
        );
        for (const [index, attempt] of attempts.entries())
          assert.deepEqual(
            app.procurement.supplierAvailability(
              f.actor,
              attempt.key,
              attempt.payload,
            ),
            results[index],
          );
        assert.deepEqual(
          app.procurement.create(f.actor, "cutoff-purchase", purchase),
          po,
        );
        assert.throws(
          () => app.procurement.create(f.actor, "blocked-cutoff-new", purchase),
          { code: "SUPPLIER_INACTIVE" },
        );
        assert.deepEqual(facts(target), cutoff);
      } finally {
        app.close();
      }
      app = new Application(target, region, { eventReports: false });
      try {
        assert.equal(
          app.procurement.supplierChoice(f.actor, f.supplier).active,
          false,
        );
        assert.ok(app.platform.recoveryHold());
        assert.deepEqual(facts(target), cutoff);
        const order = app.procurement.order(f.actor, po.id);
        app.procurement.receive(f.actor, "restored-original-receipt", {
          poId: po.id,
          lineId: order.lines[0]!.id,
          quantity: 1,
          serials: ["RESTORED-ORIGINAL"],
          deliveryRef: "RESTORED-ORIGINAL-DELIVERY",
          bin: "B-2",
          quarantine: false,
        });
        const physical = app.inventory
          .stock(f.actor)
          .filter((unit) => unit.state === "stock");
        assert.equal(
          physical.reduce((sum, unit) => sum + unit.quantity, 0),
          4,
        );
        assert.equal(
          physical.reduce((sum, unit) => sum + unit.quantity * unit.cost, 0),
          18000 + 4321,
        );
        assert.equal(
          app.procurement.order(f.actor, po.id).lines[0]!.received,
          1,
        );
        assert.ok(app.platform.recoveryHold());
      } finally {
        app.close();
      }
      assert.equal(
        f.app.procurement.supplierChoice(f.actor, f.supplier).revision,
        44,
      );
      assert.equal(
        f.app.procurement.supplierChoice(f.actor, f.supplier).active,
        true,
      );
      assert.equal(
        f.app.procurement.order(f.actor, po.id).lines[0]!.received,
        0,
      );
    },
  );
}
