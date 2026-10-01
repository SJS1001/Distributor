import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  actor: Actor;
  key: string;
  payload: Parameters<Application["inventory"]["recoverSerialMissing"]>[2];
};
process.on("message", (m: any) => {
  if (m.action === "init") {
    input = m;
    app = new Application(m.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    process.send?.({
      ok: true,
      result: app.inventory.recoverSerialMissing(
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
