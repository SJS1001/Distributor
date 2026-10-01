import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application,
  actor: Actor,
  input: Parameters<Application["identity"]["mfa"]["confirmReplacement"]>[1];
process.on("message", (message: any) => {
  if (message.action === "init") {
    app = new Application(message.path, "CA", {
      mfaEncryptionKey: message.key,
    });
    actor = message.actor;
    input = message.input;
    process.send?.({ ready: true });
    return;
  }
  try {
    app.identity.mfa.confirmReplacement(actor, input);
    process.send?.({ ok: true });
  } catch (e) {
    process.send?.({ ok: false, code: (e as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
