import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { Platform } from "./platform.ts";
import { Fulfillment } from "./fulfillment.ts";
import { CarrierBookings } from "./carrier-bookings.ts";
import {
  RestoreOfflineCanadaPostPrivateEvidence,
  canadaPostPrivateTask,
} from "./restore-offline-canada-post-private-evidence.ts";
import { RestoreOfflineCommitRecoveryReader } from "./restore-offline-commit-recovery.ts";
import {
  offlineTaskBinding,
  parseOfflineTaskEnvelope,
} from "./restore-offline-envelope.ts";

function need(v: unknown): asserts v {
  check(
    v,
    "OFFLINE_CANADA_POST_IMPORT",
    "Fixed Canada Post application or exact recovery refused.",
  );
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
// Small inert, bounded independent receipt, not evidence or an authority object.
function copy(v: unknown): any {
  let nodes = 0,
    bytes = 0;
  const active = new WeakSet<object>();
  const walk = (v: unknown, depth: number): any => {
    need(!types.isProxy(v) && ++nodes <= 8000 && depth <= 16);
    if (typeof v === "string") {
      need(v.length <= 65536 && !/[\ud800-\udfff]/u.test(v));
      bytes += Buffer.byteLength(v);
      need(bytes <= 65536);
      return v;
    }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      need(Number.isSafeInteger(v) && !Object.is(v, -0));
      return v;
    }
    need(v && typeof v === "object" && !active.has(v));
    const arr = Array.isArray(v);
    need(
      Object.getPrototypeOf(v) === (arr ? Array.prototype : Object.prototype) ||
        (!arr && Object.getPrototypeOf(v) === null),
    );
    active.add(v);
    const length = arr
      ? Object.getOwnPropertyDescriptor(v, "length")?.value
      : 0;
    need(
      !arr || (Number.isSafeInteger(length) && length >= 0 && length <= 1000),
    );
    let count = 0;
    for (const key in v)
      need(Object.hasOwn(v, key) && ++count <= (arr ? length : 64));
    const keys = Reflect.ownKeys(v);
    need(keys.length === count + (arr ? 1 : 0));
    const out: any = arr ? [] : {};
    for (const k of keys) {
      need(
        typeof k === "string" &&
          k.length <= 128 &&
          !["__proto__", "constructor", "prototype"].includes(k),
      );
      if (arr && k === "length") continue;
      need(!arr || (/^(0|[1-9][0-9]*)$/.test(k) && Number(k) < length));
      const d = Object.getOwnPropertyDescriptor(v, k);
      need(d && "value" in d && d.enumerable);
      bytes += Buffer.byteLength(k);
      need(bytes <= 65536);
      out[k] = walk(d.value, depth + 1);
    }
    active.delete(v);
    return out;
  };
  return walk(v, 0);
}
export const integrationCanadaPostMemberTask = canadaPostPrivateTask;
/** Internal, static native owner application. No runtime registration, external
 * qualification, signature verification or COMMIT interlock is supplied here.
 * ALL exceptions must escape the caller's existing outer writer transaction. */
