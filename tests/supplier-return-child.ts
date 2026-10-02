import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";
let app: Application;
let input: { path: string; actor: Actor; key: string; region?: Region } & (
  | {
      operation: "return";
      payload: Parameters<Application["procurement"]["returnStock"]>[2];
    }
  | {
      operation: "dispatch";
      payload: Parameters<Application["inventory"]["dispatchTransfer"]>[2];
    }
);
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path, input.region ?? "CA");
    process.send?.({ ready: true });
    return;
  }
  try {
    const result =
      input.operation === "return"
        ? app.procurement.returnStock(input.actor, input.key, input.payload)
        : app.inventory.dispatchTransfer(input.actor, input.key, input.payload);
    process.send?.({ ok: true, result });
  } catch (e) {
    process.send?.({ ok: false, code: (e as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
