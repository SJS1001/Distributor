// Synthetic frozen journals only. No receiver transport or actual finance evidence.
import { journalFixture, postedResult } from "./stock-journal-fixture.ts";
import { createHttp } from "../src/server/http.ts";
import { policy } from "./cost-correction-fixture.ts";
import { cancellationFixture } from "./stock-journal-cancellation-fixture.ts";

export async function stockJournalBrowser(after: (fn: () => void) => void) {
  const queue = journalFixture({ after });
  for (let i = 0; i < 25; i++) {
    const ready = queue.j.prepare(
      queue.f.actor,
      `browser-prepare-${i}`,
      queue.make(),
    );
    queue.j.decide(queue.reviewer, `browser-reject-${i}`, {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "reject",
      reason: "Synthetic previous review",
    });
  }
  queue.j.prepare(queue.f.actor, "browser-ready", queue.make());
  const history = journalFixture({ after }, "US"),
    approved = history.approve();
  for (let i = 0; i < 26; i++)
    history.j.unresolved(
      history.j.claim(history.f.actor, approved.id, i ? "lookup" : "write")!,
      "transport-uncertain",
    );
  const reconciliations = [];
  for (let n = 0; n < 9; n++) {
    const reconciliation = journalFixture(
      { after },
      n === 1 ? "US" : "CA",
      false,
      ["2026-10-01", "2026-10-02", "2026-10-03"],
      n === 3 ? "USD" : undefined,
    );
    for (const [i, date] of [
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ].entries()) {
      if (n === 3) continue;
      const journal = reconciliation.approve(
        { ...reconciliation.make(), postingDate: date },
        `browser-date-${i}`,
      );
      if (n === 2 && i === 2) continue;
      const lease = reconciliation.j.claim(
        reconciliation.f.actor,
        journal.id,
        "write",
      )!;
      reconciliation.j.beforeWrite(lease);
      reconciliation.j.posted(lease, postedResult(lease, String(500 + i)));
    }
    reconciliations.push([reconciliation.f.app, 3187 + n] as const);
  }
  const servers: Awaited<ReturnType<typeof createHttp>>[] = [];
  const cancellationCA = cancellationFixture({ after });
  const cancellationUS = cancellationFixture({ after }, "US");
  const preparationCA = journalFixture({ after }),
    preparationUS = journalFixture({ after }, "US"),
    preparationDates = journalFixture({ after }, "CA", false, [
      "2026-10-01",
      "2026-10-01",
      "2026-10-03",
    ]),
    preparationCorrection = journalFixture({ after }, "CA", true),
    preparationWithdrawal = journalFixture({ after });
  preparationDates.c.configure(preparationDates.f.actor, "closed-first-date", {
    ...policy(1),
    closedThrough: "2026-10-01",
  });
  const permissions = [];
  for (let n = 0; n < 10; n++) {
    const p = journalFixture({ after }, n === 1 ? "US" : "CA"),
      approved = p.approve();
    if (n === 1)
      p.j.unresolved(
        p.j.claim(p.f.actor, approved.id, "write")!,
        "transport-uncertain",
      );
    const r = p.f.app.identity.organizationResidency,
      current = r.current(p.f.actor);
    r.choose(p.f.actor, "browser-renewed-choice", {
      region: p.f.app.identity.region,
      revision: current.choice.revision,
      mode: "provider-exception",
      realm: "12345",
      acknowledgment: "Synthetic renewed ledger choice",
      acceptance: {
        disclosureId: current.terms!.id,
        disclosureHash: current.terms!.hash,
        representative: "Synthetic finance",
        evidenceRef: "synthetic:browser-choice",
      },
    });
    if (n === 1 || n === 9) {
      const v = p.j.permissionReview(p.f.actor, approved.id);
      for (let i = 0; i < (n === 9 ? 22 : 1); i++) {
        const review = p.j.preparePermission(
          p.f.actor,
          `browser-permission-review-${i}`,
          {
            journalId: approved.id,
            reviewHash: approved.reviewHash,
            previousPermissionHash: v.previousPermissionHash,
            authority: v.authority,
            mode: v.mode,
            reason: `Synthetic retained permission review ${i}`,
          },
        );
        if (n === 9 && i < 21)
          p.j.decidePermission(p.reviewer, `browser-permission-reject-${i}`, {
            journalId: approved.id,
            permissionReviewId: review.id,
            permissionReviewHash: review.reviewHash,
            decision: "reject",
            reason: "Synthetic historical separate rejection",
          });
      }
    }
    permissions.push([p.f.app, 3177 + n] as const);
  }
  for (const [app, port] of [
    [queue.f.app, 3168],
    [history.f.app, 3169],
    [cancellationCA.f.app, 3170],
    [cancellationUS.f.app, 3171],
    [preparationCA.f.app, 3172],
    [preparationUS.f.app, 3173],
    [preparationDates.f.app, 3174],
    [preparationCorrection.f.app, 3175],
    [preparationWithdrawal.f.app, 3176],
    ...permissions,
    ...reconciliations,
  ] as const) {
    const http = await createHttp(app, { origin: `http://127.0.0.1:${port}` });
    await http.listen({ host: "127.0.0.1", port });
    servers.push(http);
  }
  return {
    close: async () => {
      for (const http of servers) await http.close();
    },
  };
}
