import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import {
  manifestClient,
  manifestObservation,
} from "./canada-post-manifest-fixture.ts";
process.once(
  "message",
  async (message: {
    path: string;
    actor: Actor;
    groupId: string;
    reviewHash: string;
  }) => {
    const app = new Application(message.path),
      c = manifestClient();
    c.transmitManifest = async (input, guard) => {
      guard();
      process.send?.({ claimed: true });
      await new Promise<void>((resolve) =>
        process.once("message", () => resolve()),
      );
      return manifestObservation(input);
    };
    try {
      await app.carriers.transmitCanadaPostManifest(
        message.actor,
        message.groupId,
        message.reviewHash,
        c,
      );
      process.send?.({ ok: true });
    } catch (error) {
      process.send?.({ ok: false, code: (error as { code?: string }).code });
    } finally {
      app.close();
      process.disconnect();
    }
  },
);
