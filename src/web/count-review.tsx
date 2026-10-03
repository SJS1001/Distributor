import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal, type Field } from "./modal.tsx";
export type CountKind = "observation" | "approve" | "reject";
export type CountSelection = {
  id: string;
  unitId: string;
  reference: string;
  product: string;
  warehouse: string;
  bin: string;
  condition: string;
  stockRevision: number;
  expected: number;
  observed: number | null;
  unitCost: number;
  policyMode: "administrator" | "independent";
  policyRevision: number;
};
type Payload = {
  countId: string;
  reason: string;
  quantity?: number;
  decision?: "approve" | "reject";
  policyRevision?: number;
};
type Attempt = {
  key: string;
  kind: CountKind;
  selection: CountSelection;
  payload: Payload;
};
type Review = { selection: CountSelection; attempt: Attempt | null };
const recoveryError =
  "Count recovery evidence cannot be read. Reconcile the previous attempt before submitting again; restore browser storage and reload.";
const text = (v: unknown, max = 160): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
function parseAttempt(raw: string, kind: CountKind): Attempt {
  if (raw.length > 20000) throw Error();
  const a = JSON.parse(raw) as Attempt,
    s = a.selection,
    p = a.payload;
  if (
    !a ||
    !/^[a-f0-9-]{36}$/.test(a.key) ||
    a.kind !== kind ||
    !s ||
    !p ||
    !text(s.id) ||
    !text(s.unitId) ||
    !text(s.reference) ||
    !text(s.product, 1000) ||
    !text(s.warehouse, 1000) ||
    !text(s.bin) ||
    !text(s.condition) ||
    !integer(s.stockRevision, 1, 999999998) ||
    !integer(s.expected, 0, 100000) ||
    !(s.observed === null || integer(s.observed, 0, 100000)) ||
    !integer(s.unitCost, 0, 1000000000) ||
    !["administrator", "independent"].includes(s.policyMode) ||
    !integer(s.policyRevision, 1, 999999999) ||
    p.countId !== s.id ||
    !text(p.reason, 1000) ||
    (kind === "observation"
      ? !integer(p.quantity, 0, 100000) ||
        s.observed !== null ||
        Object.keys(p).sort().join() !== "countId,quantity,reason"
      : p.decision !== kind ||
        Object.keys(p).sort().join() !==
          (kind === "approve"
            ? "countId,decision,policyRevision,reason"
            : "countId,decision,reason") ||
        (kind === "approve" &&
          (s.observed === null || p.policyRevision !== s.policyRevision)))
  )
    throw Error();
  return a;
}
function retained(
  storageKey: string,
  kind: CountKind,
): { attempt: Attempt | null; error: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    return {
      attempt: raw === null ? null : parseAttempt(raw, kind),
      error: "",
    };
  } catch {
    return { attempt: null, error: recoveryError };
  }
}
function validReply(result: unknown, a: Attempt) {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, any>,
    s = a.selection;
  if (r.id !== s.id) return false;
  if (a.kind === "observation")
    return (
      r.quantity === a.payload.quantity &&
      r.delta === a.payload.quantity! - s.expected
    );
  const policy = r.reviewPolicy;
  if (
    r.state !== (a.kind === "approve" ? "approved" : "rejected") ||
    !policy ||
    !["administrator", "independent"].includes(policy.mode) ||
    !integer(policy.revision, 1, 999999999)
  )
    return false;
  if (a.kind === "reject") return r.adjustment === null;
  const v = r.adjustment,
    delta = s.observed! - s.expected;
  return (
    policy.mode === s.policyMode &&
    policy.revision === s.policyRevision &&
    v &&
    v.id === s.unitId &&
    v.revision === s.stockRevision + 1 &&
    v.previousQuantity === s.expected &&
    v.quantity === s.observed &&
    v.delta === delta &&
    v.unitCost === s.unitCost &&
    v.valueDelta === delta * s.unitCost
  );
}

