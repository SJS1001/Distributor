import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
let app: Application,
  input: {
    path: string;
    actor: Actor;
    packet: { id: string; reviewHash: string };
  };
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message;
    app = new Application(input.path);
    process.send?.({ ready: true });
  } else if (message.action === "go") {
    try {
      const value = app.integration.costs.decide(input.actor, message.key, {
        packetId: input.packet.id,
        reviewHash: input.packet.reviewHash,
        decision: "approve",
        reason: "Synthetic competing finance review",
      });
      process.send?.({ ok: true, value });
    } catch (error: any) {
      process.send?.({ ok: false, code: error.code });
    } finally {
      app.close();
      process.disconnect();
    }
  }
});
