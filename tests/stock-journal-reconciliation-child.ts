// Independent synthetic finance process. No provider I/O or worker registration.
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { JournalReconciliationInput } from "../src/server/stock-journal-reconciliation.ts";
let app: Application | undefined;
let job: {
  path: string;
  actor: Actor;
  key: string;
  input: JournalReconciliationInput;
};
process.on("message", (message: { action: "init" | "go"; job: typeof job }) => {
  try {
    if (message.action === "init") {
      job = message.job;
      app = new Application(job.path, "CA", { eventReports: false });
      process.send?.({ ready: true });
      return;
    }
    if (!app) throw Error("Synthetic process not initialized");
    const result = app.integration.costs.reconcileJournals(
      job.actor,
      job.key,
      job.input,
    );
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({
      ok: false,
      code:
        error && typeof error === "object" && "code" in error
          ? error.code
          : "UNEXPECTED",
    });
  }
  app?.close();
  process.disconnect();
});
