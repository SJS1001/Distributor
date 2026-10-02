import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: { path: string; actor: Actor; key: string } & (
  | {
      dispatch: false;
      payload: Parameters<Application["inventory"]["relocate"]>[2];
    }
  | {
      dispatch: true;
      payload: Parameters<Application["inventory"]["dispatchTransfer"]>[2];
    }
);
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    const result = input.dispatch
      ? app.inventory.dispatchTransfer(input.actor, input.key, input.payload)
      : app.inventory.relocate(input.actor, input.key, input.payload);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
