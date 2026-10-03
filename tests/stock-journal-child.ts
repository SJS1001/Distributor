// Independent synthetic process; no transport registration or provider I/O.
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application | undefined;
let job: { path: string; actor: Actor; journalId: string };
process.on("message", (message: { action: "init" | "go"; job: typeof job }) => {
  try {
    if (message.action === "init") {
      job = message.job;
      app = new Application(job.path, "CA", { eventReports: false });
      process.send?.({ ready: true });
      return;
    }
    if (!app) throw Error("Synthetic process not initialized");
    const lease = app.integration.costs.journals.claim(
      job.actor,
      job.journalId,
      "write",
    );
    process.send?.({ ok: true, claimed: !!lease });
  } catch (error) {
    process.send?.({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  app?.close();
  process.disconnect();
});
