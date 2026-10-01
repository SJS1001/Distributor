import { Application } from "./application.ts";
import { configuredEventReports } from "./report-runtime.ts";
import { configuredProviders } from "./provider-runtime.ts";
import { check, DomainError } from "./core.ts";
import { type Region } from "./iam.ts";

// One bounded foreground batch. A qualified deployment may schedule repeated invocations.
const app = new Application(
  process.env.DATABASE_PATH ?? "local-evidence/distributor.db",
  (process.env.DATA_REGION ?? "CA") as Region,
  {
    eventReports: configuredEventReports(),
    providerEncryptionKey: process.env.PROVIDER_ENCRYPTION_KEY,
  },
);
try {
  check(
    process.argv.length === 2,
    "CLI",
    "The worker accepts no arguments; it runs one bounded batch.",
    400,
  );
  const providers = configuredProviders(app);
  check(
    providers,
    "PROVIDER_DISABLED",
    "Provider worker is disabled; no outbound calls were made.",
    503,
  );
  process.stdout.write(`${JSON.stringify(await providers.tick())}\n`);
} catch (error) {
  // Provider bodies, credentials and stack traces never enter operational stdout/stderr.
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "WORKER_FAILED"}: Provider batch did not complete. Inspect current operation states before repeating.\n`,
  );
  process.exitCode = 1;
} finally {
  app.close();
}
