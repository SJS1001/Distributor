import { Application } from "./application.ts";
import { check, DomainError, integer, text } from "./core.ts";
import { type Region } from "./iam.ts";
import { type LedgerAuthority } from "./organization-residency.ts";
import { configuredEventReports } from "./report-runtime.ts";

let app: Application | undefined;
try {
  const action = process.argv[2];
  check(
    ["begin", "complete", "status", "cancel"].includes(action ?? "") &&
      process.argv.length === 3,
    "OAUTH_INPUT",
    "Select begin, complete, status or cancel; use protected stdin for inputs.",
  );
  const required = (name: string) => {
    check(
      process.env[name],
      "PROVIDER_CONFIG",
      "Required organization configuration is unavailable.",
      500,
    );
    return process.env[name]!;
  };
  // Only explicit completion can transmit a code or request the sandbox company.
  if (action === "complete") {
    check(
      process.env.PROVIDERS_ENABLED === "true",
      "PROVIDER_DISABLED",
      "Outbound sandbox access is disabled.",
    );
    required("QUICKBOOKS_CLIENT_SECRET");
  }
  const binding = {
    id: required("PROVIDER_BINDING_ID"),
    orgId: required("PROVIDER_ORG_ID"),
    workerUserId: required("PROVIDER_WORKER_USER_ID"),
    realm: required("QUICKBOOKS_REALM_ID"),
    clientId: required("QUICKBOOKS_CLIENT_ID"),
    redirectUri: required("QUICKBOOKS_REDIRECT_URI"),
  };
  const path = required("DATABASE_PATH");
  check(
    !process.stdin.isTTY,
    "OAUTH_INPUT",
    "Use protected noninteractive stdin, never authorization codes in arguments.",
  );
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    check(bytes <= 32768, "OAUTH_INPUT", "Authorization input is too large.");
    chunks.push(buffer);
  }
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  ) as Record<string, unknown>;
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "OAUTH_INPUT",
    "Supply an organization authorization request object.",
  );
  const fields =
    action === "begin"
      ? ["revision", "authority"]
      : action === "complete"
        ? ["attemptId", "callbackUrl"]
        : ["attemptId"];
  check(
    Object.keys(value).length === fields.length &&
      fields.every((field) => Object.hasOwn(value, field)),
    "OAUTH_INPUT",
    "Supply only the required operation fields.",
  );
  if (action === "begin") {
    integer(value.revision as number, "credential revision");
    check(
      value.authority &&
        typeof value.authority === "object" &&
        !Array.isArray(value.authority),
      "OAUTH_INPUT",
      "Supply the exact reviewed organization permission.",
    );
  } else {
    text(value.attemptId as string, "authorization attempt ID");
    if (action === "complete")
      check(
        typeof value.callbackUrl === "string" &&
          Buffer.byteLength(value.callbackUrl) <= 16384,
        "OAUTH_INPUT",
        "Supply a bounded authorization callback URL.",
      );
  }
  // Refused input must not initialize a new database or perform store maintenance.
  app = new Application(path, (process.env.DATA_REGION ?? "CA") as Region, {
    eventReports: configuredEventReports(),
    providerEncryptionKey:
      action === "status" || action === "cancel"
        ? undefined
        : process.env.PROVIDER_ENCRYPTION_KEY,
  });
  const flow = app.providerCredentials.ledger.authorization;
  let result;
  if (action === "begin")
    result = flow.begin(
      binding,
      value.revision as number,
      value.authority as LedgerAuthority,
    );
  else if (action === "status")
    result = flow.status(binding, value.attemptId as string);
  else if (action === "cancel")
    result = flow.cancel(binding, value.attemptId as string);
  else
    result = await flow.complete(
      binding,
      value.attemptId as string,
      process.env.QUICKBOOKS_CLIENT_SECRET!,
      value.callbackUrl as string,
    );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "OAUTH_INPUT"}: Organization authorization did not complete. Inspect current status before repeating.\n`,
  );
  process.exitCode = 1;
} finally {
  app?.close();
}
