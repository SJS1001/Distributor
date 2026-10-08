import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { createHttp } from "./browser-http.ts";
import { createHttp as productionHttp } from "../src/server/http.ts";

test("loopback browser fixture removes only the TLS upgrade directive", async (t) => {
  const f = fixture(t);
  const options = { origin: "http://127.0.0.1:3999" };
  const browser = await createHttp(f.app, options);
  const production = await productionHttp(f.app, options);
  t.after(() => browser.close());
  t.after(() => production.close());
  const expected = await production.inject({ url: "/api/health" });
  const actual = await browser.inject({ url: "/api/health" });
  const policy = String(expected.headers["content-security-policy"]);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.equal(
    actual.headers["content-security-policy"],
    policy.replace(/upgrade-insecure-requests;?/g, ""),
  );
  for (const header of [
    "x-frame-options",
    "x-content-type-options",
    "strict-transport-security",
  ])
    assert.equal(actual.headers[header], expected.headers[header]);
  for (const origin of ["https://127.0.0.1:3999", "http://example.test"])
    await assert.rejects(createHttp(f.app, { origin }), /loopback HTTP/);
});
