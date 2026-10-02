import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";

let app: Application;
let input: {
  path: string;
  actor: Actor;
  operation: "cancel" | "send";
  key: string;
  review: {
    effectId: string;
    reviewVersion: string;
    amount: number;
    reason: string;
  };
};
let release: (() => void) | undefined;
process.on("message", async (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "resume") release?.();
  else if (message.action === "go") {
    let io = 0;
    try {
      const value =
        input.operation === "cancel"
          ? app.integration.cancelCreditApplication(
              input.actor,
              input.key,
              input.review,
            )
          : await app.integration.execute(input.actor, input.review.effectId, {
              execute: async () => {
                io++;
                const held = new Promise<void>((resolve) => {
                  release = resolve;
                });
                process.send?.({ entered: true });
                await held;
                return {
                  reference: "payment:synthetic-race",
                  result: { amount: input.review.amount, currency: "CAD" },
                };
              },
              lookup: async () => {
                throw Error("No reconciliation expected");
              },
            });
      process.send?.({ ok: true, value, io });
    } catch (error: any) {
      process.send?.({
        ok: false,
        code: error.code,
        message: error.message,
        io,
      });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
