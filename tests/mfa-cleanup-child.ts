import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application,
  input: {
    path: string;
    key: string;
    password: string;
    timestamp: number;
    actor: Actor;
    action: "purge" | "begin";
  };
process.on("message", (message: any) => {
  try {
    if (message.action === "init") {
      input = message.input;
      app = new Application(input.path, "CA", { mfaEncryptionKey: input.key });
      Date.now = () => input.timestamp;
      process.send?.({ ready: true });
      return;
    }
    if (input.action === "purge")
      process.send?.({
        ok: true,
        ...app.identity.mfa.purgeExpiredEnrollments(),
      });
    else
      process.send?.({
        ok: true,
        setup: app.identity.mfa.begin(input.actor, "replacement", {
          currentPassword: input.password,
          revision: 1,
        }),
      });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code?: string }).code });
  }
  app?.close();
  process.disconnect();
});
