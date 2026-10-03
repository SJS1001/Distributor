// Synthetic frozen journals only. No receiver transport or actual finance evidence.
import { journalFixture } from "./stock-journal-fixture.ts";
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
