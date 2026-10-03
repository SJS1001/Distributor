import { configuredMfaRoles } from "./mfa-policy.ts";
import { Application } from "./application.ts";
import { configuredEventReports } from "./report-runtime.ts";
import { createHttp } from "./http.ts";
import { check } from "./core.ts";
import { type Region } from "./iam.ts";
import { configuredProviders } from "./provider-runtime.ts";
import { configuredOrganizationQuickBooksBrowser } from "./organization-quickbooks-browser.ts";
import { configuredQuickBooksBrowser } from "./quickbooks-browser.ts";
import { configuredCarriers } from "./carrier-config.ts";
const host = process.env.HOST ?? "127.0.0.1",
  port = Number(process.env.PORT ?? 3000),
  origin = process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`,
  secureCookies = process.env.SECURE_COOKIES === "true";
check(
  Number.isInteger(port) && port > 0 && port <= 65535,
  "CONFIG",
  "Invalid port.",
  500,
);
check(
  ["127.0.0.1", "localhost", "::1"].includes(host) ||
    (secureCookies && new URL(origin).protocol === "https:"),
  "CONFIG",
  "Non-loopback deployment requires HTTPS origin and secure cookies.",
  500,
);
const app = new Application(
  process.env.DATABASE_PATH ?? "local-evidence/distributor.db",
  (process.env.DATA_REGION ?? "CA") as Region,
  {
    eventReports: configuredEventReports(),
    mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY,
    mfaRequiredRoles: configuredMfaRoles(),
    providerEncryptionKey: process.env.PROVIDER_ENCRYPTION_KEY,
  },
);
const organizationQuickbooksBrowser = configuredOrganizationQuickBooksBrowser(
  app,
  origin,
);
const http = await createHttp(app, {
  origin,
  secureCookies,
  providers: configuredProviders(app, process.env, {
    organizationAuthorizationConfigured: !!organizationQuickbooksBrowser,
  }),
  quickbooksBrowser: configuredQuickBooksBrowser(app, origin),
  organizationQuickbooksBrowser,
  carriers: configuredCarriers(app),
});
// Local application maintenance only. Startup also processes one batch; each
// minute erases at most 100 expired enrollment bundles and terminalizes at most
// 100 expired/interrupted OAuth attempts per scope. No cleanup makes provider I/O.
const localMaintenance = setInterval(() => {
  try {
    app.identity.mfa.purgeExpiredEnrollments();
  } catch {
    process.stderr.write(
      "Authenticator setup cleanup did not complete; retrying next minute.\n",
    );
  }
  try {
    app.providerCredentials.authorization.expireAttempts();
    app.providerCredentials.ledger.authorization.expireAttempts();
  } catch {
    process.stderr.write(
      "QuickBooks authorization cleanup did not complete; retrying next minute.\n",
    );
  }
}, 60000).unref();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    clearInterval(localMaintenance);
    void http.close().finally(() => {
      app.close();
      process.exitCode = 0;
    });
  });
await http.listen({ host, port });
process.stdout.write(
  `Distributor listening at ${origin}; storage region ${app.identity.region}\n`,
);
