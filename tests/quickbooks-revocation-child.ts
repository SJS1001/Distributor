import { Application } from "../src/server/application.ts";
import type { RevocationBinding } from "../src/server/quickbooks-revocation.ts";
let app: Application,
  binding: RevocationBinding,
  receiptId: string,
  revision: number,
  release!: () => void,
  calls = 0;
process.on("message", async (message: any) => {
  if (message.action === "init") {
    app = new Application(message.input.path, "CA", {
      providerEncryptionKey: message.input.key,
    });
    binding = message.input.binding;
    receiptId = message.input.receiptId;
    revision = message.input.revision;
    globalThis.fetch = async () => {
      calls++;
      process.send?.({ requested: true });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({});
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
    const result = await app.providerCredentials.revocation.revoke(
      binding,
      receiptId,
      revision,
      "synthetic-revocation-secret",
    );
    process.send?.({ ok: true, result, calls });
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
