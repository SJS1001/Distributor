// Synthetic copied-lease fixtures shared by owning-task and signed-coordinator tests.
import fs from "node:fs";
import type { TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fixture, syntheticDisclosure } from "./fixtures.ts";
import {
  setup as costSetup,
  policy,
  input as correctionInput,
} from "./cost-correction-fixture.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import type { JournalDeliveryInput } from "../src/server/stock-journal-delivery.ts";
import { stockJournalReceiver } from "../src/server/stock-journal-delivery.ts";
import { ORIGINAL_LEASE_TASK } from "../src/server/integration-offline-original-lease-retirement.ts";
import { INTEGRATION_OFFLINE_ORIGINAL_LEASE_INITIALIZE_DDL as ddl } from "../src/server/integration-offline-original-lease-schema.ts";
import { parseOfflineRecoveryGeneration } from "../src/server/restore-offline-phase.ts";
import {
  parseOfflineTaskEnvelope,
  offlineTaskBinding,
} from "../src/server/restore-offline-envelope.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
export function journalFixture(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  correction = false,
  movementDates?: readonly string[],
  currency?: "CAD" | "USD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  if (movementDates) {
    const db = new DatabaseSync(f.path);
    try {
      const movements = db
        .prepare(
          "SELECT m.id FROM inventory_movements m JOIN inventory_cost_sequences s ON s.movement_id=m.id AND s.org_id=m.org_id ORDER BY s.sequence",
        )
        .all();
      if (movements.length !== movementDates.length)
        throw Error("Select one fixture date per movement");
      movements.forEach((movement, i) =>
        db
          .prepare("UPDATE inventory_movements SET created_at=? WHERE id=?")
          .run(`${movementDates[i]}T12:00:00.000Z`, String(movement.id)),
      );
    } finally {
      db.close();
    }
  }
  const { original, reviewer } = costSetup(f),
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

export const loc = (a: Actor) => ({ id: a.id, orgId: a.orgId });
export function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  reports = false,
  dispatched = false,
  lookup = false,
  orphan = false,
) {
  const c = journalFixture(t, region, false, undefined, undefined, reports),
    journal = c.approve();
  let lease = c.j.claim(c.f.actor, journal.id, "write")!;
  if (dispatched) c.j.beforeWrite(lease);
  if (lookup) {
    c.j.unresolved(lease, "transport-uncertain");
    lease = c.j.claim(c.f.actor, journal.id, "lookup")!;
  }
  c.f.app.platform.isolateRestore(
    digest("synthetic copied original"),
    new Date().toISOString(),
  );
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(c.f.path + suffix))
      fs.chmodSync(c.f.path + suffix, 0o600);
  const a = c.f.app;
  a.database.transaction(() => {
    const { logicalHash: _, ...candidate } =
      a.database.captureRestoreCandidateInTransaction();
    const generation = parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: digest("synthetic-instance"),
      schemaVersion: SCHEMA_VERSION,
      ...candidate,
      organizations: candidate.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
    a.platform.offline.createGenerationInTransaction(generation, null, []);
    let r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "isolate", sessionId: "lease-session" },
      [],
    );
    r = a.platform.offline.readInTransaction()!;
    a.platform.offline.transitionInTransaction(
      generation,
      r.anchor,
      { kind: "open" },
      [],
    );
  });
  const before = a.database.transaction(() =>
      c.j.readOfflineLeaseRetirementInTransaction(c.reviewer, journal.id),
    ),
    r = before.attempts.find((a) => a.row.id === journal.id)!.row;
  const payload = {
    journalId: journal.id,
    orgId: c.f.actor.orgId,
    leaseId: lease.leaseId,
    leaseActor: lease.actor.id,
    leaseStarted: lease.started,
    leaseMode: lease.mode,
    dispatched: r.dispatched,
    requestRef: journal.requestRef,
    sourceId: r.source_id,
    sourceHash: before.source.file.hash,
    attemptId: r.attempt_id,
    reviewHash: r.review_hash,
    expectedFactsHash: before.hash,
  };
  const envelope = a.database.transaction(() => {
    const retained = a.platform.offline.readInTransaction()!,
      {
        version: _,
        schemaVersion: __,
        ...recovery
      } = retained.state.generation,
      session = retained.state.sessions.at(-1)!,
      candidate = a.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(c.f.path, { bigint: true });
    return parseOfflineTaskEnvelope({
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "retire-original",
      preparedBy: c.f.actor.id,
      executorId: c.reviewer.id,
      preparedAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:10:00.000Z",
      recovery,
      session: {
        id: session.id,
        revision: session.revision,
        lineageHash: session.lineageHash,
      },
      candidate: {
        logicalHash: candidate.logicalHash,
        file: { dev: Number(file.dev), ino: Number(file.ino) },
      },
      source: {
        identity: "synthetic-source",
        baseline: {
          logicalHash: digest("base"),
          durableCursor: "start",
          auditSequence: 0,
        },
        end: {
          logicalHash: digest("end"),
          durableCursor: "end",
          auditSequence: 1,
        },
        intervalEvidenceHash: digest("interval"),
      },
      task: {
        owner: "integration",
        name: ORIGINAL_LEASE_TASK,
        version: 1,
        orgId: c.f.actor.orgId,
        siteIds: [],
        subjectId: journal.id,
        expectedRevision:
          before.attempts
            .find((a) => a.row.id === journal.id)!
            .observations.at(-1)?.revision ?? 0,
        expectedStateHash: before.hash,
        payloadHash: digest(canonical(payload)),
        priorClaim: {
          operationId: journal.id,
          tokenHash: digest(lease.leaseId),
          revision:
            before.attempts
              .find((a) => a.row.id === journal.id)!
              .observations.at(-1)?.revision ?? 0,
          stateHash: before.hash,
        },
      },
      evidence: {
        setHash: digest("set"),
        items: [],
        qualificationHash: digest("qualification"),
      },
      operations: {
        authorityId: "synthetic-host",
        revision: 1,
        adapterIdentity: "synthetic-unqualified",
        fenceTokenHash: digest("fence"),
        observationHash: digest("observation"),
      },
      trust: {
        authorityId: "synthetic-trust",
        revision: 1,
        registryHash: digest("registry"),
      },
    });
  });
  if (orphan)
    a.database.transaction(() => {
      const state = a.platform.offline.readInTransaction()!;
      a.platform.offline.transitionInTransaction(
        state.state.generation,
        state.anchor,
        {
          kind: "record-task",
          receipt: {
            owner: "integration",
            taskName: ORIGINAL_LEASE_TASK,
            orgId: c.f.actor.orgId,
            requestId: envelope.requestId,
            binding: offlineTaskBinding(envelope),
            payloadHash: envelope.task.payloadHash,
            beforeCandidateHash: envelope.candidate.logicalHash,
            resultHash: digest("orphan"),
          },
        },
        [],
      );
    });
  // Explicit test install only. No production initializer/migration wiring here.
  a.database.owned("integration").migrate(ddl);
  return { ...c, journal, lease, before, payload, envelope, reports, region };
}
