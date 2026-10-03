// Synthetic native journal ownership fixtures. No provider I/O or real finance approval.
import { fixture, syntheticDisclosure } from "./fixtures.ts";
import {
  setup,
  policy,
  input as correctionInput,
} from "./cost-correction-fixture.ts";
import type {
  JournalDeliveryInput,
  JournalLease,
} from "../src/server/stock-journal-delivery.ts";
import { stockJournalReceiver } from "../src/server/stock-journal-delivery.ts";
import type { EffectResult } from "../src/server/integration.ts";
export function journalFixture(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  correction = false,
) {
  const f = fixture(t, { eventReports: false }, region);
  const { original, reviewer } = setup(f),
    c = f.app.integration.costs.corrections;
  c.configure(f.actor, "journal-policy", { ...policy(), closedThrough: null });
  const r = f.app.identity.organizationResidency;
  const { provider: _provider, ...terms } = syntheticDisclosure(
    f.app,
    "quickbooks",
  );
  r.publish(f.actor, "journal-terms", terms);
  const current = r.current(f.actor);
  r.choose(f.actor, "journal-choice", {
    region,
    revision: current.choice.revision,
    mode: "provider-exception",
    realm: "12345",
    acknowledgment: "Synthetic organization exception",
    acceptance: {
      disclosureId: current.terms!.id,
      disclosureHash: current.terms!.hash,
      representative: "Synthetic finance",
      evidenceRef: "synthetic:ledger",
    },
  });
  const authority = r.permission(f.actor, "12345");
  const selected = correction
    ? (() => {
        const ready = c.prepare(f.actor, "journal-correction", {
          ...correctionInput(original),
          receiverRef: stockJournalReceiver("12345"),
        });
        return c.decide(reviewer, "journal-correction-approved", {
          correctionId: ready.id,
          reviewHash: ready.reviewHash,
          decision: "approve",
          reason: "Synthetic separate finance review",
        });
      })()
    : original;
  const file = correction
    ? c.download(f.actor, selected.id)
    : f.app.integration.costs.download(f.actor, original.id);
  const make = (
    leg: JournalDeliveryInput["leg"] = correction ? "reversal" : "original",
    attemptId: string | null = null,
  ): JournalDeliveryInput => {
    const document = JSON.parse(file.bytes),
      rows = leg === "original" ? document.report.journal : document[leg];
    return {
      sourceId: selected.id,
      sourceHash: file.hash,
      leg,
      postingDate: rows[0].date,
      attemptId,
      bindingId: "synthetic-org-binding",
      realm: "12345",
      policyRevision: 1,
      authority,
      accounts: [
        ...new Set<string>(rows.map((row: { account: string }) => row.account)),
      ].map((sourceAccount, i) => ({
        sourceAccount,
        accountId: String(10 + i),
      })),
      reason: "Synthetic exact journal/company/account review",
    };
  };
  const j = f.app.integration.costs.journals;
  const approve = (selection = make(), key = "journal") => {
    const ready = j.prepare(f.actor, key + "-prepare", selection);
    return j.decide(reviewer, key + "-approve", {
      journalId: ready.id,
      reviewHash: ready.reviewHash,
      decision: "approve",
      reason: "Synthetic independent delivery approval",
    });
  };
  return { f, original, reviewer, c, j, make, approve, selected, file };
}
export function postedResult(
  lease: JournalLease,
  reference = "500",
): EffectResult {
  const intent = JSON.parse(lease.effect.payload),
    doc = JSON.parse(intent.source.bytes);
  const rows = (
    intent.leg === "original" ? doc.report.journal : doc[intent.leg]
  ).filter((row: { date: string }) => row.date === intent.postingDate);
  return {
    reference,
    result: {
      realmId: intent.realmId,
      sourceHash: intent.source.hash,
      leg: intent.leg,
      postingDate: intent.postingDate,
      currency: doc.currency,
      debit: rows.reduce(
        (sum: number, row: { debit: number }) => sum + row.debit,
        0,
      ),
      credit: rows.reduce(
        (sum: number, row: { credit: number }) => sum + row.credit,
        0,
      ),
      syncToken: "0",
    },
  };
}
