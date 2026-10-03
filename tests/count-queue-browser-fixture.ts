import { fixture } from "./fixtures.ts";
import { countQueueFixture } from "./count-queue-fixture.ts";
import { createHttp } from "../src/server/http.ts";

export async function countQueueBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  countQueueFixture(f, 45, 3);
  f.app.identity.configureCountReview(f.actor, "queue-independent", {
    mode: "independent",
    revision: 1,
    reason: "Synthetic independent count review",
  });
  for (const [email, sites] of [
    ["count-support@example.test", [f.w1]],
    ["count-empty@example.test", []],
  ] as const) {
    f.app.identity.createUser(f.actor, email, {
      email,
      name: "Synthetic count support",
      password: "long-test-only-password",
      role: "support",
      sites: [...sites],
    });
  }
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3164" });
  await http.listen({ host: "127.0.0.1", port: 3164 });
  return http;
}
