import { useEffect, useState } from "react";

/** Only the isolated demo gateway exposes this control endpoint. */
export function DemoNotice() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/demo/api/status", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (
          response.ok &&
          response.headers.get("X-Distributor-Demo") === "native"
        ) {
          const status = await response.json();
          if (!controller.signal.aborted) setActive(status.active === true);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return active ? (
    <div
      className="native-demo-notice"
      role="complementary"
      aria-label="Demo workspace"
    >
      <strong>Fictional demo</strong>
      <span>
        Actual application · simulated payments, accounting & shipping · live
        services disabled
      </span>
      <a href="/demo">Switch role or reset demo</a>
    </div>
  ) : null;
}
