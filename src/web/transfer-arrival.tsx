import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal, type Field } from "./modal.tsx";

export type ArrivalSelection = {
  transferId: string;
  lineId: string;
  destinationId: string;
  product: string;
  source: string;
  destination: string;
  serial: string | null;
  dispatchedQuantity: number;
  remainingQuantity: number;
  unitCost: number;
};
type Payload = {
  transferId: string;
  lineId: string;
  quantity: number;
  serial: string | null;
  receiptRef: string;
  bin: string;
  condition: "usable" | "quarantine" | "damaged";
  reason: string;
};
type Attempt = { key: string; selection: ArrivalSelection; payload: Payload };
type Review = { selection: ArrivalSelection; attempt: Attempt | null };
const recoveryError =
  "Transfer arrival recovery evidence cannot be read. Reconcile the previous attempt before recording another arrival; restore browser storage and reload.";
const text = (value: unknown, max = 160): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const integer = (value: number, min: number, max: number) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
function retained(storageKey: string): {
  attempt: Attempt | null;
  error: string;
} {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return { attempt: null, error: "" };
    if (raw.length > 20000) throw Error();
    const a = JSON.parse(raw) as Attempt,
      s = a.selection,
      p = a.payload;
    if (
      !/^[a-f0-9-]{36}$/.test(a.key) ||
      !s ||
      !p ||
      !text(s.transferId) ||
      !text(s.lineId) ||
      !text(s.destinationId) ||
      !text(s.product, 1000) ||
      !text(s.source, 1000) ||
      !text(s.destination, 1000) ||
      !(s.serial === null || text(s.serial)) ||
      !integer(s.dispatchedQuantity, 1, 100000) ||
      !integer(s.remainingQuantity, 1, s.dispatchedQuantity) ||
      !integer(s.unitCost, 0, 1000000000) ||
      p.transferId !== s.transferId ||
      p.lineId !== s.lineId ||
      !(p.serial === null || text(p.serial)) ||
      !integer(p.quantity, 1, s.remainingQuantity) ||
      (s.serial !== null && (s.remainingQuantity !== 1 || p.quantity !== 1)) ||
      !text(p.receiptRef) ||
      !text(p.bin) ||
      !text(p.reason, 1000) ||
      !["usable", "quarantine", "damaged"].includes(p.condition) ||
      Object.keys(p).sort().join() !==
        "bin,condition,lineId,quantity,reason,receiptRef,serial,transferId"
    )
      throw Error();
    return { attempt: a, error: "" };
  } catch {
    return { attempt: null, error: recoveryError };
  }
}
function validReply(result: unknown, a: Attempt) {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, any>;
  return (
    r.id === a.payload.transferId &&
    text(r.receiptId) &&
    text(r.unitId) &&
    r.quantity === a.payload.quantity &&
    integer(
      r.remainingQuantity,
      0,
      a.selection.dispatchedQuantity - a.payload.quantity,
    )
  );
}

