import { invoiceQueueBrowser } from "./invoice-queue-browser-fixture.ts";
import { pdfBoundaryBrowser } from "./pdf-browser-fixture.ts";
import { costCorrectionBrowser } from "./cost-correction-browser-fixture.ts";

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
      invoiceQueueBrowser,
      pdfBoundaryBrowser,
      costCorrectionBrowser,
    ]) {
      servers.push(await start((fn) => cleanup.push(fn)));
    }
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
