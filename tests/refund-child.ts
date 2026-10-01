import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  effectId: string;
  callbackId?: string;
};
process.on("message", async (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "go") {
    try {
      let reads = 0;
      const adapter = {
        execute: async () => {
          throw Error("never send");
        },
        lookup: async (e: import("../src/server/integration.ts").Effect) => {
          reads++;
          await new Promise((r) => setTimeout(r, 250));
          const p = JSON.parse(e.payload);
          return {
            reference: "re_synthetic",
            result: {
              effectId: e.id,
              refundId: p.refundId,
              paymentId: p.paymentId,
              amount: p.amount,
              currency: p.currency,
              status: input.callbackId ? "failed" : "succeeded",
            },
          };
        },
      };
      const value = input.callbackId
        ? await app.integration.refundCallbacks.run(
            input.actor,
            input.callbackId,
            adapter,
          )
        : await app.integration.refunds.run(
            input.actor,
            input.effectId,
            adapter,
            false,
          );
      process.send?.({ ok: true, value, reads });
    } catch (error: any) {
      process.send?.({ ok: false, code: error.code, message: error.message });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
