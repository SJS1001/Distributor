import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

const cleanup: (() => void)[] = [];
const f = fixture({ after: (fn) => cleanup.push(fn) });
const origin = "http://127.0.0.1:3000";
const http = await createHttp(f.app, {
  origin,
  logger: true,
  staticRoot: "/missing-browser-build",
});
try {
  const session = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const callbackUrl =
    `${origin}/quickbooks/callback?code=synthetic-log-code` +
    "&state=synthetic-log-state&realmId=1234";
  const landing = await http.inject({
    url: callbackUrl,
    headers: {
      cookie: "distributor_session=synthetic-log-cookie",
      authorization: "Basic synthetic-log-basic",
    },
  });
  assert.equal(landing.statusCode, 503);
  const complete = await http.inject({
    method: "POST",
    url: "/api/quickbooks/authorization/complete",
    headers: {
      origin,
      cookie: `distributor_session=${session.token}`,
      "x-csrf-token": session.csrf,
      authorization: "Basic synthetic-log-basic",
    },
    payload: { attemptId: "synthetic-attempt", callbackUrl },
  });
  assert.equal(complete.statusCode, 503);
} finally {
  await http.close();
  for (const fn of cleanup.reverse()) fn();
}
