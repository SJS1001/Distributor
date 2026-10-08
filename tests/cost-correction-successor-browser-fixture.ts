// Synthetic settled parents only; no provider execution.
import { fixture } from "./fixtures.ts";
import {
  approvedCorrection,
  outcomeInput,
  policy,
} from "./cost-correction-fixture.ts";
import { createHttp } from "./browser-http.ts";
export async function costCorrectionSuccessorBrowser(
  after: (fn: () => void) => void,
) {
  const servers = [];
  for (const [n, region] of (
    ["CA", "US", "CA", "CA", "CA", "CA", "CA", "CA"] as const
  ).entries()) {
    const f = fixture({ after }, {}, region);
    const { c, approved, reviewer } = approvedCorrection(f);
    for (const leg of ["reversal", "replacement"] as const)
      c.observe(
        reviewer,
        `settled-${leg}`,
        outcomeInput(f, approved.id, leg, {
          outcome:
            n === 1 && leg === "replacement"
              ? "cancelled-unposted"
              : n === 2 && leg === "replacement"
                ? "unknown"
                : "posted",
          postingDate:
            (n === 1 && leg === "replacement") ||
            (n === 2 && leg === "replacement")
              ? null
              : "2026-10-03",
          evidence: "Synthetic settled predecessor verification",
        }),
      );
    c.configure(f.actor, "policy-two", {
      ...policy(1),
      ...(n === 7 ? { closedThrough: "2026-10-03" } : {}),
      inventoryAccount: "1202",
      mappings: [{ type: "receipt", offsetAccount: "2102" }],
    });
    const port = 3301 + n;
    const http = await createHttp(f.app, {
      origin: `http://127.0.0.1:${port}`,
    });
    await http.listen({ host: "127.0.0.1", port });
    servers.push(http);
  }
  return servers;
}
