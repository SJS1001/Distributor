import { check } from "./core.ts";

// Registration/install policy, distinct from permission to run a foreground batch.
// Never echo rejected configuration values into operational diagnostics.
export function configuredEventReports(env: NodeJS.ProcessEnv = process.env) {
  const value = env.EVENT_REPORTS ?? "enabled";
  check(
    value === "enabled" || value === "disabled",
    "CONFIG",
    "EVENT_REPORTS must be enabled or disabled.",
    500,
  );
  return value === "enabled";
}
