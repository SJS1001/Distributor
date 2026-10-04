import { lstatSync, writeSync } from "node:fs";
import { check, DomainError } from "./core.ts";
import type { Region } from "./iam.ts";
import { createRuntimeApplication } from "./runtime-application.ts";
import { parseRestoreOperatorRequest } from "./restore-runtime.ts";
import { inspectSchema } from "./schema-upgrade.ts";

const actions = new Set([
  "release-status",
  "release-prepare",
  "release-approve",
  "release-activate",
  "release-rollback",
  "release-supersede",
  "offline-failed-refund",
  "offline-failed-refund-recover",
  "offline-original-cancellation",
  "offline-original-cancellation-recover",
  "offline-original-lease-retirement",
  "offline-original-lease-retirement-recover",
  "offline-canada-post-member",
  "offline-canada-post-member-recover",
  "offline-checkout-paid",
  "offline-checkout-paid-recover",
]);

async function readInput(): Promise<Record<string, unknown>> {
  check(!process.stdin.isTTY, "RESTORE_INPUT", "Protected stdin is required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    check(size <= 1024 * 1024, "RESTORE_INPUT", "Input is too large.");
    chunks.push(bytes);
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "RESTORE_INPUT",
    "A JSON object is required.",
  );
  return value as Record<string, unknown>;
}

async function main() {
  let app: ReturnType<typeof createRuntimeApplication>["app"] | undefined;
  let phase: "input" | "store" | "operation" = "input";
  try {
    const action = process.argv[2];
    check(
      process.argv.length === 3 && actions.has(action ?? ""),
      "RESTORE_INPUT",
      "Select one restore operator action.",
    );
    const input = parseRestoreOperatorRequest(action!, await readInput());
    phase = "store";
    const path = process.env.DATABASE_PATH;
    const region = process.env.DATA_REGION;
    check(
      typeof path === "string" &&
        path.length > 0 &&
        (region === "CA" || region === "US"),
      "RESTORE_CONFIG",
      "An existing regional store and explicit region are required.",
    );
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      check(false, "RESTORE_STORE", "An existing regional store is required.");
      return;
    }
    check(
      stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      "RESTORE_STORE",
      "An existing single-link regular store is required.",
    );
    // Inspect the persisted schema without invoking constructors. In particular,
    // an empty regular file must not be initialized as a new application store.
    const inspection = inspectSchema(path);
    check(
      inspection.kind === "current" && inspection.region === region,
      "RESTORE_STORE",
      "A current store in the selected region is required.",
    );
    // Opening a candidate must preserve its persisted reporting profile.
    const runtime = createRuntimeApplication(path, region as Region, {
      eventReports: false,
      startupMaintenance: false,
    });
    app = runtime.app;
    let openedStat;
    try {
      openedStat = lstatSync(path);
    } catch {
      check(false, "RESTORE_STORE", "Regional store changed while opening.");
      return;
    }
    check(
      openedStat.isFile() &&
        !openedStat.isSymbolicLink() &&
        openedStat.nlink === 1 &&
        openedStat.dev === stat.dev &&
        openedStat.ino === stat.ino,
      "RESTORE_STORE",
      "Regional store changed while opening.",
    );
    phase = "operation";
    const result = runtime.restore.run(action!, input);
    const output = JSON.stringify(result);
    check(
      typeof output === "string",
      "RESTORE_OPERATION",
      "No result was returned.",
    );
    app.close();
    app = undefined;
    writeSync(1, `${output}\n`);
  } catch (error) {
    // Never echo thrown messages: inputs, evidence and host errors can contain private data.
    const code =
      error instanceof DomainError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : phase === "input"
          ? "RESTORE_INPUT"
          : phase === "store"
            ? "RESTORE_STORE"
            : "RESTORE_OPERATION";
    process.stderr.write(
      `${code}: Restore operation did not complete. Inspect current native state before retrying.\n`,
    );
    process.exitCode = 1;
  } finally {
    try {
      app?.close();
    } catch {
      process.exitCode = 1;
    }
  }
}

await main();
