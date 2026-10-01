import {
  configurationFixture,
  clients,
} from "./carrier-configuration-fixture.ts";
import { DomainError } from "../src/server/core.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "../src/server/http.ts";

// Pure constructor metadata and a synthetic guarded lost response. No provider
// transport is installed or called by this independent browser database.
export async function configurationBrowser(after: (fn: () => void) => void) {
  const f = configurationFixture({ after });
  const configuration = new clients.usps(f.usps).configuration;
  const http = await createHttp(f.app, {
    origin: "http://127.0.0.1:3122",
    carriers: new CarrierRuntime(f.app, [
      {
        orgId: f.actor.orgId,
        adapter: {
          provider: "usps",
          sandbox: true,
          configuration,
          async book(_intent, guard) {
            guard();
            throw new DomainError(
              "CARRIER_TRANSPORT",
              "Synthetic lost USPS label response",
              502,
            );
          },
          async lookup() {
            throw new DomainError(
              "CARRIER_RECOVERY_UNSUPPORTED",
              "Synthetic read-only label recovery unavailable",
            );
          },
        },
      },
    ]),
  });
  await http.listen({ host: "127.0.0.1", port: 3122 });
  return http;
}