export function TransferArrival({
  orgId,
  actorId,
  selection,
  close,
  saved,
}: {
  orgId: string;
  actorId: string;
  selection: ArrivalSelection | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const storageKey = `distributor-transfer-arrival:${orgId}:${actorId}`;
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
          "Close this review, refresh Inventory and review the remaining transfer stock again.",
      );
      return;
    }
    const s = review.selection;
    const input: Attempt = review.attempt ?? {
      key: crypto.randomUUID(),
      selection: s,
      payload: {
        transferId: s.transferId,
        lineId: s.lineId,
        quantity: values.quantity,
        serial: String(values.serial ?? "").trim() || null,
        receiptRef: String(values.receiptRef ?? "").trim(),
        bin: String(values.bin ?? "").trim(),
        condition: values.condition,
        reason: String(values.reason ?? "").trim(),
      },
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate transfer arrivals between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              "Another tab is submitting a transfer arrival. Wait for its outcome before retrying.",
            );
          const current = retained(storageKey);
          if (current.error) throw Error(current.error);
          if (
            review.attempt
              ? JSON.stringify(current.attempt) !== JSON.stringify(input)
              : !!current.attempt
          ) {
            throw Error(
              "Transfer arrival recovery evidence changed in another tab. Close this review and review the retained original arrival before retrying.",
            );
          }
          // Validate persistence before transport, including a round-trip read.
          // Storage failures retain evidence; they never authorize an unsaved write.
          localStorage.setItem(storageKey, JSON.stringify(input));
          const persisted = retained(storageKey);
          if (
            persisted.error ||
            JSON.stringify(persisted.attempt) !== JSON.stringify(input)
          )
            throw Error(
              persisted.error ||
                "Transfer arrival could not be retained. Restore browser storage before retrying.",
            );
          const clearAttempt = () => {
            const latest = retained(storageKey);
            if (
              latest.error ||
              JSON.stringify(latest.attempt) !== JSON.stringify(input)
            )
              throw Error(
                "Transfer arrival recovery evidence changed. Reconcile the original arrival before retrying; retained evidence has been preserved.",
              );
            localStorage.removeItem(storageKey);
            const cleared = retained(storageKey);
            if (cleared.error || cleared.attempt)
              throw Error(
                "Transfer arrival recovery evidence could not be cleared. Retry the retained exact arrival after restoring browser storage.",
              );
          };
          let result: unknown;
          try {
            result = await request("/api/commands/transfer.receive", {
              method: "POST",
              headers: { "idempotency-key": input.key },
              body: JSON.stringify(input.payload),
            });
          } catch (e) {
            // Known native pre-effect refusals permit correction. Authority,
            // key conflicts, unknown errors and lost replies keep the exact attempt.
            if (
              e instanceof RequestError &&
              [
                "VALIDATION",
                "SERIAL",
                "STATE",
                "QUANTITY",
                "RECEIPT_CONFLICT",
              ].includes(e.code ?? "")
            ) {
              clearAttempt();
              if (active.current) {
                setReview({ selection: s, attempt: null });
                if (["STATE", "QUANTITY"].includes(e.code ?? ""))
                  setInvalid(true);
              }
            } else if (active.current)
              setReview({ selection: s, attempt: input });
            throw e;
          }
          if (!validReply(result, input)) {
            if (active.current) setReview({ selection: s, attempt: input });
            throw Error(
              "Transfer arrival reply could not be confirmed. Retry the retained exact arrival; do not receive the stock again.",
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
            : "Transfer arrival could not be confirmed.",
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
          name: "quantity",
          label: "Units arriving",
          type: "number",
          value: review?.selection.remainingQuantity,
          min: 1,
          max: review?.selection.remainingQuantity,
        },
        {
          name: "serial",
          label: "Scan transferred serial (leave blank for bulk)",
          scan: "single",
          optional: !review?.selection.serial,
        },
        {
          name: "receiptRef",
          label: "Arrival reference (unique per portion)",
          help: "Use a distinct reference for each quantity and condition received.",
          maxLength: 160,
        },
        { name: "bin", label: "Destination bin", maxLength: 160 },
        {
          name: "condition",
          label: "Condition",
          options: ["usable", "quarantine", "damaged"].map((value) => ({
            value,
            label: value,
          })),
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
    <section aria-label="Transfer arrival recovery">
      {recovery.error && (
        <p role="alert" className="error">
          {recovery.error}
        </p>
      )}
      {recovery.attempt && (
        <p role="status">
          A transfer arrival for {recovery.attempt.selection.product} is
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
            Review retained transfer arrival
          </button>
        </p>
      )}
      {review && (
        <Modal
          dialog={{
            title: "Receive transfer",
            fields,
            perform: submit,
            submitLabel: attempt ? "Retry exact transfer arrival" : "Continue",
            description: attempt ? (
              <>
                <p>
                  Recover the original submitted arrival. Do not receive the
                  physical stock again. This receipt describes the original
                  operation; inspect current stock and transfer history before
                  further work.
                </p>
                <dl>
                  <dt>Transfer reference</dt>
                  <dd>{attempt.payload.transferId}</dd>
                  <dt>Product</dt>
                  <dd>{attempt.selection.product}</dd>
                  <dt>Route</dt>
                  <dd>
                    {attempt.selection.source} → {attempt.selection.destination}
                  </dd>
                  <dt>Serial</dt>
                  <dd>{attempt.payload.serial ?? "Bulk stock"}</dd>
                  <dt>Units</dt>
                  <dd>{attempt.payload.quantity}</dd>
                  <dt>Arrival reference</dt>
                  <dd>{attempt.payload.receiptRef}</dd>
                  <dt>Destination bin</dt>
                  <dd>{attempt.payload.bin}</dd>
                  <dt>Condition</dt>
                  <dd>{attempt.payload.condition}</dd>
                  <dt>Reason / evidence</dt>
                  <dd>{attempt.payload.reason}</dd>
                </dl>
              </>
            ) : (
              `Review ${review.selection.product} arriving from ${review.selection.source} at ${review.selection.destination}. Confirm the physical quantity, scanned serial, bin, condition and arrival evidence before recording stock.`
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
