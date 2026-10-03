// Dedicated synthetic organization authority, independent of buyer credentials.
import { fixture, syntheticDisclosure } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import { OrganizationQuickBooksBrowser } from "../src/server/organization-quickbooks-browser.ts";

export async function organizationQuickBooksBrowser(
  after: (fn: () => void) => void,
) {
  const servers: Awaited<ReturnType<typeof createHttp>>[] = [];
  for (let n = 0; n < 15; n++) {
    const region = n === 1 || n === 8 ? "US" : "CA";
    const f = fixture(
      { after },
      { providerEncryptionKey: "ab".repeat(32) },
      region,
    );
    const r = f.app.identity.organizationResidency;
    const { provider: _provider, ...terms } = syntheticDisclosure(
      f.app,
      "quickbooks",
    );
    r.publish(f.actor, "browser-org-terms", terms);
    const current = r.current(f.actor);
    if (n !== 2)
      r.choose(f.actor, "browser-org-choice", {
        region,
        revision: current.choice.revision,
        mode: "provider-exception",
        realm: "1234",
        acknowledgment: "Synthetic reviewed organization choice",
        acceptance: {
          disclosureId: current.terms!.id,
          disclosureHash: current.terms!.hash,
          representative: "Synthetic organization representative",
          evidenceRef: "synthetic:organization-choice",
        },
      });
    const origin = `http://127.0.0.1:${3220 + n}`;
    const binding = {
      id: "synthetic-org-browser",
      orgId: f.actor.orgId,
      workerUserId: f.actor.id,
      realm: "1234",
      clientId: "synthetic-client",
      redirectUri: `${origin}/quickbooks/organization/callback`,
    };
    if (n >= 7) {
      f.app.providerCredentials.ledger.install(
        binding,
        0,
        {
          accessToken: `synthetic-org-browser-access-${n}`,
          refreshToken: `synthetic-org-browser-revoke-${n}`,
          accessExpiresAt: Date.now() + 3600000,
          refreshExpiresAt: Date.now() + 86400000,
        },
        r.permission(f.actor, binding.realm),
      );
      f.app.identity.createUser(f.actor, "browser-revocation-finance", {
        email: "finance@example.test",
        name: "Synthetic finance",
        password: "long-test-only-password",
        role: "finance",
        sites: [],
      });
    }
    const http = await createHttp(f.app, {
      origin,
      organizationQuickbooksBrowser: new OrganizationQuickBooksBrowser(
        f.app,
        binding,
        "synthetic-org-client-secret",
        origin,
      ),
    });
    await http.listen({ host: "127.0.0.1", port: 3220 + n });
    servers.push(http);
  }
  return servers;
}
