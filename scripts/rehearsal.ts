import assert from "node:assert/strict";
import { fork, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import {
  assertRehearsal,
  completeOrder,
  rehearsalConfig,
  rehearsalRegions,
  replaySale,
  seedRehearsal,
  type Sale,
  type RehearsalConfig,
} from "./rehearsal-fixture.ts";

type Phase = {
  type: "phaseDone";
  startedAt: number;
  completedAt: number;
  sales: Sale[];
  durations: number[];
};
type Ready = { type: "ready"; pid: number };
type Reply = Phase | Ready | { type: "error"; code: string };
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
class Worker {
  child: ChildProcess;
  exit: Promise<void>;
  queue: Reply[] = [];
  waiting?: { resolve: (value: Reply) => void; reject: (error: Error) => void };
  failure?: Error;
  closed = false;
  constructor(directory: string, name: string) {
    const log = createWriteStream(join(directory, `${name}.log`), {
      flags: "wx",
      mode: 0o600,
    });
    this.child = fork(join(root, "scripts/rehearsal-worker.ts"), [], {
      cwd: root,
      execArgv: ["--import", "tsx"],
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child.stdout!.pipe(log, { end: false });
    this.child.stderr!.pipe(log, { end: false });
    this.child.on("message", (reply: Reply) => {
      if (reply.type === "error") {
        this.fail(new Error(`Worker ${name}: ${reply.code}`));
        return;
      }
      if (this.waiting) {
        const waiting = this.waiting;
        this.waiting = undefined;
        waiting.resolve(reply);
      } else this.queue.push(reply);
    });
    this.exit = new Promise((resolveExit, reject) => {
      this.child.once("error", (error) => {
        this.fail(error);
        reject(error);
      });
      this.child.once("close", (code, signal) => {
        this.closed = true;
        log.end();
        if (code !== 0 || signal) {
          const error = new Error(`Worker ${name} exited ${code}/${signal}`);
          this.fail(error);
          reject(error);
        } else {
          if (this.waiting)
            this.fail(new Error(`Worker ${name} closed before reply`));
          resolveExit();
        }
      });
    });
    // A child failure may precede the awaited phase/cleanup; keep the rejection observed.
    void this.exit.catch(() => {});
  }
  fail(error: Error) {
    this.failure = error;
    this.waiting?.reject(error);
    this.waiting = undefined;
  }
  receive(): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error("Worker already closed"));
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    assert(!this.waiting, "Only one outstanding worker reply");
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
  send(message: unknown) {
    if (this.failure) throw this.failure;
    this.child.send(message as object, (error) => {
      if (error) this.fail(error);
    });
  }
  terminate() {
    if (!this.closed) this.child.kill("SIGKILL");
  }
  async close() {
    if (!this.closed) {
      this.send({ type: "close" });
      await this.exit;
    }
  }
}
async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolvePort, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolvePort);
  });
  const address = socket.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolveClose, reject) =>
    socket.close((error) => (error ? reject(error) : resolveClose())),
  );
  // If another process takes it before the child listens, startup fails; never attach to it.
  return address.port;
}
function metrics(values: number[]) {
  assert(
    values.length > 0 && values.every((v) => Number.isFinite(v) && v >= 0),
  );
  const ordered = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
    maxMs: ordered.at(-1),
  };
}
export async function runRehearsal(input: unknown) {
  const config = rehearsalConfig(input);
  assert(
    ["darwin", "linux"].includes(process.platform),
    "This workstation rehearsal requires POSIX; Windows unqualified",
  );
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert(
    major === 24 && minor! >= 16,
    "Use supported Node >=24.16.0 <25 runtime",
  );
  const work = await mkdtemp(join(tmpdir(), "distributor-load-recovery-"));
  await chmod(work, 0o700);
  const started = performance.now(),
    children = new Set<Worker>(),
    abort = new AbortController();
  const deadline = setTimeout(() => {
    abort.abort(new Error("Rehearsal deadline exceeded"));
    for (const child of children) child.terminate();
  }, config.deadlineMs);
  const checkDeadline = () => {
    if (performance.now() - started >= config.deadlineMs)
      throw new Error("Rehearsal deadline exceeded");
    abort.signal.throwIfAborted();
  };
  const inputs: Record<string, string> = {};
  const receipt: {
    status: string;
    startedAt: string;
    completedAt?: string;
    work: string;
    environment: object;
    config: RehearsalConfig;
    inputHashes: Record<string, string>;
    regions: object[];
    limitations: string[];
    error?: string;
    elapsedMs?: number;
  } = {
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    work,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    config,
    inputHashes: inputs,
    regions: [],
    limitations: [
      "Synthetic workstation workload; production peak/latency/availability/RPO/RTO targets remain unapproved",
      "CA/US are logical regional stores on one workstation, not infrastructure residency evidence",
      "HTTP GET reads plus independent native writer processes; no HTTP write, browser/device/provider or network outage qualification",
      "Writers pause at an exact cutoff; live WAL read/backup is exercised, not backup correctness during simultaneous commits",
      "Restore timing excludes provisioning, incident detection, operator review and provider reconciliation",
      "Post-cutoff loss is reported in business records; no scheduled-backup RPO guarantee",
      "No real processor/carrier/accounting calls; restored providers remain held",
      "Backup encryption keys are ephemeral and erased after this run; retained synthetic archives cannot be reopened",
    ],
  };
  let current: Application | undefined, restored: Application | undefined;
  try {
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root },
    )
      .toString()
      .split("\0")
      .filter((path) =>
        /^(src\/|tests\/|scripts\/)|^(package(-lock)?\.json|tsconfig\.json|vite\.config\.ts)$/.test(
          path,
        ),
      )
      .sort();
    for (const path of files)
      inputs[path] = hash(await readFile(join(root, path)));
    for (const region of rehearsalRegions) {
      checkDeadline();
      const directory = join(work, region);
      await mkdir(directory, { mode: 0o700 });
      const path = join(directory, "source.db"),
        archive = join(directory, "cutoff.distributor-backup"),
        recoveredPath = join(directory, "restored.db"),
        seedStart = performance.now();
      current = new Application(path, region);
      const seed = seedRehearsal(current, config, checkDeadline),
        seedMs = performance.now() - seedStart;
      assertRehearsal(current, seed, config, []);
      const port = await freePort(),
        url = `http://127.0.0.1:${port}`,
        http = new Worker(directory, "http");
      children.add(http);
      http.send({
        type: "start",
        input: { kind: "http", path, region, config, seed, port, writer: -1 },
      });
      const serverReady = await http.receive();
      assert.equal(serverReady.type, "ready");
      const fetchLocal = (route: string, init?: RequestInit) =>
        fetch(url + route, {
          ...init,
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
      const unauthenticated = await fetchLocal("/api/stock/page");
      assert.equal(unauthenticated.status, 401);
      await unauthenticated.arrayBuffer();
      const cookies = await Promise.all(
        seed.readers.map(async (reader) => {
          const response = await fetchLocal("/api/login", {
            method: "POST",
            headers: { origin: url, "content-type": "application/json" },
            body: JSON.stringify(reader),
          });
          assert.equal(response.status, 200);
          const session = (await response.json()) as {
            passwordChangeRequired: boolean;
            mfaEnrollmentRequired: boolean;
          };
          assert.equal(session.passwordChangeRequired, false);
          assert.equal(session.mfaEnrollmentRequired, false);
          const cookie = response.headers.get("set-cookie")?.split(";")[0];
          assert(cookie && cookie.startsWith("distributor_session="));
          return cookie;
        }),
      );
      const copiedSession = current.identity.login(
          seed.readers[0]!.email,
          seed.readers[0]!.password,
        ),
        writers: Worker[] = [];
      // Construct sequentially; the measured phases start all independent writers together.
      for (let writer = 0; writer < config.writers; writer++) {
        checkDeadline();
        const worker = new Worker(directory, `writer-${writer}`);
        children.add(worker);
        writers.push(worker);
        worker.send({
          type: "start",
          input: { kind: "writer", path, region, config, seed, writer, port },
        });
        assert.equal((await worker.receive()).type, "ready");
      }
      const requests: {
          route: string;
          phase: string;
          client: number;
          startedAt: number;
          completedAt: number;
          durationMs: number;
          status: number;
        }[] = [],
        phases: Phase[][] = [];
      async function runPhase(
        from: number,
        to: number,
        reads: number,
        phase: string,
      ) {
        checkDeadline();
        const phaseStart = performance.now();
        for (const writer of writers) writer.send({ type: "phase", from, to });
        const readTasks = cookies.map(async (cookie, client) => {
          const routes = [
            "/api/catalog/products/page",
            "/api/stock/page",
            "/api/operations/reconciliation",
          ];
          for (let i = 0; i < reads; i++) {
            const route = routes[(i + client) % routes.length]!,
              start = performance.now(),
              startedAt = Date.now();
            const response = await fetchLocal(route, { headers: { cookie } }),
              body = (await response.json()) as {
                items?: unknown[];
                stock?: { issues: { count: number } };
                billing?: { issues: { count: number } };
                sales?: { issues: { count: number } };
              };
            requests.push({
              route,
              phase,
              client,
              startedAt,
              completedAt: Date.now(),
              durationMs: performance.now() - start,
              status: response.status,
            });
            assert.equal(response.status, 200, `HTTP ${route}`);
            assert.equal(response.headers.get("cache-control"), "no-store");
            if (body.items)
              assert(body.items.length <= 20, "Bounded HTTP pages");
            if (route.endsWith("reconciliation")) {
              assert(body.stock && body.billing && body.sales);
              for (const control of [body.stock, body.billing, body.sales])
                assert.equal(
                  control.issues.count,
                  0,
                  "Consistent live reconciliation",
                );
            }
          }
        });
        const writerReplies = Promise.all(
          writers.map(async (writer) => {
            const reply = await writer.receive();
            assert.equal(reply.type, "phaseDone");
            return reply as Phase;
          }),
        );
        // Observe all promises, including errors from reads that precede a writer exit.
        const [writeResults] = await Promise.all([
          writerReplies,
          Promise.all(readTasks),
        ]);
        phases.push(writeResults);
        return {
          writes: writeResults.flatMap((r) => r.sales),
          elapsedMs: performance.now() - phaseStart,
        };
      }
      const cutoffCount = Math.ceil(config.ordersPerWriter / 2),
        first = await runPhase(
          0,
          cutoffCount,
          Math.ceil(config.readsPerClient / 2),
          "before-cutoff",
        ),
        cutoff = assertRehearsal(current, seed, config, first.writes),
        key = randomBytes(32);
      let backupMs: number,
        restoreMs: number,
        backupReceipt: Awaited<ReturnType<typeof createBackup>>,
        restoreReceipt: Awaited<ReturnType<typeof restoreBackup>>;
      try {
        const backupStart = performance.now();
        backupReceipt = await createBackup(path, archive, region, key);
        backupMs = performance.now() - backupStart;
        const second = await runPhase(
            cutoffCount,
            config.ordersPerWriter,
            Math.floor(config.readsPerClient / 2),
            "after-cutoff",
          ),
          live = assertRehearsal(current, seed, config, [
            ...first.writes,
            ...second.writes,
          ]);
        const restoreStart = performance.now();
        restoreReceipt = await restoreBackup(
          archive,
          recoveredPath,
          region,
          key,
        );
        restoreMs = performance.now() - restoreStart;
        restored = new Application(recoveredPath, region);
        const restoredCutoff = assertRehearsal(
          restored,
          seed,
          config,
          first.writes,
        );
        assert.deepEqual(restoredCutoff.actual.stock, cutoff.actual.stock);
        assert.deepEqual(restoredCutoff.actual.billing, cutoff.actual.billing);
        assert.deepEqual(restoredCutoff.actual.sales, cutoff.actual.sales);
        assert.equal(
          restoredCutoff.actual.snapshotHash,
          cutoff.actual.snapshotHash,
        );
        assert.throws(() => restored!.identity.session(copiedSession.token), {
          code: "UNAUTHENTICATED",
        });
        assert.equal(restoreReceipt.providerHold, true);
        assert(restored.platform.recoveryHold());
        assert.throws(() => restored!.platform.assertProviderAccess(), {
          code: "RECOVERY_HOLD",
        });
        for (const sale of first.writes) replaySale(restored, seed, sale);
        assert.equal(
          assertRehearsal(restored, seed, config, first.writes).actual
            .snapshotHash,
          cutoff.actual.snapshotHash,
          "Exact retries have no duplicate business effect",
        );
        const pendingSale = completeOrder(
          restored,
          seed,
          seed.pending.id,
          0,
          0,
          "pending-completion",
        );
        replaySale(restored, seed, pendingSale);
        const resumed = assertRehearsal(
          restored,
          seed,
          config,
          [...first.writes, pendingSale],
          false,
        );
        const overlappedReads = requests.filter((r) =>
          phases.some((phase) =>
            phase.some(
              (w) =>
                r.startedAt <= w.completedAt && r.completedAt >= w.startedAt,
            ),
          ),
        ).length;
        assert(overlappedReads > 0, "HTTP reads overlap independent writers");
        const childPids = [...children]
          .filter((w) => !w.closed)
          .map((w) => w.child.pid);
        assert.equal(new Set(childPids).size, config.writers + 1);
        await writeFile(
          join(directory, "http-samples.json"),
          JSON.stringify(requests, null, 2),
          { mode: 0o600 },
        );
        await writeFile(
          join(directory, "writer-samples.json"),
          JSON.stringify(phases, null, 2),
          { mode: 0o600 },
        );
        receipt.regions.push({
          region,
          seedMs,
          writerProcesses: config.writers,
          readerClients: config.readClients,
          processIds: childPids,
          httpRequests: requests.length,
          overlappedReads,
          httpLatency: metrics(requests.map((r) => r.durationMs)),
          nativeSaleLatency: metrics(
            phases.flatMap((phase) => phase.flatMap((r) => r.durations)),
          ),
          phaseMs: [first.elapsedMs, second.elapsedMs],
          salesPerSecondIncludingConcurrentReads:
            ((first.writes.length + second.writes.length) * 1000) /
            (first.elapsedMs + second.elapsedMs),
          backupMs,
          restoreMs,
          backup: backupReceipt,
          restore: restoreReceipt,
          cutoff,
          live,
          restoredCutoff,
          resumed,
          postCutoffExcludedSales: second.writes.length,
          pendingOrderResumedOnce: true,
          existingSaleReplayCount: first.writes.length,
          copiedSessionRejected: true,
          restoredProviderHold: true,
        });
        restored.close();
        restored = undefined;
      } finally {
        key.fill(0);
      }
      for (const writer of writers) {
        await writer.close();
        children.delete(writer);
      }
      await http.close();
      children.delete(http);
      current.close();
      current = undefined;
    }
    for (const [path, expected] of Object.entries(inputs))
      assert.equal(
        hash(await readFile(join(root, path))),
        expected,
        `Input changed during rehearsal: ${path}`,
      );
    receipt.status = "PASS";
  } catch (error) {
    receipt.status = "FAIL";
    receipt.error =
      error instanceof Error ? error.message : "Unknown rehearsal failure";
  } finally {
    clearTimeout(deadline);
    abort.abort();
    for (const worker of children) worker.terminate();
    await Promise.allSettled([...children].map((worker) => worker.exit));
    restored?.close();
    current?.close();
    receipt.completedAt = new Date().toISOString();
    receipt.elapsedMs = performance.now() - started;
    await writeFile(
      join(work, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  return receipt;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert(
    process.argv.length <= 3,
    "Usage: npm run verify:load-recovery -- [workload.json]",
  );
  const config = process.argv[2]
    ? (JSON.parse(await readFile(resolve(process.argv[2]), "utf8")) as unknown)
    : {};
  const receipt = await runRehearsal(config);
  console.log(
    JSON.stringify({
      status: receipt.status,
      receipt: join(receipt.work, "receipt.json"),
      regions: receipt.regions.length,
      elapsedMs: receipt.elapsedMs,
      ...(receipt.error ? { error: receipt.error } : {}),
    }),
  );
  if (receipt.status !== "PASS") process.exitCode = 1;
}
