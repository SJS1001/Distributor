import { existsSync } from "node:fs";
import { createRuntimeApplication } from "./runtime-application.ts";
import type { Application } from "./application.ts";
import { configuredEventReports } from "./report-runtime.ts";
import { check, DomainError } from "./core.ts";
import { type Region } from "./iam.ts";

// Explicit, bounded foreground local work. No scheduler, network or provider runtime.
let app: Application | undefined;
try {
  check(
    process.argv.length === 2,
    "CLI",
    "This worker accepts no command arguments.",
    400,
  );
  check(
    configuredEventReports() && process.env.LOCAL_EVENT_REPORTS === "enabled",
    "EVENTS_DISABLED",
    "Local event reporting is disabled.",
    503,
  );
  const path = process.env.DATABASE_PATH;
  check(
    path && path !== ":memory:" && existsSync(path),
    "DATABASE",
    "Select an existing local database.",
    400,
  );
  const region = process.env.DATA_REGION;
  check(
    region === "CA" || region === "US",
    "REGION",
    "Select the database region.",
    400,
  );
  app = createRuntimeApplication(path, region as Region, {
    eventReports: true,
  }).app;
  process.stdout.write(
    `${JSON.stringify(app.eventDelivery.tick("event-report", { enabled: true }))}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof DomainError ? error.code : "EVENT_WORKER_FAILED"}: Local event batch did not complete. Inspect scoped delivery diagnostics before retrying.\n`,
  );
  process.exitCode = 1;
} finally {
  app?.close();
}
