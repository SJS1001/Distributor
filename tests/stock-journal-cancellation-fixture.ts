// Synthetic final non-posting attestation, never a provider verification.
import { journalFixture } from "./stock-journal-fixture.ts";
import { outcomeInput } from "./cost-correction-fixture.ts";
export function cancellationFixture(
  t: Parameters<typeof journalFixture>[0],
  region: "CA" | "US" = "CA",
  proof = true,
) {
  const fixture = journalFixture(t, region, true),
    { f, j, c, approve, selected, reviewer } = fixture;
  const journal = approve(),
    lease = j.claim(f.actor, journal.id, "write")!;
  j.beforeWrite(lease);
  j.unresolved(lease, "transport-uncertain");
  if (proof)
    c.observe(
      reviewer,
      "cancellation-proof",
      outcomeInput(f, selected.id, "reversal", {
        outcome: "cancelled-unposted",
        externalRef: "synthetic-cancelled-reversal",
        evidence:
          "Synthetic independently checked final cancellation and non-posting",
      }),
    );
  return { ...fixture, journal };
}
