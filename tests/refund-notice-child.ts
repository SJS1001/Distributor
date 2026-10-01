import { Application } from "../src/server/application.ts";
let app: Application;
let input: any;
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "go") {
    try {
      process.send?.({
        ok: true,
        value: app.billing.refunds.alerts.acknowledge(input.actor, input.key, {
          noticeId: input.noticeId,
          revision: 1,
        }),
      });
    } catch (error: any) {
      process.send?.({ ok: false, code: error.code, message: error.message });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
