import { existsSync, statSync } from "node:fs";
import { createRuntimeApplication } from "./runtime-application.ts";
import type { Application } from "./application.ts";
import { check, DomainError, text } from "./core.ts";
import type { Region } from "./iam.ts";
import { configuredEventReports } from "./report-runtime.ts";
import { StockJournalTransport } from "./stock-journal-transport.ts";

let app: Application | undefined;
const interrupted = new AbortController();
const interrupt = () => interrupted.abort();
try {
  const action = process.argv[2];
  check(
    process.argv.length === 3 &&
      ["status", "write", "lookup"].includes(action ?? ""),
    "JOURNAL_INPUT",
    "Select status, write or lookup; use protected stdin for one reviewed journal.",
  );
  check(
    action === "status" || process.env.PROVIDERS_ENABLED === "true",
    "PROVIDER_DISABLED",
    "Outbound sandbox access is disabled.",
  );
  const required = (name: string) => {
    check(
      process.env[name],
      "PROVIDER_CONFIG",
      "Required journal configuration is unavailable.",
    );
    return process.env[name]!;
  };
  const binding = {
    id: required("PROVIDER_BINDING_ID"),
    orgId: required("PROVIDER_ORG_ID"),
    workerUserId: required("PROVIDER_WORKER_USER_ID"),
    realm: required("QUICKBOOKS_REALM_ID"),
    clientId: required("QUICKBOOKS_CLIENT_ID"),
  };
  for (const name of ["id", "orgId", "workerUserId", "clientId"] as const)
    text(binding[name], name, 200);
  const secret =
      action === "status" ? "" : required("QUICKBOOKS_CLIENT_SECRET"),
    encryptionKey =
      action === "status" ? undefined : required("PROVIDER_ENCRYPTION_KEY"),
    path = required("DATABASE_PATH"),
    region = process.env.DATA_REGION ?? "CA";
  check(
    /^[1-9][0-9]{0,29}$/.test(binding.realm) &&
      (action === "status" ||
        (/^[\x21-\x7e]{1,8192}$/.test(secret) &&
          /^[a-fA-F0-9]{64}$/.test(encryptionKey!))) &&
      ["CA", "US"].includes(region),
    "PROVIDER_CONFIG",
    "Invalid journal sandbox configuration.",
  );
  const fields =
    action === "status" ? ["journalId"] : ["journalId", "reviewHash"];
  check(
    !process.stdin.isTTY,
    "JOURNAL_INPUT",
    "Supply protected noninteractive stdin, never journal data in arguments.",
  );
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    check(bytes <= 32768, "JOURNAL_INPUT", "Journal input is too large.");
    chunks.push(buffer);
  }
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  ) as Record<string, unknown>;
  check(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((field) => Object.hasOwn(value, field)),
    "JOURNAL_INPUT",
    "Supply only the journal identity and exact reviewed hash.",
  );
  const journalId = text(value.journalId, "journal identity", 128);
  check(
    action === "status" ||
      (typeof value.reviewHash === "string" &&
        /^[a-f0-9]{64}$/.test(value.reviewHash)),
    "JOURNAL_INPUT",
    "Supply the exact reviewed journal hash.",
  );
  check(
    existsSync(path) && statSync(path).isFile(),
    "JOURNAL_STORE",
    "Use an existing regional store.",
  );
  app = createRuntimeApplication(path, region as Region, {
    eventReports: configuredEventReports(),
    providerEncryptionKey: encryptionKey,
  }).app;
  const actor = app.identity.workerActor(binding.orgId, binding.workerUserId),
    journals = app.integration.costs.journals,
    current = journals.detail(actor, journalId);
  check(
    current.bindingId === binding.id && current.realm === binding.realm,
    "JOURNAL_BINDING",
    "Use the exact journal binding and sandbox company.",
  );
  if (action === "status") {
    process.stdout.write(
      `${JSON.stringify({ journalId: current.id, reviewHash: current.reviewHash, state: current.state, dispatched: current.dispatched, reference: current.externalId, leaseStarted: current.leaseStarted, leaseMode: current.leaseMode })}\n`,
    );
  } else {
    check(
      app.providerCredentials.available,
      "CREDENTIAL_KEY",
      "Use the current protected provider encryption key before execution.",
      503,
    );
    check(
      current.reviewHash === value.reviewHash,
      "JOURNAL_REVIEW_CHANGED",
      "Review the exact immutable journal before execution.",
    );
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    const result = await new StockJournalTransport(
      journals,
      app.providerCredentials,
      binding,
      secret,
      true,
    ).run(actor, journalId, action as "write" | "lookup", interrupted.signal);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.outcome === "unknown") process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "JOURNAL_INPUT"}: Journal operation did not complete. Inspect native state before reconciliation; do not resend an unresolved journal.\n`,
  );
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  app?.close();
}
