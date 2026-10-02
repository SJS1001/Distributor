import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal, type Field } from "./modal.tsx";

export type DispatchSelection = {
  unitId: string;
  sourceId: string;
  sourceBin: string;
  product: string;
  source: string;
  serial: string | null;
  quantity: number;
  availableQuantity: number;
  revision: number;
  unitCost: number;
  destinations: { id: string; name: string }[];
};
type Payload = {
  unitId: string;
  destinationId: string;
  quantity: number;
  revision: number;
  reason: string;
};
type Attempt = { key: string; selection: DispatchSelection; payload: Payload };
type Review = { selection: DispatchSelection; attempt: Attempt | null };
const recoveryError =
  "Transfer dispatch recovery evidence cannot be read. Reconcile the previous attempt before dispatching again; restore browser storage and reload.";
const text = (value: unknown, max = 160): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const integer = (value: number, min: number, max: number) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
function parseAttempt(raw: string): Attempt {
  if (raw.length > 20000) throw Error();
  const a = JSON.parse(raw) as Attempt,
    s = a.selection,
    p = a.payload;
  if (
    typeof a.key !== "string" ||
    !/^[a-f0-9-]{36}$/.test(a.key) ||
    !s ||
    !p ||
    !text(s.unitId) ||
    !text(s.sourceId) ||
    !text(s.sourceBin) ||
    !text(s.product, 1000) ||
    !text(s.source, 1000) ||
    !(s.serial === null || text(s.serial)) ||
    !integer(s.quantity, 1, 100000) ||
    !integer(s.availableQuantity, 1, s.quantity) ||
    !integer(s.revision, 0, 999999998) ||
    !integer(s.unitCost, 0, 1000000000) ||
    !Array.isArray(s.destinations) ||
    s.destinations.length !== 1 ||
    !text(s.destinations[0]?.id) ||
    !text(s.destinations[0]?.name, 1000) ||
    s.destinations[0].id === s.sourceId ||
    p.unitId !== s.unitId ||
    p.revision !== s.revision ||
    p.destinationId !== s.destinations[0].id ||
    !integer(p.quantity, 1, s.availableQuantity) ||
    (s.serial !== null && (s.quantity !== 1 || p.quantity !== 1)) ||
    !text(p.reason, 1000) ||
    Object.keys(p).sort().join() !==
      "destinationId,quantity,reason,revision,unitId"
  )
    throw Error();
  return a;
}
function retained(storageKey: string): {
  attempt: Attempt | null;
  error: string;
} {
  try {
    const raw = localStorage.getItem(storageKey);
    return { attempt: raw === null ? null : parseAttempt(raw), error: "" };
  } catch {
    return { attempt: null, error: recoveryError };
  }
}
function validReply(result: unknown, a: Attempt) {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, any>;
  return (
    text(r.id) &&
    text(r.lineId) &&
    text(r.unitId) &&
    (a.payload.quantity === a.selection.quantity
      ? r.unitId === a.payload.unitId
      : r.unitId !== a.payload.unitId)
  );
}

