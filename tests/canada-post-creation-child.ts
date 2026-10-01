import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import { client, observation } from "./canada-post-creation-fixture.ts";
process.once(
  "message",
  async (message: {
    path: string;
    actor: Actor;
    groupId: string;
    bookingId: string;
  }) => {
    const app = new Application(message.path),
      c = client();
    c.create = async (intent, groupId, guard) => {
      guard();
      process.send?.({ claimed: true });
      await new Promise<void>((resolve) => {
        process.once("message", () => resolve());
      });
      return observation(intent, groupId);
    };
    try {
      await app.carriers.createCanadaPostMember(
        message.actor,
        message.groupId,
        message.bookingId,
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
