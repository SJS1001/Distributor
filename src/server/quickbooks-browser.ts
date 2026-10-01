import { check } from "./core.ts";
import type { Application } from "./application.ts";
import type { AuthorizationBinding } from "./quickbooks-authorization.ts";

// Fixed server configuration. Browser requests cannot choose a company, customer,
// worker, redirect, client, environment or secret.
export class QuickBooksBrowser {
  private readonly binding: AuthorizationBinding;
  constructor(
    private app: Application,
    binding: AuthorizationBinding,
    private clientSecret: string,
    origin: string,
  ) {
    this.binding = { ...binding };
    check(
      binding.redirectUri === `${new URL(origin).origin}/quickbooks/callback`,
      "OAUTH_CONFIG",
      "Browser authorization requires this origin's exact /quickbooks/callback URI.",
      500,
    );
    check(
      /^[\x21-\x7e]{1,8192}$/.test(clientSecret),
      "OAUTH_CONFIG",
      "Configure a valid confidential-client secret.",
      500,
    );
    check(
      app.providerCredentials.available,
      "CREDENTIAL_KEY",
      "Provider encryption key is unavailable.",
      500,
    );
    app.identity.workerActor(binding.orgId, binding.workerUserId);
    app.providerCredentials.status(binding);
  }
  status(token: string) {
    return this.app.providerCredentials.authorization.browserStatus(
      this.binding,
      token,
    );
  }
  begin(token: string, revision: number) {
    return this.app.providerCredentials.authorization.begin(
      this.binding,
      revision,
      token,
    );
  }
  disconnect(token: string, revision: number) {
    return this.app.providerCredentials.authorization.disconnect(
      this.binding,
      token,
      revision,
    );
  }
  cancel(token: string, attemptId: string) {
    return this.app.providerCredentials.authorization.cancel(
      this.binding,
      attemptId,
      token,
    );
  }
  complete(token: string, attemptId: string, callbackUrl: string) {
    return this.app.providerCredentials.authorization.complete(
      this.binding,
      attemptId,
      this.clientSecret,
      callbackUrl,
      token,
    );
  }
}

export function configuredQuickBooksBrowser(
  app: Application,
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.QUICKBOOKS_BROWSER_AUTH_ENABLED !== "true") return undefined;
  check(
    env.PROVIDERS_ENABLED === "true" &&
      env.QUICKBOOKS_CREDENTIAL_MODE === "managed",
    "OAUTH_CONFIG",
    "Browser authorization requires explicitly enabled managed provider access.",
    500,
  );
  const required = (name: string) => {
    check(env[name], "OAUTH_CONFIG", `Missing ${name}.`, 500);
    return env[name]!;
  };
  return new QuickBooksBrowser(
    app,
    {
      id: required("PROVIDER_BINDING_ID"),
      orgId: required("PROVIDER_ORG_ID"),
      workerUserId: required("PROVIDER_WORKER_USER_ID"),
      realm: required("QUICKBOOKS_REALM_ID"),
      clientId: required("QUICKBOOKS_CLIENT_ID"),
      accountId: required("PROVIDER_ACCOUNT_ID"),
      redirectUri: required("QUICKBOOKS_REDIRECT_URI"),
    },
    required("QUICKBOOKS_CLIENT_SECRET"),
    origin,
  );
}
