import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { CanadaPostGroupPrepare } from "../src/server/carrier-bookings.ts";

let app: Application | undefined;
process.on(
  "message",
  (message: {
    action: "ready" | "prepare";
    path: string;
    actor: Actor;
    key: string;
    input: CanadaPostGroupPrepare;
  }) => {
    try {
      if (message.action === "ready") {
        app = new Application(message.path);
        process.send?.({ ready: true });
        return;
      }
      const result = app!.carriers.prepareCanadaPostGroup(
        message.actor,
        message.key,
        message.input,
      );
      process.send?.({ ok: true, result });
    } catch (error) {
      process.send?.({ ok: false, code: (error as { code?: string }).code });
    } finally {
      if (message.action === "prepare") {
        app?.close();
        process.disconnect();
      }
    }
  },
);
