import {
  replacementCarrierFixture,
  replacementAdapter,
} from "./replacement-carrier-fixture.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "./browser-http.ts";

// Local synthetic transport only; no carrier endpoint or device is contacted.
export async function replacementCarrierBrowser(
  after: (fn: () => void) => void,
) {
  const f = replacementCarrierFixture({ after });
  const http = await createHttp(f.app, {
    origin: "http://127.0.0.1:3133",
    carriers: new CarrierRuntime(f.app, [
      { orgId: f.actor.orgId, adapter: replacementAdapter() },
    ]),
  });
  await http.listen({ host: "127.0.0.1", port: 3133 });
  return http;
}
