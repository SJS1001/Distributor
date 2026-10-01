import { Application } from "../src/server/application.ts";
let app: Application, input: any;
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  }
  if (message.action === "go") {
    try {
      const result =
        input.kind === "refund"
          ? app.integration.accountingRefund(
              input.actor,
              input.key,
              input.input,
            )
          : app.integration.accountingCreditApplication(
              input.actor,
              input.key,
              input.input,
            );
      process.send?.({ ok: true, result });
    } catch (error: any) {
      process.send?.({ ok: false, code: error.code });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
