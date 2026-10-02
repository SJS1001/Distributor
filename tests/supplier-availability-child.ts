import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";

export type SupplierJob = {
  path: string;
  region: Region;
  actor: Actor;
  key: string;
} & (
  | {
      operation: "availability";
      payload: Parameters<
        Application["procurement"]["supplierAvailability"]
      >[2];
    }
  | {
      operation: "purchase";
      payload: Parameters<Application["procurement"]["create"]>[2];
    }
);

let app: Application | undefined;
let input: SupplierJob;
process.on(
  "message",
  (message: { action: "init" | "go"; input: SupplierJob }) => {
    try {
      if (message.action === "init") {
        input = message.input;
        app = new Application(input.path, input.region);
        process.send?.({ ready: true });
        return;
      }
      if (!app) throw Error("Supplier worker was not initialized.");
      const result =
        input.operation === "availability"
          ? app.procurement.supplierAvailability(
              input.actor,
              input.key,
              input.payload,
            )
          : app.procurement.create(input.actor, input.key, input.payload);
      process.send?.({ ok: true, result });
    } catch (error) {
      process.send?.({
        ok: false,
        code: (error as { code?: string }).code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    app?.close();
    process.disconnect();
  },
);
