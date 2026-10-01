import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type { DisclosureInput } from "../src/server/iam-residency.ts";
let app: Application;
type Choice = Parameters<Application["identity"]["residencyChoice"]>[2];
let input: { path: string; actor: Actor; key: string } & (
  | { kind: "publish"; payload: DisclosureInput }
  | { kind: "choice"; payload: Choice }
);
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path, "CA");
    process.send?.({ ready: true });
    return;
  }
  try {
    const result =
      input.kind === "publish"
        ? app.identity.residency.publish(input.actor, input.key, input.payload)
        : app.identity.residencyChoice(input.actor, input.key, input.payload);
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
