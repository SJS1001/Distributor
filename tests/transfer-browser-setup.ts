import { transferArrivalBrowser } from "./transfer-arrival-browser-fixture.ts";
import { transferDispatchBrowser } from "./transfer-dispatch-browser-fixture.ts";
import { transferLossBrowser } from "./transfer-loss-browser-fixture.ts";

import { transferQueueBrowser } from "./transfer-queue-browser-fixture.ts";

// Start only the fixtures these journeys need; no CI or external providers.
export default async function setup() {
  const cleanup: (() => void)[] = [];
  const servers: { close: () => Promise<void> }[] = [];
  const teardown = async () => {
    try {
      await Promise.all(servers.map((server) => server.close()));
    } finally {
      for (const fn of cleanup.reverse()) fn();
    }
  };
  try {
    for (const start of [
      transferQueueBrowser,
      transferArrivalBrowser,
      transferDispatchBrowser,
      transferLossBrowser,
    ]) {
      servers.push(await start((fn) => cleanup.push(fn)));
    }
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
