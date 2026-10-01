import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
const [path, rawActor, label] = process.argv.slice(2);
const app = new Application(path!);
try {
  const actor = JSON.parse(rawActor!) as Actor;
  for (let i = 0; i < 30; i++)
    app.platform.audit(actor, "SyntheticConcurrent", `${label}-${i}`, {});
} finally {
  app.close();
}
