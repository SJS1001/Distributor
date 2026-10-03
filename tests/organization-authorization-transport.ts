import assert from "node:assert/strict";

// Synthetic child-process HTTP boundary. Never allow a real provider request.
let calls = 0;
globalThis.fetch = async (url, init) => {
  calls++;
  const headers = new Headers(init?.headers);
  if (calls === 1) {
    assert.equal(
      String(url),
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    );
    assert.equal(init?.method, "POST");
    assert.equal(
      headers.get("authorization"),
      `Basic ${Buffer.from("synthetic-client:synthetic-secret").toString("base64")}`,
    );
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "synthetic-code");
    assert.equal(
      body.get("redirect_uri"),
      "http://127.0.0.1:3000/organization-callback",
    );
    return Response.json({
      access_token: "synthetic-org-access",
      refresh_token: "synthetic-org-refresh",
      token_type: "bearer",
      expires_in: 3600,
      x_refresh_token_expires_in: 8640000,
    });
  }
  assert.equal(calls, 2);
  assert.equal(
    String(url),
    "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234",
  );
  assert.equal(init?.method, "GET");
  assert.equal(headers.get("authorization"), "Bearer synthetic-org-access");
  return Response.json({ CompanyInfo: { Id: "1234" } });
};
process.on("beforeExit", () => {
  assert.equal(calls, Number(process.env.SYNTHETIC_EXPECT_REQUESTS));
});
