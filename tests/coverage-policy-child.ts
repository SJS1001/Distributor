import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  key: string;
  operation: "policy" | "submit";
  payload: any;
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    const result =
      input.operation === "policy"
        ? app.identity.configureCoverage(input.actor, input.key, input.payload)
        : app.warranty.submit(input.actor, input.key, input.payload);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
