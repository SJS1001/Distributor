import {
  setup as canadaPostSetup,
  configurationHash as canadaPostHash,
} from "./canada-post-fixture.ts";
import { client as canadaPostCreation } from "./canada-post-creation-fixture.ts";
import { manifestClient as canadaPostManifest } from "./canada-post-manifest-fixture.ts";
import { CarrierRuntime } from "../src/server/carrier-runtime.ts";
import { createHttp } from "./browser-http.ts";

export async function canadaPostBrowser(after: (fn: () => void) => void) {
  // Independent, strictly synthetic warehouse fixture. Guarded writes deliberately
  // lose their first replies; recovery observes the retained synthetic provider effect.
  const cp = canadaPostSetup({ after }, 23);
  const cpCreation = canadaPostCreation(),
    cpManifest = canadaPostManifest();
  const lostMembers = new Set<string>();
  let manifestLost = false;
  const cpHttp = await createHttp(cp.app, {
    origin: "http://127.0.0.1:3120",
    carriers: new CarrierRuntime(
      cp.app,
      [],
      [
        {
          orgId: cp.actor.orgId,
          warehouseId: cp.w1,
          client: {
            testApplication: true,
            configurationHash: canadaPostHash,
            async create(intent, groupId, guard) {
              const observation = await cpCreation.create(
                intent,
                groupId,
                guard,
              );
              if (!lostMembers.has(intent.bookingId)) {
                lostMembers.add(intent.bookingId);
                throw Error("Synthetic lost creation reply");
              }
              return observation;
            },
            lookup: cpCreation.lookup.bind(cpCreation),
            manifestIdentity: cpManifest.manifestIdentity.bind(cpManifest),
            async transmitManifest(input, guard) {
              const observation = await cpManifest.transmitManifest(
                input,
                guard,
              );
              if (!manifestLost) {
                manifestLost = true;
                throw Error("Synthetic lost manifest reply");
              }
              return observation;
            },
            recoverManifest: cpManifest.recoverManifest.bind(cpManifest),
          },
        },
      ],
    ),
  });
  await cpHttp.listen({ host: "127.0.0.1", port: 3120 });
  return cpHttp;
}
