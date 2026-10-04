// Actual native synthetic fixture; no provider IO or external qualification.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import fs from "node:fs";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { canonical, digest } from "../src/server/core.ts";
import { Application } from "../src/server/application.ts";
import { IntegrationOfflineCheckoutReview } from "../src/server/integration-offline-checkout-review.ts";
import { type OfflineCheckoutEvidenceInput } from "../src/server/integration-offline-checkout-evidence.ts";
import { RestoreOfflineCheckoutNativeJoin as Join } from "../src/server/restore-offline-checkout-native-join.ts";

async function nativeSetup(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = fixture(t, { eventReports: reports }, region, currency),
    invoiceId = ship(f, accept(f).id).invoiceId;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic permission only",
  });
  const effect = f.app.integration.checkout(f.actor, "checkout", { invoiceId });
  let calls = 0;
  assert.equal(
    (
      await f.app.integration.execute(f.actor, effect.id, {
        execute: async () => {
          calls++;
          throw Error("Synthetic lost reply; no provider IO");
        },
        lookup: async () => {
          calls++;
          return null;
        },
      })
    ).state,
    "unknown",
  );
  const user = f.app.identity.createUser(f.actor, "finance", {
    name: "Review finance",
    email: "checkout-review@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const actor = { id: user.id, orgId: f.actor.orgId };
  const second = f.app.identity.createUser(f.actor, "independent-finance", {
    name: "Independent checkout finance",
    email: "checkout-executor@example.test",
    password: "synthetic-long-password",
    role: "finance",
    sites: [],
  });
  const executor = { id: second.id, orgId: f.actor.orgId };
  const hold = () => {
    for (const suffix of ["", "-wal", "-shm"])
      if (fs.existsSync(f.path + suffix)) fs.chmodSync(f.path + suffix, 0o600);
    f.app.database.transaction(() =>
      f.app.platform.isolateRestore(
        digest("synthetic-checkout-snapshot"),
        "2026-10-01T00:00:00.000Z",
      ),
    );
  };
  const input = () =>
    f.app.database.transaction(() => {
      const candidate = new IntegrationOfflineCheckoutReview(
        f.app.database,
        f.app.identity,
        f.app.billing,
        f.app.integration.checkouts,
      ).getInTransaction(
        f.app.identity.workerActor(actor.orgId, actor.id),
        effect.id,
      );
      const candidateStore =
          f.app.database.captureRestoreCandidateInTransaction(),
        amount = candidate.invoice.total,
        currency = candidate.invoice.currency.toLowerCase() as "cad" | "usd",
        metadata = { effect_id: effect.id };
      return {
        version: 1,
        profile: "stripe-first-unknown-checkout-paid-v1",
        source: structuredClone(candidate),
        candidate,
        candidateStore,
        binding: {
          provider: "stripe",
          mode: "test",
          scope: "direct-account",
          orgId: f.actor.orgId,
          accountId: f.buyer,
          runtimeBindingId: "synthetic-runtime-binding",
          stripeAccountId: "acct_synthetic",
        },
        provider: {
          stripeAccountId: "acct_synthetic",
          session: {
            object: "checkout.session",
            id: "cs_test_synthetic",
            mode: "payment",
            livemode: false,
            status: "complete",
            payment_status: "paid",
            amount_total: amount,
            currency,
            expires_at: 1893456000,
            url: null,
            metadata,
            payment_intent: {
              object: "payment_intent",
              id: "pi_synthetic",
              status: "succeeded",
              livemode: false,
              amount,
              amount_received: amount,
              currency,
              metadata,
              on_behalf_of: null,
              transfer_data: null,
              application_fee_amount: null,
            },
          },
        },
      } satisfies OfflineCheckoutEvidenceInput;
    });
  const join = () =>
    new Join(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    );
  return Object.assign(f, {
    invoiceId,
    effectId: effect.id,
    reviewer: actor,
    executor,
    hold,
    input,
    join,
    calls: () => calls,
  });
}
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RestoreOfflineCheckoutPrivateEvidence as Private,
  checkoutPrivateTask,
} from "../src/server/restore-offline-checkout-private-evidence.ts";
import { SCHEMA_VERSION } from "../src/server/schema.ts";
function json(v: any): string {
  if (Array.isArray(v)) return `[${v.map(json).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${json(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
export async function checkoutPaidFixture(
  t: TestContext,
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = await nativeSetup(t, region, currency, reports);
  f.hold();
  f.app.database.transaction(() => {
    const { logicalHash: _hash, ...candidate } =
      f.app.database.captureRestoreCandidateInTransaction();
    f.app.platform.offline.createGenerationInTransaction(
      {
        version: 1,
        schemaVersion: SCHEMA_VERSION,
        instanceId: digest("synthetic-private-checkout-instance"),
        ...candidate,
        organizations: candidate.organizations.map((o) => ({
          id: o.id,
          currency: o.currency,
        })),
      },
      null,
      [],
    );
    for (const transition of [
      { kind: "isolate", sessionId: "checkout-session" },
      { kind: "open" },
    ] as const) {
      const s = f.app.platform.offline.readInTransaction()!;
      f.app.platform.offline.transitionInTransaction(
        s.state.generation,
        s.anchor,
        transition,
        [],
      );
    }
  });
  const inputData = f.input(),
    root = fs.mkdtempSync(join(tmpdir(), "checkout-private-")),
    file = join(root, "report.json");
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const envelope: any = f.app.database.transaction(() => {
    const s = f.app.platform.offline.readInTransaction()!,
      session = s.state.sessions.at(-1)!,
      stat = fs.lstatSync(f.path);
    const {
      version: _v,
      schemaVersion: _schema,
      ...recovery
    } = s.state.generation;
    const h = digest("synthetic-qualification-not-proof");
    return {
      version: 1,
      purpose: "distributor-restore-offline-task-v1",
      requestId: "private-checkout",
      preparedBy: f.reviewer.id,
      executorId: f.executor.id,
      preparedAt: "2026-10-04T01:00:00.000Z",
      expiresAt: "2026-10-04T01:15:00.000Z",
      recovery,
      session: {
        id: session.id,
        revision: session.revision,
        lineageHash: session.lineageHash,
      },
      candidate: {
        logicalHash: inputData.candidateStore.logicalHash,
        file: { dev: stat.dev, ino: stat.ino },
      },
      source: {
        identity: "synthetic-source",
        baseline: { logicalHash: h, durableCursor: "start", auditSequence: 1 },
        end: { logicalHash: h, durableCursor: "end", auditSequence: 2 },
        intervalEvidenceHash: h,
      },
      task: {
        ...checkoutPrivateTask,
        orgId: f.actor.orgId,
        siteIds: [],
        subjectId: f.effectId,
        expectedRevision: 0,
        expectedStateHash: inputData.candidate.factsHash,
        payloadHash: digest(canonical(inputData)),
        priorClaim: null,
      },
      evidence: { setHash: h, items: [], qualificationHash: h },
      operations: {
        authorityId: "external-operations",
        revision: 1,
        adapterIdentity: "synthetic-not-qualified",
        fenceTokenHash: h,
        observationHash: h,
      },
      trust: { authorityId: "external-trust", revision: 1, registryHash: h },
    };
  });
  const manifest = {
    version: 1 as const,
    root,
    files: [{ reference: "checkout-report", path: "report.json" }],
  };
  const write = (bytes: Buffer = Buffer.from(json(inputData))) => {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    envelope.evidence.items = [
      {
        reference: "checkout-report",
        bytes: bytes.length,
        sha256: digest(bytes),
      },
    ];
    envelope.evidence.setHash = digest(canonical(envelope.evidence.items));
    return bytes;
  };
  const bytes = write(),
    reader = new Private(
      f.app.database,
      f.app.identity,
      f.app.billing,
      f.app.integration.checkouts,
    );
  const read = () => reader.read(envelope, manifest);
  const run = () => {
    const h = read();
    h.complete();
    return f.app.database.transaction(() => h.reviewInTransaction(f.reviewer));
  };
  const snapshot = () =>
    f.app.database.transaction(() =>
      canonical({
        candidate: f.app.database.captureRestoreCandidateInTransaction(),
        offline: f.app.platform.offline.readInTransaction(),
      }),
    );
  return Object.assign(f, {
    inputData,
    root,
    file,
    envelope,
    manifest,
    bytes,
    write,
    reader,
    read,
    run,
    snapshot,
  });
}
