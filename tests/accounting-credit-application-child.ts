import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  creditId: string;
  key: string;
  amount: number;
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "go") {
    try {
      const value = app.integration.accountingCreditApplication(
        input.actor,
        input.key,
        { creditId: input.creditId, amount: input.amount },
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
