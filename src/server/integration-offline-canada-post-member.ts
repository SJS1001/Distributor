import { types } from "node:util";
import { canonical, check, digest, permit, type Actor } from "./core.ts";
import { Database, type Store } from "./database.ts";
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
function fixedEnvelope(e: ReturnType<typeof parseOfflineTaskEnvelope>) {
  need(
    e.task.owner === canadaPostPrivateTask.owner &&
      e.task.name === canadaPostPrivateTask.name &&
      e.task.version === 1 &&
      e.task.expectedRevision === 0 &&
      e.task.priorClaim === null &&
      e.task.siteIds.length === 1,
  );
}
function recordInput(input: unknown) {
  const r = copy(input);
  const keys = (v: any, names: string[]) =>
    need(
      v &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        canonical(Object.keys(v).sort()) === canonical(names.sort()),
    );
  const id = (v: unknown) =>
    need(typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v));
  const hash = (v: unknown) =>
    need(typeof v === "string" && /^[a-f0-9]{64}$/.test(v));
  keys(r, [
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
  ]);
  need(
    r.version === 1 && r.purpose === "integration-canada-post-member-import-v1",
  );
  for (const k of [
    "binding",
    "comparisonHash",
    "evidenceSetHash",
    "inputHash",
    "nativeJoinHash",
    "payloadHash",
  ])
    hash(r[k]);
  keys(r.actor, ["id", "orgId"]);
  id(r.actor.id);
  id(r.actor.orgId);
  keys(r.result, [
    "version",
    "purpose",
    "orgId",
    "groupId",
    "bookingId",
    "warehouseId",
    "scopeHash",
    "custody",
    "platform",
  ]);
  const result = r.result;
  need(
    result.version === 1 &&
      result.purpose === "canada-post-native-import-result-v1",
  );
  for (const k of ["orgId", "groupId", "bookingId", "warehouseId"])
    id(result[k]);
  hash(result.scopeHash);
  for (const [list, hashKey] of [
    [result.custody, "custodyHash"],
    [result.platform, "factsHash"],
  ] as const) {
    need(Array.isArray(list) && list.length >= 1 && list.length <= 100);
    const ids = new Set<string>();
    for (const row of list) {
      keys(row, ["bookingId", hashKey]);
      id(row.bookingId);
      hash(row[hashKey]);
      need(!ids.has(row.bookingId));
      ids.add(row.bookingId);
    }
    need(ids.has(result.bookingId));
  }
  need(
    canonical(result.custody.map((x: any) => x.bookingId)) ===
      canonical(result.platform.map((x: any) => x.bookingId)) &&
      r.actor.orgId === result.orgId,
  );
  need(Buffer.byteLength(canonical(r)) <= 65536);
  return freeze(r);
}

export const integrationCanadaPostMemberTask = canadaPostPrivateTask;
/** Internal, static native owner application. No runtime registration, external
 * qualification, signature verification or COMMIT interlock is supplied here.
 * ALL exceptions must escape the caller's existing outer writer transaction. */