export function CountReview({
  kind,
  orgId,
  actorId,
  selection,
  close,
  saved,
}: {
  kind: CountKind;
  orgId: string;
  actorId: string;
  selection: CountSelection | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const storageKey = `distributor-count-${kind}:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey, kind));
  // The open review is fixed. Storage events update the recovery banner only;
  // they cannot replace the operation the operator has actually reviewed.
  const [review, setReview] = useState<Review | null>(() =>
    selection
      ? {
          selection: recovery.attempt?.selection ?? selection,
          attempt: recovery.attempt,
        }
      : null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submitting = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    const changed = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null)
        setRecovery(retained(storageKey, kind));
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      window.removeEventListener("storage", changed);
    };
  }, [storageKey]);
  const dismiss = () => {
    if (submitting.current) return;
    setReview(null);
    setError("");
    setInvalid(false);
    close();
  };
  const submit = async (values: Record<string, any>) => {
    if (!review || submitting.current) return;
    if (invalid || recovery.error) {
      setError(
        recovery.error ||
          "Close this review, refresh Inventory and review the current count and policy again.",
      );
      return;
    }
    const s = review.selection;
    const payload: Payload =
      review.attempt?.payload ??
      (kind === "observation"
        ? {
            countId: s.id,
            quantity: values.quantity,
            reason: String(values.reason ?? "").trim(),
          }
        : {
            countId: s.id,
            decision: kind,
            reason: String(values.reason ?? "").trim(),
            ...(kind === "approve" ? { policyRevision: s.policyRevision } : {}),
          });
    const input: Attempt = review.attempt ?? {
      key: crypto.randomUUID(),
      kind,
      selection: s,
      payload,
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate count operations between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              "Another tab is submitting a count operation. Wait for its outcome before retrying.",
            );
          const current = retained(storageKey, kind);
          if (current.error) throw Error(current.error);
          if (
            review.attempt
              ? JSON.stringify(current.attempt) !== JSON.stringify(input)
              : !!current.attempt
          ) {
            throw Error(
              "Count operation recovery evidence changed in another tab. Close this review and review the retained original count operation before retrying.",
            );
          }
          // Validate persistence before transport, including a round-trip read.
          // Storage failures retain evidence; they never authorize an unsaved write.
          try {
            parseAttempt(JSON.stringify(input), kind);
          } catch {
            throw Error(
              "Check the observed quantity and reason before submitting. Nothing was sent.",
            );
          }
          localStorage.setItem(storageKey, JSON.stringify(input));
          const persisted = retained(storageKey, kind);
          if (
            persisted.error ||
            JSON.stringify(persisted.attempt) !== JSON.stringify(input)
          )
            throw Error(
              persisted.error ||
                "Count operation could not be retained. Restore browser storage before retrying.",
            );
          const clearAttempt = () => {
            const latest = retained(storageKey, kind);
            if (
              latest.error ||
              JSON.stringify(latest.attempt) !== JSON.stringify(input)
            )
              throw Error(
                "Count operation recovery evidence changed. Reconcile the original count operation before retrying; retained evidence has been preserved.",
              );
            localStorage.removeItem(storageKey);
            const cleared = retained(storageKey, kind);
            if (cleared.error || cleared.attempt)
              throw Error(
                "Count operation recovery evidence could not be cleared. Retry the retained exact count operation after restoring browser storage.",
              );
          };
          let result: unknown;
          try {
            result = await request(
              `/api/commands/${kind === "observation" ? "count.submit" : "count.decide"}`,
              {
                method: "POST",
                headers: { "idempotency-key": input.key },
                body: JSON.stringify(input.payload),
              },
            );
          } catch (e) {
            // Known native pre-effect refusals permit correction. Authority,
            // key conflicts, unknown errors and lost replies keep the exact attempt.
            if (
              e instanceof RequestError &&
              [
                "VALIDATION",
                "STATE",
                "STOCK",
                "REVISION",
                "SERIAL",
                "SEPARATION_OF_DUTIES",
              ].includes(e.code ?? "")
            ) {
              clearAttempt();
              if (active.current) {
                setReview({ selection: s, attempt: null });
                if (e.code !== "VALIDATION") setInvalid(true);
              }
            } else if (active.current)
              setReview({ selection: s, attempt: input });
            throw e;
          }
          if (!validReply(result, input)) {
            if (active.current) setReview({ selection: s, attempt: input });
            throw Error(
              "Count operation reply could not be confirmed. Retry the retained exact count operation; do not create another correction.",
            );
          }
          // Failure to clear retains the original committed attempt for recovery.
          clearAttempt();
          if (active.current) {
            setRecovery({ attempt: null, error: "" });
            setReview(null);
            close();
            await saved();
          }
        },
      );
    } catch (e) {
      if (active.current) {
        const current = retained(storageKey, kind);
        setRecovery(current);
        // After cleanup failure keep the original fixed review readonly.
        if (
          current.attempt &&
          JSON.stringify(current.attempt) === JSON.stringify(input)
        )
          setReview({ selection: s, attempt: input });
        setError(
          e instanceof Error
            ? e.message
            : "Count operation could not be confirmed.",
        );
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };
  const fields: Field[] = review?.attempt
    ? []
    : [
        ...(kind === "observation"
          ? [
              {
                name: "quantity",
                label: "Physical units observed",
                type: "number" as const,
                value: review?.selection.expected,
                min: 0,
                max: 100000,
              },
            ]
          : []),
        {
          name: "reason",
          label: "Reason / evidence",
          type: "textarea",
          maxLength: 1000,
        },
      ];
  const attempt = review?.attempt;
  const s = review?.selection;
  const title =
    kind === "observation"
      ? "Record count observation"
      : kind === "approve"
        ? "Approve stock correction"
        : "Reject stock count";
  return (
    <section aria-label={`Count ${kind} recovery`}>
      {recovery.error && (
        <p role="alert" className="error">
          {recovery.error}
        </p>
      )}
      {recovery.attempt && (
        <p role="status">
          A count {kind} for {recovery.attempt.selection.reference} is awaiting
          confirmation.{" "}
          <button
            disabled={busy}
            onClick={() => {
              const current = retained(storageKey, kind);
              setRecovery(current);
              if (current.attempt)
                setReview({
                  selection: current.attempt.selection,
                  attempt: current.attempt,
                });
              setError("");
              setInvalid(false);
            }}
          >
            Review retained count {kind}
          </button>
        </p>
      )}
      {review && s && (
        <Modal
          dialog={{
            title,
            fields,
            perform: submit,
            submitLabel: attempt ? "Retry exact count operation" : "Continue",
            description: (
              <>
                {attempt && (
                  <p>
                    Recover the original submitted operation. Do not repeat the
                    physical count or create another stock correction. This
                    receipt describes the original operation; review current
                    stock and count history before further work.
                  </p>
                )}
                <dl>
                  <dt>Reference</dt>
                  <dd>{s.reference}</dd>
                  <dt>Product / warehouse / bin</dt>
                  <dd>
                    {s.product} / {s.warehouse} / {s.bin}
                  </dd>
                  <dt>Condition</dt>
                  <dd>{s.condition}</dd>
                  <dt>Snapshot stock revision</dt>
                  <dd>{s.stockRevision}</dd>
                  <dt>Expected units</dt>
                  <dd>{s.expected}</dd>
                  <dt>Observed units</dt>
                  <dd>
                    {attempt?.kind === "observation"
                      ? attempt.payload.quantity
                      : (s.observed ?? "Awaiting observation")}
                  </dd>
                  <dt>Review policy</dt>
                  <dd>
                    {s.policyMode} version {s.policyRevision}
                  </dd>
                  {kind === "approve" && (
                    <>
                      <dt>Adjustment</dt>
                      <dd>
                        {s.observed! - s.expected} units at original unit cost{" "}
                        {s.unitCost} cents. Approval does not post an accounting
                        entry.
                      </dd>
                    </>
                  )}
                  {attempt && (
                    <>
                      <dt>Reason / evidence</dt>
                      <dd>{attempt.payload.reason}</dd>
                    </>
                  )}
                </dl>
              </>
            ),
          }}
          busy={busy}
          error={error}
          close={dismiss}
          submit={submit}
        />
      )}
    </section>
  );
}
