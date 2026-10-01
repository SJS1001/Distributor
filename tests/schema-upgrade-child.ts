import { Application } from "../src/server/application.ts";
import { Store } from "../src/server/database.ts";
import { upgradeSchema } from "../src/server/schema-upgrade.ts";

process.on("message", async (message: any) => {
  if (message.action === "ready") {
    process.send?.({ ready: true });
    return;
  }
  if (message.action === "kill-init") {
    const original = Store.prototype.migrate;
    Store.prototype.migrate = function (sql: string) {
      original.call(this, sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS report_events")) {
        process.send?.({
          paused: true,
          objects: this.all(
            "SELECT name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'",
          ).length,
        });
        // Remain inside the uncommitted constructor transaction until OS termination.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
    };
    new Application(message.path);
    process.send?.({ unexpectedCompletion: true });
    return;
  }
  try {
    const result = await upgradeSchema(
      message.source,
      message.destination,
      message.hash,
      "CA",
    );
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code?: string }).code });
  } finally {
    process.disconnect();
  }
});
