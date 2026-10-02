import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fixture } from "./fixtures.ts";

test(
  "actual server minute maintenance continues OAuth cleanup after an enrollment storage fault and shuts down",
  { timeout: 80000 },
  async (t) => {
    const f = fixture(t),
      probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      probe.close((e) => (e ? reject(e) : resolve())),
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          DATABASE_PATH: f.path,
          DATA_REGION: "CA",
          PORT: String(port),
          PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      if (stderr.length < 65536) stderr += data.toString();
    });
    child.stdout.resume();
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const stopped = once(child, "exit");
        child.kill("SIGKILL");
        await stopped;
      }
    });
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const started = Date.now();
    let ready = false;
    while (Date.now() - started < 10000) {
      assert.equal(child.exitCode, null, "server must remain live");
      try {
        ready =
          (
            await fetch(`http://127.0.0.1:${port}/api/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).status === 200;
      } catch {}
      if (ready) break;
      await sleep(100);
    }
    assert.equal(ready, true, "actual server must be listening");
    // Install expired work only after startup, so the real minute timer must handle it.
    const iam = f.app.database.owned("iam"),
      integration = f.app.database.owned("integration");
    iam.run(
      "INSERT INTO iam_mfa_pending VALUES(?,?,?,?,?,?,?)",
      f.actor.id,
      f.actor.orgId,
      "synthetic-key",
      "synthetic-enrollment",
      1,
      "synthetic-material",
      0,
    );
    iam.migrate(`CREATE TRIGGER iam_maintenance_fault BEFORE UPDATE ON iam_mfa_pending
    BEGIN SELECT RAISE(ABORT,'synthetic private failure'); END;`);
    integration.run(
      "INSERT INTO integration_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      "runtime-attempt",
      f.actor.orgId,
      "runtime-binding",
      f.buyer,
      f.actor.id,
      "1234",
      "synthetic-client",
      `http://127.0.0.1:${port}/quickbooks/callback`,
      "a".repeat(64),
      0,
      1,
      0,
      "exchanging",
      "runtime-claim",
      0,
      null,
    );
    let terminal = false;
    while (Date.now() - started < 73000) {
      assert.equal(
        child.exitCode,
        null,
        "minute maintenance must not terminate server",
      );
      terminal =
        integration.get(
          "SELECT state FROM integration_authorizations WHERE id='runtime-attempt'",
        )!.state === "unknown";
      if (terminal) break;
      await sleep(200);
    }
    assert.equal(
      terminal,
      true,
      "real minute timer must fence interrupted authorization",
    );
    assert.equal(
      integration.get(
        "SELECT claim FROM integration_authorizations WHERE id='runtime-attempt'",
      )!.claim,
      null,
    );
    assert.equal(
      iam.get("SELECT material FROM iam_mfa_pending")!.material,
      "synthetic-material",
    );
    assert.match(
      stderr,
      /Authenticator setup cleanup did not complete; retrying next minute\./,
    );
    assert.doesNotMatch(
      stderr,
      /synthetic private failure|synthetic-material|runtime-claim/,
    );
    iam.migrate("DROP TRIGGER iam_maintenance_fault");
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);
  },
);
