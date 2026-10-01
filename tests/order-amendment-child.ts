import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";

let app: Application;
let request: {
  actor: Actor;
  key: string;
  input: Parameters<Application["orders"]["amend"]>[2];
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    request = message;
    app = new Application(message.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    process.send?.({
      ok: true,
      result: app.orders.amend(request.actor, request.key, request.input),
    });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
