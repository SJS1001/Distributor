import { types } from "node:util";
import { canonical, check, digest, type Actor } from "./core.ts";
import { Database } from "./database.ts";
import { Identity } from "./iam.ts";
import { StockJournalDelivery } from "./stock-journal-delivery.ts";
import {
  assertCapturedOfflineOriginalEvidence,
  StockJournalOfflineOriginalEvidence,
} from "./stock-journal-offline-original-evidence.ts";
import {
  PlatformOfflineOriginalObservationReviewReader,
  originalObservationPrincipal,
} from "./platform-offline-original-observation-review.ts";
function consistent(value: unknown): asserts value {
  check(
    value,
    "OFFLINE_ORIGINAL_NATIVE_JOIN",
    "Captured original journal and complete native audit history do not agree.",
  );
}
/** Internal same-writer consistency join. No callback, caller port or grant. */
export class RestoreOfflineOriginalNativeJoin {
  readonly #evidence: StockJournalOfflineOriginalEvidence;
  readonly #platform: PlatformOfflineOriginalObservationReviewReader;
  constructor(
    private readonly database: Database,
    identity: Identity,
    journals: StockJournalDelivery,
  ) {
    for (const [owner, prototype] of [
      [database, Database.prototype],
      [identity, Identity.prototype],
      [journals, StockJournalDelivery.prototype],
    ] as const)
      consistent(
        owner &&
          !types.isProxy(owner) &&
          Object.getPrototypeOf(owner) === prototype,
      );
    this.#evidence = new StockJournalOfflineOriginalEvidence(
      database,
      identity,
      journals,
    );
    this.#platform = new PlatformOfflineOriginalObservationReviewReader(
      database,
      identity,
    );
  }
  getInTransaction(actorInput: Actor, captureInput: unknown) {
    this.database.requireTransaction();
    assertCapturedOfflineOriginalEvidence(captureInput);
    const actor = originalObservationPrincipal(actorInput),
      capture = captureInput;
    const store = this.database.owned("platform"),
      unchanged = store.get("SELECT total_changes() AS n")!.n;
    const refreshed = this.#evidence.captureInTransaction(
      actor,
      capture.native.journalId,
      {
        version: 1,
        source: capture.native,
        candidate: capture.native,
        providerClaims: [capture.claim],
      },
    );
    consistent(refreshed.hash === capture.hash);
    const platform = this.#platform.getInTransaction(actor);
    consistent(platform.orgId === refreshed.native.orgId);
    const journalIds = new Set(refreshed.native.attempts.map((a) => a.row.id));
    const selected = platform.audits.filter((a) => journalIds.has(a.journalId)),
      used = new Set<string>();
    for (const attempt of refreshed.native.attempts) {
      let sequence = 0;
      for (const observation of attempt.observations) {
        const matching = selected.filter(
          (a) =>
            a.journalId === attempt.row.id &&
            a.revision === observation.revision,
        );
        consistent(matching.length === 1);
        const audit = matching[0]!;
        consistent(
          audit.hash === observation.hash &&
            audit.actorId === observation.recordedBy &&
            audit.sequence > sequence &&
            !used.has(audit.id),
        );
        sequence = audit.sequence;
        used.add(audit.id);
      }
    }
    consistent(
      used.size === selected.length &&
        store.get("SELECT total_changes() AS n")!.n === unchanged,
    );
    const facts = {
      version: 1 as const,
      purpose: "distributor-offline-original-native-join-v1" as const,
      capture: refreshed,
      platform,
    };
    return Object.freeze({ ...facts, hash: digest(canonical(facts)) });
  }
}
