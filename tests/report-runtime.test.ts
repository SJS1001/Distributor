import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { configuredEventReports } from "../src/server/report-runtime.ts";
import { Application } from "../src/server/application.ts";
import { inspectSchema } from "../src/server/schema-upgrade.ts";
import { fixture } from "./fixtures.ts";

function environment(path: string, extra: NodeJS.ProcessEnv = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    DATABASE_PATH: path,
    DATA_REGION: "CA",
    PROVIDERS_ENABLED: "false",
    EVENT_REPORTS: "disabled",
    ...extra,
  };
}
function launch(
  script: string,
  path: string,
  args: string[] = [],
  extra: NodeJS.ProcessEnv = {},
) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", `src/server/${script}.ts`, ...args],
    {
      env: environment(path, extra),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let out = "",
    err = "";
  child.stdout.on("data", (b) => {
    out += b;
  });
  child.stderr.on("data", (b) => {
    err += b;
  });
  const done = new Promise<{
    code: number | null;
    signal: string | null;
    out: string;
    err: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, out, err }));
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000).unref();
  void done.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
  return { child, done, output: () => ({ out, err }) };
}
function directory(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "distributor-report-runtime-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function stored(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      schema: inspectSchema(path),
      outbox: db.prepare("SELECT * FROM platform_events ORDER BY id").all(),
      receipts: db
        .prepare("SELECT * FROM platform_delivery_receipts ORDER BY event_id")
        .all(),
      deliveries: db
        .prepare("SELECT * FROM platform_deliveries ORDER BY event_id")
        .all(),
      reports: db
        .prepare("SELECT name FROM sqlite_schema WHERE name='report_events'")
        .get()
        ? db.prepare("SELECT * FROM report_events ORDER BY event_id").all()
        : null,
    };
  } finally {
    db.close();
  }
}
async function serve(
  t: { after(fn: () => void): void },
  path: string,
  region = "CA",
) {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const process = launch("main", path, [], {
    DATA_REGION: region,
    HOST: "127.0.0.1",
    PORT: String(port),
    PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    SECURE_COOKIES: "false",
  });
  t.after(() => {
    process.child.kill("SIGKILL");
  });
  const deadline = Date.now() + 10000;
  while (!process.output().out.includes("Distributor listening")) {
    assert.equal(process.child.exitCode, null, process.output().err);
    assert.equal(process.child.signalCode, null, process.output().err);
    assert.ok(Date.now() < deadline, "HTTP startup deadline");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).region, region);
  process.child.kill("SIGTERM");
  const result = await process.done;
  assert.equal(result.code, 0, result.err);
  assert.equal(result.signal, null);
}

test("runtime reporting configuration keeps compatibility and rejects ambiguous values without echoing input", () => {
  assert.equal(configuredEventReports({}), true);
  assert.equal(configuredEventReports({ EVENT_REPORTS: "enabled" }), true);
  assert.equal(configuredEventReports({ EVENT_REPORTS: "disabled" }), false);
  for (const value of [
    "",
    "true",
    "false",
    "Enabled",
    " enabled",
    "disabled\n",
    "secret-config-value",
  ])
    assert.throws(
      () => configuredEventReports({ EVENT_REPORTS: value }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal((error as Error & { code: string }).code, "CONFIG");
        if (value === "secret-config-value")
          assert.ok(!error.message.includes(value));
        return true;
      },
    );
});

test("every runtime rejects invalid report settings before creating a database", async (t) => {
  const dir = directory(t);
  for (const [script, args] of [
    ["main", []],
    ["cli", ["bootstrap"]],
    ["worker", []],
    ["event-worker", []],
    ["provider-credentials-cli", ["key-status"]],
    ["quickbooks-authorization-cli", ["status"]],
  ] as const) {
    const path = join(dir, script + ".db");
    const p = launch(script, path, [...args], {
      EVENT_REPORTS: "secret-config-value",
      LOCAL_EVENT_REPORTS: "enabled",
      PROVIDER_BINDING_ID: "synthetic-binding",
      PROVIDER_ORG_ID: "synthetic-org",
      PROVIDER_WORKER_USER_ID: "synthetic-worker",
      QUICKBOOKS_REALM_ID: "synthetic-realm",
      QUICKBOOKS_CLIENT_ID: "synthetic-client",
      PROVIDER_ACCOUNT_ID: "synthetic-account",
      QUICKBOOKS_REDIRECT_URI: "http://127.0.0.1/callback",
    });
    p.child.stdin.end("{}");
    const result = await p.done;
    assert.equal(result.code, 1, script);
    assert.match(result.err, /CONFIG/, script);
    assert.ok(!result.err.includes("secret-config-value"), script);
    assert.equal(result.out, "", script);
    assert.equal(existsSync(path), false, script);
  }
});

