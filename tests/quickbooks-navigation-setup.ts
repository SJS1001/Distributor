import { fixture, chooseProviders } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { QuickBooksBrowser } from "../src/server/quickbooks-browser.ts";
import { organizationQuickBooksBrowser } from "./organization-quickbooks-browser-fixture.ts";

// The standard browser server's synthetic OAuth/revocation transport. Every
// unrecognized endpoint throws; no real provider request can leave this setup.
export default async function setup() {
  const cleanup: (() => void)[] = [];
  const servers: { close: () => Promise<void> }[] = [];
  const previousFetch = globalThis.fetch;
  const teardown = async () => {
    try {
      await Promise.all(servers.map((server) => server.close()));
    } finally {
      globalThis.fetch = previousFetch;
      for (const fn of cleanup.reverse()) fn();
    }
  };
  try {
    const authorizationFixture = fixture(
      { after: (fn) => cleanup.push(fn) },
      {
        providerEncryptionKey: "ac".repeat(32),
      },
    );
    chooseProviders(
      authorizationFixture,
      authorizationFixture.actor,
      "browser-oauth-choice",
      {
        accountId: authorizationFixture.buyer,
        region: "CA",
        mode: "provider-exceptions",
        providers: ["quickbooks"],
        version: 1,
        acknowledgment: "Synthetic browser processing choice",
      },
    );
    globalThis.fetch = async (url, init) => {
      if (
        String(url) ===
          "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer" &&
        init?.method === "POST"
      )
        return Response.json({
          access_token: "synthetic-browser-access",
          refresh_token: "synthetic-browser-refresh",
          token_type: "bearer",
          expires_in: 3600,
          x_refresh_token_expires_in: 86400,
          x_refresh_token_hard_expires_in: 172800,
        });
      if (
        String(url) ===
        "https://sandbox-quickbooks.api.intuit.com/v3/company/1234/companyinfo/1234"
      )
        return Response.json({ CompanyInfo: { Id: "1234" } });
      if (
        String(url) ===
          "https://developer.api.intuit.com/v2/oauth2/tokens/revoke" &&
        init?.method === "POST"
      ) {
        const token = JSON.parse(String(init.body)).token;
        if (
          ![7, 8, 9, 10, 11, 12, 13, 14].some(
            (n) => token === `synthetic-org-browser-revoke-${n}`,
          )
        )
          throw Error("Synthetic revocation token differs");
        if (
          token === "synthetic-org-browser-revoke-9" ||
          token === "synthetic-org-browser-revoke-10"
        )
          throw Error("Synthetic unknown provider response");
        return new Response(null, { status: 200 });
      }
      throw Error(
        "Browser fixture permits only synthetic authorization endpoints.",
      );
    };
    const authorizationOrigin = "http://127.0.0.1:3119";
    const authorizationHttp = await createHttp(authorizationFixture.app, {
      origin: authorizationOrigin,
      quickbooksBrowser: new QuickBooksBrowser(
        authorizationFixture.app,
        {
          id: "synthetic-browser-authorization",
          orgId: authorizationFixture.actor.orgId,
          workerUserId: authorizationFixture.actor.id,
          accountId: authorizationFixture.buyer,
          realm: "1234",
          clientId: "synthetic-client",
          redirectUri: `${authorizationOrigin}/quickbooks/callback`,
        },
        "synthetic-browser-client-secret",
        authorizationOrigin,
      ),
    });
    servers.push(authorizationHttp);
    await authorizationHttp.listen({ host: "127.0.0.1", port: 3119 });

    servers.push(
      ...(await organizationQuickBooksBrowser((fn) => cleanup.push(fn))),
    );
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
