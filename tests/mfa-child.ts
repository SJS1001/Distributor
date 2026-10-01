import { Application } from "../src/server/application.ts";
let app: Application;
let input: {
  path: string;
  key: string;
  email: string;
  password: string;
  code: string;
  timestamp: number;
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path, "CA", { mfaEncryptionKey: input.key });
    Date.now = () => input.timestamp;
    process.send?.({ ready: true });
    return;
  }
  try {
    app.identity.login(input.email, input.password, input.code);
    process.send?.({ ok: true });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
