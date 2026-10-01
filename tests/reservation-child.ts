import { Application } from "../src/server/application.ts";
import { type Actor } from "../src/server/core.ts";
let app: Application;
let input: { path: string; actor: Actor; quoteId: string; key: string };
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    const result = app.orders.accept(input.actor, input.key, {
      quoteId: input.quoteId,
      allowBackorder: false,
    });
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
