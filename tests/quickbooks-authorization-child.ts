import { Application } from "../src/server/application.ts";
import { type AuthorizationBinding } from "../src/server/quickbooks-authorization.ts";
let app: Application,
  binding: AuthorizationBinding,
  attemptId: string,
  callback: string,
  release!: () => void,
  calls = 0;
process.on("message", async (message: any) => {
  if (message.action === "init") {
    app = new Application(message.input.path, "CA", {
      providerEncryptionKey: message.input.key,
    });
    binding = message.input.binding;
    attemptId = message.input.attemptId;
    callback = message.input.callback;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 2)
        return Response.json({ CompanyInfo: { Id: binding.realm } });
      process.send?.({ requested: true });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({
        access_token: "synthetic-child-access",
        refresh_token: "synthetic-child-refresh",
        token_type: "bearer",
        expires_in: 3600,
        x_refresh_token_expires_in: 100 * 86400,
      });
    };
    process.send?.({ ready: true });
    return;
  }
  if (message.action === "release") {
    release();
    return;
  }
  if (message.action !== "go") return;
  try {
    await app.providerCredentials.authorization.complete(
      binding,
      attemptId,
      "synthetic-child-secret",
      callback,
    );
    process.send?.({ ok: true, calls });
  } catch (error) {
    process.send?.({
      ok: false,
      code: (error as { code: string }).code,
      calls,
    });
  } finally {
    app.close();
    process.disconnect();
  }
});