export class IntegrationOfflineCanadaPostMember {
  readonly #private: RestoreOfflineCanadaPostPrivateEvidence;
  readonly #recovery: RestoreOfflineCommitRecoveryReader;
  #busy = false;
  #reentered = false;
  constructor(
    private readonly database: Database,
    private readonly identity: Identity,
    private readonly platform: Platform,
    fulfillment: Fulfillment,
    private readonly carrier: CarrierBookings,
  ) {
    this.#private = new RestoreOfflineCanadaPostPrivateEvidence(
      database,
      identity,
      platform,
      fulfillment,
      carrier,
    );
    this.#recovery = new RestoreOfflineCommitRecoveryReader(
      database,
      platform,
      identity,
    );
  }
  read(envelope: unknown, manifest: unknown) {
    return this.#private.read(envelope, manifest);
  }
  private actor(input: unknown) {
    const v = copy(input);
    need(
      v &&
        !Array.isArray(v) &&
        canonical(Object.keys(v).sort()) === canonical(["id", "orgId"]),
    );
    need(
      [v.id, v.orgId].every(
        (x) => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x),
      ),
    );
    const actor = this.identity.currentActor(v as Actor);
    permit(actor, ["finance"]);
    need(
      !actor.accountId &&
        !this.identity.security(actor).passwordChangeRequired &&
        this.platform.rawRecoveryHoldInTransaction(),
    );
    return actor;
  }
  applyInTransaction(actorInput: unknown, handle: unknown) {
    if (this.#busy) {
      this.#reentered = true;
      need(false);
    }
    this.#busy = true;
    this.#reentered = false;
    try {
      this.database.requireTransaction();
      // Identity/lifetime validation of handle precedes any caller input traversal.
      const applied = this.#private.applyInTransaction(handle, actorInput);
      const { envelope, joined, result } = applied;
      const actor = this.actor(actorInput);
      need(actor.id === joined.actor.id && actor.orgId === joined.actor.orgId);
      const record = freeze({
        version: 1,
        purpose: "integration-canada-post-member-import-v1",
        binding: offlineTaskBinding(envelope),
        evidenceSetHash: envelope.evidence.setHash,
        payloadHash: envelope.task.payloadHash,
        inputHash: joined.comparison.inputHash,
        comparisonHash: joined.comparison.comparisonHash,
        nativeJoinHash: joined.hash,
        actor: { id: actor.id, orgId: actor.orgId },
        result,
      });
      need(Buffer.byteLength(canonical(record)) <= 65536);
      const resultHash = digest(canonical(record));
      const retained = this.platform.offline.readInTransaction();
      need(retained);
      const session = retained.state.sessions.at(-1);
      need(
        session?.phase === "open" &&
          session.id === envelope.session.id &&
          session.revision === envelope.session.revision &&
          session.lineageHash === envelope.session.lineageHash,
      );
      const history =
        this.platform.restore.offlineReleaseHistoryInTransaction();
      need(
        history.releases.length === 0 && retained.state.releases.length === 0,
      );
      this.platform.offline.transitionInTransaction(
        retained.state.generation,
        retained.anchor,
        {
          kind: "record-task",
          receipt: {
            owner: envelope.task.owner,
            orgId: actor.orgId,
            taskName: envelope.task.name,
            requestId: envelope.requestId,
            binding: record.binding,
            payloadHash: envelope.task.payloadHash,
            beforeCandidateHash: envelope.candidate.logicalHash,
            resultHash,
          },
        },
        [],
      );
      // Current candidate pin/raw generation/IAM and exact journal checked after
      // the final receipt too; old logical hash is intentionally NOT reused.
      const recovered = this.#recovery.getInTransaction(actor, envelope);
      need(recovered.receipt?.resultHash === resultHash && !this.#reentered);
      need(
        canonical(
          this.carrier.recoverOfflineCanadaPostMemberInTransaction(
            actor,
            result.groupId,
            result.bookingId,
          ),
        ) === canonical(result),
      );
      this.actor(actorInput);
      need(!this.#reentered);
      return freeze({
        version: 1,
        status: "native-owner-application-only",
        record,
        resultHash,
      });
    } finally {
      this.#private.discardApplicationCapture(handle);
      this.#busy = false;
    }
  }
  recoverInTransaction(
    actorInput: unknown,
    envelopeInput: unknown,
    originalInput: unknown,
  ) {
    this.database.requireTransaction();
    const actor = this.actor(actorInput),
      envelope = parseOfflineTaskEnvelope(copy(envelopeInput)),
      original = copy(originalInput);
    need(
      envelope.task.owner === canadaPostPrivateTask.owner &&
        envelope.task.name === canadaPostPrivateTask.name &&
        envelope.task.version === 1 &&
        envelope.task.expectedRevision === 0 &&
        envelope.task.priorClaim === null,
    );
    need(
      original &&
        canonical(Object.keys(original).sort()) ===
          canonical(["record", "resultHash", "status", "version"]) &&
        original.version === 1 &&
        original.status === "native-owner-application-only",
    );
    const r = original.record;
    need(
      r &&
        canonical(Object.keys(r).sort()) ===
          canonical([
            "actor",
            "binding",
            "comparisonHash",
            "evidenceSetHash",
            "inputHash",
            "nativeJoinHash",
            "payloadHash",
            "purpose",
            "result",
            "version",
          ]) &&
        r.version === 1 &&
        r.purpose === "integration-canada-post-member-import-v1",
    );
    need(
      [
        r.inputHash,
        r.comparisonHash,
        r.nativeJoinHash,
        original.resultHash,
      ].every((h) => typeof h === "string" && /^[a-f0-9]{64}$/.test(h)),
    );
    need(
      r.binding === offlineTaskBinding(envelope) &&
        r.evidenceSetHash === envelope.evidence.setHash &&
        r.payloadHash === envelope.task.payloadHash &&
        original.resultHash === digest(canonical(r)),
    );
    const retained = this.#recovery.getInTransaction(actor, envelope);
    need(retained.receipt?.resultHash === original.resultHash);
    need(
      r.result.orgId === actor.orgId &&
        r.result.bookingId === envelope.task.subjectId &&
        canonical(envelope.task.siteIds) === canonical([r.result.warehouseId]),
    );
    const result = this.carrier.recoverOfflineCanadaPostMemberInTransaction(
      actor,
      r.result.groupId,
      r.result.bookingId,
    );
    need(canonical(result) === canonical(r.result));
    return freeze({
      version: 1,
      status: "native-commit-recovery-consistency-only",
      binding: r.binding,
      resultHash: original.resultHash,
      result,
      requiredChecks: retained.requiredChecks,
    });
  }
}
