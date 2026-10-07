import { useEffect, useState } from "react";
import { request, RequestError } from "./api.ts";
import { ControlIcon } from "./control-icon.tsx";
import {
  minimumOrderAssessment,
  type CustomerMinimumOrder,
} from "../shared/customer-minimum-order.ts";

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amount / 100,
  );
// Parse decimal text directly into cents; reject rounding, exponents and unsafe integers.
export function minimumAmount(text: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text.trim())) return null;
  const [whole, fraction = ""] = text.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 1e12
    ? amount
    : null;
}
type Attempt = {
  key: string;
  payload: {
    accountId: string;
    expectedRevision: number;
    minimumSubtotal: number;
    minimumEquipmentQuantity: number;
    reason: string;
  };
};
export function CustomerMinimumOrderControls({
  accountId,
  recoveryScope,
  editable = false,
  refreshKey,
}: {
  accountId: string;
  recoveryScope?: string;
  editable?: boolean;
  refreshKey?: string;
}) {
  const storageKey = `distributor-minimum-order:${recoveryScope}:${accountId}`;
  const [recovery] = useState(() => {
    try {
      if (!editable) return { attempt: null, error: "" };
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { attempt: null, error: "" };
      const a = JSON.parse(raw) as Attempt;
      if (
        raw.length > 10000 ||
        !/^[a-f0-9-]{36}$/.test(a.key) ||
        a.payload?.accountId !== accountId ||
        !Number.isSafeInteger(a.payload.expectedRevision) ||
        a.payload.expectedRevision < 0 ||
        !Number.isSafeInteger(a.payload.minimumSubtotal) ||
        a.payload.minimumSubtotal < 0 ||
        a.payload.minimumSubtotal > 1e12 ||
        !Number.isSafeInteger(a.payload.minimumEquipmentQuantity) ||
        a.payload.minimumEquipmentQuantity < 0 ||
        a.payload.minimumEquipmentQuantity > 100000 ||
        typeof a.payload.reason !== "string" ||
        !a.payload.reason.trim() ||
        a.payload.reason.length > 1000
      )
        throw Error();
      return { attempt: a, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Saved minimum order change cannot be read. Restore browser storage and reload before changing this record.",
      };
    }
  });
  const [attempt, setAttempt] = useState<Attempt | null>(recovery.attempt),
    [blocked, setBlocked] = useState(recovery.error);
  const [policy, setPolicy] = useState<CustomerMinimumOrder | null>(null),
    [amount, setAmount] = useState("0.00"),
    [units, setUnits] = useState("0"),
    [reason, setReason] = useState("");
  const [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [rejected, setRejected] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setPolicy(null);
    setError("");
    void request<CustomerMinimumOrder>(
      `/api/accounts/${encodeURIComponent(accountId)}/minimum-order`,
      { signal: c.signal },
    )
      .then((p) => {
        if (c.signal.aborted) return;
        setPolicy(p);
        setAmount((p.minimumSubtotal / 100).toFixed(2));
        setUnits(String(p.minimumEquipmentQuantity));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [accountId, epoch, refreshKey]);
  async function send(a: Attempt) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(a));
      setAttempt(a);
      await request("/api/commands/account.minimum-order.save", {
        method: "POST",
        headers: { "idempotency-key": a.key },
        body: JSON.stringify(a.payload),
      });
      localStorage.removeItem(storageKey);
      setAttempt(null);
      setRejected(false);
      setReason("");
      setNotice("Minimum order saved.");
      setEpoch((e) => e + 1);
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof RequestError &&
        e.status < 500 &&
        ![401, 403, 408, 429].includes(e.status)
      )
        setRejected(true);
    } finally {
      setBusy(false);
    }
  }
  const subtotal = minimumAmount(amount),
    quantity =
      /^\d+$/.test(units) &&
      Number.isSafeInteger(Number(units)) &&
      Number(units) <= 100000
        ? Number(units)
        : null;
  return (
    <section className="panel minimum-order-panel" aria-label="Minimum order">
      <div className="minimum-order-heading">
        <h3>Minimum order</h3>
        {editable && (
          <button
            type="button"
            className="secondary icon-button"
            aria-label="Refresh minimum order requirements"
            title="Refresh minimum order requirements"
            disabled={busy || !!attempt || !!blocked}
            onClick={() => setEpoch((e) => e + 1)}
          >
            <ControlIcon name="refresh" />
          </button>
        )}
      </div>
      {editable && (
        <p>
          Merchandise subtotal before tax and freight, plus whole equipment
          units. Accessories do not count as equipment. Zero means no minimum
          for that requirement.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {blocked && <p role="alert">{blocked}</p>}
      {notice && <p role="status">{notice}</p>}
      {attempt && (
        <div className="pricing-recovery">
          <p role="status">
            A reviewed minimum order change is awaiting confirmation. Retry
            sends exactly the saved values and revision.
          </p>
          <p>
            Reviewed amount:{" "}
            {policy
              ? money(attempt.payload.minimumSubtotal, policy.currency)
              : `${attempt.payload.minimumSubtotal} cents`}
            . Equipment units: {attempt.payload.minimumEquipmentQuantity}.
            Reason: {attempt.payload.reason}
          </p>
          <button
            type="button"
            disabled={busy || !!blocked}
            onClick={() => void send(attempt)}
          >
            Retry saved minimum order change
          </button>
          {rejected && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                try {
                  localStorage.removeItem(storageKey);
                  setAttempt(null);
                  setRejected(false);
                  setEpoch((e) => e + 1);
                } catch {
                  setBlocked(
                    "Browser storage is unavailable. Restore it and reload.",
                  );
                }
              }}
            >
              Discard rejected change and reload
            </button>
          )}
        </div>
      )}
      {!policy ? (
        <p role="status">
          {error ? "Minimum order unavailable." : "Loading minimum order…"}
        </p>
      ) : editable && policy.canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              subtotal === null ||
              quantity === null ||
              !reason.trim() ||
              busy ||
              attempt ||
              blocked
            )
              return;
            void send({
              key: crypto.randomUUID(),
              payload: {
                accountId,
                expectedRevision: policy.revision,
                minimumSubtotal: subtotal,
                minimumEquipmentQuantity: quantity,
                reason: reason.trim(),
              },
            });
          }}
        >
          <fieldset
            className="record-form-card"
            disabled={busy || !!attempt || !!blocked}
          >
            <legend>Customer minimum order</legend>
            <label>
              Minimum merchandise subtotal ({policy.currency})
              <input
                type="text"
                inputMode="decimal"
                required
                value={amount}
                aria-invalid={subtotal === null}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            {subtotal === null && (
              <p role="alert">
                Enter a nonnegative amount with at most two decimal places, up
                to 10 billion.
              </p>
            )}
            <label>
              Minimum equipment units
              <input
                type="text"
                inputMode="numeric"
                required
                value={units}
                aria-invalid={quantity === null}
                onChange={(e) => setUnits(e.target.value)}
              />
            </label>
            {quantity === null && (
              <p role="alert">
                Enter a nonnegative whole number of equipment units, up to
                100,000.
              </p>
            )}
            <label>
              Reason for minimum order change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="record-form-note">
              Drafts can be saved below these minimums. Current requirements are
              checked when an order is submitted or approved.
            </p>
            <div className="record-form-footer">
              <button
                type="submit"
                disabled={
                  subtotal === null || quantity === null || !reason.trim()
                }
              >
                Save minimum order
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <dl className="minimum-order-summary">
            <div>
              <dt>Minimum merchandise subtotal</dt>
              <dd>
                {policy.minimumSubtotal === 0
                  ? "No minimum"
                  : money(policy.minimumSubtotal, policy.currency)}
                <small>Before tax and freight</small>
              </dd>
            </div>
            <div>
              <dt>Minimum equipment units</dt>
              <dd>
                {policy.minimumEquipmentQuantity === 0
                  ? "No minimum"
                  : policy.minimumEquipmentQuantity}
                <small>Accessories excluded</small>
              </dd>
            </div>
          </dl>
          <p className="minimum-order-guidance">
            Both requirements apply when you submit an order.
          </p>
        </>
      )}
    </section>
  );
}
export function MinimumOrderProgress({
  accountId,
  lines,
}: {
  accountId: string;
  lines: {
    quantity: number;
    unitPrice: number;
    serialized: number | boolean;
  }[];
}) {
  const [policy, setPolicy] = useState<CustomerMinimumOrder | null>(null),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setPolicy(null);
    setError("");
    void request<CustomerMinimumOrder>(
      `/api/accounts/${encodeURIComponent(accountId)}/minimum-order`,
      { signal: c.signal },
    )
      .then((p) => {
        if (!c.signal.aborted) setPolicy(p);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [accountId, epoch]);
  const assessment = policy ? minimumOrderAssessment(policy, lines) : null;
  return (
    <section aria-label="Order minimum progress">
      <h3>Minimum order</h3>
      {assessment && policy ? (
        <>
          <p>
            Minimum merchandise subtotal:{" "}
            {money(policy.minimumSubtotal, policy.currency)} before tax and
            freight. Minimum equipment units: {policy.minimumEquipmentQuantity}.
          </p>
          <p>
            Current merchandise subtotal:{" "}
            {money(assessment.subtotal, policy.currency)}. Equipment units:{" "}
            {assessment.equipmentQuantity}.
          </p>
          <p role="status">
            {assessment.met
              ? "Order minimums met."
              : `Still needed: ${money(assessment.missingSubtotal, policy.currency)} in merchandise and ${assessment.missingEquipmentQuantity} equipment units.`}
          </p>
          <p>
            Accessories do not count as equipment. You can save a draft below
            the minimums. Current policy and prices are checked on submission.
          </p>
        </>
      ) : (
        <p role={error ? "alert" : "status"}>
          {error || "Loading order minimums…"}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        onClick={() => setEpoch((e) => e + 1)}
      >
        Refresh order minimums
      </button>
    </section>
  );
}
