import { stockQueueBrowser } from "./stock-queue-browser-fixture.ts";
import { countQueueBrowser } from "./count-queue-browser-fixture.ts";

import { stockHistoryBrowser } from "./stock-history-browser-fixture.ts";

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
      stockQueueBrowser,
      countQueueBrowser,
      stockHistoryBrowser,
    ]) {
      servers.push(await start((fn) => cleanup.push(fn)));
    }
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
