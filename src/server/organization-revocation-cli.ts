import { Application } from "./application.ts";
import { check, DomainError, integer, text } from "./core.ts";
import type { Region } from "./iam.ts";
import type { LedgerAuthority } from "./organization-residency.ts";
import { configuredEventReports } from "./report-runtime.ts";

let app: Application | undefined;
try {
  const action = process.argv[2];
  check(
    process.argv.length === 3 &&
      ["revoke", "status", "review"].includes(action ?? ""),
    "REVOCATION_INPUT",
    "Select revoke, status or review; use protected stdin for inputs.",
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
  if (action === "revoke") {
    check(
      process.env.PROVIDERS_ENABLED === "true",
      "PROVIDER_DISABLED",
      "Outbound sandbox access is disabled.",
    );
    check(
      /^[\x21-\x7e]{1,8192}$/.test(required("QUICKBOOKS_CLIENT_SECRET")),
      "PROVIDER_CONFIG",
      "QuickBooks client secret is unavailable.",
    );
  }
  const binding = {
    id: required("PROVIDER_BINDING_ID"),
    orgId: required("PROVIDER_ORG_ID"),
    workerUserId: required("PROVIDER_WORKER_USER_ID"),
    realm: required("QUICKBOOKS_REALM_ID"),
    clientId: required("QUICKBOOKS_CLIENT_ID"),
  };
  const path = required("DATABASE_PATH");
  check(
    !process.stdin.isTTY,
    "REVOCATION_INPUT",
    "Supply protected noninteractive stdin, never operation data in arguments.",
  );
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    check(bytes <= 32768, "REVOCATION_INPUT", "Revocation input is too large.");
    chunks.push(buffer);
  }
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  ) as Record<string, unknown>;
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "REVOCATION_INPUT",
    "Supply an organization revocation request object.",
  );
  const fields =
    action === "revoke"
      ? ["receiptId", "revision", "authority"]
      : action === "status"
        ? ["receiptId"]
        : ["receiptId", "revision", "resolution", "evidence"];
  check(
    Object.keys(value).length === fields.length &&
      fields.every((field) => Object.hasOwn(value, field)),
    "REVOCATION_INPUT",
    "Supply only the required operation fields.",
  );
  text(value.receiptId, "revocation receipt ID", 128);
  if (action !== "status")
    integer(
      value.revision,
      "credential revision",
      1,
      Number.MAX_SAFE_INTEGER - 1,
    );
  if (action === "revoke") {
    const authority = value.authority as LedgerAuthority;
    const names = [
      "provider",
      "purpose",
      "environment",
      "orgId",
      "region",
      "realm",
      "revision",
      "disclosureId",
      "disclosureHash",
    ];
    check(
      authority &&
        typeof authority === "object" &&
        !Array.isArray(authority) &&
        Object.keys(authority).length === names.length &&
        names.every((name) => Object.hasOwn(authority, name)),
      "REVOCATION_INPUT",
      "Supply the exact reviewed organization permission.",
    );
    check(
      authority.provider === "quickbooks" &&
        authority.purpose === "stock-cost-journal" &&
        authority.environment === "sandbox" &&
        ["CA", "US"].includes(authority.region),
      "REVOCATION_INPUT",
      "Organization permission scope differs.",
    );
    text(authority.orgId, "permission organization", 128);
    text(authority.realm, "permission company", 128);
    integer(authority.revision, "permission revision", 1);
    text(authority.disclosureId, "permission disclosure", 128);
    check(
      typeof authority.disclosureHash === "string" &&
        /^[a-f0-9]{64}$/.test(authority.disclosureHash),
      "REVOCATION_INPUT",
      "Permission disclosure hash differs.",
    );
  } else if (action === "review") {
    check(
      ["provider-confirmed", "provider-unconfirmed"].includes(
        value.resolution as string,
      ),
      "REVOCATION_INPUT",
      "Select an explicit provider outcome.",
    );
    text(value.evidence, "provider review evidence", 2000);
  }
  // Refused input cannot initialize a store. Offline metadata/review ignores ambient keys.
  app = new Application(path, (process.env.DATA_REGION ?? "CA") as Region, {
    eventReports: configuredEventReports(),
    providerEncryptionKey:
      action === "revoke" ? process.env.PROVIDER_ENCRYPTION_KEY : undefined,
  });
  const flow = app.providerCredentials.ledger.revocation;
  const result =
    action === "revoke"
      ? await flow.revoke(
          binding,
          value.receiptId as string,
          value.revision as number,
          value.authority as LedgerAuthority,
          process.env.QUICKBOOKS_CLIENT_SECRET!,
        )
      : action === "status"
        ? flow.status(binding, value.receiptId as string)
        : flow.review(
            binding,
            value.receiptId as string,
            value.revision as number,
            value.resolution as "provider-confirmed" | "provider-unconfirmed",
            value.evidence as string,
          );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "REVOCATION_INPUT"}: Organization revocation did not complete. Inspect current status before repeating; do not resend an unresolved request.\n`,
  );
  process.exitCode = 1;
} finally {
  app?.close();
}
