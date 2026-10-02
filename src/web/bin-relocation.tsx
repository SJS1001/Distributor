import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal, type Field } from "./modal.tsx";

export type BinStock = {
  id: string;
  warehouse_id: string;
  bin: string;
  serial: string | null;
  quantity: number;
  revision: number;
  condition: string;
};
export type BinSelection = {
  stock: BinStock;
  product: string;
  warehouse: string;
};
type Payload = {
  unitId: string;
  revision: number;
  sourceBin: string;
  bin: string;
  serial: string | null;
  quantity: number;
  reason: string;
};
type Attempt = { key: string; selection: BinSelection; payload: Payload };
const recoveryError =
  "Bin move recovery evidence cannot be read. Reconcile the previous attempt before moving stock; restore browser storage and reload.";
const integer = (value: number, min: number, max = 1000000000) =>
  Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value: unknown, max = 160): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
function retained(storageKey: string): {
  attempt: Attempt | null;
  error: string;
} {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return { attempt: null, error: "" };
    if (raw.length > 20000) throw Error();
    const a = JSON.parse(raw) as Attempt;
    const s = a.selection?.stock,
      p = a.payload;
    if (
      typeof a.key !== "string" ||
      !/^[a-f0-9-]{36}$/.test(a.key) ||
      !s ||
      !p ||
      !text(a.selection.product, 1000) ||
      !text(a.selection.warehouse, 1000) ||
      !text(s.id) ||
      !text(s.warehouse_id) ||
      !text(s.bin) ||
      !["usable", "quarantine", "damaged"].includes(s.condition) ||
      !(s.serial === null || text(s.serial)) ||
      !integer(s.quantity, 1, 100000) ||
      !integer(s.revision, 0, 999999998) ||
      p.unitId !== s.id ||
      p.revision !== s.revision ||
      p.sourceBin !== s.bin ||
      p.serial !== s.serial ||
      !text(p.bin) ||
      p.bin === p.sourceBin ||
      !text(p.reason, 1000) ||
      !integer(p.quantity, 1, s.quantity) ||
      (s.serial !== null && (s.quantity !== 1 || p.quantity !== 1)) ||
      Object.keys(p).sort().join() !==
        "bin,quantity,reason,revision,serial,sourceBin,unitId"
    )
      throw Error();
    return { attempt: a, error: "" };
  } catch {
    return { attempt: null, error: recoveryError };
  }
}
function validReply(result: unknown, a: Attempt) {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, any>,
    s = a.selection.stock,
    p = a.payload;
  const partial = p.quantity < s.quantity;
  return (
    text(r.id) &&
    text(r.relocationId) &&
    r.warehouseId === s.warehouse_id &&
    r.fromBin === p.sourceBin &&
    r.bin === p.bin &&
    r.serial === p.serial &&
    r.quantity === p.quantity &&
    integer(r.unitCost, 0) &&
    r.condition === s.condition &&
    (partial
      ? r.id !== s.id &&
        r.revision === 1 &&
        r.sourceUnitId === s.id &&
        r.sourceQuantity === s.quantity - p.quantity &&
        r.sourceRevision === s.revision + 1
      : r.id === s.id &&
        r.revision === s.revision + 1 &&
        r.sourceUnitId === undefined &&
        r.sourceQuantity === undefined &&
        r.sourceRevision === undefined)
  );
}

