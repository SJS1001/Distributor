import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  key: string;
  masters?: boolean;
  documents?: boolean;
  payload: Parameters<Application["migration"]["decide"]>[2];
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    const result = input.documents
      ? app.migration.documents.decide(input.actor, input.key, input.payload)
      : input.masters
        ? app.migration.masters.decide(input.actor, input.key, input.payload)
        : app.migration.decide(input.actor, input.key, input.payload);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
