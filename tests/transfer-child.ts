import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  key: string;
} & (
  | {
      operation?: "receive";
      payload: Parameters<Application["inventory"]["receiveTransfer"]>[2];
    }
  | {
      operation: "loss";
      payload: Parameters<Application["inventory"]["approveTransferLoss"]>[2];
    }
  | {
      operation: "recover";
      payload: Parameters<Application["inventory"]["recoverTransferLoss"]>[2];
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
    process.send?.({
      ok: true,
      result:
        input.operation === "loss"
          ? app.inventory.approveTransferLoss(
              input.actor,
              input.key,
              input.payload,
            )
          : input.operation === "recover"
            ? app.inventory.recoverTransferLoss(
                input.actor,
                input.key,
                input.payload,
              )
            : app.inventory.receiveTransfer(
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
