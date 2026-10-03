import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal, type Field } from "./modal.tsx";

type Description = {
  transferId: string;
  lineId: string;
  unitId: string;
  product: string;
  source: string;
  destination: string;
  serial: string | null;
  dispatchedQuantity: number;
  remainingQuantity: number;
  unitCost: number;
};
export type LossSelection = Description &
  (
    | { kind: "loss"; revision: number }
    | {
        kind: "recovery";
        lossId: string;
        lossRef: string;
        lossQuantity: number;
      }
  );
type Payload = {
  quantity: number;
  serial: string | null;
  reason: string;
} & (
  | { transferId: string; lineId: string; revision: number; lossRef: string }
  | {
      lossId: string;
      receiptRef: string;
      bin: string;
      condition: "usable" | "quarantine" | "damaged";
    }
);
type Attempt = { key: string; selection: LossSelection; payload: Payload };
type Review = { selection: LossSelection; attempt: Attempt | null };
const text = (value: unknown, max = 160): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const integer = (value: number, min: number, max: number) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const unreadable =
  "Transfer loss/recovery evidence cannot be read. Reconcile the previous attempt before recording another change; restore browser storage and reload.";

function parseAttempt(raw: string, kind: LossSelection["kind"]): Attempt {
  if (raw.length > 20000) throw Error();
  const a = JSON.parse(raw) as Attempt,
    s = a.selection,
    p = a.payload;
  if (
    typeof a.key !== "string" ||
    !/^[a-f0-9-]{36}$/.test(a.key) ||
    !s ||
    !p ||
    s.kind !== kind ||
    !text(s.transferId) ||
    !text(s.lineId) ||
    !text(s.unitId) ||
    !text(s.product, 1000) ||
    !text(s.source, 1000) ||
    !text(s.destination, 1000) ||
    !(s.serial === null || text(s.serial)) ||
    !integer(s.dispatchedQuantity, 1, 100000) ||
    !integer(s.remainingQuantity, 1, s.dispatchedQuantity) ||
    !integer(s.unitCost, 0, 1000000000) ||
    !integer(p.quantity, 1, s.remainingQuantity) ||
    !(p.serial === null || text(p.serial)) ||
    !text(p.reason, 1000) ||
    (s.serial !== null && (s.dispatchedQuantity !== 1 || p.quantity !== 1))
  )
    throw Error();
  if (s.kind === "loss") {
    if (
      !("transferId" in p) ||
      p.transferId !== s.transferId ||
      p.lineId !== s.lineId ||
      !integer(s.revision, 1, 999999998) ||
      p.revision !== s.revision ||
      !text(p.lossRef) ||
      Object.keys(p).sort().join() !==
        "lineId,lossRef,quantity,reason,revision,serial,transferId"
    )
      throw Error();
  } else {
    if (
      !("lossId" in p) ||
      !text(s.lossId) ||
      !text(s.lossRef) ||
      !integer(s.lossQuantity, 1, s.dispatchedQuantity) ||
      s.remainingQuantity > s.lossQuantity ||
      p.lossId !== s.lossId ||
      !text(p.receiptRef) ||
      !text(p.bin) ||
      !["usable", "quarantine", "damaged"].includes(p.condition) ||
      Object.keys(p).sort().join() !==
        "bin,condition,lossId,quantity,reason,receiptRef,serial"
    )
      throw Error();
  }
  return a;
}
function retained(storageKey: string, kind: LossSelection["kind"]) {
  try {
    const raw = localStorage.getItem(storageKey);
    return {
      attempt: raw === null ? null : parseAttempt(raw, kind),
      error: "",
    };
  } catch {
    return { attempt: null, error: unreadable };
  }
}
function validReply(result: unknown, a: Attempt) {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, any>,
    s = a.selection;
  if (r.id !== s.transferId || r.quantity !== a.payload.quantity) return false;
  return s.kind === "loss"
    ? text(r.lossId) &&
        r.unitCost === s.unitCost &&
        integer(
          r.remainingQuantity,
          0,
          s.dispatchedQuantity - a.payload.quantity,
        )
    : text(r.receiptId) &&
        text(r.unitId) &&
        (s.serial === null || r.unitId === s.unitId) &&
        integer(
          r.remainingLostQuantity,
          0,
          s.lossQuantity - a.payload.quantity,
        );
}
function newAttempt(s: LossSelection, values: Record<string, any>): Attempt {
  const common = {
    quantity: values.quantity,
    serial: String(values.serial ?? "").trim() || null,
    reason: String(values.reason ?? "").trim(),
  };
  return {
    key: crypto.randomUUID(),
    selection: s,
    payload:
      s.kind === "loss"
        ? {
            ...common,
            transferId: s.transferId,
            lineId: s.lineId,
            revision: s.revision,
            lossRef: String(values.lossRef ?? "").trim(),
          }
        : {
            ...common,
            lossId: s.lossId,
            receiptRef: String(values.receiptRef ?? "").trim(),
            bin: String(values.bin ?? "").trim(),
            condition: values.condition,
          },
  };
}
function fields(s: LossSelection | undefined): Field[] {
  if (!s) return [];
  return [
    {
      name: "quantity",
      label: s.kind === "loss" ? "Missing units to write off" : "Units found",
      type: "number",
      value: s.remainingQuantity,
      min: 1,
      max: s.remainingQuantity,
    },
    {
      name: "serial",
      scan: "single",
      label:
        s.kind === "loss"
          ? "Confirm missing serial (leave blank for bulk)"
          : "Scan recovered serial (leave blank for bulk)",
      optional: !s.serial,
    },
    ...(s.kind === "loss"
      ? [
          {
            name: "lossRef",
            label: "Loss evidence reference (unique per portion)",
            maxLength: 160,
          },
        ]
      : [
          {
            name: "receiptRef",
            label: "Recovery reference (unique per portion)",
            maxLength: 160,
          },
          { name: "bin", label: "Destination bin", maxLength: 160 },
          {
            name: "condition",
            label: "Condition",
            value: "quarantine",
            options: ["usable", "quarantine", "damaged"].map((v) => ({
              value: v,
              label: v,
            })),
          },
        ]),
    {
      name: "reason",
      label: "Reason / evidence",
      type: "textarea",
      maxLength: 1000,
    },
  ];
}
function OriginalReview({ attempt }: { attempt: Attempt }) {
  const s = attempt.selection,
    p = attempt.payload;
  return (
    <>
      <p>
        Recover the original submitted operation. Do not repeat the physical
        write-off or stock recovery. This receipt describes the original
        operation; inspect current stock and transfer history before further
        work.
      </p>
      <dl>
        <dt>Product</dt>
        <dd>{s.product}</dd>
        <dt>Transfer</dt>
        <dd>{s.transferId}</dd>
        <dt>Route</dt>
        <dd>
          {s.source} → {s.destination}
        </dd>
        <dt>Recorded serial</dt>
        <dd>{s.serial ?? "Bulk stock"}</dd>
        <dt>Submitted serial</dt>
        <dd>{p.serial ?? "Bulk stock"}</dd>
        <dt>Units</dt>
        <dd>{p.quantity}</dd>
        {"lossRef" in p ? (
          <>
            <dt>Loss reference</dt>
            <dd>{p.lossRef}</dd>
            <dt>Original transit revision</dt>
            <dd>{p.revision}</dd>
          </>
        ) : (
          <>
            <dt>Approved loss reference</dt>
            <dd>{s.kind === "recovery" ? s.lossRef : ""}</dd>
            <dt>Recovery reference</dt>
            <dd>{p.receiptRef}</dd>
            <dt>Destination bin</dt>
            <dd>{p.bin}</dd>
            <dt>Condition</dt>
            <dd>{p.condition}</dd>
          </>
        )}
        <dt>Reason / evidence</dt>
        <dd>{p.reason}</dd>
      </dl>
    </>
  );
}

