import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application,
  actor: Actor,
  key: string,
  input: Parameters<Application["fulfillment"]["updateDelivery"]>[2];
process.on("message", (m: any) => {
  if (!m.go) {
    app = new Application(m.path);
    actor = m.actor;
    key = m.key;
    input = m.input;
    process.send!({ tag: "ready" });
    return;
  }
  try {
    process.send!({
      tag: "result",
      ok: true,
      result: app.fulfillment.updateDelivery(actor, key, input),
    });
  } catch (e) {
    process.send!({
      tag: "result",
      ok: false,
      code: (e as any).code,
      message: (e as Error).message,
    });
  } finally {
    app.close();
    process.disconnect();
  }
});