export class IntegrationOfflineCanadaPostMember {
  readonly #store: Store;
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
    this.#store = database.owned("integration");
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
      this.provenance();
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
      const envelopeText = canonical(envelope),
        recordText = canonical(record);
      need(Buffer.byteLength(envelopeText) <= 65536);
      recordInput(record);
      this.#store.run(
        "INSERT INTO integration_offline_canada_post_members(booking_id,group_id,org_id,request_id,binding,envelope,envelope_hash,record,record_hash) VALUES(?,?,?,?,?,?,?,?,?)",
        result.bookingId,
        result.groupId,
        actor.orgId,
        envelope.requestId,
        record.binding,
        envelopeText,
        digest(envelopeText),
        recordText,
        resultHash,
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
      need(canonical(this.stored(envelope).record) === canonical(record));
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
  /** Complete globally bounded owned projection, joined to Platform through its
   * native reader. No JSON or retained text is fetched before scalar preflight. */
  private provenance() {
    const columns = [
      "booking_id",
      "group_id",
      "org_id",
      "request_id",
      "binding",
      "envelope",
      "envelope_hash",
      "record",
      "record_hash",
    ];
    const size = this.#store.get<{ n: number; bytes: number; bad: number }>(`
      SELECT COUNT(*) AS n,COALESCE(SUM(${columns.map((c) => `length(CAST(${c} AS BLOB))`).join("+")}),0) AS bytes,
      COALESCE(MAX(CASE WHEN ${columns.map((c) => `typeof(${c})!='text' OR instr(CAST(${c} AS BLOB),x'00')>0`).join(" OR ")}
      OR ${["booking_id", "group_id", "org_id", "request_id"].map((c) => `length(CAST(${c} AS BLOB)) NOT BETWEEN 1 AND 128 OR ${c} GLOB '*[^A-Za-z0-9_-]*'`).join(" OR ")}
      OR ${["binding", "envelope_hash", "record_hash"].map((c) => `length(CAST(${c} AS BLOB))!=64 OR ${c} GLOB '*[^a-f0-9]*'`).join(" OR ")}
      OR length(CAST(envelope AS BLOB)) NOT BETWEEN 1 AND 65536 OR length(CAST(record AS BLOB)) NOT BETWEEN 1 AND 65536 THEN 1 ELSE 0 END),0) AS bad FROM integration_offline_canada_post_members`)!;
    need(
      Number.isSafeInteger(size.n) &&
        size.n >= 0 &&
        size.n <= 1024 &&
        Number.isSafeInteger(size.bytes) &&
        size.bytes >= 0 &&
        size.bytes <= 16 * 1024 * 1024 &&
        size.bad === 0,
    );
    const complexity = this.#store.get<{ nodes: number; containers: number }>(
      `WITH docs AS (SELECT envelope AS raw FROM integration_offline_canada_post_members UNION ALL SELECT record FROM integration_offline_canada_post_members) SELECT COALESCE(MAX(1+length(raw)-length(replace(replace(replace(replace(raw,',',''),':',''),'[',''),'{',''))),0) AS nodes,COALESCE(MAX(length(raw)-length(replace(replace(raw,'[',''),'{',''))),0) AS containers FROM docs`,
    )!;
    need(complexity.nodes <= 8000 && complexity.containers <= 1024);
    need(
      this.#store.get(
        "SELECT COUNT(*) AS n FROM integration_offline_canada_post_members WHERE NOT json_valid(envelope) OR NOT json_valid(record)",
      )!.n === 0,
    );
    need(
      this.#store.get(
        "SELECT COUNT(*) AS n FROM integration_offline_canada_post_members WHERE json_type(envelope)!='object' OR json_type(record)!='object'",
      )!.n === 0,
    );
    need(
      this.#store.get(
        `SELECT COUNT(*) AS n FROM integration_offline_canada_post_members p LEFT JOIN integration_carrier_bookings b ON b.id=p.booking_id LEFT JOIN integration_canada_post_members m ON m.group_id=p.group_id AND m.booking_id=p.booking_id LEFT JOIN integration_canada_post_groups g ON g.id=p.group_id WHERE b.id IS NULL OR m.booking_id IS NULL OR g.id IS NULL OR p.org_id!=b.org_id OR p.org_id!=m.org_id OR p.org_id!=g.org_id`,
      )!.n === 0,
    );
    const retained = this.platform.offline.readInTransaction();
    const expected =
      retained?.state.sessions.flatMap((s) =>
        s.history
          .filter((h) => h.receipt?.taskName === canadaPostPrivateTask.name)
          .map((h) => ({ session: s, step: h })),
      ) ?? [];
    need(expected.length === size.n);
    const rows = this.#store.all<{
      booking_id: string;
      group_id: string;
      org_id: string;
      request_id: string;
      binding: string;
      envelope_bytes: Uint8Array;
      envelope_hash: string;
      record_bytes: Uint8Array;
      record_hash: string;
    }>(
      "SELECT booking_id,group_id,org_id,request_id,binding,CAST(envelope AS BLOB) AS envelope_bytes,envelope_hash,CAST(record AS BLOB) AS record_bytes,record_hash FROM integration_offline_canada_post_members ORDER BY booking_id",
    );
    const used = new Set<string>();
    try {
      const result = rows.map((row) => {
        const decoder = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        });
        let envelope: ReturnType<typeof parseOfflineTaskEnvelope>,
          record: any,
          envelopeText: string,
          recordText: string;
        try {
          envelopeText = decoder.decode(row.envelope_bytes);
          recordText = decoder.decode(row.record_bytes);
          envelope = parseOfflineTaskEnvelope(copy(JSON.parse(envelopeText)));
          record = recordInput(JSON.parse(recordText));
        } catch {
          need(false);
        }
        need(
          canonical(envelope) === envelopeText &&
            digest(envelopeText) === row.envelope_hash &&
            canonical(record) === recordText &&
            digest(recordText) === row.record_hash,
        );
        fixedEnvelope(envelope);
        need(
          row.booking_id === envelope.task.subjectId &&
            row.org_id === envelope.task.orgId &&
            row.request_id === envelope.requestId &&
            row.binding === offlineTaskBinding(envelope),
        );
        need(
          record.binding === row.binding &&
            record.payloadHash === envelope.task.payloadHash &&
            record.evidenceSetHash === envelope.evidence.setHash &&
            record.actor.orgId === row.org_id &&
            record.result.orgId === row.org_id &&
            record.result.bookingId === row.booking_id &&
            record.result.groupId === row.group_id &&
            canonical(envelope.task.siteIds) ===
              canonical([record.result.warehouseId]),
        );
        const matches = expected.filter(
          ({ step }) =>
            step.receipt!.binding === row.binding ||
            (step.receipt!.orgId === row.org_id &&
              step.receipt!.requestId === row.request_id),
        );
        need(matches.length === 1 && !used.has(row.binding));
        used.add(row.binding);
        const { session, step } = matches[0]!,
          receipt = step.receipt!;
        need(
          retained &&
            session.id === envelope.session.id &&
            step.kind === "record-task" &&
            step.revision === envelope.session.revision + 1 &&
            step.previousHash === envelope.session.lineageHash,
        );
        const {
          version: _version,
          schemaVersion: _schema,
          ...generation
        } = retained.state.generation;
        need(canonical(envelope.recovery) === canonical(generation));
        need(
          canonical(receipt) ===
            canonical({
              owner: canadaPostPrivateTask.owner,
              orgId: row.org_id,
              taskName: canadaPostPrivateTask.name,
              requestId: row.request_id,
              binding: row.binding,
              payloadHash: envelope.task.payloadHash,
              beforeCandidateHash: envelope.candidate.logicalHash,
              resultHash: row.record_hash,
            }),
        );
        return { envelope, record, resultHash: row.record_hash };
      });
      need(
        canonical(this.platform.offline.readInTransaction()) ===
          canonical(retained),
      );
      return result;
    } finally {
      for (const r of rows) {
        r.envelope_bytes.fill(0);
        r.record_bytes.fill(0);
      }
    }
  }
  private stored(envelope: ReturnType<typeof parseOfflineTaskEnvelope>) {
    const binding = offlineTaskBinding(envelope);
    const matches = this.provenance().filter(
      (p) =>
        p.record.result.bookingId === envelope.task.subjectId ||
        p.record.binding === binding ||
        (p.envelope.task.orgId === envelope.task.orgId &&
          p.envelope.requestId === envelope.requestId),
    );
    need(matches.length === 1);
    const row = matches[0]!;
    need(canonical(row.envelope) === canonical(envelope));
    return row;
  }
  /** No caller preimage/private host required. Still current native read authority,
   * raw generation/file and exact retained journal/result consistency only. */
  recoverRetainedInTransaction(actorInput: unknown, envelopeInput: unknown) {
    this.database.requireTransaction();
    const actor = this.actor(actorInput),
      envelope = parseOfflineTaskEnvelope(copy(envelopeInput));
    fixedEnvelope(envelope);
    need(envelope.task.orgId === actor.orgId);
    const p = this.stored(envelope);
    const recovered = this.recoverInTransaction(
      { id: actor.id, orgId: actor.orgId },
      envelope,
      {
        version: 1,
        status: "native-owner-application-only",
        record: p.record,
        resultHash: p.resultHash,
      },
    );
    return freeze({ ...recovered, record: p.record });
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
    const r = recordInput(original.record);
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
    const stored = this.stored(envelope);
    need(
      canonical(stored.record) === canonical(r) &&
        stored.resultHash === original.resultHash,
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
