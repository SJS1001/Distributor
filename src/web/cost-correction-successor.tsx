import React, { useEffect, useRef, useState } from "react";
import type {
  CostCorrections,
  CorrectionInput,
} from "../server/cost-corrections.ts";
import type { CostPacketView } from "../server/integration-costs.ts";
import { request } from "./api.ts";
type Policy = NonNullable<ReturnType<CostCorrections["policy"]>>;
type Outcomes = ReturnType<CostCorrections["outcomes"]>;
type Source = { policy: Policy; outcomes: Outcomes };
type Attempt = Source & {
  orgId: string;
  actorId: string;
  key: string;
  payload: CorrectionInput;
  fingerprint: string;
};
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
const sha = async (raw: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number(v.slice(0, 4)) >= 1900 &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
const nonempty = (v: unknown, max = 2000): v is string =>
  typeof v === "string" && !!v.trim() && v === v.trim() && v.length <= max;
const storageError =
  "Subsequent preparation recovery evidence is unavailable or damaged. Restore browser storage and reconcile the original attempt before preparing another correction.";
function settled(source: Source, original: CostPacketView) {
  const s = source?.outcomes,
    p = source?.policy;
  if (
    !p ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    !hash(p.hash) ||
    !p.input ||
    !s ||
    !nonempty(s.correctionId, 160) ||
    !hash(s.contentHash) ||
    s.receiverRegion !== original.region ||
    s.currency !== original.currency ||
    !nonempty(s.receiverRef, 100) ||
    !Array.isArray(s.legs) ||
    s.legs.length < 1 ||
    s.legs.length > 2 ||
    new Set(s.legs.map((l) => l.leg)).size !== s.legs.length
  )
    throw Error(
      "Invalid predecessor or policy review. Reload the current evidence.",
    );
  if (
    !s.legs.some((l) => l.leg === "replacement") ||
    !s.legs.every(
      (l) =>
        l.current &&
        (l.leg === "reversal"
          ? l.current.input.outcome === "posted"
          : l.leg === "replacement" &&
            ["posted", "cancelled-unposted"].includes(l.current.input.outcome)),
    )
  )
    throw Error(
      "Resolve every predecessor leg first. Reversal must be posted; replacement must be posted or finally cancelled.",
    );
  for (const leg of s.legs) {
    const i = leg.current!.input;
    if (
      !hash(leg.current!.evidenceHash) ||
      !Number.isSafeInteger(leg.current!.revision) ||
      leg.current!.revision < 1 ||
      i.correctionId !== s.correctionId ||
      i.contentHash !== s.contentHash ||
      i.leg !== leg.leg ||
      i.receiverRef !== s.receiverRef ||
      i.receiverRegion !== s.receiverRegion ||
      i.currency !== s.currency ||
      !nonempty(i.externalRef, 160) ||
      i.debit !== leg.debit ||
      i.credit !== leg.credit ||
      !Number.isSafeInteger(i.debit) ||
      i.debit < 0 ||
      i.debit !== i.credit ||
      (i.outcome === "posted" ? !date(i.postingDate) : i.postingDate !== null)
    )
      throw Error(
        "Invalid settled predecessor observation. Reload and reconcile the evidence.",
      );
  }
  return s.legs.find((l) => l.leg === "replacement")!.current!.input;
}
function stamp(a: Omit<Attempt, "fingerprint"> | Attempt) {
  return canonical({
    orgId: a.orgId,
    actorId: a.actorId,
    key: a.key,
    payload: a.payload,
    policy: a.policy,
    outcomes: a.outcomes,
  });
}
async function validate(
  a: Attempt,
  orgId: string,
  actorId: string,
  original: CostPacketView,
) {
  if (
    !a ||
    Object.keys(a).sort().join() !==
      "actorId,fingerprint,key,orgId,outcomes,payload,policy" ||
    a.orgId !== orgId ||
    a.actorId !== actorId ||
    !/^[a-f0-9-]{36}$/.test(a.key) ||
    !hash(a.fingerprint) ||
    (await sha(stamp(a))) !== a.fingerprint
  )
    throw Error(storageError);
  const i = settled(a, original),
    p = a.payload;
  if (
    !p ||
    Object.keys(p).sort().join() !==
      "cancellationEvidence,externalRef,originalHash,originalId,originalPostingDate,outcome,outcomeEvidence,policyRevision,postingDate,predecessor,priorPeriodEvidence,reason,receiverRef" ||
    p.originalId !== original.id ||
    p.originalHash !== original.contentHash ||
    p.predecessor?.correctionId !== a.outcomes.correctionId ||
    p.predecessor?.contentHash !== a.outcomes.contentHash ||
    p.policyRevision !== a.policy.revision ||
    p.receiverRef !== a.outcomes.receiverRef ||
    p.externalRef !== i.externalRef ||
    p.originalPostingDate !== i.postingDate ||
    p.outcome !== (i.outcome === "posted" ? "posted" : "unposted") ||
    !date(p.postingDate) ||
    (a.policy.input.closedThrough &&
      p.postingDate <= a.policy.input.closedThrough) ||
    !nonempty(p.outcomeEvidence) ||
    !nonempty(p.reason) ||
    !(p.priorPeriodEvidence === null || nonempty(p.priorPeriodEvidence)) ||
    (i.outcome === "posted" &&
      a.policy.input.closedThrough &&
      i.postingDate! <= a.policy.input.closedThrough &&
      !nonempty(p.priorPeriodEvidence)) ||
    (p.outcome === "unposted"
      ? !nonempty(p.cancellationEvidence)
      : p.cancellationEvidence !== null) ||
    (await sha(canonical(a.policy.input))) !== a.policy.hash
  )
    throw Error(storageError);
  return a;
}
const field = (
  label: string,
  name: string,
  optional = false,
  isDate = false,
) => (
  <div className="form-field">
    <label htmlFor={`successor-${name}`}>{label}</label>
    <input
      id={`successor-${name}`}
      name={name}
      required={!optional}
      type={isDate ? "date" : "text"}
      maxLength={2000}
    />
  </div>
);
export function CostCorrectionSuccessor({
  original,
  predecessorId,
  predecessorHash,
  orgId,
  actorId,
  recoveryHold,
  saved,
}: {
  original: CostPacketView;
  predecessorId: string;
  predecessorHash: string;
  orgId: string;
  actorId: string;
  recoveryHold: boolean;
  saved: (id: string) => Promise<void>;
}) {
  const storageKey = `distributor-cost-successor:${orgId}:${actorId}:${original.id}`;
  const [source, setSource] = useState<Source | null>(null),
    [review, setReview] = useState<Attempt | null>(null),
    [retainedRaw, setRetainedRaw] = useState<string | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null),
    reviewElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) {
        setRetainedRaw(raw);
        if (!raw) setError(storageError);
      }
    } catch {
      setRetainedRaw("");
      setError(storageError);
    }
    return () => {
      operation.current?.abort();
      operation.current = null;
    };
  }, [storageKey]);
  useEffect(() => {
    if (review) reviewElement.current?.focus();
  }, [review]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Preparation failed. Retain the original attempt.",
        );
    } finally {
      if (operation.current === controller && !controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const load = async (signal: AbortSignal) => {
    if (localStorage.getItem(storageKey) !== null) {
      setRetainedRaw(localStorage.getItem(storageKey));
      throw Error("A retained preparation must be recovered first.");
    }
    const [policy, outcomes] = await Promise.all([
      request<Policy>("/api/accounting/cost-policy", { signal }),
      request<Outcomes>(
        `/api/accounting/cost-corrections/${encodeURIComponent(predecessorId)}/outcomes`,
        { signal },
      ),
    ]);
    signal.throwIfAborted();
    const next = { policy, outcomes };
    settled(next, original);
    if (
      outcomes.correctionId !== predecessorId ||
      outcomes.contentHash !== predecessorHash ||
      (await sha(canonical(policy.input))) !== policy.hash
    )
      throw Error(
        "The predecessor or policy identity changed. Reload the review.",
      );
    signal.throwIfAborted();
    setSource(next);
  };
  const prepare = async (signal: AbortSignal, recovering: boolean) => {
    if (!navigator.locks)
      throw Error(
        "Browser coordination is unavailable. Retain the attempt and use a supported browser.",
      );
    await navigator.locks.request(
      storageKey,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw Error(
            "Another tab is preparing this correction. Recover the retained attempt after it finishes.",
          );
        const existing = localStorage.getItem(storageKey);
        if (recovering && existing === null)
          throw Error(
            "The retained preparation changed in another tab. Reopen the review.",
          );
        if (!recovering && existing !== null) {
          setRetainedRaw(existing);
          throw Error("Another retained preparation must be recovered first.");
        }
        const raw = recovering ? existing! : JSON.stringify(review);
        if (raw.length > 2_097_152) throw Error(storageError);
        const attempt = await validate(
          JSON.parse(raw),
          orgId,
          actorId,
          original,
        );
        signal.throwIfAborted();
        if (!recovering) {
          localStorage.setItem(storageKey, raw);
          if (localStorage.getItem(storageKey) !== raw)
            throw Error(storageError);
          setRetainedRaw(raw);
        }
        if (localStorage.getItem(storageKey) !== raw) throw Error(storageError);
        const result = await request<ReturnType<CostCorrections["prepare"]>>(
          "/api/commands/accounting.cost.correction.prepare",
          {
            method: "POST",
            signal,
            headers: { "idempotency-key": attempt.key },
            body: JSON.stringify(attempt.payload),
          },
        );
        signal.throwIfAborted();
        const plan = result?.plan,
          expectedLegs = attempt.outcomes.legs.map((l) => ({
            leg: l.leg,
            attemptId: l.attemptId,
            current: l.current,
            debit: l.debit,
            credit: l.credit,
            postingDate: l.postingDate,
          }));
        if (
          !result ||
          !nonempty(result.id, 160) ||
          result.createdBy !== actorId ||
          result.state !== "ready" ||
          result.contentHash !== null ||
          result.originalId !== original.id ||
          result.originalHash !== original.contentHash ||
          canonical(result.input) !== canonical(attempt.payload) ||
          !plan ||
          plan.orgId !== orgId ||
          plan.region !== original.region ||
          plan.currency !== original.currency ||
          canonical(plan.input) !== canonical(attempt.payload) ||
          canonical(plan.policy) !== canonical(attempt.policy) ||
          plan.predecessor?.correctionId !== attempt.outcomes.correctionId ||
          plan.predecessor?.contentHash !== attempt.outcomes.contentHash ||
          canonical(plan.predecessor?.legs) !== canonical(expectedLegs) ||
          !hash(result.reviewHash) ||
          (await sha(canonical(plan))) !== result.reviewHash
        )
          throw Error(
            "Preparation reply failed its identity or integrity check. Recover the exact retained attempt.",
          );
        signal.throwIfAborted();
        if (localStorage.getItem(storageKey) !== raw) throw Error(storageError);
        localStorage.removeItem(storageKey);
        if (localStorage.getItem(storageKey) !== null)
          throw Error(storageError);
        setRetainedRaw(null);
        setReview(null);
        setChecked(false);
        await saved(result.id);
      },
    );
  };
  return (
    <section aria-label="Subsequent account mapping correction">
      <h5>Correct the settled replacement</h5>
      <p>
        Keep the original quantities and values. A posted replacement is
        reversed using its own accounts; a finally cancelled replacement is
        replaced without another reversal. Native uncertainty and changed
        evidence are checked again before preparation and separate approval.
      </p>
      {error && <p role="alert">{error}</p>}
      {retainedRaw !== null ? (
        <>
          <p role="status">
            Retained preparation: recover the exact original body and key before
            preparing another correction. Restoration or withdrawn authority may
            refuse recovery; keep this evidence for reconciliation.
          </p>
          <button
            disabled={busy || !retainedRaw}
            onClick={() => void run((s) => prepare(s, true))}
          >
            Recover exact subsequent preparation
          </button>
        </>
      ) : (
        <>
          <button
            disabled={busy || recoveryHold || !!review}
            onClick={() => void run(load)}
          >
            Load settled predecessor and current policy
          </button>
          {source && !review && (
            <form
              aria-label="Review subsequent correction"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void run(async (signal) => {
                  const replacement = settled(source, original),
                    text = (name: string) =>
                      String(data.get(name) ?? "").trim();
                  if (
                    replacement.outcome === "posted" &&
                    source.policy.input.closedThrough &&
                    replacement.postingDate! <=
                      source.policy.input.closedThrough &&
                    !text("prior")
                  )
                    throw Error(
                      "An accountant review is required for this closed-period replacement. Add the review evidence before confirmation.",
                    );
                  const a = {
                    ...source,
                    orgId,
                    actorId,
                    key: crypto.randomUUID(),
                    payload: {
                      originalId: original.id,
                      originalHash: original.contentHash!,
                      predecessor: {
                        correctionId: predecessorId,
                        contentHash: predecessorHash,
                      },
                      policyRevision: source.policy.revision,
                      postingDate: text("date"),
                      receiverRef: source.outcomes.receiverRef,
                      externalRef: replacement.externalRef,
                      outcome:
                        replacement.outcome === "posted"
                          ? ("posted" as const)
                          : ("unposted" as const),
                      originalPostingDate: replacement.postingDate,
                      outcomeEvidence: text("evidence"),
                      cancellationEvidence:
                        replacement.outcome === "cancelled-unposted"
                          ? text("cancellation")
                          : null,
                      priorPeriodEvidence: text("prior") || null,
                      reason: text("reason"),
                    },
                  };
                  const fixed = { ...a, fingerprint: await sha(stamp(a)) };
                  await validate(fixed, orgId, actorId, original);
                  signal.throwIfAborted();
                  setChecked(false);
                  setReview(fixed);
                });
              }}
            >
              <fieldset disabled={busy || recoveryHold}>
                <p>
                  Policy revision {source.policy.revision}; accounts{" "}
                  {source.policy.input.inventoryAccount}; closed through{" "}
                  {source.policy.input.closedThrough ?? "no recorded close"}.
                  Replacement {source.outcomes.currency}{" "}
                  {
                    source.outcomes.legs.find((l) => l.leg === "replacement")!
                      .debit
                  }{" "}
                  minor units; {source.outcomes.receiverRef}; reference{" "}
                  {
                    source.outcomes.legs.find((l) => l.leg === "replacement")!
                      .current!.input.externalRef
                  }
                  .
                </p>
                {field(
                  "Subsequent correction posting date",
                  "date",
                  false,
                  true,
                )}
                {field("Settled replacement verification evidence", "evidence")}
                {source.outcomes.legs.find((l) => l.leg === "replacement")!
                  .current!.input.outcome === "cancelled-unposted" &&
                  field(
                    "Final replacement cancellation evidence",
                    "cancellation",
                  )}
                {field(
                  "Subsequent prior period accountant review",
                  "prior",
                  true,
                )}
                {field("Subsequent correction reason", "reason")}
                <button type="submit">Review subsequent correction</button>
              </fieldset>
            </form>
          )}
          {review && (
            <div
              ref={reviewElement}
              role="region"
              aria-label="Fixed subsequent correction review"
              tabIndex={-1}
            >
              <h6>Fixed subsequent correction review</h6>
              <p>
                Original {original.id}; predecessor{" "}
                {review.outcomes.correctionId}. Preparation creates a draft
                requiring a different finance reviewer.
              </p>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {JSON.stringify(
                  {
                    input: review.payload,
                    policy: review.policy,
                    predecessor: review.outcomes,
                  },
                  null,
                  2,
                )}
              </pre>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy || recoveryHold}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I verified this predecessor, current policy and unchanged
                quantities and values
              </label>
              <button
                disabled={busy || recoveryHold || !checked}
                onClick={() => void run((s) => prepare(s, false))}
              >
                Prepare subsequent correction
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setReview(null);
                  setChecked(false);
                }}
              >
                Return to subsequent correction evidence
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
