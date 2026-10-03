import assert from "node:assert/strict";
// Intercept every child-process provider request; this seam never uses the network.
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(
    String(url),
    "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  );
  assert.equal(options?.method, "POST");
  assert.equal(options?.redirect, "error");
  assert.equal(
    new Headers(options?.headers).get("Authorization"),
    "Basic " +
      Buffer.from("synthetic-client:synthetic-secret").toString("base64"),
  );
  assert.deepEqual(JSON.parse(String(options?.body)), {
    token: "synthetic-org-refresh",
  });
  return new Response(
    process.env.SYNTHETIC_RESPONSE === "failure"
      ? "sensitive-provider-body"
      : "",
    { status: process.env.SYNTHETIC_RESPONSE === "failure" ? 500 : 200 },
  );
};
process.on("beforeExit", () =>
  assert.equal(calls, Number(process.env.SYNTHETIC_EXPECT_REQUESTS ?? "0")),
);
