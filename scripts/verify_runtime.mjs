import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// A foreground workstation check, never a scheduler or provider/device sender.
// Retain the private synthetic install and hashed logs on success AND failure.
assert.equal(process.argv.length, 2, "This check accepts no arguments.");
assert.ok(
  ["darwin", "linux"].includes(process.platform),
  "POSIX process groups required; Windows remains unqualified.",
);
const [major, minor] = process.versions.node.split(".").map(Number);
assert.ok(
  major === 24 && minor >= 16,
  "Use the project's supported Node 24 runtime.",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  work = await mkdtemp(join(tmpdir(), "distributor-runtime-")),
  runtime = join(work, "application"),
  browserBuild = join(work, "browser-build"),
  nodeBin = dirname(process.execPath),
  npm = join(nodeBin, "npm"),
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  emptyConfig = join(work, "empty-user-npmrc"),
  emptyGlobalConfig = join(work, "empty-global-npmrc"),
  receipt = {
    startedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    work,
    status: "RUNNING",
    inputs: {},
    commands: [],
    regions: [],
  };
await writeFile(emptyConfig, "", { mode: 0o600 });
await writeFile(emptyGlobalConfig, "", { mode: 0o600 });
// Do not inherit credentials, database paths, enabled providers, NODE_OPTIONS,
// registry configuration or npm-run's original workspace node_modules PATH.
const env = {
  PATH: `${nodeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
  ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
  NODE_ENV: "production",
  NPM_CONFIG_USERCONFIG: emptyConfig,
  NPM_CONFIG_GLOBALCONFIG: emptyGlobalConfig,
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  PROVIDERS_ENABLED: "false",
  CARRIERS_ENABLED: "false",
  QUICKBOOKS_BROWSER_AUTH_ENABLED: "false",
  QUICKBOOKS_LEDGER_BROWSER_AUTH_ENABLED: "false",
  EVENT_REPORTS: "enabled",
  LOCAL_EVENT_REPORTS: "disabled",
  HOST: "127.0.0.1",
  SECURE_COOKIES: "false",
};
let sequence = 0;
const children = new Set();
function launch(args, cwd, extraEnv = {}, input = "") {
  const child = spawn(npm, args, {
    cwd,
    env: { ...env, ...extraEnv },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  const parts = [],
    startedAt = new Date().toISOString(),
    log = join(work, `${String(++sequence).padStart(2, "0")}-${args[0]}.log`);
  // Commands use only generated fixtures; never persist stdin/passwords/keys.
  child.stdout.on("data", (data) => parts.push(data));
  child.stderr.on("data", (data) => parts.push(data));
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const done = new Promise((resolveDone, reject) => {
    child.once("error", reject);
    child.once("close", async (exitCode, signal) => {
      children.delete(child);
      try {
        const bytes = Buffer.concat(parts);
        await writeFile(log, bytes, { mode: 0o600 });
        const command = {
          argv: [npm, ...args],
          cwd,
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
          signal,
          log,
          logSha256: hash(bytes),
        };
        receipt.commands.push(command);
        resolveDone({ ...command, output: bytes.toString("utf8") });
      } catch (error) {
        reject(error);
      }
    });
  });
  // Attach immediately so a spawn failure during readiness cannot go unhandled.
  void done.catch(() => {});
  return { child, done };
}
function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function stop(job) {
  signalGroup(job.child, "SIGTERM");
  let forced = false;
  const timeout = setTimeout(() => {
    forced = true;
    signalGroup(job.child, "SIGKILL");
  }, 8000);
  try {
    await job.done;
  } finally {
    clearTimeout(timeout);
  }
  assert.equal(forced, false, "Runtime required forced termination.");
  // npm may finish before a descendant. A closed parent alone is insufficient.
  for (let n = 0; n < 80; n++) {
    try {
      process.kill(-job.child.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await delay(100);
  }
  signalGroup(job.child, "SIGKILL");
  assert.fail("Runtime left a descendant process after shutdown.");
}
async function command(
  args,
  cwd = runtime,
  extraEnv = {},
  input = "",
  expected = 0,
) {
  const job = launch(args, cwd, extraEnv, input);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup(job.child, "SIGKILL");
  }, 120000);
  try {
    const result = await job.done;
    assert.equal(timedOut, false, "Command timed out; inspect private logs.");
    assert.equal(
      result.exitCode,
      expected,
      `Unexpected command exit; inspect ${result.log}`,
    );
    return result.output;
  } finally {
    clearTimeout(timer);
  }
}
async function capture(path, prefix = path, sourceRoot = root) {
  for (const item of await readdir(join(sourceRoot, path), {
    withFileTypes: true,
  })) {
    if (item.name === ".DS_Store") continue;
    const rel = join(path, item.name),
      target = join(prefix, item.name);
    assert.equal(
      item.isSymbolicLink(),
      false,
      "Package inputs must not be symlinks.",
    );
    if (item.isDirectory()) await capture(rel, target, sourceRoot);
    else receipt.inputs[target] = hash(await readFile(join(sourceRoot, rel)));
  }
}
async function port() {
  const server = createServer();
  await new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePort);
  });
  const value = server.address().port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return value;
}
async function regionCheck(region) {
  const directory = join(work, region);
  await mkdir(directory, { mode: 0o700 });
  const database = join(directory, "synthetic.db"),
    password = randomBytes(24).toString("base64url"),
    email = "runtime@example.test",
    config = { DATABASE_PATH: database, DATA_REGION: region },
    summary = { region, startupCycles: 0, profiles: [] };
  assert.match(
    await command(
      ["run", "bootstrap"],
      runtime,
      {
        ...config,
        BOOTSTRAP_EMAIL: email,
        ORGANIZATION_NAME: "Synthetic runtime qualification",
      },
      `${password}\n`,
    ),
    /Organization created/,
  );
  assert.match(
    await command(
      ["run", "schema", "--", "inspect", database],
      runtime,
      config,
    ),
    /"kind":"current"/,
  );
  assert.match(
    await command(["run", "worker"], runtime, config, "", 1),
    /PROVIDER_DISABLED/,
  );
  assert.match(
    await command(["run", "events:worker"], runtime, config, "", 1),
    /EVENTS_DISABLED/,
  );
  const localEvents = await command(["run", "events:worker"], runtime, {
    ...config,
    LOCAL_EVENT_REPORTS: "enabled",
  });
  assert.deepEqual(JSON.parse(localEvents.trim().split("\n").at(-1)), {
    claimed: 0,
    completed: 0,
    retry: 0,
    quarantined: 0,
    abandoned: 0,
  });
  assert.match(
    await command(["run", "provider:credentials"], runtime, config, "", 1),
    /CLI:/,
  );
  assert.match(
    await command(["run", "provider:authorize"], runtime, config, "", 1),
    /OAUTH_INPUT:/,
  );
  assert.match(
    await command(["run", "provider:ledger-authorize"], runtime, config, "", 1),
    /OAUTH_INPUT:/,
  );
  assert.match(
    await command(
      ["run", "provider:ledger-authorize", "--", "complete"],
      runtime,
      config,
      "",
      1,
    ),
    /PROVIDER_DISABLED:/,
  );
  assert.match(
    await command(["run", "provider:ledger-revoke"], runtime, config, "", 1),
    /REVOCATION_INPUT:/,
  );
  assert.match(
    await command(
      ["run", "provider:ledger-revoke", "--", "revoke"],
      runtime,
      config,
      "",
      1,
    ),
    /PROVIDER_DISABLED:/,
  );
  assert.match(
    await command(["run", "provider:ledger-journal"], runtime, config, "", 1),
    /JOURNAL_INPUT:/,
  );
  for (const action of ["write", "lookup"])
    assert.match(
      await command(
        ["run", "provider:ledger-journal", "--", action],
        runtime,
        config,
        "",
        1,
      ),
      /PROVIDER_DISABLED:/,
    );
  let original, unit, prepared;
  for (let cycle = 0; cycle < 2; cycle++) {
    const selectedPort = await port(),
      origin = `http://127.0.0.1:${selectedPort}`,
      job = launch(["start"], runtime, {
        ...config,
        PORT: String(selectedPort),
        PUBLIC_ORIGIN: origin,
      });
    try {
      const request = (path, options = {}) =>
        fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (job.child.exitCode !== null || job.child.signalCode !== null) break;
        try {
          const response = await request("/api/health");
          if (response.ok) {
            assert.deepEqual(await response.json(), { status: "ok", region });
            ready = true;
            break;
          }
        } catch {
          /* bounded local readiness; terminal exit is checked above */
        }
        await delay(100);
      }
      assert.equal(
        ready,
        true,
        "Production-only npm start did not become ready.",
      );
      summary.startupCycles++;
      const index = await request("/");
      assert.equal(index.status, 200);
      const html = await index.text(),
        asset = html.match(/src="(\/assets\/[^\"]+\.js)"/);
      assert.ok(asset, "Built browser application was not served.");
      const js = await request(asset[1]);
      assert.equal(js.status, 200);
      assert.equal(
        hash(Buffer.from(await js.arrayBuffer())),
        receipt.inputs[join("dist", asset[1].slice(1))],
        "Served asset differs from the built package.",
      );
      assert.equal((await request("/api/dashboard")).status, 401);
      const login = await request("/api/login", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(login.status, 200);
      const session = await login.json(),
        cookie = login.headers.get("set-cookie").split(";")[0],
        headers = {
          origin,
          cookie,
          "x-csrf-token": session.csrf,
          "content-type": "application/json",
        },
        read = async (path) => {
          const response = await request(path, { headers });
          assert.equal(response.status, 200);
          return response.json();
        },
        task = async (name, body, key = name) => {
          const response = await request(`/api/commands/${name}`, {
            method: "POST",
            headers: { ...headers, "idempotency-key": key },
            body: JSON.stringify(body),
          });
          assert.equal(response.status, 200, `Runtime task ${name} failed.`);
          return response.json();
        };
      if (cycle === 0) {
        const warehouseId = (
            await task("warehouse.create", { name: "Synthetic warehouse" })
          ).id,
          productId = (
            await task("product.create", {
              sku: "Runtime-Québec",
              name: "Synthetic equipment",
              serialized: true,
              unitPrice: 10000,
              taxBasisPoints: 0,
            })
          ).id,
          supplierId = (
            await task("supplier.create", { name: "Synthetic supplier" })
          ).id,
          poId = (
            await task("purchase.create", {
              supplierId,
              warehouseId,
              lines: [{ productId, quantity: 1, unitCost: 6000 }],
            })
          ).id,
          purchases = await read("/api/purchases"),
          lineId = purchases.orders.find((po) => po.id === poId).lines[0].id;
        await task("purchase.receive", {
          poId,
          lineId,
          deliveryRef: "Synthetic runtime receipt",
          quantity: 1,
          serials: ["Runtime-é-^XZ~JA"],
          bin: "A-1",
          quarantine: false,
        });
      }
      const dashboard = await read("/api/dashboard");
      assert.equal(dashboard.organization.region, region);
      assert.equal(
        dashboard.organization.currency,
        region === "CA" ? "CAD" : "USD",
      );
      assert.equal(dashboard.stock.length, 1);
      assert.equal(dashboard.stock[0].quantity, 1);
      assert.equal(dashboard.stock[0].serial, "Runtime-é-^XZ~JA");
      if (cycle === 0) {
        original = dashboard;
        unit = dashboard.stock[0];
        prepared = new Map();
      } else
        assert.deepEqual(
          dashboard,
          original,
          "Restart changed stock/business state.",
        );
      for (const output of ["pdf", "zpl-8", "zpl-12"]) {
        const response = await request(`/api/stock/${unit.id}/label`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": `runtime-${output}` },
          body: JSON.stringify({ revision: unit.revision, copies: 1, output }),
        });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer()),
          sha256 = hash(bytes),
          id = response.headers.get("x-download-receipt");
        assert.equal(response.headers.get("x-document-sha256"), sha256);
        assert.ok(id);
        assert.equal(
          response.headers.get("content-type"),
          output === "pdf" ? "application/pdf" : "application/octet-stream",
        );
        if (output === "pdf")
          assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        else
          assert.match(
            bytes.toString(),
            output === "zpl-8"
              ? /^\^XA\n\^PW800\n\^LL400\n/
              : /^\^XA\n\^PW1200\n\^LL600\n/,
          );
        const label = { output, bytes: bytes.length, sha256, id };
        if (cycle === 0) {
          prepared.set(output, label);
          summary.profiles.push(label);
        } else
          assert.deepEqual(
            label,
            prepared.get(output),
            "Restart failed exact prepared-label replay.",
          );
      }
      assert.equal((await read("/api/stock/labels")).length, 3);
      assert.deepEqual(
        await read("/api/dashboard"),
        original,
        "Label export changed native business state.",
      );
      assert.deepEqual(await read("/api/quickbooks/authorization"), {
        enabled: false,
      });
      assert.equal(
        (await request("/api/logout", { method: "POST", headers, body: "{}" }))
          .status,
        200,
      );
      assert.equal((await request("/api/dashboard", { headers })).status, 401);
    } finally {
      await stop(job);
    }
  }
  const key = randomBytes(32).toString("hex"),
    archive = join(directory, "synthetic.backup"),
    restored = join(directory, "restored.db");
  assert.match(
    await command(
      ["run", "recovery", "--", "backup", database, archive, region],
      runtime,
      config,
      `${key}\n`,
    ),
    /"snapshotHash"/,
  );
  assert.match(
    await command(
      ["run", "recovery", "--", "restore", archive, restored, region],
      runtime,
      config,
      `${key}\n`,
    ),
    /"providerHold":true/,
  );
  assert.match(
    await command(
      ["run", "schema", "--", "inspect", restored],
      runtime,
      config,
    ),
    /"kind":"current"/,
  );
  summary.localBackupRestore = true;
  receipt.regions.push(summary);
}
try {
  await mkdir(runtime, { mode: 0o700 });
  // Installed development tools build a production bundle. Keep their output
  // private so this check cannot replace another browser check's dist tree.
  await command(
    ["run", "build", "--", "--outDir", browserBuild, "--mode", "production"],
    root,
  );
  receipt.browserBuild = {
    nodeEnv: env.NODE_ENV,
    mode: "production",
    directory: browserBuild,
  };
  for (const file of ["package.json", "package-lock.json"]) {
    const bytes = await readFile(join(root, file));
    receipt.inputs[file] = hash(bytes);
    await writeFile(join(runtime, file), bytes);
  }
  for (const directory of ["src", "dist"]) {
    const source = directory === "dist" ? browserBuild : join(root, directory);
    await capture(".", directory, source);
    await cp(source, join(runtime, directory), {
      recursive: true,
      filter: (path) => basename(path) !== ".DS_Store",
    });
  }
  await capture("docs/licenses");
  await cp(join(root, "docs/licenses"), join(runtime, "docs/licenses"), {
    recursive: true,
    filter: (path) => basename(path) !== ".DS_Store",
  });
  for (const file of ["docs/THIRD-PARTY-NOTICES.md", "docs/RUNTIME.md"]) {
    const bytes = await readFile(join(root, file));
    receipt.inputs[file] = hash(bytes);
    await writeFile(join(runtime, file), bytes);
  }
  receipt.inputs["scripts/verify_runtime.mjs"] = hash(
    await readFile(fileURLToPath(import.meta.url)),
  );
  await mkdir(join(runtime, "scripts"));
  await cp(
    fileURLToPath(import.meta.url),
    join(runtime, "scripts/verify_runtime.mjs"),
  );
  // Qualify the copied package, not merely the checkout read before the copy.
  for (const [path, sha256] of Object.entries(receipt.inputs))
    assert.equal(
      hash(await readFile(join(runtime, path))),
      sha256,
      `Copied package input changed: ${path}`,
    );
  receipt.copiedInputsVerified = Object.keys(receipt.inputs).length;
  await command(["ci", "--omit=dev", "--offline", "--no-audit", "--no-fund"]);
  const dependencies = JSON.parse(
    await command(["ls", "--omit=dev", "--depth=0", "--json"]),
  ).dependencies;
  assert.equal(dependencies.tsx.version, "4.23.15");
  receipt.runtimeDependencies = Object.fromEntries(
    Object.entries(dependencies).map(([name, value]) => [name, value.version]),
  );
  const lock = JSON.parse(
    await readFile(join(runtime, "package-lock.json"), "utf8"),
  );
  // Shared optional runtime peers (e.g. Stripe's @types/node) may remain.
  // Require every exclusively development package to be physically absent.
  const developmentOnly = Object.entries(lock.packages).filter(
    ([path, metadata]) => path && metadata.dev === true,
  );
  for (const [path] of developmentOnly)
    assert.equal(
      existsSync(join(runtime, path, "package.json")),
      false,
      `${path} leaked into the runtime install.`,
    );
  receipt.developmentOnlyPackagesAbsent = developmentOnly.length;
  for (const region of ["CA", "US"]) await regionCheck(region);
  for (const [path, sha256] of Object.entries(receipt.inputs)) {
    assert.equal(
      hash(await readFile(join(runtime, path))),
      sha256,
      `Runtime package input changed during verification: ${path}`,
    );
    assert.equal(
      hash(await readFile(join(root, path))),
      sha256,
      `Checkout package input changed during verification: ${path}`,
    );
  }
  receipt.status = "PASS";
} catch (error) {
  receipt.status = "FAIL";
  // Assertion diagnostics can contain session-bearing objects; emit only context.
  receipt.failure = {
    name: error.name,
    location: error.stack
      ?.split("\n")
      .find(
        (line) =>
          line.trim().startsWith("at ") && line.includes("verify_runtime.mjs"),
      ),
    message:
      "Runtime qualification failed; inspect retained command logs and this check's assertions.",
  };
  process.exitCode = 1;
} finally {
  for (const child of children) signalGroup(child, "SIGKILL");
  receipt.finishedAt = new Date().toISOString();
  const path = join(work, "receipt.json");
  await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: receipt.status,
      receipt: path,
      regions: receipt.regions,
      gatesVerified: false,
    }),
  );
}
