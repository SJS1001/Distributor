import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type {
  SupplierCreditInput,
  SupplierReplacementInput,
} from "../src/server/supplier-followups.ts";
let app: Application;
let input: {
  actor: Actor;
  key: string;
  kind?: string;
  input: SupplierCreditInput | SupplierReplacementInput;
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(message.path);
    process.send?.({ ready: true });
    return;
  }
  try {
    process.send?.({
      ok: true,
      result:
        input.kind === "replacement"
          ? app.procurement.followups.replacement(
              input.actor,
              input.key,
              input.input as SupplierReplacementInput,
            )
          : app.procurement.followups.credit(
              input.actor,
              input.key,
              input.input as SupplierCreditInput,
            ),
    });
  } catch (e) {
    process.send?.({ ok: false, code: (e as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
