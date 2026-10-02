import { Application } from "./application.ts";
import { configuredEventReports } from "./report-runtime.ts";
import { check, DomainError, integer } from "./core.ts";
import { type Region } from "./iam.ts";
import { type TokenBundle } from "./provider-credentials.ts";

let app: Application | undefined;
try {
  const [action] = process.argv.slice(2);
  check(
    process.argv.length === 3 &&
      [
        "status",
        "install",
        "disable",
        "key-status",
        "rotate",
        "revoke",
        "revocation-status",
        "revocation-review",
      ].includes(action ?? ""),
    "CLI",
    "Usage: provider-credentials <status|install|disable|key-status|rotate|revoke|revocation-status|revocation-review>; operation input must arrive through protected stdin.",
    400,
  );
  const required = (name: string) => {
    check(process.env[name], "PROVIDER_CONFIG", `Missing ${name}.`, 500);
    return process.env[name]!;
  };
  const revocationAction = [
    "revoke",
    "revocation-status",
    "revocation-review",
  ].includes(action!);
  if (action === "revoke") {
    check(
      process.env.PROVIDERS_ENABLED === "true",
      "PROVIDER_DISABLED",
      "Outbound sandbox access is disabled.",
    );
    required("QUICKBOOKS_CLIENT_SECRET");
  }
  const binding = [
    "status",
    "install",
    "disable",
    "revoke",
    "revocation-status",
    "revocation-review",
  ].includes(action!)
    ? {
        id: required("PROVIDER_BINDING_ID"),
        orgId: required("PROVIDER_ORG_ID"),
        workerUserId: required("PROVIDER_WORKER_USER_ID"),
        realm: required("QUICKBOOKS_REALM_ID"),
        clientId: required("QUICKBOOKS_CLIENT_ID"),
      }
    : undefined;
  app = new Application(
    required("DATABASE_PATH"),
    (process.env.DATA_REGION ?? "CA") as Region,
    {
      eventReports: configuredEventReports(),
      providerEncryptionKey: process.env.PROVIDER_ENCRYPTION_KEY,
    },
  );
  let result;
  if (action === "status") result = app.providerCredentials.status(binding!);
  else if (action === "key-status")
    result = app.providerCredentials.keyStatus();
  else {
    check(
      !process.stdin.isTTY,
      "CREDENTIAL_INPUT",
      "Use protected stdin; never pass credentials in command arguments.",
    );
    let input = "";
    for await (const chunk of process.stdin) {
      input += String(chunk);
      check(
        Buffer.byteLength(input) <= 32768,
        "CREDENTIAL_INPUT",
        "Credential input exceeds the allowed size.",
      );
    }
    const value = JSON.parse(input) as {
      revision: number;
      tokens?: TokenBundle;
      generation?: number;
      nextKey?: string;
      workers?: { orgId: string; workerUserId: string }[];
      receiptId?: string;
      resolution?: "provider-confirmed" | "provider-unconfirmed";
      evidence?: string;
    };
    check(
      value && typeof value === "object" && !Array.isArray(value),
      "CREDENTIAL_INPUT",
      "Supply a credential operation object.",
    );
    if (revocationAction) {
      const allowed =
        action === "revoke"
          ? ["receiptId", "revision"]
          : action === "revocation-status"
            ? ["receiptId"]
            : ["receiptId", "revision", "resolution", "evidence"];
      check(
        Object.keys(value).every((name) => allowed.includes(name)),
        "CREDENTIAL_INPUT",
        "Unexpected revocation input.",
      );
      const revocationBinding = {
        ...binding!,
        accountId: required("PROVIDER_ACCOUNT_ID"),
      };
      if (action === "revoke")
        result = await app.providerCredentials.revocation.revoke(
          revocationBinding,
          value.receiptId!,
          value.revision,
          process.env.QUICKBOOKS_CLIENT_SECRET!,
        );
      else if (action === "revocation-status")
        result = app.providerCredentials.revocation.status(
          revocationBinding,
          value.receiptId!,
        );
      else
        result = app.providerCredentials.revocation.review(
          revocationBinding,
          value.receiptId!,
          value.revision,
          value.resolution!,
          value.evidence!,
        );
    } else if (action === "rotate") {
      check(
        Object.keys(value).every((name) =>
          ["generation", "nextKey", "workers"].includes(name),
        ),
        "CREDENTIAL_INPUT",
        "Unexpected rotation input.",
      );
      result = app.providerCredentials.rotate(
        value.workers!,
        value.generation!,
        value.nextKey!,
      );
    } else {
      integer(value.revision, "credential revision");
      if (action === "install") {
        check(
          value.tokens,
          "CREDENTIAL_INPUT",
          "Supply a credential token bundle.",
        );
        result = app.providerCredentials.install(
          binding!,
          value.revision,
          value.tokens,
        );
      } else result = app.providerCredentials.disable(binding!, value.revision);
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "CREDENTIAL_INPUT"}: Provider credential operation did not complete. Inspect current status before repeating.\n`,
  );
  process.exitCode = 1;
} finally {
  app?.close();
}
