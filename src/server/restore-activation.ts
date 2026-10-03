import { DatabaseSync } from "node:sqlite";
import { lstatSync } from "node:fs";
import { canonical, check, digest, text } from "./core.ts";
import { Database, type Store } from "./database.ts";
import { RESTORE_ACTIVATION_DDL } from "./restore-activation-schema.ts";
import {
  assertRestoreApprovals,
  assertRestoreSignatures,
  captureRestoreCandidate,
  type RestoreDossier,
  type RestoreApproval,
  type RestoreApprover,
} from "./restore-review.ts";
import {
  reviewRestoreEvidence,
  type RestoreEvidenceManifest,
} from "./restore-evidence.ts";

export function restoreReleaseApprovalMessage(
  binding: string,
  signerId: string,
  role: RestoreApprover["role"],
) {
  return canonical({
    purpose: "distributor-restore-activation-v1",
    binding,
    signerId,
    role,
  });
}

export type RestoreReleaseInput = {
  id: string;
  dossier: RestoreDossier;
  approvals: RestoreApproval[];
  manifest: RestoreEvidenceManifest;
};
export type RestoreControl = {
  releaseId: string;
  binding: string;
  source: RestoreDossier["source"];
  candidate: RestoreDossier["candidate"];
  sourceWriters: string[];
  candidateWriters: string[];
  evidenceSetHash: string;
};
/** A trusted, separately qualified operations boundary, NOT a report parser.
 * Observations must cover every declared writer, route and organization/provider.
 * Calls are synchronous and bounded. An adapter must durably deduplicate by
 * releaseId/binding and fence delayed controls before reporting settled=true. */
export interface RestoreActivationAdapter {
  readonly enabled: boolean;
  readonly identity: string;
  fence(control: RestoreControl): void;
  routeCandidate(control: RestoreControl): void;
  stopCandidate(control: RestoreControl): void;
  routeSource(control: RestoreControl): void;
  observe(control: RestoreControl): {
    releaseId: string;
    binding: string;
    token: string;
    observedAt: number;
    validUntil: number;
    settled: boolean;
    sourceFenced: boolean;
    candidateFenced: boolean;
    route: "isolated" | "candidate" | "source" | "unknown";
    sourceHash: string;
    sourceCursor: string;
    evidenceSetHash: string;
    reconciliation: "complete" | "unknown";
    externalEffects: "none" | "observed" | "unknown";
  };
}
type Phase =
  | "prepared"
  | "fencing"
  | "fenced"
  | "routing"
  | "released"
  | "stopping"
  | "returning"
  | "rolled-back"
  | "superseded";
type State = Phase | "held" | "forward-held";
export type RestoreRelease = {
  version: 1;
  id: string;
  revision: number;
  state: State;
  phase: Phase;
  // False distinguishes an interrupted control from a proven/possible effect.
  // Older forward-held records lack that distinction and remain closed.
  forwardRecoveryRequired?: boolean;
  releaseApprovals?: RestoreApproval[];
  inputHash: string;
  dossier: RestoreDossier;
  approvals: RestoreApproval[];
  evidenceSetHash: string;
  adapter: string;
  binding: string;
  token?: string;
  file: { dev: string; ino: string };
  at: number;
  history: { state: State; phase: Phase; at: number }[];
};

/** Filesystem-authorized operator API. No HTTP/tenant or environment-variable
 * activation switch. Each runtime must explicitly configure current authority. */