// A scoped, durable attempt precedes transport. Never reconstruct an uncertain
// command from current stock: a partial move may already have created its lot.
export function BinRelocation({
  orgId,
  actorId,
  selection,
  close,
  saved,
}: {
  orgId: string;
  actorId: string;
  selection: BinSelection | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const storageKey = `distributor-bin-move:${orgId}:${actorId}`;
  const [recovery, setRecovery] = useState(() => retained(storageKey));
  const [reviewRecovery, setReviewRecovery] = useState(false);
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
  const attempt = recovery.attempt;
  const selected = attempt?.selection ?? selection;
  const dismiss = () => {
    if (submitting.current) return;
    setReviewRecovery(false);
    setError("");
    setInvalid(false);
    close();
  };
  const submit = async (values: Record<string, any>) => {
    if (!selected || submitting.current) return;
    if (recovery.error || invalid) {
      setError(
        recovery.error ||
          "Close this review, refresh Inventory and physically review stock again.",
      );
      return;
    }
    const s = selected.stock;
    const input: Attempt = attempt ?? {
      key: crypto.randomUUID(),
      selection: {
        ...selected,
        stock: {
          id: s.id,
          warehouse_id: s.warehouse_id,
          bin: s.bin,
          serial: s.serial,
          quantity: s.quantity,
          revision: s.revision,
          condition: s.condition,
        },
      },
      payload: {
        unitId: s.id,
        revision: s.revision,
        sourceBin: String(values.sourceBin ?? "").trim(),
        bin: String(values.bin ?? "").trim(),
        serial: s.serial === null ? null : String(values.serial ?? "").trim(),
        quantity: s.serial === null ? values.quantity : 1,
        reason: String(values.reason ?? "").trim(),
      },
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.locks)
        throw Error(
          "This browser cannot coordinate bin moves between tabs. Use a browser with Web Locks support.",
        );
      await navigator.locks.request(
        storageKey,
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw Error(
              "Another tab is submitting a bin move. Wait for its outcome before retrying.",
            );
          const current = retained(storageKey);
          if (current.error) {
            if (active.current) setRecovery(current);
            throw Error(current.error);
          }
          if (
            current.attempt &&
            JSON.stringify(current.attempt) !== JSON.stringify(input)
          ) {
            if (active.current) setRecovery(current);
            throw Error(
              "Another tab retained a bin move. Review its original details and retry that exact move first.",
            );
          }
          localStorage.setItem(storageKey, JSON.stringify(input));
          let result: unknown;
          try {
            result = await request("/api/commands/stock.relocate", {
              method: "POST",
              headers: { "idempotency-key": input.key },
              body: JSON.stringify(input.payload),
            });
          } catch (e) {
            // These native refusals precede changes. Authorization, key conflicts,
            // unknown errors and transport loss keep the exact retained attempt.
            if (
              e instanceof RequestError &&
              ["VALIDATION", "REVISION", "STATE", "STOCK", "SERIAL"].includes(
                e.code ?? "",
              )
            ) {
              localStorage.removeItem(storageKey);
              if (active.current) {
                setRecovery({ attempt: null, error: "" });
                if (["REVISION", "STATE", "STOCK"].includes(e.code ?? ""))
                  setInvalid(true);
              }
            } else if (active.current)
              setRecovery({ attempt: input, error: "" });
            throw e;
          }
          if (!validReply(result, input)) {
            if (active.current) setRecovery({ attempt: input, error: "" });
            throw Error(
              "Bin move reply could not be confirmed. Retry the retained exact move; do not move the stock again.",
            );
          }
          localStorage.removeItem(storageKey);
          if (active.current) {
            setRecovery({ attempt: null, error: "" });
            setReviewRecovery(false);
            close();
            await saved();
          }
        },
      );
    } catch (e) {
      if (active.current) {
        setRecovery(retained(storageKey));
        setError(
          e instanceof Error ? e.message : "Bin move could not be confirmed.",
        );
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };
  const fields: Field[] = attempt
    ? []
    : [
        { name: "sourceBin", label: "Confirm current bin", scan: "single" },
        {
          name: "bin",
          label: "Destination bin in this warehouse",
          scan: "single",
        },
        ...(selected?.stock.serial
          ? [
              {
                name: "serial",
                label: "Scan stock serial",
                scan: "single" as const,
              },
            ]
          : [
              {
                name: "quantity",
                label: "Units to move",
                type: "number" as const,
                value: selected?.stock.quantity,
                min: 1,
                max: selected?.stock.quantity,
              },
            ]),
        {
          name: "reason",
          label: "Reason / evidence",
          type: "textarea",
          maxLength: 1000,
        },
      ];
  return (
    <section aria-label="Bin move recovery">
      {recovery.error && (
        <p role="alert" className="error">
          {recovery.error}
        </p>
      )}
      {error && !(selected && (selection || reviewRecovery)) && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {attempt && (
        <p role="status">
          A bin move for {attempt.selection.product} is awaiting confirmation.{" "}
          <button
            onClick={() => {
              setReviewRecovery(true);
              setError("");
            }}
          >
            Review retained bin move
          </button>
        </p>
      )}
      {selected && (selection || reviewRecovery) && (
        <Modal
          dialog={{
            title: "Move stock within warehouse",
            fields,
            perform: submit,
            submitLabel: attempt ? "Retry exact bin move" : "Confirm bin move",
            description: attempt ? (
              <>
                <p>
                  Recover the original submitted move. Do not repeat the
                  physical move. This receipt describes the original operation;
                  inspect current stock and history before further work.
                </p>
                <dl>
                  <dt>Product</dt>
                  <dd>{attempt.selection.product}</dd>
                  <dt>Warehouse</dt>
                  <dd>{attempt.selection.warehouse}</dd>
                  <dt>From bin</dt>
                  <dd>{attempt.payload.sourceBin}</dd>
                  <dt>To bin</dt>
                  <dd>{attempt.payload.bin}</dd>
                  <dt>Serial</dt>
                  <dd>{attempt.payload.serial ?? "Bulk stock"}</dd>
                  <dt>Units</dt>
                  <dd>{attempt.payload.quantity}</dd>
                  <dt>Condition</dt>
                  <dd>{attempt.selection.stock.condition}</dd>
                  <dt>Reason / evidence</dt>
                  <dd>{attempt.payload.reason}</dd>
                </dl>
              </>
            ) : (
              `Move all ${selected.stock.quantity} units of ${selected.product}${selected.stock.serial ? `, serial ${selected.stock.serial}` : " in this bulk lot, or select a smaller quantity to leave the remainder in its current bin"} from ${selected.warehouse} / ${selected.stock.bin}. Confirm both bins and the physical stock. The warehouse, original cost and condition remain the same. Reserved stock cannot move. For another warehouse, use Transfer.`
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