export function TransferLoss({
  orgId,
  actorId,
  kind,
  selection,
  close,
  saved,
}: {
  orgId: string;
  actorId: string;
  kind: LossSelection["kind"];
  selection: LossSelection | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const operation =
    kind === "loss"
      ? "transfer loss approval"
      : "found transfer stock recovery";
  const storageKey = `distributor-transfer-${kind}:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey, kind));
  // Storage events may update the banner; they cannot replace an open review.
  const [review, setReview] = useState<Review | null>(() =>
    selection
      ? {
          selection: recovery.attempt?.selection ?? selection,
          attempt: recovery.attempt,
        }
      : null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [invalid, setInvalid] = useState(false);
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
  }, [storageKey, kind]);
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
          "Close this review, refresh Inventory and review current transfer custody again.",
      );
      return;
    }
    const s = review.selection,
      input = review.attempt ?? newAttempt(s, values);
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw Error(
          `This browser cannot coordinate ${operation} between tabs. Use a browser with Web Locks support.`,
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              `Another tab is submitting ${operation}. Wait for its outcome before retrying.`,
            );
          const current = retained(storageKey, kind);
          if (current.error) throw Error(current.error);
          if (
            review.attempt
              ? JSON.stringify(current.attempt) !== JSON.stringify(input)
              : !!current.attempt
          )
            throw Error(
              "Transfer loss/recovery evidence changed in another tab. Close this review and review the retained original operation before retrying.",
            );
          try {
            parseAttempt(JSON.stringify(input), kind);
          } catch {
            throw Error(
              "Check quantity, serial, reference, reason and any destination details before submitting. Nothing was sent.",
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
                "The operation could not be retained. Restore browser storage before retrying.",
            );
          const clearAttempt = () => {
            const latest = retained(storageKey, kind);
            if (
              latest.error ||
              JSON.stringify(latest.attempt) !== JSON.stringify(input)
            )
              throw Error(
                "Transfer loss/recovery evidence changed. Reconcile the original operation before retrying; retained evidence has been preserved.",
              );
            localStorage.removeItem(storageKey);
            const cleared = retained(storageKey, kind);
            if (cleared.error || cleared.attempt)
              throw Error(
                "Transfer loss/recovery evidence could not be cleared. Retry the retained exact operation after restoring browser storage.",
              );
          };
          let result: unknown;
          try {
            result = await request(
              `/api/commands/transfer.${kind === "loss" ? "loss" : "recover"}`,
              {
                method: "POST",
                headers: { "idempotency-key": input.key },
                body: JSON.stringify(input.payload),
              },
            );
          } catch (e) {
            if (
              e instanceof RequestError &&
              [
                "VALIDATION",
                "SERIAL",
                "STATE",
                "QUANTITY",
                "REVISION",
              ].includes(e.code ?? "")
            ) {
              clearAttempt();
              if (active.current) {
                setReview({ selection: s, attempt: null });
                if (["STATE", "QUANTITY", "REVISION"].includes(e.code ?? ""))
                  setInvalid(true);
              }
            } else if (active.current)
              setReview({ selection: s, attempt: input });
            throw e;
          }
          if (!validReply(result, input)) {
            if (active.current) setReview({ selection: s, attempt: input });
            throw Error(
              "Transfer loss/recovery reply could not be confirmed. Retry the retained exact operation; do not repeat the stock change.",
            );
          }
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
        if (
          current.attempt &&
          JSON.stringify(current.attempt) === JSON.stringify(input)
        )
          setReview({ selection: s, attempt: input });
        setError(
          e instanceof Error
            ? e.message
            : "Transfer loss/recovery could not be confirmed.",
        );
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <section
      aria-label={
        kind === "loss"
          ? "Transfer loss approval recovery"
          : "Found transfer stock recovery"
      }
    >
      {recovery.error && (
        <p role="alert" className="error">
          {recovery.error}
        </p>
      )}
      {recovery.attempt && (
        <p role="status">
          An original {operation} for {recovery.attempt.selection.product} is
          awaiting confirmation.{" "}
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
            Review retained {operation}
          </button>
        </p>
      )}
      {review && (
        <Modal
          dialog={{
            title:
              kind === "loss" ? "Approve transit loss" : "Recover lost stock",
            fields: review.attempt ? [] : fields(review.selection),
            perform: submit,
            submitLabel: review.attempt
              ? `Retry exact ${operation}`
              : "Continue",
            description: review.attempt ? (
              <OriginalReview attempt={review.attempt} />
            ) : (
              `Review ${review.selection.product} on ${review.selection.source} → ${review.selection.destination}. Confirm the physical evidence and quantity before ${kind === "loss" ? "approving a transit write-off" : "recording found stock at the destination"}.`
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