export class RestoreActivation {
  private store: Store;
  private adapter?: RestoreActivationAdapter;
  private loadTrust?: () => RestoreApprover[];
  private clock: () => number = Date.now;
  constructor(private database: Database) {
    this.store = database.owned("platform");
    this.store.migrate(
      RESTORE_ACTIVATION_DDL.replaceAll(
        "CREATE TABLE ",
        "CREATE TABLE IF NOT EXISTS ",
      ).replaceAll(
        "CREATE UNIQUE INDEX ",
        "CREATE UNIQUE INDEX IF NOT EXISTS ",
      ),
    );
  }
  configure(
    adapter: RestoreActivationAdapter,
    loadTrust: () => RestoreApprover[],
    clock: () => number = Date.now,
  ) {
    this.adapter = adapter;
    this.loadTrust = loadTrust;
    this.clock = clock;
  }
  private configured() {
    check(
      this.adapter?.enabled === true && this.loadTrust,
      "RESTORE_DISABLED",
      "Restore activation requires an explicit qualified operations adapter and current external trust.",
    );
    check(
      this.adapter.identity ===
        text(this.adapter.identity, "Adapter identity", 160),
      "RESTORE_DISABLED",
      "Use an exact versioned adapter identity.",
    );
    return this.adapter;
  }
  private identity() {
    const s = lstatSync(this.database.path, { bigint: true });
    check(
      s.isFile() &&
        !s.isSymbolicLink() &&
        s.nlink === 1n &&
        s.uid === BigInt(process.getuid!()) &&
        (s.mode & 0o077n) === 0n,
      "RESTORE_PATH",
      "Use a private single-link candidate file.",
    );
    return { dev: String(s.dev), ino: String(s.ino) };
  }
  private sameFile(r: RestoreRelease) {
    check(
      canonical(this.identity()) === canonical(r.file),
      "RESTORE_PATH",
      "Candidate file identity changed.",
    );
  }
  private recovery() {
    return this.store.get("SELECT * FROM platform_recovery WHERE id=1");
  }
  current(): RestoreRelease | null {
    const row = this.store.get(
      "SELECT * FROM platform_restore_releases WHERE state NOT IN('rolled-back','superseded')",
    );
    return row ? this.decode(row) : null;
  }
  private decode(row: { [key: string]: unknown }): RestoreRelease {
    const record = String(row.record);
    check(
      digest(record) === row.hash,
      "RESTORE_STATE",
      "Release journal is inconsistent.",
    );
    const r = JSON.parse(record) as RestoreRelease;
    check(
      r.version === 1 &&
        r.id === row.id &&
        r.state === row.state &&
        r.revision === row.revision,
      "RESTORE_STATE",
      "Release journal identity is inconsistent.",
    );
    return r;
  }
  get(id: string) {
    const row = this.store.get(
      "SELECT * FROM platform_restore_releases WHERE id=?",
      id,
    );
    check(row, "RESTORE_STATE", "Release does not exist.");
    return this.decode(row);
  }
  private write(r: RestoreRelease, state: State, phase = r.phase) {
    this.database.requireTransaction();
    const current = this.get(r.id);
    check(
      current.revision === r.revision,
      "RESTORE_CONFLICT",
      "Another operator advanced this release. Inspect retained state.",
    );
    const at = this.clock();
    check(
      Number.isFinite(at) && at >= r.at,
      "RESTORE_CLOCK",
      "Release clock moved backwards.",
    );
    const next = {
      ...r,
      state,
      phase,
      revision: r.revision + 1,
      at,
      history: [...r.history, { state, phase, at }],
    };
    const raw = canonical(next);
    this.store.run(
      "UPDATE platform_restore_releases SET state=?,revision=?,record=?,hash=? WHERE id=?",
      state,
      next.revision,
      raw,
      digest(raw),
      r.id,
    );
    return next;
  }
  private control(r: RestoreRelease): RestoreControl {
    return structuredClone({
      releaseId: r.id,
      binding: r.binding,
      source: r.dossier.source,
      candidate: r.dossier.candidate,
      sourceWriters: r.dossier.operations.sourceWriters,
      candidateWriters: r.dossier.operations.candidateWriters,
      evidenceSetHash: r.evidenceSetHash,
    });
  }
  private observe(r: RestoreRelease, releaseWindow = true) {
    const a = this.configured();
    this.sameFile(r);
    check(
      a.identity === r.adapter,
      "RESTORE_AUTHORITY",
      "Restore adapter changed.",
    );
    const o = a.observe(this.control(r)),
      at = this.clock();
    check(
      o &&
        Number.isFinite(at) &&
        at >= r.at &&
        Number.isFinite(o.observedAt) &&
        o.observedAt >= r.at &&
        o.observedAt <= at &&
        Number.isFinite(o.validUntil) &&
        o.validUntil > at &&
        (!releaseWindow || o.validUntil <= Date.parse(r.dossier.expiresAt)) &&
        o.settled === true &&
        ["none", "observed", "unknown"].includes(o.externalEffects) &&
        o.releaseId === r.id &&
        o.binding === r.binding &&
        typeof o.token === "string" &&
        o.token === text(o.token, "Fencing token", 256) &&
        (!r.token || r.token === o.token),
      "RESTORE_AUTHORITY",
      "Operations authority is stale, uncertain or belongs to a different release.",
    );
    check(
      o.sourceHash === r.dossier.source.logicalHash &&
        o.sourceCursor === r.dossier.source.durableCursor &&
        o.evidenceSetHash === r.evidenceSetHash &&
        o.reconciliation === "complete",
      "RESTORE_RECONCILIATION",
      "Independent post-cutoff reconciliation is incomplete or changed.",
    );
    return o;
  }
  private approvals(r: RestoreRelease) {
    this.configured();
    assertRestoreApprovals(
      r.dossier,
      r.approvals,
      this.loadTrust!(),
      this.clock(),
    );
    const h = this.recovery(),
      c = r.dossier.candidate;
    check(
      h &&
        h.snapshot_hash === c.snapshotHash &&
        h.restored_at === c.restoredAt &&
        h.source_completed_at === c.sourceCompletedAt,
      "RESTORE_STATE",
      "Recovery generation changed.",
    );
  }
  private releaseAuthority(r: RestoreRelease) {
    this.approvals(r);
    assertRestoreSignatures(
      r.binding,
      r.dossier.preparedBy,
      r.releaseApprovals!,
      this.loadTrust!(),
      restoreReleaseApprovalMessage,
    );
  }
  approveRelease(id: string, approvals: RestoreApproval[]) {
    approvals = structuredClone(approvals);
    return this.database.transaction(() => {
      const r = this.get(id);
      check(
        r.state === "prepared",
        "RESTORE_STATE",
        "Release approvals must precede writer controls.",
      );
      this.releaseAuthority({ ...r, releaseApprovals: approvals });
      check(
        !r.releaseApprovals ||
          canonical(r.releaseApprovals) === canonical(approvals),
        "RESTORE_CONFLICT",
        "Release signatures are already retained.",
      );
      return this.write({ ...r, releaseApprovals: approvals }, "prepared");
    });
  }
  private settledNativeQueues() {
    // Read-only maintenance inspection under the caller's candidate writer lock.
    // Never turn copied pending work into evidence of a negative external outcome.
    const db = new DatabaseSync(this.database.path, {
      readOnly: true,
      timeout: 5000,
    });
    try {
      for (const [table, terminal] of [
        ["integration_effects", ["completed", "rejected"]],
        ["integration_callbacks", ["completed"]],
        ["integration_refund_callbacks", ["completed"]],
        ["integration_carrier_bookings", ["booked", "canceled"]],
        ["integration_canada_post_groups", ["transmitted", "canceled"]],
        ["integration_canada_post_members", ["created"]],
        ["integration_stock_journals", ["posted", "cancelled", "rejected"]],
        ["integration_credential_revocations", ["confirmed", "released"]],
        ["integration_ledger_revocations", ["confirmed", "released"]],
        [
          "integration_authorizations",
          ["completed", "canceled", "denied", "expired"],
        ],
        [
          "integration_ledger_authorizations",
          ["completed", "canceled", "denied", "expired"],
        ],
      ] as const) {
        check(
          !db
            .prepare(
              `SELECT 1 FROM ${table} WHERE state NOT IN (${terminal.map(() => "?").join(",")}) LIMIT 1`,
            )
            .get(...terminal),
          "RESTORE_UNRESOLVED",
          "Copied provider work requires owning-module reconciliation before release.",
        );
      }
      for (const table of [
        "integration_operation_leases",
        "integration_balance_reads",
        "integration_refund_polls",
      ])
        check(
          !db
            .prepare(`SELECT 1 FROM ${table} WHERE token IS NOT NULL LIMIT 1`)
            .get(),
          "RESTORE_UNRESOLVED",
          "An external operation claim remains unresolved.",
        );
    } finally {
      db.close();
    }
  }
  private review(r: RestoreRelease, input: RestoreReleaseInput) {
    check(
      digest(canonical(input)) === r.inputHash,
      "RESTORE_CONFLICT",
      "Use the exact retained release inputs.",
    );
    this.sameFile(r);
    this.approvals(r);
    this.settledNativeQueues();
    const receipt = reviewRestoreEvidence(
      this.database.path,
      r.dossier,
      r.approvals,
      this.loadTrust!,
      input.manifest,
      this.clock,
    );
    check(
      receipt.evidence.setHash === r.evidenceSetHash,
      "RESTORE_EVIDENCE",
      "Evidence changed.",
    );
  }
  prepare(input: RestoreReleaseInput) {
    input = structuredClone(input);
    const adapter = this.configured();
    check(
      input.id === text(input.id, "Release ID", 128),
      "RESTORE_STATE",
      "Use an exact release ID.",
    );
    return this.database.transaction(() => {
      const old = this.store.get(
        "SELECT id FROM platform_restore_releases WHERE id=?",
        input.id,
      );
      if (old) {
        const r = this.get(input.id);
        this.review(r, input);
        return r;
      }
      check(
        !this.current(),
        "RESTORE_CONFLICT",
        "A release is already active or unresolved.",
      );
      const file = this.identity();
      this.settledNativeQueues();
      const receipt = reviewRestoreEvidence(
        this.database.path,
        input.dossier,
        input.approvals,
        this.loadTrust!,
        input.manifest,
        this.clock,
      );
      const at = this.clock(),
        binding = digest(
          canonical({
            id: input.id,
            dossierHash: receipt.dossierHash,
            evidenceSetHash: receipt.evidence.setHash,
            adapter: adapter.identity,
            file,
          }),
        );
      const r: RestoreRelease = {
        version: 1,
        id: input.id,
        revision: 1,
        state: "prepared",
        phase: "prepared",
        inputHash: digest(canonical(input)),
        dossier: input.dossier,
        approvals: input.approvals,
        evidenceSetHash: receipt.evidence.setHash,
        adapter: adapter.identity,
        binding,
        file,
        at,
        history: [{ state: "prepared", phase: "prepared", at }],
      };
      this.approvals(r);
      this.sameFile(r);
      const raw = canonical(r);
      this.store.run(
        "INSERT INTO platform_restore_releases VALUES(?,?,?,?,?)",
        r.id,
        r.state,
        1,
        raw,
        digest(raw),
      );
      return r;
    });
  }
  private call(
    method: "fence" | "routeCandidate" | "stopCandidate" | "routeSource",
    r: RestoreRelease,
  ) {
    check(
      this.get(r.id).revision === r.revision,
      "RESTORE_CONFLICT",
      "Control intent was superseded.",
    );
    this.sameFile(r);
    if (method !== "stopCandidate") this.releaseAuthority(r);
    const adapter = this.configured();
    check(
      adapter.identity === r.adapter,
      "RESTORE_AUTHORITY",
      "Restore adapter changed.",
    );
    const result = adapter[method](this.control(r)) as unknown;
    check(
      !result || typeof (result as { then?: unknown }).then !== "function",
      "RESTORE_ADAPTER",
      "Operations adapters must complete synchronously; inspect uncertain outcome before retry.",
    );
  }
  private hold(
    r: RestoreRelease,
    state: "held" | "forward-held" = "held",
    forwardRecoveryRequired = false,
  ) {
    // Preserve an uncertain intent even when the wall clock fails.
    this.database.transaction(() => {
      const current = this.get(r.id);
      if (current.revision !== r.revision) return;
      const next = {
        ...current,
        revision: current.revision + 1,
        state,
        ...(state === "forward-held"
          ? {
              forwardRecoveryRequired:
                current.forwardRecoveryRequired === true ||
                forwardRecoveryRequired,
            }
          : {}),
        history: [
          ...current.history,
          { state, phase: current.phase, at: current.at },
        ],
      };
      const raw = canonical(next);
      this.store.run(
        "UPDATE platform_restore_releases SET state=?,revision=?,record=?,hash=? WHERE id=?",
        state,
        next.revision,
        raw,
        digest(raw),
        r.id,
      );
    });
  }
  activate(input: RestoreReleaseInput) {
    input = structuredClone(input);
    let r = this.get(input.id);
    check(
      ["prepared", "fencing", "fenced", "routing"].includes(r.phase) &&
        r.state !== "forward-held",
      "RESTORE_STATE",
      "Inspect or recover the retained release; it cannot be activated.",
    );
    try {
      this.database.transaction(() => {
        this.review(r, input);
        this.releaseAuthority(r);
      });
      if (r.phase === "prepared") {
        r = this.database.transaction(() =>
          this.write(r, "fencing", "fencing"),
        );
        this.call("fence", r);
      }
      if (r.phase === "fencing") {
        r = this.database.transaction(() => {
          this.review(r, input);
          const o = this.observe(r);
          check(
            o.sourceFenced === true &&
              o.candidateFenced === true &&
              o.route === "isolated" &&
              o.externalEffects === "none",
            "RESTORE_FENCING",
            "Both writer sets must be stopped and isolated with no unresolved effects.",
          );
          this.releaseAuthority(r);
          return this.write({ ...r, token: o.token }, "fenced", "fenced");
        });
      }
      if (r.phase === "fenced") {
        r = this.database.transaction(() => {
          this.review(r, input);
          const o = this.observe(r);
          check(
            o.sourceFenced === true &&
              o.candidateFenced === true &&
              o.route === "isolated" &&
              o.externalEffects === "none",
            "RESTORE_FENCING",
            "Writer isolation changed.",
          );
          this.releaseAuthority(r);
          return this.write(r, "routing", "routing");
        });
        this.call("routeCandidate", r);
      }
      r = this.database.transaction(() => {
        this.review(r, input);
        const o = this.observe(r);
        check(
          o.sourceFenced === true &&
            o.route === "candidate" &&
            o.externalEffects === "none",
          "RESTORE_ROUTING",
          "Candidate routing or post-cutoff outcomes are not established.",
        );
        this.releaseAuthority(r);
        check(
          this.clock() < o.validUntil,
          "RESTORE_AUTHORITY",
          "Operations authority expired before release.",
        );
        return this.write(r, "released", "released");
      });
      return r;
    } catch (error) {
      this.hold(r);
      throw error;
    }
  }
  /** Called by the application's existing provider gate, including workers and
   * callbacks. Restart without configuration, stale/revoked trust or lost fencing
   * always closes the gate. Business effects are expected after release. */
  permits() {
    try {
      const r = this.current();
      if (!r || r.state !== "released") return false;
      this.approvals(r);
      const o = this.observe(r);
      this.releaseAuthority(r);
      // Observation/trust callbacks can advance another connection or replace
      // the path. Never grant from the snapshot taken before those callbacks.
      this.sameFile(r);
      const current = this.current();
      return (
        current?.id === r.id &&
        current.revision === r.revision &&
        current.state === "released" &&
        this.configured().identity === r.adapter &&
        this.clock() < o.validUntil &&
        o.sourceFenced === true &&
        o.route === "candidate" &&
        o.externalEffects !== "unknown"
      );
    } catch {
      return false;
    }
  }
  assertCommandAccess() {
    const r = this.current();
    check(
      !r || (r.state === "released" && this.permits()),
      "RECOVERY_HOLD",
      "Restore release is unresolved or its current authority is unavailable.",
      503,
    );
  }
  /** Safety stop requires no surviving approval; routing back does. Never rewind
   * business data. Unknown/observed effects require a newly reconciled candidate. */
  rollback(id: string) {
    let r = this.get(id);
    check(
      !["rolled-back", "superseded"].includes(r.state),
      "RESTORE_STATE",
      "Release is already terminal.",
    );
    if (
      r.forwardRecoveryRequired === true ||
      (r.state === "forward-held" && r.forwardRecoveryRequired !== false)
    )
      return r;
    // Keep this outside the transaction: a failed final check must retain the
    // positive/unknown effect evidence even when its transaction rolls back.
    let forwardRecoveryRequired = false;
    const unchangedCandidate = () => {
      const same =
        canonical(captureRestoreCandidate(this.database.path)) ===
        canonical(r.dossier.candidate);
      if (!same) forwardRecoveryRequired = true;
      return same;
    };
    try {
      if (!["stopping", "returning"].includes(r.phase)) {
        r = this.database.transaction(() =>
          this.write(r, "stopping", "stopping"),
        );
        this.call("stopCandidate", r);
      }
      if (r.phase === "stopping") {
        r = this.database.transaction(() => {
          const o = this.observe(r, false);
          if (o.externalEffects !== "none") forwardRecoveryRequired = true;
          check(
            o.candidateFenced === true && o.sourceFenced === true,
            "RESTORE_FENCING",
            "Candidate and source must be stopped before rollback.",
          );
          if (!unchangedCandidate() || forwardRecoveryRequired)
            return this.write(
              { ...r, forwardRecoveryRequired: true },
              "forward-held",
            );
          this.releaseAuthority(r);
          return this.write(r, "returning", "returning");
        });
        if (r.state === "forward-held") return r;
        // Hold SQLite's writer lock across the bounded synchronous routing call.
        // The adapter must also fence all other candidate processes and delayed IO.
        this.database.transaction(() => {
          this.approvals(r);
          const o = this.observe(r, false);
          if (o.externalEffects !== "none") forwardRecoveryRequired = true;
          check(
            o.candidateFenced === true &&
              o.sourceFenced === true &&
              o.externalEffects === "none" &&
              unchangedCandidate(),
            "RESTORE_ROLLBACK",
            "Effects changed before source routing.",
          );
          this.releaseAuthority(r);
          this.call("routeSource", r);
        });
      }
      r = this.database.transaction(() => {
        this.approvals(r);
        const o = this.observe(r, false);
        if (o.externalEffects !== "none") forwardRecoveryRequired = true;
        check(
          o.candidateFenced === true &&
            o.route === "source" &&
            o.externalEffects === "none" &&
            unchangedCandidate(),
          "RESTORE_ROLLBACK",
          "Source rollback is not proven; retain the hold.",
        );
        this.releaseAuthority(r);
        return this.write(r, "rolled-back", "rolled-back");
      });
      return r;
    } catch (error) {
      this.hold(r, "forward-held", forwardRecoveryRequired);
      throw error;
    }
  }
  /** After a separately reconciled stopped interval, retain all old history and
   * allow a fresh dossier/signatures. Does not route, write imports or clear hold. */
  supersede(id: string) {
    return this.database.transaction(() => {
      const r = this.get(id);
      check(
        ["held", "forward-held"].includes(r.state),
        "RESTORE_STATE",
        "Only a held release can be superseded.",
      );
      const o = this.observe(r, false);
      check(
        o.candidateFenced === true &&
          o.sourceFenced === true &&
          o.route === "isolated" &&
          o.externalEffects !== "unknown",
        "RESTORE_FENCING",
        "Stop and independently reconcile the interval before new review.",
      );
      return this.write(r, "superseded", "superseded");
    });
  }
  isolate() {
    const r = this.current();
    if (r) {
      const next = {
        ...r,
        state: "superseded" as const,
        phase: "superseded" as const,
        revision: r.revision + 1,
        history: [
          ...r.history,
          {
            state: "superseded" as const,
            phase: "superseded" as const,
            at: r.at,
          },
        ],
      };
      const raw = canonical(next);
      this.store.run(
        "UPDATE platform_restore_releases SET state=?,revision=?,record=?,hash=? WHERE id=?",
        next.state,
        next.revision,
        raw,
        digest(raw),
        r.id,
      );
    }
  }
}
