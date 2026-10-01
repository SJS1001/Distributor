import { Application } from "../src/server/application.ts";
import {
  type CredentialBinding,
  type TokenBundle,
} from "../src/server/provider-credentials.ts";
let app: Application;
process.on(
  "message",
  (message: {
    action: string;
    path: string;
    key: string;
    binding: CredentialBinding;
    tokens: TokenBundle;
  }) => {
    if (message.action === "init") {
      app = new Application(message.path, "CA", {
        providerEncryptionKey: message.key,
      });
      process.send?.({ ready: true });
    } else {
      try {
        app.providerCredentials.install(message.binding, 0, message.tokens);
        process.send?.({ ok: true });
      } catch (error) {
        process.send?.({ ok: false, code: (error as { code: string }).code });
      }
    }
  },
);
