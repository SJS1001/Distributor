import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { Application } from "../src/server/application.ts";
import { canonical, digest, type Actor } from "../src/server/core.ts";
import { readyCanadaPostMember } from "./offline-canada-post-coordinator-fixture.ts";
import {
  RestoreOfflineCanadaPostMemberCoordinator,
  type OfflineCanadaPostMemberHost,
  type OfflineCanadaPostMemberQualification,
} from "../src/server/restore-offline-canada-post-member-coordinator.ts";
import { PlatformOfflineCanadaPostCommandReviewReader } from "../src/server/platform-offline-canada-post-command-review.ts";
import {
  offlineTaskApprovalMessage,
  offlineTaskBinding,
} from "../src/server/restore-offline-envelope.ts";
import { offlineApprovalRosterFingerprint } from "../src/server/restore-offline-approvals.ts";

async function ready(
  t: TestContext,
  currency: "CAD" | "USD" = "CAD",
  reports = false,
) {
  const f = await readyCanadaPostMember(t, currency, reports),
    a = f.app;
  const evidenceActor = { id: f.preparer.id, orgId: f.actor.orgId },
    executor = { id: f.actor.id, orgId: f.actor.orgId };
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("ed25519"),
  ];
  const roster = pairs.map((p, i) => ({
    id: i === 0 ? "finance-signer" : "security-signer",
    role: i === 0 ? ("finance" as const) : ("security" as const),
    personId: "signer-person-" + i,
    publicKey: p.publicKey.export({ type: "spki", format: "pem" }).toString(),
  }));
  f.envelope.preparedBy = evidenceActor.id;
  f.envelope.executorId = executor.id;
  f.envelope.preparedAt = "2026-10-04T00:00:00.000Z";
  f.envelope.expiresAt = "2026-10-04T00:10:00.000Z";
  f.envelope.trust.registryHash = offlineApprovalRosterFingerprint(roster);
  const approvals = roster.map((r, i) => ({
    signerId: r.id,
    role: r.role,
    binding: offlineTaskBinding(f.envelope),
    signature: sign(
      null,
      Buffer.from(offlineTaskApprovalMessage(f.envelope, r.id, r.role)),
      pairs[i]!.privateKey,
    ).toString("base64"),
  }));
  const commands = a.database.transaction(() =>
    new PlatformOfflineCanadaPostCommandReviewReader(
      a.database,
      a.identity,
      a.platform,
      a.fulfillment,
      a.carriers,
    ).getInTransaction(evidenceActor as Actor, f.groupId, f.bookingId),
  );
  const h = f.capture();
  let joined;
  try {
    joined = a.database.transaction(() => h.reviewInTransaction(executor));
  } finally {
    h.dispose();
  }
  const qualification: OfflineCanadaPostMemberQualification = {
    purpose: "distributor-offline-current-canada-post-member-qualification-v1",
    envelopeBinding: offlineTaskBinding(f.envelope),
    now: "2026-10-04T00:05:00.000Z",
    trust: f.envelope.trust,
    roster,
    associations: {
      preparer: { id: evidenceActor.id, personId: "preparer-person" },
      executor: { id: executor.id, personId: "executor-person" },
      operations: {
        id: f.envelope.operations.authorityId,
        personId: "operations-person",
      },
    },
    evidence: {
      setHash: f.envelope.evidence.setHash,
      qualificationHash: f.envelope.evidence.qualificationHash,
      payloadHash: f.envelope.task.payloadHash,
      inputHash: joined.comparison.inputHash,
      comparisonHash: joined.comparison.comparisonHash,
      nativeJoinHash: joined.hash,
      commandReviewHash: commands.factsHash,
      provider: "canada-post",
      mode: "test",
      subjectId: f.bookingId,
      groupId: f.groupId,
    },
  };
  let held = false,
    calls = 0;
  const state = {
    qualification,
    onRead: (_n: number) => {},
    cleanupFailure: false,
    heldReads: 0,
  };
  const host: OfflineCanadaPostMemberHost = {
    adapter: {
      identity: f.envelope.operations.adapterIdentity,
      hold(_request, commit) {
        held = true;
        try {
          commit();
        } finally {
          held = false;
        }
        if (state.cleanupFailure) throw Error("synthetic response lost");
      },
      assertHeld() {
        assert(held);
        state.heldReads++;
      },
    },
    readCurrent() {
      state.onRead(++calls);
      return state.qualification;
    },
  };
  const coordinator = new RestoreOfflineCanadaPostMemberCoordinator(
    a.database,
    a.identity,
    a.platform,
    a.fulfillment,
    a.carriers,
    host,
  );
  return {
    ...f,
    evidenceActor,
    executor,
    approvals,
    commands,
    joined,
    state,
    host,
    coordinator,
  };
}
type Ready = Awaited<ReturnType<typeof ready>>;
function execute(f: Ready) {
  return f.coordinator.execute(
    f.evidenceActor,
    f.executor,
    f.envelope,
    f.approvals,
    f.manifest,
  );
}

