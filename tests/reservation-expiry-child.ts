import { mock } from "node:test";
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";

let app: Application;
let request: {
  actor: Actor;
  key: string;
  command: "expire" | "cancel" | "pick";
  payload: any;
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    request = message;
    mock.method(Date, "now", () => message.clock);
    app = new Application(message.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    const result =
      request.command === "expire"
        ? app.orders.expireReservations(
            request.actor,
            request.key,
            request.payload,
          )
        : request.command === "cancel"
          ? app.orders.cancel(request.actor, request.key, request.payload)
          : app.fulfillment.pick(request.actor, request.key, request.payload);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
