import { customerPricingBrowser } from "./customer-pricing-browser-fixture.ts";
const cleanup: (() => void)[] = [];
const http = await customerPricingBrowser((fn) => cleanup.push(fn));
async function stop() {
  await http.close();
  cleanup.forEach((fn) => fn());
  process.exit(0);
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
