import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { Modal } from "./modal.tsx";
import type { CartLine } from "../shared/customer-products.ts";

export type CartSave = {
  accountId: string;
  warehouseId: string;
  revision: number;
  lines: CartLine[];
};
export type CartSaveReview = {
  account: string;
  warehouse: string;
  products: { id: string; sku: string; name: string }[];
};
type Attempt = { key: string; payload: CartSave; review: CartSaveReview };
const changed = "distributor-cart-recovery-changed";
const evidenceError =
  "Cart save recovery evidence cannot be read. Reconcile the previous attempt before saving another cart; restore browser storage and reload.";
const label = (value: unknown, max: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= max;
const integer = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;
export const cartRecoveryKey = (orgId: string, actorId: string) =>
  `distributor-cart-save:${orgId}:${actorId}`;

function retained(scope: string): Attempt | null {
  try {
    const raw = localStorage.getItem(scope);
    if (raw === null) return null;
    if (raw.length > 200000) throw Error();
    const a = JSON.parse(raw) as Attempt;
    const p = a.payload,
      r = a.review;
    if (
      !label(a.key, 36) ||
      !/^[a-f0-9-]{36}$/.test(a.key) ||
      !p ||
      !r ||
      !label(p.accountId, 128) ||
      !label(p.warehouseId, 128) ||
      !integer(p.revision) ||
      !Array.isArray(p.lines) ||
      p.lines.length > 100 ||
      Object.keys(p).sort().join() !== "accountId,lines,revision,warehouseId" ||
      !label(r.account, 1000) ||
      !label(r.warehouse, 1000) ||
      !Array.isArray(r.products) ||
      r.products.length !== p.lines.length
    )
      throw Error();
    const seen = new Set<string>();
    for (let i = 0; i < p.lines.length; i++) {
      const line = p.lines[i]!,
        product = r.products[i]!;
      if (
        !label(line.productId, 128) ||
        !integer(line.quantity, 1) ||
        Object.keys(line).sort().join() !== "productId,quantity" ||
        seen.has(line.productId) ||
        product?.id !== line.productId ||
        !label(product.sku, 1000) ||
        !label(product.name, 1000)
      )
        throw Error();
      seen.add(line.productId);
    }
    return a;
  } catch {
    throw Error(evidenceError);
  }
}
function notify() {
  window.dispatchEvent(new Event(changed));
}
function forget(scope: string) {
  localStorage.removeItem(scope);
  notify();
}

// One retained save per browser profile/principal. Native revisions and fresh
// authority remain decisive across devices; browser evidence grants no access.
export async function saveReviewedCart(
  scope: string,
  payload?: CartSave,
  review?: CartSaveReview,
  expectedKey?: string,
): Promise<{ id: string; revision: number }> {
  if (!navigator.locks)
    throw Error(
      "Cart recovery requires browser coordination. Use a supported browser before saving.",
    );
  return navigator.locks.request(scope, { ifAvailable: true }, async (lock) => {
    if (!lock)
      throw Error(
        "Another tab is saving this cart. Wait, then recover the retained attempt.",
      );
    let attempt = retained(scope);
    if (expectedKey && attempt?.key !== expectedKey)
      throw Error(
        "Retained cart save changed. Close and review the current recovery evidence before continuing.",
      );
    if (
      attempt &&
      payload &&
      JSON.stringify(attempt.payload) !== JSON.stringify(payload)
    )
      throw Error(
        "Recover the retained cart save in Orders before saving different quantities or another cart.",
      );
    if (!attempt) {
      if (!payload || !review)
        throw Error(
          "No retained cart save. Refresh and review the current saved cart.",
        );
      attempt = { key: crypto.randomUUID(), payload, review };
      try {
        localStorage.setItem(scope, JSON.stringify(attempt));
        // Validate/reread the persisted evidence before any transport.
        attempt = retained(scope);
        if (!attempt) throw Error();
        notify();
      } catch {
        throw Error(
          "Cart save was not sent. Browser recovery storage is unavailable; restore it before continuing.",
        );
      }
    }
    let result: { id: string; revision: number };
    try {
      result = await request("/api/commands/cart.save", {
        method: "POST",
        headers: { "idempotency-key": attempt.key },
        body: JSON.stringify(attempt.payload),
      });
    } catch (error) {
      // These native checks precede effects. Authority/key conflicts can also
      // refuse a previously committed reply, so preserve that evidence.
      if (
        error instanceof RequestError &&
        ["VALIDATION", "REVISION"].includes(error.code ?? "")
      )
        forget(scope);
      throw error;
    }
    if (
      !result ||
      !label(result.id, 128) ||
      result.revision !== attempt.payload.revision + 1
    )
      throw Error(
        "Cart save reply could not be verified. Recover the retained attempt before saving different quantities.",
      );
    forget(scope);
    return result;
  });
}

export function CartSaveRecovery({
  scope,
  disabled,
  recovered,
}: {
  scope: string;
  disabled: boolean;
  recovered: () => Promise<unknown>;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [reviewed, setReviewed] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const read = () => {
      try {
        setAttempt(retained(scope));
        setError("");
      } catch (e) {
        setAttempt(null);
        setError((e as Error).message);
      }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener(changed, read);
    return () => {
      active.current = false;
      window.removeEventListener("storage", read);
      window.removeEventListener(changed, read);
    };
  }, [scope]);
  return (
    <>
      {error && !reviewed && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {attempt && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => {
            setError("");
            setReviewed(attempt);
          }}
        >
          Review retained cart save
        </button>
      )}
      {reviewed && (
        <Modal
          dialog={{
            title: "Recover reviewed cart save",
            fields: [],
            perform: async () => {},
            submitLabel: "Recover exact cart save",
            description: (
              <>
                <p>
                  {reviewed.review.account} · {reviewed.review.warehouse}.
                  Original reviewed quantities:
                </p>
                <ul>
                  {reviewed.payload.lines.map((l, i) => (
                    <li key={l.productId}>
                      {l.quantity} × {reviewed.review.products[i]!.sku} ·{" "}
                      {reviewed.review.products[i]!.name}
                    </li>
                  ))}
                </ul>
                {!reviewed.payload.lines.length && (
                  <p>Remove all saved items.</p>
                )}
                <p>
                  Recovery retrieves the original save receipt. It does not
                  quote or accept an order. The current cart may have changed
                  since this save; refresh and review it before continuing.
                </p>
              </>
            ),
          }}
          busy={busy}
          error={error}
          close={() => {
            setReviewed(null);
            setError("");
          }}
          submit={async () => {
            setBusy(true);
            setError("");
            try {
              await saveReviewedCart(
                scope,
                reviewed.payload,
                reviewed.review,
                reviewed.key,
              );
              if (!active.current) return;
              setReviewed(null);
              setAttempt(null);
              await recovered();
            } catch (e) {
              if (active.current) {
                try {
                  const remaining = retained(scope);
                  setAttempt(remaining);
                  if (!remaining || remaining.key !== reviewed.key)
                    setReviewed(null);
                } catch {
                  setReviewed(null);
                }
                setError((e as Error).message);
              }
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
