import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: { path: string; actor: Actor; effectId: string };
process.on("message", async (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "go") {
    try {
      const value = await app.integration.reconcile(
        input.actor,
        input.effectId,
        {
          execute: async () => {
            throw Error("never send");
          },
          lookup: async () => {
            await new Promise((r) => setTimeout(r, 250));
            return {
              reference: "qbo_synthetic_child",
              result: { total: 11300, currency: "CAD" },
            };
          },
        },
      );
      process.send?.({ ok: true, value });
    } catch (error: any) {
      process.send?.({ ok: false, code: error.code, message: error.message });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
