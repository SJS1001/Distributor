import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  key: string;
  payload: Parameters<Application["identity"]["residencyChoice"]>[2];
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path, "CA");
    process.send?.({ ready: true });
    return;
  }
  try {
    process.send?.({
      ok: true,
      result: app.identity.residencyChoice(
        input.actor,
        input.key,
        input.payload,
      ),
    });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
