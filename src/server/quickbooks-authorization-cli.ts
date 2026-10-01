import { Application } from "./application.ts";
import { check, DomainError, text } from "./core.ts";
import { type Region } from "./iam.ts";
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
      "Required provider configuration is unavailable.",
      500,
    );
    return process.env[name]!;
  };
  // Offline setup/status/cancel do not need outbound enablement. Only this action can request providers.
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
    accountId: required("PROVIDER_ACCOUNT_ID"),
    redirectUri: required("QUICKBOOKS_REDIRECT_URI"),
  };
  check(
    !process.stdin.isTTY,
    "OAUTH_INPUT",
    "Use protected noninteractive stdin, never authorization codes in arguments.",
  );
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    check(
      Buffer.byteLength(input) <= 32768,
      "OAUTH_INPUT",
      "Authorization input exceeds the allowed size.",
    );
  }
  const value = JSON.parse(input) as {
    revision: number;
    attemptId: string;
    callbackUrl: string;
  };
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "OAUTH_INPUT",
    "Supply an authorization request object.",
  );
  app = new Application(
    required("DATABASE_PATH"),
    (process.env.DATA_REGION ?? "CA") as Region,
    { providerEncryptionKey: process.env.PROVIDER_ENCRYPTION_KEY },
  );
  const flow = app.providerCredentials.authorization;
  let result;
  if (action === "begin") result = flow.begin(binding, value.revision);
  else {
    const attemptId = text(value.attemptId, "authorization attempt ID");
    if (action === "status") result = flow.status(binding, attemptId);
    else if (action === "cancel") result = flow.cancel(binding, attemptId);
    else
      result = await flow.complete(
        binding,
        attemptId,
        process.env.QUICKBOOKS_CLIENT_SECRET!,
        value.callbackUrl,
      );
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "OAUTH_INPUT"}: QuickBooks authorization did not complete. Inspect current status before repeating.\n`,
  );
  process.exitCode = 1;
} finally {
  app?.close();
}
