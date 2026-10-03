import { check, DomainError } from "./core.ts";
import type { Application } from "./application.ts";
import type { OrganizationAuthorizationBinding } from "./organization-authorization.ts";
import type { LedgerAuthority } from "./organization-residency.ts";

// Fixed organization configuration, independent of all buyer bindings. Browser
// requests supply reviewed permission, never company/client/worker/secret choices.
export class OrganizationQuickBooksBrowser {
  private readonly binding: OrganizationAuthorizationBinding;
  constructor(
    private app: Application,
    binding: OrganizationAuthorizationBinding,
    private clientSecret: string,
    origin: string,
  ) {
    this.binding = Object.freeze({ ...binding });
    let browserOrigin: URL;
    try {
      browserOrigin = new URL(origin);
    } catch {
      throw new DomainError(
        "OAUTH_CONFIG",
        "Configure an exact browser origin.",
        500,
      );
    }
    check(
      origin === browserOrigin.origin &&
        (browserOrigin.protocol === "https:" ||
          (browserOrigin.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(
              browserOrigin.hostname,
            ))),
      "OAUTH_CONFIG",
      "Use an exact HTTPS or loopback browser origin.",
      500,
    );
    check(
      binding.redirectUri ===
        `${browserOrigin.origin}/quickbooks/organization/callback`,
      "OAUTH_CONFIG",
      "Organization authorization requires this origin's exact /quickbooks/organization/callback URI.",
      500,
    );
    check(
      /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
      "OAUTH_CONFIG",
      "Configure a valid confidential-client secret.",
      500,
    );
    app.identity.workerActor(binding.orgId, binding.workerUserId);
    app.providerCredentials.ledger.status(this.binding);
  }
  status(token: string) {
    return this.app.providerCredentials.ledger.authorization.browserStatus(
      this.binding,
      token,
    );
  }
  begin(token: string, revision: number, authority: LedgerAuthority) {
    return this.app.providerCredentials.ledger.authorization.begin(
      this.binding,
      revision,
      authority,
      token,
    );
  }
  cancel(token: string, attemptId: string) {
    return this.app.providerCredentials.ledger.authorization.cancel(
      this.binding,
      attemptId,
      token,
    );
  }
  disconnect(token: string, revision: number) {
    return this.app.providerCredentials.ledger.authorization.disconnect(
      this.binding,
      token,
      revision,
    );
  }
  revoke(
    token: string,
    receiptId: string,
    revision: number,
    authority: LedgerAuthority,
  ) {
    return this.app.providerCredentials.ledger.revocation.revoke(
      this.binding,
      receiptId,
      revision,
      authority,
      this.clientSecret,
      token,
    );
  }
  revocationStatus(token: string, receiptId: string) {
    return this.app.providerCredentials.ledger.revocation.status(
      this.binding,
      receiptId,
      token,
    );
  }
  reviewRevocation(
    token: string,
    receiptId: string,
    revision: number,
    resolution: "provider-confirmed" | "provider-unconfirmed",
    evidence: string,
  ) {
    return this.app.providerCredentials.ledger.revocation.review(
      this.binding,
      receiptId,
      revision,
      resolution,
      evidence,
      token,
    );
  }
  complete(token: string, attemptId: string, callbackUrl: string) {
    return this.app.providerCredentials.ledger.authorization.complete(
      this.binding,
      attemptId,
      this.clientSecret,
      callbackUrl,
      token,
    );
  }
}
export function configuredOrganizationQuickBooksBrowser(
  app: Application,
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.QUICKBOOKS_LEDGER_BROWSER_AUTH_ENABLED !== "true") return undefined;
  check(
    env.PROVIDERS_ENABLED === "true",
    "OAUTH_CONFIG",
    "Organization browser authorization requires explicitly enabled provider access.",
    500,
  );
  const required = (name: string) => {
    check(env[name], "OAUTH_CONFIG", `Missing ${name}.`, 500);
    return env[name]!;
  };
  return new OrganizationQuickBooksBrowser(
    app,
    {
      id: required("LEDGER_PROVIDER_BINDING_ID"),
      orgId: required("LEDGER_PROVIDER_ORG_ID"),
      workerUserId: required("LEDGER_PROVIDER_WORKER_USER_ID"),
      realm: required("LEDGER_QUICKBOOKS_REALM_ID"),
      clientId: required("LEDGER_QUICKBOOKS_CLIENT_ID"),
      redirectUri: required("LEDGER_QUICKBOOKS_REDIRECT_URI"),
    },
    required("LEDGER_QUICKBOOKS_CLIENT_SECRET"),
    origin,
  );
}
