import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request, RequestError } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import { Modal } from "./modal.tsx";
import type {
  SupplierChoice,
  SupplierAvailabilityReview,
} from "../shared/supplier-search.ts";

type Attempt = {
  key: string;
  supplier: SupplierChoice;
  payload: {
    supplierId: string;
    revision: number;
    active: boolean;
    reason: string;
  };
};
function retained(storageKey: string): {
  attempt: Attempt | null;
  error: string;
} {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { attempt: null, error: "" };
    if (raw.length > 10000) throw Error();
    const attempt = JSON.parse(raw) as Attempt;
    const { supplier, payload, key } = attempt;
    if (
      typeof key !== "string" ||
      !/^[a-f0-9-]{36}$/.test(key) ||
      typeof supplier?.id !== "string" ||
      !supplier.id ||
      typeof supplier.name !== "string" ||
      typeof supplier.active !== "boolean" ||
      !Number.isInteger(supplier.revision) ||
      supplier.revision < 0 ||
      supplier.revision > 99999998 ||
      payload?.supplierId !== supplier.id ||
      payload.revision !== supplier.revision ||
      payload.active !== !supplier.active ||
      typeof payload.reason !== "string" ||
      !payload.reason.trim() ||
      payload.reason.length > 1000
    )
      throw Error();
    return { attempt, error: "" };
  } catch {
    return {
      attempt: null,
      error:
        "Supplier change recovery evidence cannot be read. Reconcile the previous attempt before making another change; restore browser storage and reload.",
    };
  }
}

