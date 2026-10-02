import { fixture } from "./fixtures.ts";
import { seedOperationsHealth, oldest } from "./operations-health-fixture.ts";
import { createHttp } from "../src/server/http.ts";

export async function operationsHealthBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after }, { eventReports: false });
  seedOperationsHealth(f.app, f.actor);
  f.app.database
    .owned("platform")
    .run(
      "INSERT INTO platform_recovery VALUES(1,'PRIVATE-SNAPSHOT',?,?)",
      oldest,
      oldest,
    );
  f.app.identity.createUser(f.actor, "health-browser-support", {
    email: "support@example.test",
    name: "Synthetic support",
    password: "long-test-only-password",
    role: "support",
    sites: [],
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3150" });
  await http.listen({ host: "127.0.0.1", port: 3150 });
  return http;
}