for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    for (const cleanupFailure of [false, true])
      test(`retained coordinator restart ${currency}/${reports}, cleanup loss=${cleanupFailure}`, async (t) => {
        const f = await ready(t, currency, reports);
        f.state.cleanupFailure = cleanupFailure;
        const applied = execute(f);
        assert.equal(
          applied.status,
          cleanupFailure ? "committed-recovery-required" : "committed",
        );
        const row = f.app.database
          .owned("integration")
          .get(
            "SELECT * FROM integration_offline_canada_post_members WHERE booking_id=?",
            f.bookingId,
          )!;
        const original = JSON.parse(String(row.record));
        rmSync(f.root, { recursive: true, force: true });
        f.app.close();
        const app = new Application(f.path, "CA", { eventReports: reports });
        f.originalFixture.app = app;
        const coordinator = new RestoreOfflineCanadaPostMemberCoordinator(
          app.database,
          app.identity,
          app.platform,
          app.fulfillment,
          app.carriers,
        );
        const before = app.database.transaction(() =>
          canonical({
            candidate: app.database.captureRestoreCandidateInTransaction(),
            offline: app.platform.offline.readInTransaction(),
          }),
        );
        const changes = app.database
          .owned("integration")
          .get("SELECT total_changes() AS n")!.n;
        const recovered = app.database.transaction(() =>
          coordinator.recoverRetainedInTransaction(f.executor, f.envelope),
        );
        assert.deepEqual(recovered.record, original);
        assert.equal(recovered.resultHash, row.record_hash);
        assert(Object.isFrozen(recovered));
        assert.equal(
          app.database.owned("integration").get("SELECT total_changes() AS n")!
            .n,
          changes,
        );
        assert.equal(
          app.database.transaction(() =>
            canonical({
              candidate: app.database.captureRestoreCandidateInTransaction(),
              offline: app.platform.offline.readInTransaction(),
            }),
          ),
          before,
        );
        assert.throws(() =>
          app.database.transaction(() =>
            coordinator.recoverRetainedInTransaction(
              new Proxy(
                {},
                {
                  get() {
                    throw Error("getter invoked");
                  },
                },
              ),
              f.envelope,
            ),
          ),
        );
      });

for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    test(`synthetic qualified Canada Post member COMMIT ${currency}, reports=${reports}`, async (t) => {
      const f = await ready(t, currency, reports);
      assert.deepEqual(f.commands.blockers, [
        "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
      ]);
      const result = execute(f);
      assert.equal(result.status, "committed");
      assert(Object.isFrozen(result));
      assert(f.state.heldReads > 2);
      const raw = f.app.database
        .owned("integration")
        .get(
          "SELECT state FROM integration_canada_post_members WHERE booking_id=? AND group_id=?",
          f.bookingId,
          f.groupId,
        )!;
      assert.equal(raw.state, "created");
      assert.equal(
        f.app.database
          .owned("integration")
          .get(
            "SELECT state FROM integration_carrier_bookings WHERE id=?",
            f.bookingId,
          )!.state,
        "pending",
      );
      const retained = f.app.database.transaction(() =>
        f.app.platform.offline.readInTransaction()!,
      );
      assert.equal(
        retained.state.sessions
          .at(-1)!
          .history.filter((h) => h.kind === "record-task").length,
        1,
      );
      assert.throws(() => execute(f));
    });

test("absent trusted host refuses before mutation", async (t) => {
  const f = await ready(t),
    before = f.snapshot();
  const closed = new RestoreOfflineCanadaPostMemberCoordinator(
    f.app.database,
    f.app.identity,
    f.app.platform,
    f.app.fulfillment,
    f.app.carriers,
  );
  assert.throws(() =>
    closed.execute(
      f.evidenceActor,
      f.executor,
      f.envelope,
      f.approvals,
      f.manifest,
    ),
  );
  assert.equal(f.snapshot(), before);
});

for (const field of [
  "envelopeBinding",
  "payloadHash",
  "inputHash",
  "comparisonHash",
  "nativeJoinHash",
  "commandReviewHash",
  "groupId",
  "subjectId",
  "setHash",
  "qualificationHash",
  "provider",
  "mode",
  "now",
] as const)
  test(`qualified Canada Post ${field} mismatch rolls back the entire writer`, async (t) => {
    const f = await ready(t),
      before = f.snapshot();
    const q: any = structuredClone(f.state.qualification);
    if (field === "envelopeBinding") q[field] = digest("other");
    else if (field === "now") q[field] = f.envelope.expiresAt;
    else
      q.evidence[field] = ["provider", "mode", "groupId", "subjectId"].includes(
        field,
      )
        ? "other"
        : digest("other");
    f.state.qualification = q;
    assert.throws(() => execute(f));
    assert.equal(f.snapshot(), before);
  });

