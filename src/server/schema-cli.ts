import { DomainError, check } from "./core.ts";
import { inspectSchema, upgradeSchema } from "./schema-upgrade.ts";
import type { Region } from "./iam.ts";

const usage =
  "Usage: schema-cli inspect <source> | upgrade <source> <fresh destination> <expected schema sha256> <CA|US>. Stop old writers before upgrade; activation requires separate operator review.";
try {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === "--help" && args.length === 0) {
    process.stdout.write(usage + "\n");
  } else {
    check(
      (operation === "inspect" && args.length === 1) ||
        (operation === "upgrade" && args.length === 4),
      "SCHEMA_USAGE",
      usage,
    );
    const receipt =
      operation === "inspect"
        ? inspectSchema(args[0]!)
        : await upgradeSchema(args[0]!, args[1]!, args[2]!, args[3]! as Region);
    process.stdout.write(JSON.stringify(receipt) + "\n");
  }
} catch (error) {
  // SQLite/OS messages may contain business values or private paths. Only emit
  // our fixed error vocabulary, never raw error text or database rows.
  process.stderr.write(
    JSON.stringify({
      code:
        error instanceof DomainError ? error.code : "SCHEMA_OPERATION_FAILED",
      message:
        error instanceof DomainError
          ? error.message
          : "Schema operation failed; no activation was performed.",
    }) + "\n",
  );
  process.exitCode = 1;
}
