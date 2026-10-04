import { Application } from "./application.ts";
import { configuredRestoreHost } from "./deployment-host.ts";
import { RestoreRuntime } from "./restore-runtime.ts";
import type { RestoreRuntimeConfiguration } from "./runtime-host.ts";
import type { Region } from "./iam.ts";

/** Executable application composition. No control or provider operation runs
 * at construction. Explicit host injection is for trusted programmatic callers;
 * executable entrypoints use the single reviewed static composition above. */
export function createRuntimeApplication(
  path: string,
  region: Region = "CA",
  security: ConstructorParameters<typeof Application>[2] = {},
  host: RestoreRuntimeConfiguration | undefined = configuredRestoreHost({
    databasePath: path,
    region,
  }),
) {
  const app = new Application(path, region, security);
  try {
    const restore = new RestoreRuntime(app, host);
    return { app, restore };
  } catch (error) {
    app.close();
    throw error;
  }
}