for (const input of [
  "preparer",
  "executor",
  "envelope",
  "approvals",
  "manifest",
] as const)
  test(`proxy ${input} is rejected before the trusted host`, async (t) => {
    const f = await ready(t),
      before = f.snapshot();
    let reads = 0,
      traps = 0;
    f.state.onRead = () => reads++;
    const proxy = new Proxy(
      {},
      {
        get() {
          traps++;
          throw Error("trap");
        },
        ownKeys() {
          traps++;
          throw Error("trap");
        },
        getPrototypeOf() {
          traps++;
          throw Error("trap");
        },
      },
    );
    assert.throws(() =>
      f.coordinator.execute(
        input === "preparer" ? proxy : f.evidenceActor,
        input === "executor" ? proxy : f.executor,
        input === "envelope" ? proxy : f.envelope,
        input === "approvals" ? proxy : f.approvals,
        input === "manifest" ? proxy : f.manifest,
      ),
    );
    assert.equal(traps, 0);
    assert.equal(reads, 0);
    assert.equal(f.snapshot(), before);
  });

test("late native join qualification failure rolls back member effects and the sole receipt", async (t) => {
  const f = await ready(t),
    before = f.snapshot();
  let observedEffect = false;
  f.state.onRead = () => {
    if (
      f.app.database
        .owned("integration")
        .get(
          "SELECT state FROM integration_canada_post_members WHERE booking_id=? AND group_id=?",
          f.bookingId,
          f.groupId,
        )?.state === "created"
    ) {
      observedEffect = true;
      f.state.qualification = {
        ...f.state.qualification,
        evidence: {
          ...f.state.qualification.evidence,
          nativeJoinHash: digest("late alteration"),
        },
      };
    }
  };
  assert.throws(() => execute(f));
  assert(observedEffect);
  assert.equal(f.snapshot(), before);
});

test("cleanup failure reports committed recovery required without replaying the effect", async (t) => {
  const f = await ready(t);
  f.state.cleanupFailure = true;
  assert.equal(execute(f).status, "committed-recovery-required");
  const before = f.snapshot();
  assert.throws(() => execute(f));
  assert.equal(f.snapshot(), before);
});

test("matching principal identities cannot replace independent preparer and executor", async (t) => {
  const f = await ready(t),
    before = f.snapshot();
  assert.throws(() =>
    f.coordinator.execute(
      f.executor,
      f.executor,
      f.envelope,
      f.approvals,
      f.manifest,
    ),
  );
  assert.equal(f.snapshot(), before);
});

for (const which of ["preparer", "executor"] as const)
  test(`current inactive ${which} refuses despite previously qualified signatures`, async (t) => {
    const f = await ready(t);
    f.app.database.transaction(() =>
      f.app.database
        .owned("iam")
        .run(
          "UPDATE iam_users SET active=0 WHERE id=?",
          which === "preparer" ? f.evidenceActor.id : f.executor.id,
        ),
    );
    const before = f.snapshot();
    assert.throws(() => execute(f));
    assert.equal(f.snapshot(), before);
  });

test("host substitution of a native owner link refuses and conserves the candidate", async (t) => {
  const f = await ready(t),
    before = f.snapshot();
  const owner = f.app.carriers as any;
  const previous = owner.fulfillment;
  f.state.onRead = () => {
    owner.fulfillment = {};
  };
  try {
    assert.throws(() => execute(f));
    assert.equal(f.snapshot(), before);
  } finally {
    owner.fulfillment = previous;
  }
});

test("substituted native getter is refused without running it", async (t) => {
  const f = await ready(t),
    before = f.snapshot();
  const owner = f.app.carriers as any;
  const previous = Object.getOwnPropertyDescriptor(owner, "fulfillment")!;
  let getters = 0;
  Object.defineProperty(owner, "fulfillment", {
    configurable: true,
    get() {
      getters++;
      throw Error("substituted getter");
    },
  });
  try {
    assert.throws(() => execute(f));
    assert.equal(getters, 0);
    assert.equal(f.snapshot(), before);
  } finally {
    Object.defineProperty(owner, "fulfillment", previous);
  }
});

test("host substitution of a native store owner refuses before a foreign read", async (t) => {
  const f = await ready(t),
    before = f.snapshot();
  const store = (f.app.carriers as any).store;
  const previous = store.owner;
  f.state.onRead = () => {
    store.owner = "billing";
  };
  try {
    assert.throws(() => execute(f));
    assert.equal(f.snapshot(), before);
  } finally {
    store.owner = previous;
  }
});

for (const defect of ["signature", "revocation", "independence"] as const)
  test(`current ${defect} approval defect refuses without effects`, async (t) => {
    const f = await ready(t),
      before = f.snapshot();
    if (defect === "signature")
      f.approvals[0]!.signature = Buffer.alloc(64).toString("base64");
    else {
      const q: any = structuredClone(f.state.qualification);
      if (defect === "revocation") q.roster.shift();
      else q.associations.preparer.personId = q.roster[0].personId;
      f.state.qualification = q;
    }
    assert.throws(() => execute(f));
    assert.equal(f.snapshot(), before);
  });
