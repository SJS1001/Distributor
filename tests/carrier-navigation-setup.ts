import { canadaPostBrowser } from "./canada-post-browser-fixture.ts";
import { dhlBrowser } from "./dhl-warehouse-fixture.ts";
import { configurationBrowser } from "./carrier-configuration-browser-fixture.ts";
import { claimBrowser } from "./carrier-claim-browser-fixture.ts";
import { replacementCarrierBrowser } from "./replacement-carrier-browser-fixture.ts";
import { shipmentCoverageBrowser } from "./shipment-coverage-browser-fixture.ts";

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
      canadaPostBrowser,
      configurationBrowser,
      claimBrowser,
      replacementCarrierBrowser,
      shipmentCoverageBrowser,
    ])
      servers.push(await start((fn) => cleanup.push(fn)));
    servers.push(...(await dhlBrowser((fn) => cleanup.push(fn))));
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
