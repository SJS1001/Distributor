// Synthetic frozen journals only. No receiver transport or actual finance evidence.
import { journalFixture } from "./stock-journal-fixture.ts";
import { createHttp } from "../src/server/http.ts";

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
  for (const [app, port] of [
    [queue.f.app, 3168],
    [history.f.app, 3169],
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
