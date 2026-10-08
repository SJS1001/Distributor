import React, { useEffect, useRef, useState } from "react";
import { request, RequestError } from "./api.ts";
import { sendRetainedCommand } from "./retained-command.ts";
import { usePages } from "./billing-inbox.tsx";
import type {
  PurchasingPolicy,
  PurchasingPolicyInput,
  ProductPurchasingPolicy,
  ProductPurchasingPolicyInput,
} from "../shared/purchasing.ts";
import type { CatalogProduct } from "../shared/catalog-lifecycle.ts";
import "./record-forms.css";
import "./purchasing-rules.css";

function ProductChoices({
  selected,
  change,
  disabled,
}: {
  selected: string[];
  change: (ids: string[]) => void;
  disabled: boolean;
}) {
  const rows = usePages<CatalogProduct>(
    "/api/catalog/products/page?state=active",
  );
  return (
    <fieldset disabled={disabled} className="policy-product-choices">
      <legend>Eligible products ({selected.length} selected)</legend>
      <div className="policy-products">
        {rows.items.map((p) => (
          <label key={p.id} className="purchasing-check">
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                change(
                  e.target.checked
                    ? [...selected, p.id]
                    : selected.filter((id) => id !== p.id),
                )
              }
            />
            {p.sku} — {p.name}
          </label>
        ))}
      </div>
      {selected.filter((id) => !rows.items.some((p) => p.id === id)).length >
        0 && (
        <p>
          Selections outside this page remain selected. Load more products to
          review them.
        </p>
      )}
      {rows.error && <p role="alert">{rows.error}</p>}
      {(rows.next || rows.error) && (
        <button
          type="button"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          Load more eligible product choices
        </button>
      )}
    </fieldset>
  );
}
function CustomerPolicy({
  accountId,
  refreshToken,
  recoveryScope,
}: {
  accountId: string;
  recoveryScope: string;
  refreshToken?: unknown;
}) {
  const storageKey = `distributor-purchasing:${recoveryScope}:${accountId}`;
  type Attempt = { key: string; payload: PurchasingPolicyInput };
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { attempt: null as Attempt | null, error: "" };
      const saved = JSON.parse(raw) as Attempt;
      const p = saved.payload;
      if (
        raw.length > 20000 ||
        !/^[a-f0-9-]{36}$/.test(saved.key) ||
        !p ||
        p.accountId !== accountId ||
        !Number.isInteger(p.revision) ||
        p.revision < 0 ||
        !["none", "all", "selected"].includes(p.mode) ||
        typeof p.requiresReview !== "boolean" ||
        !Array.isArray(p.productIds) ||
        !p.productIds.every((id) => typeof id === "string") ||
        typeof p.reason !== "string" ||
        !p.reason.trim() ||
        p.reason.length > 1000
      )
        throw Error();
      return { attempt: saved, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Saved purchasing change cannot be read. Restore browser storage and reload before changing this record.",
      };
    }
  });
  const dirty = useRef(!!recovery.attempt),
    pending = useRef(recovery.attempt);
  const [blocked, setBlocked] = useState(recovery.error);
  const reviewed = useRef<PurchasingPolicy | null>(null);
  const [latest, setLatest] = useState<PurchasingPolicy | null>(null),
    [retained, setRetained] = useState(recovery.attempt);
  const [policy, setPolicy] = useState<PurchasingPolicy | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(recovery.attempt?.payload.reason ?? ""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (policy) reviewed.current = policy;
  }, [policy]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<PurchasingPolicy>(
      `/api/catalog/purchasing/${encodeURIComponent(accountId)}`,
      { signal: controller.signal },
    )
      .then((p) => {
        if (controller.signal.aborted) return;
        setLatest(p);
        if (!dirty.current && !pending.current) setPolicy(p);
        else if (reviewed.current) setPolicy(reviewed.current);
        else if (pending.current)
          setPolicy({ ...p, ...pending.current.payload });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
            setPolicy(null);
            setLatest(null);
          }
        }
      });
    return () => controller.abort();
  }, [accountId, epoch, refreshToken]);
  const stale = !!policy && !!latest && policy.revision !== latest.revision;
  async function save(attempt: Attempt) {
    let definitivelyRejected = false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await sendRetainedCommand(
        storageKey,
        "catalog.purchasing.set",
        attempt,
        () => {
          pending.current = attempt;
          setRetained(attempt);
        },
        () => {
          definitivelyRejected = true;
          pending.current = null;
          setRetained(null);
        },
      );
      pending.current = null;
      setRetained(null);
      dirty.current = false;
      setReason("");
      setNotice("Customer purchasing rules saved.");
      setEpoch((e) => e + 1);
    } catch (e) {
      setError((e as Error).message);
      if (!pending.current && !definitivelyRejected)
        setBlocked((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {blocked && <p role="alert">{blocked}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {stale && (
        <p role="status">
          Purchasing rules changed since this draft was reviewed. Your edits and
          reviewed revision are retained. Current rules: {latest?.mode} product
          access;{" "}
          {latest?.requiresReview
            ? "every order requires approval"
            : "orders follow product review rules"}
          ; {latest?.productIds.length ?? 0} selected products; revision{" "}
          {latest?.revision}.
        </p>
      )}
      {stale && !retained && latest && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPolicy((p) =>
              p ? { ...p, revision: latest.revision } : latest,
            );
          }}
        >
          Use latest purchasing revision for this draft
        </button>
      )}
      {retained && policy && (
        <div role="status">
          <p>
            A purchasing change needs confirmation. Retry sends the identical
            saved values and revision.
          </p>
          <button
            type="button"
            disabled={busy || !policy || !!blocked}
            onClick={() => void save(retained)}
          >
            Retry saved purchasing change
          </button>
        </div>
      )}
      {policy ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (stale || retained || blocked) return;
            void save({
              key: crypto.randomUUID(),
              payload: {
                ...policy,
                productIds: policy.mode === "selected" ? policy.productIds : [],
                reason,
              },
            });
          }}
        >
          <fieldset
            disabled={busy || !!retained || !!blocked}
            className="record-form-card"
          >
            <legend>Customer purchasing access</legend>
            <label className="purchasing-access">
              Catalog access
              <select
                aria-label="Catalog access"
                value={policy.mode}
                onChange={(e) => {
                  dirty.current = true;
                  setPolicy({
                    ...policy,
                    mode: e.target.value as PurchasingPolicy["mode"],
                  });
                }}
              >
                <option value="none">No product access</option>
                <option value="selected">Selected products</option>
                <option value="all">All active products</option>
              </select>
            </label>
            <label className="purchasing-check">
              <input
                type="checkbox"
                checked={policy.requiresReview}
                onChange={(e) => {
                  dirty.current = true;
                  setPolicy({ ...policy, requiresReview: e.target.checked });
                }}
              />
              Require distributor approval for every order
            </label>
            {policy.mode === "selected" && (
              <ProductChoices
                selected={policy.productIds}
                change={(productIds) => {
                  dirty.current = true;
                  setPolicy({ ...policy, productIds });
                }}
                disabled={busy}
              />
            )}
            <label>
              Reason for purchasing rule change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  dirty.current = true;
                  setReason(e.target.value);
                }}
              />
            </label>
            <p className="record-form-note">
              Changing access applies to browsing and subsequent cart, quote and
              acceptance checks. Product rules may independently require review.
            </p>
            <div className="record-form-footer">
              <button type="submit" disabled={stale}>
                Save customer purchasing rules
              </button>
              {(error || refreshToken === undefined) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setEpoch((e) => e + 1)}
                >
                  Reload current purchasing rules
                </button>
              )}
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p role="status">
            {error
              ? "Rules unavailable. Reload to retry."
              : "Loading purchasing rules…"}
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setEpoch((e) => e + 1)}
          >
            Reload current purchasing rules
          </button>
        </>
      )}
    </>
  );
}
export function CustomerPurchasingRules({
  accounts,
  selectedOnly = false,
  refreshToken,
  recoveryScope = "standalone",
}: {
  recoveryScope?: string;
  selectedOnly?: boolean;
  refreshToken?: unknown;
  accounts: { id: string; name: string }[];
}) {
  const [id, setId] = useState(accounts[0]?.id ?? "");
  return (
    <section className="panel customer-purchasing-rules">
      <h3>Customer purchasing rules</h3>
      {!selectedOnly && (
        <label>
          Customer for purchasing rules
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {id ? (
        <CustomerPolicy
          key={`${recoveryScope}:${id}`}
          accountId={id}
          refreshToken={refreshToken}
          recoveryScope={recoveryScope}
        />
      ) : (
        <p>Create a customer before assigning product access.</p>
      )}
    </section>
  );
}
export function ProductPurchasingRules({
  productId,
  recoveryScope = "standalone",
  refreshToken,
}: {
  productId: string;
  recoveryScope?: string;
  refreshToken?: unknown;
}) {
  const storageKey = `distributor-product-purchasing:${recoveryScope}:${productId}`;
  type Attempt = { key: string; payload: ProductPurchasingPolicyInput };
  const [recovery] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { attempt: null as Attempt | null, error: "" };
      const saved = JSON.parse(raw) as Attempt;
      const p = saved.payload;
      if (
        raw.length > 20000 ||
        !/^[a-f0-9-]{36}$/.test(saved.key) ||
        !p ||
        p.productId !== productId ||
        !Number.isInteger(p.revision) ||
        p.revision < 0 ||
        typeof p.requiresReview !== "boolean" ||
        typeof p.reason !== "string" ||
        !p.reason.trim() ||
        p.reason.length > 1000
      )
        throw Error();
      return { attempt: saved, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Saved purchasing change cannot be read. Restore browser storage and reload before changing this record.",
      };
    }
  });
  const dirty = useRef(!!recovery.attempt),
    pending = useRef(recovery.attempt);
  const [blocked, setBlocked] = useState(recovery.error);
  const reviewed = useRef<ProductPurchasingPolicy | null>(null);
  const [latest, setLatest] = useState<ProductPurchasingPolicy | null>(null),
    [retained, setRetained] = useState(recovery.attempt);
  const [policy, setPolicy] = useState<ProductPurchasingPolicy | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(recovery.attempt?.payload.reason ?? ""),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (policy) reviewed.current = policy;
  }, [policy]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void request<ProductPurchasingPolicy>(
      `/api/catalog/products/${encodeURIComponent(productId)}/purchasing`,
      { signal: controller.signal },
    )
      .then((p) => {
        if (controller.signal.aborted) return;
        setLatest(p);
        if (!dirty.current && !pending.current) setPolicy(p);
        else if (reviewed.current) setPolicy(reviewed.current);
        else if (pending.current)
          setPolicy({ ...p, ...pending.current.payload });
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
            setPolicy(null);
            setLatest(null);
          }
        }
      });
    return () => controller.abort();
  }, [productId, epoch, refreshToken]);
  const stale = !!policy && !!latest && policy.revision !== latest.revision;
  async function save(attempt: Attempt) {
    let definitivelyRejected = false;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await sendRetainedCommand(
        storageKey,
        "catalog.product-purchasing.set",
        attempt,
        () => {
          pending.current = attempt;
          setRetained(attempt);
        },
        () => {
          definitivelyRejected = true;
          pending.current = null;
          setRetained(null);
        },
      );
      pending.current = null;
      setRetained(null);
      dirty.current = false;
      setReason("");
      setNotice("Product purchasing rule saved.");
      setEpoch((e) => e + 1);
    } catch (e) {
      setError((e as Error).message);
      if (!pending.current && !definitivelyRejected)
        setBlocked((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>Product purchasing rules</h3>
      {blocked && <p role="alert">{blocked}</p>}
      {error && <p role="alert">{error}</p>}
      {stale && (
        <p role="status">
          Product purchasing rules changed since this draft was reviewed. Your
          edits and reviewed revision are retained. Current revision{" "}
          {latest?.revision}.
        </p>
      )}
      {stale && !retained && latest && (
        <button
          type="button"
          disabled={busy || !!blocked}
          onClick={() =>
            setPolicy((p) => (p ? { ...p, revision: latest.revision } : latest))
          }
        >
          Use latest product purchasing revision for this draft
        </button>
      )}
      {retained && policy && (
        <div role="status">
          <p>
            A product purchasing change needs confirmation. Retry sends the
            identical saved values and revision.
          </p>
          <button
            type="button"
            disabled={busy || !!blocked}
            onClick={() => void save(retained)}
          >
            Retry saved product purchasing change
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!policy && (
        <>
          {!error && <p role="status">Loading product purchasing rule…</p>}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setEpoch(epoch + 1)}
          >
            Reload product purchasing rule
          </button>
        </>
      )}
      {policy && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (stale || retained || blocked) return;
            void save({
              key: crypto.randomUUID(),
              payload: { ...policy, reason },
            });
          }}
        >
          <fieldset
            disabled={busy || !!retained || !!blocked}
            className="record-form-card"
          >
            <legend>Order review</legend>
            <label className="record-form-check">
              <input
                type="checkbox"
                checked={policy.requiresReview}
                onChange={(e) => {
                  dirty.current = true;
                  setPolicy({ ...policy, requiresReview: e.target.checked });
                }}
              />
              Require distributor approval for orders containing this product
            </label>
            <label>
              Reason for product rule change
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  dirty.current = true;
                  setReason(e.target.value);
                }}
              />
            </label>
            <p className="record-form-note">
              Customer entitlement is managed in Customers → Customer purchasing
              rules.
            </p>
            <div className="record-form-footer">
              <button type="submit" disabled={stale}>
                Save product purchasing rule
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEpoch(epoch + 1)}
              >
                Reload product purchasing rule
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </>
  );
}
