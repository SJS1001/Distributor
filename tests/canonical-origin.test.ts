import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { installCanonicalOrigin } from "../src/server/canonical-origin.ts";

test("only configured navigation aliases redirect to the fixed canonical origin", async () => {
  const http = Fastify();
  installCanonicalOrigin(http, "https://dstrbtr.ca", [
    "www.dstrbtr.ca",
    "pilot.fly.dev",
  ]);
  http.all("/*", async () => ({ reached: true }));
  try {
    const redirected = await http.inject({
      url: "/apply?q=1",
      headers: { host: "www.dstrbtr.ca" },
    });
    assert.equal(redirected.statusCode, 308);
    assert.equal(redirected.headers.location, "https://dstrbtr.ca/apply?q=1");
    for (const request of [
      { url: "/", headers: { host: "dstrbtr.ca" } },
      { url: "/", headers: { host: "evil.example" } },
      { url: "/api/health", headers: { host: "pilot.fly.dev" } },
      {
        method: "POST" as const,
        url: "/apply",
        headers: { host: "pilot.fly.dev" },
      },
    ])
      assert.equal((await http.inject(request)).statusCode, 200);
    const tricky = await http.inject({
      url: "//evil.example/path",
      headers: { host: "pilot.fly.dev" },
    });
    assert.equal(
      new URL(String(tricky.headers.location)).origin,
      "https://dstrbtr.ca",
    );
  } finally {
    await http.close();
  }
});
