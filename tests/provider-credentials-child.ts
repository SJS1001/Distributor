import { Application } from "../src/server/application.ts";
import { type CredentialBinding } from "../src/server/provider-credentials.ts";
import type { LedgerAuthority } from "../src/server/organization-residency.ts";
import { type Effect } from "../src/server/integration.ts";
let app: Application,
  binding: CredentialBinding,
  effect: Effect,
  authority: LedgerAuthority | undefined,
  release!: () => void,
  calls = 0;
process.on("message", async (message: any) => {
  if (message.action === "init") {
    app = new Application(message.input.path, "CA", {
      providerEncryptionKey: message.input.key,
    });
    binding = message.input.binding;
    effect = message.input.effect;
    authority = message.input.authority;
    globalThis.fetch = async () => {
      calls++;
      process.send?.({ requested: true });
      await new Promise<void>((r) => {
        release = r;
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
    release?.();
    return;
  }
  if (message.action !== "go") return;
  try {
    if (authority)
      await app.providerCredentials.ledger.access(
        binding,
        "synthetic-child-secret",
        authority,
      );
    else
      await app.providerCredentials.access(
        binding,
        "synthetic-child-secret",
        effect,
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
