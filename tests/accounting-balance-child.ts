import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application, input: { path: string; actor: Actor; effectId: string };
process.on("message", async (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "go") {
    try {
      const value = await app.integration.balances.refresh(
        input.actor,
        input.effectId,
        message.key,
        {
          execute: async () => {
            throw Error("never send");
          },
          lookup: async () => null,
          readInvoiceBalance: async (e) => {
            await new Promise((r) => setTimeout(r, 400));
            return {
              reference: e.external_ref!,
              total: 11300,
              currency: "CAD",
              balance: 11300,
              syncToken: "1",
            };
          },
        },
      );
      process.send?.({ ok: true, value });
    } catch (error: any) {
      process.send?.({ ok: false, code: error.code });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
