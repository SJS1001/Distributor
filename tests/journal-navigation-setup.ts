import { stockJournalBrowser } from "./stock-journal-browser-fixture.ts";
import { costCorrectionSuccessorBrowser } from "./cost-correction-successor-browser-fixture.ts";

// Existing synthetic accounting fixtures only; no provider transport or CI.
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
    servers.push(await stockJournalBrowser((fn) => cleanup.push(fn)));
    servers.push(
      ...(await costCorrectionSuccessorBrowser((fn) => cleanup.push(fn))),
    );
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
