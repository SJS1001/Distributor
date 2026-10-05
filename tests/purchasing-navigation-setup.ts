import { purchaseEntryBrowser } from "./purchase-entry-browser-fixture.ts";
import { purchaseQueueBrowser } from "./purchase-queue-browser-fixture.ts";
import { supplierAvailabilityBrowser } from "./supplier-availability-browser-fixture.ts";
import { supplierReturnQueueBrowser } from "./supplier-return-queue-browser-fixture.ts";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";

async function receiptHistoryBrowser(after: (fn: () => void) => void) {
  const f = fixture({ after });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3117" });
  await http.listen({ host: "127.0.0.1", port: 3117 });
  return http;
}

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
      purchaseEntryBrowser,
      purchaseQueueBrowser,
      supplierAvailabilityBrowser,
      supplierReturnQueueBrowser,
      receiptHistoryBrowser,
    ]) {
      servers.push(await start((fn) => cleanup.push(fn)));
    }
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
