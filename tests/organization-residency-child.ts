// Independent synthetic SQLite writer used by the direct workstation tests.
import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { Region } from "../src/server/iam.ts";
import type {
  LedgerChoiceInput,
  LedgerDisclosureInput,
} from "../src/server/organization-residency.ts";
export type LedgerJob = {
  path: string;
  region: Region;
  actor: Actor;
  key: string;
} & (
  | { operation: "choose"; payload: LedgerChoiceInput }
  | { operation: "publish"; payload: LedgerDisclosureInput }
  | { operation: "withdraw"; payload: { disclosureId: string; reason: string } }
);
let app: Application | undefined;
let input: LedgerJob;
process.on(
  "message",
  (message: { action: "init" | "go"; input: LedgerJob }) => {
    try {
      if (message.action === "init") {
        input = message.input;
        app = new Application(input.path, input.region);
        process.send?.({ ready: true });
        return;
      }
      if (!app)
        throw Error(
          "Organization ledger test application was not initialized.",
        );
      const r = app.identity.organizationResidency;
      const result =
        input.operation === "choose"
          ? r.choose(input.actor, input.key, input.payload)
          : input.operation === "publish"
            ? r.publish(input.actor, input.key, input.payload)
            : r.withdrawDisclosure(input.actor, input.key, input.payload);
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
