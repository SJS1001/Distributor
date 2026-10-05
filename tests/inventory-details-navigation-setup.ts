import { serialDossierBrowser } from "./serial-dossier-browser-fixture.ts";
import { binRelocationBrowser } from "./bin-relocation-browser-fixture.ts";
import { countPolicyBrowser } from "./count-policy-browser-fixture.ts";
import { countRecoveryBrowser } from "./count-recovery-browser-fixture.ts";
import { inventoryValuationBrowser } from "./inventory-valuation-browser-fixture.ts";

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
      serialDossierBrowser,
      binRelocationBrowser,
      countPolicyBrowser,
      countRecoveryBrowser,
      inventoryValuationBrowser,
    ]) {
      servers.push(await start((fn) => cleanup.push(fn)));
    }
    servers.push(
      await inventoryValuationBrowser((fn) => cleanup.push(fn), 3292, "USD"),
    );
    // The quantity suite owns its three region/currency fixture servers.
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
