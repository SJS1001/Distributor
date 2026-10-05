import { cartRecoveryBrowser } from "./cart-recovery-browser-fixture.ts";
import { claimQueueBrowser } from "./claim-queue-browser-fixture.ts";
import { coveragePolicyBrowser } from "./coverage-policy-browser-fixture.ts";
import { customerPricingBrowser } from "./customer-pricing-browser-fixture.ts";
import { operationsHealthBrowser } from "./operations-health-browser-fixture.ts";
import { orderQueueBrowser } from "./order-queue-browser-fixture.ts";
import { reconciliationBrowser } from "./reconciliation-browser-fixture.ts";
import { retiredReceivingBrowser } from "./retired-receiving-browser-fixture.ts";

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
      cartRecoveryBrowser,
      claimQueueBrowser,
      coveragePolicyBrowser,
      customerPricingBrowser,
      operationsHealthBrowser,
      orderQueueBrowser,
      reconciliationBrowser,
      retiredReceivingBrowser,
    ])
      servers.push(await start((fn) => cleanup.push(fn)));
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}