function SupplierRows({
  q,
  canManage,
  blocked,
  select,
}: {
  q: string;
  canManage: boolean;
  blocked: boolean;
  select: (supplierId: string, manage: boolean) => void;
}) {
  const rows = usePages<SupplierChoice>(
    `/api/purchases/suppliers/page?q=${encodeURIComponent(q)}`,
  );
  return (
    <section aria-label="Supplier directory">
      <p role="status">
        {rows.items.length} {rows.items.length === 1 ? "supplier" : "suppliers"}{" "}
        loaded
        {rows.busy ? " · Loading…" : ""}
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      {rows.items.length > 0 && (
        <div
          className="table-wrap"
          role="region"
          tabIndex={0}
          aria-label="Supplier availability"
        >
          <p className="table-scroll-cue">
            Scroll across the table to review all fields and actions.
          </p>
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>New purchasing</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <strong>{supplier.name}</strong>
                  </td>
                  <td>
                    <span
                      className="record-status purchasing-status"
                      data-status={supplier.active ? undefined : "closed"}
                    >
                      {supplier.active ? "Available" : "Suspended"}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      {canManage && (
                        <button
                          className="secondary"
                          disabled={blocked}
                          onClick={() => select(supplier.id, true)}
                          aria-label={`${supplier.active ? "Suspend purchasing from" : "Resume purchasing from"} ${supplier.name}`}
                        >
                          {supplier.active
                            ? "Suspend purchasing"
                            : "Resume purchasing"}
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() => select(supplier.id, false)}
                        aria-label={`Purchasing availability history ${supplier.name}`}
                      >
                        Purchasing availability history
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p className="empty">
          {q ? "No suppliers match this search." : "No suppliers yet."}
        </p>
      )}
      {(rows.next || rows.error) && (
        <button disabled={rows.busy} onClick={() => void rows.load()}>
          {rows.error
            ? "Retry supplier directory"
            : "Next supplier directory page"}
        </button>
      )}
    </section>
  );
}

// Each history refresh owns its cursor. Failed pages retain the same cursor and
// existing rows; a newer change never silently replaces the reviewed revision.
function SupplierReview({
  supplierId,
  manage,
  attempt,
  blocked,
  save,
  close,
}: {
  supplierId: string;
  manage: boolean;
  attempt: Attempt | null;
  blocked: string;
  save: (attempt: Attempt) => Promise<void>;
  close: () => void;
}) {
  const [review, setReview] = useState<SupplierAvailabilityReview | null>(null);
  const [reason, setReason] = useState(attempt?.payload.reason ?? "");
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const active = useRef(true),
    loading = useRef<AbortController | null>(null),
    current = useRef<SupplierAvailabilityReview | null>(null),
    failedRefresh = useRef(false),
    submitting = useRef(false);
  const load = async (refresh = false) => {
    if (
      loading.current ||
      (!refresh && current.current && !current.current.next)
    )
      return;
    const controller = new AbortController();
    loading.current = controller;
    setBusy(true);
    setReadError("");
    if (refresh) {
      setError("");
      setInvalid(true);
    }
    const previous = refresh ? null : current.current;
    try {
      const page = await request<SupplierAvailabilityReview>(
        `/api/purchases/suppliers/${encodeURIComponent(supplierId)}/availability${previous?.next ? `?after=${encodeURIComponent(previous.next)}` : ""}`,
        { signal: controller.signal },
      );
      if (!active.current || controller.signal.aborted) return;
      const merged = {
        ...page,
        supplier: previous?.supplier ?? page.supplier,
        changes: [...(previous?.changes ?? []), ...page.changes],
      };
      current.current = merged;
      setReview(merged);
      failedRefresh.current = false;
      if (refresh) setInvalid(false);
    } catch (e) {
      if (active.current && !controller.signal.aborted) {
        failedRefresh.current = refresh;
        setReadError(
          e instanceof Error
            ? e.message
            : "Supplier review could not be loaded.",
        );
      }
    } finally {
      if (loading.current === controller) {
        loading.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      loading.current?.abort();
    };
  }, []);
  const submit = async () => {
    if (!manage) {
      close();
      return;
    }
    if (busy || submitting.current) return;
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!attempt && (!review || invalid)) {
      setError("Refresh the supplier review before making a change.");
      return;
    }
    if (!attempt && (!reason.trim() || reason.trim().length > 1000)) {
      setError(
        "Enter a reason or evidence for this change (up to 1,000 characters).",
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    const supplier = attempt?.supplier ?? review!.supplier;
    try {
      await save(
        attempt ?? {
          key: crypto.randomUUID(),
          supplier,
          payload: {
            supplierId,
            revision: supplier.revision,
            active: !supplier.active,
            reason: reason.trim(),
          },
        },
      );
    } catch (e) {
      if (active.current) {
        setError(
          e instanceof Error
            ? e.message
            : "Supplier change could not be confirmed.",
        );
        if (
          e instanceof RequestError &&
          ["REVISION", "SUPPLIER_STATE"].includes(e.code ?? "")
        )
          setInvalid(true);
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };
  const supplier = attempt?.supplier ?? review?.supplier;
  return (
    <Modal
      dialog={{
        title: manage
          ? "Review supplier purchasing"
          : "Purchasing availability history",
        readOnly: !manage,
        fields: [
          {
            name: "review",
            label: "Supplier review",
            content: (
              <>
                {supplier && (
                  <p>
                    {supplier.name} ·{" "}
                    {supplier.active
                      ? "Available for new purchasing"
                      : "Suspended for new purchasing"}{" "}
                    · reviewed revision {supplier.revision}
                  </p>
                )}
                <p>
                  Suspension stops new purchase orders. Existing orders, saved
                  receipts and supplier returns retain their original
                  commitments and costs.
                </p>
                {attempt && (
                  <p>
                    A submitted change is retained. Retry its exact details to
                    confirm the outcome. Closing or signing out cannot cancel
                    it; recovery is available in this browser for this staff
                    account.
                  </p>
                )}
                {manage && (
                  <label>
                    Supplier change reason / evidence
                    <textarea
                      aria-label="Supplier change reason / evidence"
                      required
                      maxLength={1000}
                      value={attempt?.payload.reason ?? reason}
                      disabled={busy || !!attempt || !!blocked}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                )}
                {!attempt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void load(true)}
                  >
                    Refresh supplier review
                  </button>
                )}
                {review && (
                  <section aria-label="Supplier purchasing changes">
                    <p role="status">{review.changes.length} changes loaded</p>
                    <div
                      className="table-wrap"
                      role="region"
                      tabIndex={0}
                      aria-label="Supplier availability"
                    >
                      <p className="table-scroll-cue">
                        Scroll across the table to review all fields and
                        actions.
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Change</th>
                            <th>Reason</th>
                            <th>Actor ID</th>
                            <th>Receipt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.changes.map((row) => (
                            <tr key={row.id}>
                              <td>{row.createdAt}</td>
                              <td>
                                {row.active
                                  ? "Resumed purchasing"
                                  : "Suspended purchasing"}{" "}
                                · revision {row.revision}
                              </td>
                              <td>{row.reason}</td>
                              <td>{row.actorId}</td>
                              <td>{row.id}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!review.changes.length && (
                      <p>No availability changes recorded.</p>
                    )}
                  </section>
                )}
                {!review && busy && (
                  <p role="status">Loading supplier review…</p>
                )}
                {readError && (
                  <p role="alert" className="error">
                    {readError}
                  </p>
                )}
                {(review?.next || readError) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void load(failedRefresh.current)}
                  >
                    {readError
                      ? "Retry supplier history"
                      : "Load older supplier changes"}
                  </button>
                )}
              </>
            ),
          },
        ],
        perform: submit,
        submitLabel: !manage
          ? "Close supplier history"
          : attempt
            ? "Retry exact supplier change"
            : supplier?.active === false
              ? "Resume supplier purchasing"
              : "Suspend supplier purchasing",
      }}
      busy={busy}
      error={error}
      close={close}
      submit={submit}
    />
  );
}

export function SupplierAvailability({
  orgId,
  actorId,
  canManage,
}: {
  orgId: string;
  actorId: string;
  canManage: boolean;
}) {
  const storageKey = `distributor-supplier-change:${orgId}:${actorId}`;
  const [recovery] = useState(() => retained(storageKey));
  const [attempt, setAttempt] = useState(recovery.attempt);
  const [view, setView] = useState<{
    supplierId: string;
    manage: boolean;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState({ q: "", epoch: 0 });
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const save = async (input: Attempt) => {
    await navigator.locks.request(
      storageKey,
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw Error(
            "Another tab is submitting a supplier change for this staff account. Wait for its outcome before retrying.",
          );
        const current = retained(storageKey);
        if (current.error) throw Error(current.error);
        if (current.attempt && current.attempt.key !== input.key) {
          if (active.current) {
            setAttempt(current.attempt);
            setView({ supplierId: current.attempt.supplier.id, manage: true });
          }
          throw Error(
            "Another tab retained a supplier change. Review and retry its exact details before making another change.",
          );
        }
        localStorage.setItem(storageKey, JSON.stringify(input));
        if (active.current) setAttempt(input);
        let result: SupplierChoice;
        try {
          result = await request<SupplierChoice>(
            "/api/commands/supplier.availability",
            {
              method: "POST",
              headers: { "idempotency-key": input.key },
              body: JSON.stringify(input.payload),
            },
          );
        } catch (e) {
          // These exact native refusals precede mutation; cached success returns
          // first. Authority/key conflicts and lost responses retain the attempt.
          if (
            e instanceof RequestError &&
            ([400, 404].includes(e.status) ||
              ["REVISION", "SUPPLIER_STATE"].includes(e.code ?? ""))
          ) {
            localStorage.removeItem(storageKey);
            if (active.current) setAttempt(null);
          }
          throw e;
        }
        if (
          result.id !== input.supplier.id ||
          result.active !== input.payload.active ||
          result.revision !== input.payload.revision + 1
        )
          throw Error(
            "Supplier change reply could not be confirmed. Retry the retained attempt.",
          );
        localStorage.removeItem(storageKey);
        if (active.current) {
          setAttempt(null);
          setView(null);
          setSelection((value) => ({ ...value, epoch: value.epoch + 1 }));
          setNotice(
            `${input.supplier.name}: ${result.active ? "purchasing resumed" : "new purchasing suspended"}.`,
          );
        }
      },
    );
  };
  return (
    <section
      className="ledger-section supplier-directory"
      aria-label="Supplier purchasing availability"
    >
      <div className="info-heading">
        <h2>Suppliers</h2>
        <InfoBubble label="Suppliers">
          Review purchasing availability and its history. Search includes
          suspended suppliers.
        </InfoBubble>
      </div>
      {notice && <p role="status">{notice}</p>}
      {recovery.error && (
        <p role="alert" className="error">
          {recovery.error}
        </p>
      )}
      {attempt && (
        <p role="status">
          A supplier change for {attempt.supplier.name} is awaiting
          confirmation.{" "}
          {canManage && (
            <button
              onClick={() =>
                setView({ supplierId: attempt.supplier.id, manage: true })
              }
            >
              Review retained supplier change
            </button>
          )}
        </p>
      )}
      <form
        className="queue-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSelection({ q: search.trim(), epoch: selection.epoch + 1 });
        }}
      >
        <label className="queue-field">
          Supplier directory search
          <input
            maxLength={120}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="queue-field-actions">
          <button type="submit" className="secondary">
            Search supplier directory
          </button>
        </div>
      </form>
      <SupplierRows
        key={selection.epoch}
        q={selection.q}
        canManage={canManage}
        blocked={!!attempt || !!recovery.error}
        select={(supplierId, manage) => setView({ supplierId, manage })}
      />
      {view && (
        <SupplierReview
          key={view.supplierId + String(view.manage)}
          supplierId={view.supplierId}
          manage={view.manage && canManage}
          attempt={
            view.manage && attempt?.supplier.id === view.supplierId
              ? attempt
              : null
          }
          blocked={recovery.error}
          save={save}
          close={() => setView(null)}
        />
      )}
    </section>
  );
}
