import { Application } from "../src/server/application.ts";
let app: Application;
let input: any;
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    process.send?.({
      ok: true,
      result: app.warranty.evidence.upload(
        input.actor,
        input.key,
        input.claimId,
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
