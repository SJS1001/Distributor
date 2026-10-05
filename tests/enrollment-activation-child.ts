import { Application } from "../src/server/application.ts";
let app: Application;
process.on(
  "message",
  (message: {
    path?: string;
    orgId?: string;
    token?: string;
    action: string;
  }) => {
    if (message.action === "ready") {
      app = new Application(message.path!);
      process.send?.({ ready: true });
      return;
    }
    try {
      app.enrollment.activate(
        message.orgId!,
        message.token!,
        "synthetic-buyer-password",
      );
      process.send?.({ ok: true });
    } catch (error) {
      process.send?.({ ok: false, code: (error as { code?: string }).code });
    } finally {
      app.close();
      process.disconnect();
    }
  },
);