export function TransferDispatch({
  orgId,
  actorId,
  selection,
  close,
  saved,
}: {
  orgId: string;
  actorId: string;
  selection: DispatchSelection | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const storageKey = `distributor-transfer-dispatch:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey));
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
        setRecovery(retained(storageKey));
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
          "Close this review, refresh Inventory and review the source stock again.",
      );
      return;
    }
    const s = review.selection;
    const payload: Payload = review.attempt?.payload ?? {
      unitId: s.unitId,
      revision: s.revision,
      destinationId: String(values.destinationId ?? ""),
      quantity: values.quantity,
      reason: String(values.reason ?? "").trim(),
    };
    const input: Attempt = review.attempt ?? {
      key: crypto.randomUUID(),
      selection: {
        ...s,
        destinations: s.destinations.filter(
          (d) => d.id === payload.destinationId,
        ),
      },
      payload,
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate transfer dispatches between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              "Another tab is submitting a transfer dispatch. Wait for its outcome before retrying.",
            );
          const current = retained(storageKey);
          if (current.error) throw Error(current.error);
          if (
            review.attempt
              ? JSON.stringify(current.attempt) !== JSON.stringify(input)
              : !!current.attempt
          ) {
            throw Error(
              "Transfer dispatch recovery evidence changed in another tab. Close this review and review the retained original dispatch before retrying.",
            );
          }
          // Validate persistence before transport, including a round-trip read.
          // Storage failures retain evidence; they never authorize an unsaved write.
          try {
            parseAttempt(JSON.stringify(input));
          } catch {
            throw Error(
              "Check the dispatch quantity, destination and reason before submitting. Nothing was sent.",
            );
          }
          localStorage.setItem(storageKey, JSON.stringify(input));
          const persisted = retained(storageKey);
          if (
            persisted.error ||
            JSON.stringify(persisted.attempt) !== JSON.stringify(input)
          )
            throw Error(
              persisted.error ||
                "Transfer dispatch could not be retained. Restore browser storage before retrying.",
            );
          const clearAttempt = () => {
            const latest = retained(storageKey);
            if (
              latest.error ||
              JSON.stringify(latest.attempt) !== JSON.stringify(input)
            )
              throw Error(
                "Transfer dispatch recovery evidence changed. Reconcile the original dispatch before retrying; retained evidence has been preserved.",
              );
            localStorage.removeItem(storageKey);
            const cleared = retained(storageKey);
            if (cleared.error || cleared.attempt)
              throw Error(
                "Transfer dispatch recovery evidence could not be cleared. Retry the retained exact dispatch after restoring browser storage.",
              );
          };
          let result: unknown;
          try {
            result = await request("/api/commands/transfer.dispatch", {
              method: "POST",
              headers: { "idempotency-key": input.key },
              body: JSON.stringify(input.payload),
            });
          } catch (e) {
            // Known native pre-effect refusals permit correction. Authority,
            // key conflicts, unknown errors and lost replies keep the exact attempt.
            if (
              e instanceof RequestError &&
              ["VALIDATION", "STATE", "STOCK"].includes(e.code ?? "")
            ) {
              clearAttempt();
              if (active.current) {
                setReview({ selection: s, attempt: null });
                if (["STATE", "STOCK"].includes(e.code ?? "")) setInvalid(true);
              }
            } else if (active.current)
              setReview({ selection: s, attempt: input });
            throw e;
          }
          if (!validReply(result, input)) {
            if (active.current) setReview({ selection: s, attempt: input });
            throw Error(
              "Transfer dispatch reply could not be confirmed. Retry the retained exact dispatch; do not dispatch the stock again.",
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
        const current = retained(storageKey);
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
            : "Transfer dispatch could not be confirmed.",
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
        {
          name: "destinationId",
          label: "Destination",
          options: review?.selection.destinations.map((d) => ({
            value: d.id,
            label: d.name,
          })),
        },
        {
          name: "quantity",
          label: "Units",
          type: "number",
          value: 1,
          min: 1,
          max: review?.selection.availableQuantity,
        },
        {
          name: "reason",
          label: "Reason / evidence",
          type: "textarea",
          maxLength: 1000,
        },
      ];
  const attempt = review?.attempt;
  return (
    <section aria-label="Transfer dispatch recovery">
      {recovery.error && (
        <p role="alert" className="error">
          {recovery.error}
        </p>
      )}
      {recovery.attempt && (
        <p role="status">
          A transfer dispatch for {recovery.attempt.selection.product} is
          awaiting confirmation.{" "}
          <button
            disabled={busy}
            onClick={() => {
              const current = retained(storageKey);
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
            Review retained transfer dispatch
          </button>
        </p>
      )}
      {review && (
        <Modal
          dialog={{
            title: "Dispatch transfer",
            fields,
            perform: submit,
            submitLabel: attempt ? "Retry exact transfer dispatch" : "Continue",
            description: attempt ? (
              <>
                <p>
                  Recover the original submitted dispatch. Do not dispatch the
                  physical stock again. This receipt describes the original
                  operation; inspect current stock and transfer history before
                  further work.
                </p>
                <dl>
                  <dt>Product</dt>
                  <dd>{attempt.selection.product}</dd>
                  <dt>Source</dt>
                  <dd>
                    {attempt.selection.source} / {attempt.selection.sourceBin}
                  </dd>
                  <dt>Destination</dt>
                  <dd>{attempt.selection.destinations[0]?.name}</dd>
                  <dt>Serial</dt>
                  <dd>{attempt.selection.serial ?? "Bulk stock"}</dd>
                  <dt>Original source revision</dt>
                  <dd>{attempt.payload.revision}</dd>
                  <dt>Units</dt>
                  <dd>{attempt.payload.quantity}</dd>
                  <dt>Reason / evidence</dt>
                  <dd>{attempt.payload.reason}</dd>
                </dl>
              </>
            ) : (
              `Review ${review.selection.product} leaving ${review.selection.source} / ${review.selection.sourceBin}. Confirm the physical quantity, destination and handover evidence before dispatching stock.`
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
