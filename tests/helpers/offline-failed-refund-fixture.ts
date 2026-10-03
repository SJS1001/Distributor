import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import fs from "node:fs";
import { accept, chooseProviders, fixture, ship } from "../fixtures.ts";
import { canonical, digest, type Actor } from "../../src/server/core.ts";
import { Application } from "../../src/server/application.ts";
import { compareOfflineFailedRefundEvidence } from "../../src/server/integration-offline-refund-evidence.ts";
import { RestoreOfflineRefundNativeJoin } from "../../src/server/restore-offline-refund-native-join.ts";
import {
  IntegrationOfflineFailedRefund,
  offlineFailedRefundTask,
} from "../../src/server/integration-offline-failed-refund.ts";
import { parseOfflineRecoveryGeneration } from "../../src/server/restore-offline-phase.ts";
import { RestoreOfflineCommitGuard } from "../../src/server/restore-offline-commit-guard.ts";
import { Store } from "../../src/server/database.ts";
import { SCHEMA_VERSION } from "../../src/server/schema.ts";
export const h = (s: string) => digest("synthetic-offline-write:" + s);
export async function setup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
) {
  const f = fixture(t, {}, region, currency);
  const invoiceId = ship(f, accept(f, 2).id).invoiceId;
  chooseProviders(f, f.actor, "join-choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic test consent",
  });
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      22600,
      "stripe",
      "pi_native_join",
    ),
  );
  f.app.billing.issueCredit(f.actor, "join-credit", {
    invoiceId,
    reference: "JOIN-CREDIT",
    reason: "Synthetic credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const request = {
    invoiceId,
    paymentId: payment.id,
    amount: 5000,
    reference: "JOIN-REFUND",
    reason: "Original native refund reason",
  };
  const refund = f.app.billing.refundRequest(f.actor, "join-request", request);
  const effect = f.app.integration.refund(f.actor, "join-queue", {
    refundId: refund.id,
  });
  await assert.rejects(
    f.app.integration.execute(f.actor, effect.id, {
      execute: async (_effect, beforeWrite) => {
        beforeWrite?.();
        throw Error("synthetic lost response; no provider called");
      },
      lookup: async () => {
        throw Error("unexpected lookup");
      },
    }),
    /synthetic lost response/,
  );
  const { id } = f.app.identity.createUser(f.actor, "join-finance", {
    name: "Native join finance",
    email: "native-join@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id });
  f.app.platform.isolateRestore(
    digest("synthetic-join-source"),
    new Date().toISOString(),
  );
  // Synthetic evidence assembled from fixed fixture owner tables, independently
  // of the join under test. No provider truth/source qualification is asserted.
  const billing = f.app.database.owned("billing"),
    integration = f.app.database.owned("integration"),
    platform = f.app.database.owned("platform");
  const invoice = billing.get(
    "SELECT id,org_id,account_id,currency,total FROM billing_invoices WHERE id=?",
    invoiceId,
  )!;
  const nativeRefund = billing.get(
    "SELECT id,org_id,invoice_id,payment_id,amount,reference,state FROM billing_refunds WHERE id=?",
    refund.id,
  )!;
  const originalPayment = billing.get(
    "SELECT id,org_id,invoice_id,provider,external_ref,amount FROM billing_payments WHERE id=?",
    payment.id,
  )!;
  const nativeEffect = integration.get(
    "SELECT * FROM integration_effects WHERE id=?",
    effect.id,
  )!;
  const native = {
    organization: { id: f.actor.orgId, region, currency },
    account: { id: f.buyer, org_id: f.actor.orgId, currency },
    invoice: { ...invoice },
    payment: { ...originalPayment },
    refund: { ...nativeRefund },
    effect: { ...nativeEffect },
  };
  const receipts = ["billing.refund.request", "stripe.refund"].map((name) => {
    const row = platform.get(
      "SELECT * FROM platform_commands WHERE org_id=? AND name=?",
      f.actor.orgId,
      name,
    )!;
    return {
      orgId: row.org_id,
      actorId: row.actor_id,
      command: row.name,
      key: row.key,
      requestHash: row.hash,
      result: JSON.parse(String(row.result)),
      createdAt: row.created_at,
    };
  });
  const history = {
    orgId: f.actor.orgId,
    effectId: effect.id,
    refundId: refund.id,
    coverage: "complete-for-subject",
    poll: {
      ...integration.get(
        "SELECT * FROM integration_refund_polls WHERE effect_id=?",
        effect.id,
      )!,
    },
    providerMappings: [],
    observations: [],
    callbacks: [],
    manualProofs: [],
    notices: [],
    noticeUpdates: [],
    noticeReads: [],
    accountingDescendants: [],
    genericLeases: [],
    receipts,
  };
  const input = {
    version: 1,
    native,
    sourceNative: structuredClone(native),
    candidateHistory: history,
    sourceHistory: structuredClone(history),
    refundRequest: request,
    binding: {
      provider: "stripe",
      mode: "test",
      scope: "direct-account",
      orgId: f.actor.orgId,
      accountId: f.buyer,
      runtimeBindingId: "synthetic-runtime",
      stripeAccountId: "acct_synthetic",
      profile: "stripe-failed-refund-v1",
    },
    provider: {
      stripeAccountId: "acct_synthetic",
      livemode: false,
      coverage: "complete-for-effect",
      matchingRefundIds: ["re_native_join"],
      paymentIntent: {
        object: "payment_intent",
        id: "pi_native_join",
        status: "succeeded",
        livemode: false,
        amount_received: 22600,
        currency: currency.toLowerCase(),
      },
      refund: {
        object: "refund",
        id: "re_native_join",
        payment_intent: "pi_native_join",
        amount: 5000,
        currency: currency.toLowerCase(),
        status: "failed",
        metadata: { effect_id: effect.id, refund_id: refund.id },
      },
    },
  };
  const reader = new RestoreOfflineRefundNativeJoin(
    f.app.database,
    f.app.identity,
    f.app.billing,
  );
  return {
    ...f,
    replaceApp(app: Application) {
      f.app = app;
    },
    input,
    reader,
    finance,
    effectId: effect.id,
    refundId: refund.id,
  };
}

export type Fixture = Awaited<ReturnType<typeof prepared>>;
export async function prepared(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  beforeGeneration?: (f: Awaited<ReturnType<typeof setup>>) => void,
  afterOpen?: (f: Awaited<ReturnType<typeof setup>>) => void,
) {
  const f = await setup(t, region, currency);
  beforeGeneration?.(f);
  for (const suffix of ["", "-wal", "-shm"])
    if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
  f.app.database.transaction(() => {
    const { logicalHash: _logical, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    const generation = parseOfflineRecoveryGeneration({
      version: 1,
      instanceId: h("instance"),
      schemaVersion: SCHEMA_VERSION,
      ...candidate,
      organizations: candidate.organizations.map((o) => ({
        id: o.id,
        currency: o.currency,
      })),
    });
    f.app.platform.offline.createGenerationInTransaction(generation, null, []);
    let state = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      generation,
      state.anchor,
      { kind: "isolate", sessionId: "synthetic-session" },
      [],
    );
    state = f.app.platform.offline.readInTransaction()!;
    f.app.platform.offline.transitionInTransaction(
      generation,
      state.anchor,
      { kind: "open" },
      [],
    );
    afterOpen?.(f);
  });
  const comparison = compareOfflineFailedRefundEvidence(f.input);
  const envelope = f.app.database.transaction(() => {
    const retained = f.app.platform.offline.readInTransaction()!,
      {
        version: _version,
        schemaVersion: _schema,
        ...recovery
      } = retained.state.generation,
      session = retained.state.sessions.at(-1)!,
      candidate = f.app.database.captureRestoreCandidateInTransaction(),
      file = fs.lstatSync(f.path, { bigint: true }),
      joined = f.reader.getInTransaction(f.finance, comparison);
    return {
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "synthetic-write",
      preparedBy: "synthetic-preparer",
      executorId: "synthetic-executor",
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
          logicalHash: h("baseline"),
          durableCursor: "start",
          auditSequence: 0,
        },
        end: { logicalHash: h("end"), durableCursor: "end", auditSequence: 1 },
        intervalEvidenceHash: h("interval"),
      },
      task: {
        ...offlineFailedRefundTask,
        orgId: f.actor.orgId,
        siteIds: [],
        subjectId: f.effectId,
        expectedRevision: 0,
        expectedStateHash: joined.hash,
        payloadHash: digest(
          canonical({ version: 1, comparisonInputHash: comparison.inputHash }),
        ),
        priorClaim: null,
      },
      evidence: {
        setHash: h("set"),
        items: [
          { reference: "synthetic-evidence", sha256: h("bytes"), bytes: 1 },
        ],
        qualificationHash: h("qualification"),
      },
      operations: {
        authorityId: "synthetic-operations",
        revision: 1,
        adapterIdentity: "synthetic-unqualified",
        fenceTokenHash: h("fence"),
        observationHash: h("observation"),
      },
      trust: {
        authorityId: "synthetic-trust",
        revision: 1,
        registryHash: h("registry"),
      },
    };
  });
  return {
    ...f,
    comparison,
    envelope,
    operation: new IntegrationOfflineFailedRefund(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.platform,
    ),
  };
}