for (const region of ["CA", "US"] as const) {
  test(`${region} bootstrap and HTTP startup preserve an explicitly disabled stored report profile`, async (t) => {
    const path = join(directory(t), "app.db");
    const p = launch("cli", path, ["bootstrap"], {
      DATA_REGION: region,
      BOOTSTRAP_PASSWORD: "long-test-only-password",
      BOOTSTRAP_EMAIL: "admin@example.test",
      ORGANIZATION_NAME: "Synthetic runtime",
    });
    p.child.stdin.end();
    const result = await p.done;
    assert.equal(result.code, 0, result.err);
    assert.equal(inspectSchema(path).eventReports, false);
    const before = stored(path);
    await serve(t, path, region);
    assert.deepEqual(stored(path), before);
    await serve(t, path, region);
    assert.deepEqual(stored(path), before);
    const app = new Application(path, region, { eventReports: false });
    try {
      const actor = app.identity.login(
        "admin@example.test",
        "long-test-only-password",
      ).actor;
      assert.equal(
        app.identity.organization(actor).currency,
        region === "CA" ? "CAD" : "USD",
      );
      assert.equal(app.platform.project(true), 0);
    } finally {
      app.close();
    }
  });
}

for (const eventReports of [false, true]) {
  test(`disabled server and operator commands preserve stored reports=${eventReports} and pending deliveries; worker enablement cannot override removal`, async (t) => {
    const f = fixture(t, { eventReports });
    f.app.platform.project(true);
    f.app.platform.event(f.actor, "SyntheticFact", "runtime-pending", {
      synthetic: true,
    });
    const before = stored(f.path);
    if (eventReports) assert.ok(before.reports!.length > 0);
    else assert.equal(before.reports, null);
    assert.ok(before.outbox.length > before.receipts.length);
    await serve(t, f.path);
    assert.deepEqual(stored(f.path), before);
    for (const [script, args, input] of [
      ["worker", [], ""],
      ["event-worker", [], ""],
      ["provider-credentials-cli", ["key-status"], ""],
      [
        "quickbooks-authorization-cli",
        ["status"],
        JSON.stringify({ attemptId: "synthetic-absent" }),
      ],
    ] as const) {
      const p = launch(script, f.path, [...args], {
        LOCAL_EVENT_REPORTS: "enabled",
        PROVIDER_BINDING_ID: "synthetic-binding",
        PROVIDER_ORG_ID: f.actor.orgId,
        PROVIDER_WORKER_USER_ID: f.actor.id,
        QUICKBOOKS_REALM_ID: "synthetic-realm",
        QUICKBOOKS_CLIENT_ID: "synthetic-client",
        PROVIDER_ACCOUNT_ID: f.buyer,
        QUICKBOOKS_REDIRECT_URI: "http://127.0.0.1/callback",
      });
      p.child.stdin.end(input);
      const result = await p.done;
      assert.equal(result.signal, null, result.err);
      if (script === "provider-credentials-cli") {
        assert.equal(result.code, 0, result.err);
        assert.equal(JSON.parse(result.out).configured, false);
      } else {
        assert.equal(result.code, 1, script + result.err);
        assert.ok(result.err.length > 0);
      }
      if (script === "worker") assert.match(result.err, /PROVIDER_DISABLED/);
      if (script === "event-worker")
        assert.match(result.err, /EVENTS_DISABLED/);
      assert.deepEqual(stored(f.path), before, script);
    }
  });
}

test("encrypted report-disabled recovery restarts through the normal server without installation or hold release", async (t) => {
  const f = fixture(t, { eventReports: false });
  const dir = directory(t),
    archive = join(dir, "cutoff.distributor-backup"),
    target = join(dir, "restored.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const before = stored(target);
  assert.equal(before.schema.eventReports, false);
  await serve(t, target);
  assert.deepEqual(stored(target), before);
  const restored = new Application(target, "CA", { eventReports: false });
  try {
    assert.ok(restored.platform.recoveryHold());
    assert.throws(() => restored.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
  } finally {
    restored.close();
  }
});

test("explicit enabled startup installs the optional profile once and the foreground batch still needs its separate permission", async (t) => {
  const f = fixture(t, { eventReports: false });
  assert.equal(inspectSchema(f.path).eventReports, false);
  const denied = launch("event-worker", f.path, [], {
    EVENT_REPORTS: "enabled",
  });
  denied.child.stdin.end();
  assert.match((await denied.done).err, /EVENTS_DISABLED/);
  assert.equal(inspectSchema(f.path).eventReports, false);
  const enabled = launch("event-worker", f.path, [], {
    EVENT_REPORTS: "enabled",
    LOCAL_EVENT_REPORTS: "enabled",
  });
  enabled.child.stdin.end();
  const result = await enabled.done;
  assert.equal(result.code, 0, result.err);
  assert.ok(JSON.parse(result.out).completed > 0);
  assert.equal(inspectSchema(f.path).eventReports, true);
  const before = stored(f.path);
  await serve(t, f.path);
  assert.deepEqual(stored(f.path), before);
});
