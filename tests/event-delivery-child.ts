import { Application } from "../src/server/application.ts";
import {
  EventDelivery,
  type EventConsumer,
} from "../src/server/event-delivery.ts";
import { writeSync } from "node:fs";
let app: Application;
let engine: EventDelivery;
let mode: string;
function marker(phase: string) {
  writeSync(1, JSON.stringify({ phase }) + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
process.on(
  "message",
  (message: { action: string; path: string; mode: string }) => {
    if (message.action === "init") {
      mode = message.mode;
      app = new Application(message.path);
      const store = app.database.owned("report");
      const consumer: EventConsumer = {
        id: "process-report",
        version: 1,
        eventVersions: [1],
        apply(event) {
          store.run("INSERT INTO report_process_effects VALUES(?)", event.id);
          if (mode === "during") marker("during");
        },
      };
      engine = new EventDelivery(app.database, app.platform, app.identity, [
        consumer,
      ]);
      process.send?.({ ready: true });
      return;
    }
    try {
      if (mode === "compete") {
        const result = engine.tick("process-report", {
          enabled: true,
          limit: 100,
        });
        process.send?.({ result });
      } else {
        const claim = engine.claimBatch("process-report", 1).claims[0]!;
        if (mode === "claimed") marker("claimed");
        const result = engine.deliver(claim);
        if (mode === "after") marker("after");
        process.send?.({ result });
      }
    } catch (error) {
      process.send?.({
        error: (error as { code?: string }).code ?? "CHILD_FAILED",
      });
    } finally {
      app.close();
      process.disconnect();
    }
  },
);
