import React, { useEffect, useRef, useState } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { request } from "./api.ts";

type Item = Record<string, any>;
type Page<T extends Item = Item> = { items: T[]; next: string | number | null };

// Each mounted list owns its continuation and cancels reads on refresh,
// selection changes or sign-out. A failed read preserves its rows and cursor.
export function usePages<T extends Item = Item>(
  endpoint: string,
  initial?: Page<T>,
  cursorName: "after" | "before" = "after",
) {
  const [page, setPage] = useState<Page<T>>(
    initial ?? { items: [], next: null },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(initial);
  const pending = useRef<AbortController | null>(null);
  const active = useRef(true);
  const load = async () => {
    if (pending.current || (current.current && !current.current.next)) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    const previous = current.current;
    try {
      const result = await request<Page<T>>(
        endpoint +
          (previous?.next
            ? `${endpoint.includes("?") ? "&" : "?"}${cursorName}=${encodeURIComponent(previous.next)}`
            : ""),
        { signal: controller.signal },
      );
      if (!active.current || pending.current !== controller) return;
      const merged = {
        items: [...(previous?.items ?? []), ...result.items],
        next: result.next,
      };
      current.current = merged;
      setPage(merged);
    } catch (e) {
      if (
        active.current &&
        pending.current === controller &&
        !controller.signal.aborted
      )
        setError(
          e instanceof Error ? e.message : "History could not be loaded.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    active.current = true;
    if (!initial) void load();
    return () => {
      active.current = false;
      const controller = pending.current;
      pending.current = null;
      controller?.abort();
    };
  }, []);
  return { ...page, busy, error, load, loaded: !!current.current };
}

function HistoryList({
  publicationId,
  kind,
}: {
  publicationId: string;
  kind: "downloads" | "acknowledgments";
}) {
  const downloads = kind === "downloads";
  const title = downloads ? "Prepared PDF requests" : "Receipt confirmations";
  const rows = usePages(
    `/api/billing/inbox/${encodeURIComponent(publicationId)}/history/${kind}`,
  );
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} records loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{downloads ? "Requested" : "Confirmed"}</th>
                <th>Buyer</th>
                <th>Evidence</th>
                <th>PDF SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((r) => (
                <tr key={r.id}>
                  <td>{downloads ? r.requested_at : r.acknowledged_at}</td>
                  <td>{r.actor_name ?? r.actor_id}</td>
                  <td>
                    {downloads ? (
                      <>
                        {r.size} bytes · prepared only · request {r.id}
                      </>
                    ) : (
                      <>
                        {r.statement} · request {r.download_id}
                      </>
                    )}
                  </td>
                  <td>
                    <code>{r.content_hash}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p>No {title.toLowerCase()} are recorded for this view.</p>
      )}
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error
            ? downloads
              ? "Retry PDF requests"
              : "Retry receipt confirmations"
            : downloads
              ? "Load older PDF requests"
              : "Load older receipt confirmations"}
        </button>
      )}
    </section>
  );
}

function DocumentHistory({
  publication,
  personal,
  close,
}: {
  publication: Item;
  personal: boolean;
  close: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section aria-label="Document history">
      <div className="info-heading">
        <h2 ref={heading} tabIndex={-1}>
          Document history — {publication.number}
        </h2>
        <InfoBubble label="this section">
          Publication {publication.id} · {publication.state} when selected.{" "}
          {personal
            ? "Your own PDF requests and receipt confirmations."
            : "Authorized customer PDF requests and receipt confirmations."}{" "}
          Prepared requests do not prove delivery, saving or reading. Receipt
          confirmation does not confirm payment or agreement.
        </InfoBubble>
      </div>
      <button className="secondary" onClick={close}>
        Close document history
      </button>
      <HistoryList publicationId={publication.id} kind="downloads" />
      <HistoryList publicationId={publication.id} kind="acknowledgments" />
    </section>
  );
}

export function BillingInbox({
  initial,
  personal,
  accountName,
  renderActions,
}: {
  initial: Page;
  personal: boolean;
  accountName: (id: string) => string;
  renderActions: (publication: Item) => React.ReactNode;
}) {
  const rows = usePages("/api/billing/inbox/page", initial);
  const [selected, setSelected] = useState<Item | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <section className="ledger-section" aria-label="Customer document inbox">
        <div className="info-heading">
          <h2>Customer document inbox</h2>
          <InfoBubble label="Customer document inbox">
            Published PDFs are available to the customer account. Only a buyer's
            explicit confirmation records receipt. Withdrawing a publication
            preserves its history and the original invoice or credit. Refresh
            shows the newest documents and resets the history view.
          </InfoBubble>
        </div>
        <p>
          {personal
            ? "Confirmations and history show your own activity."
            : "Confirmations and history show authorized customer activity."}
        </p>
        {rows.error && (
          <p role="alert" className="error">
            {rows.error}
          </p>
        )}
        <p role="status">
          {rows.items.length} publications loaded
          {rows.busy ? " · Loading…" : ""}
        </p>
        {rows.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Document",
                    "Customer",
                    "Published",
                    "Availability",
                    "Receipt confirmations",
                    "Actions",
                  ].map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.number}</td>
                    <td>{accountName(p.account_id)}</td>
                    <td>{p.published_at}</td>
                    <td>{p.state}</td>
                    <td>
                      {p.acknowledgmentCount ? (
                        <>
                          <small>
                            {p.acknowledgments.length} of{" "}
                            {p.acknowledgmentCount} confirmations shown · newest
                            first
                          </small>
                          {p.acknowledgments.map((a: Item) => (
                            <small key={a.id}>
                              {a.actor_name} · {a.acknowledged_at} · receipt
                              confirmed
                            </small>
                          ))}
                        </>
                      ) : (
                        "Awaiting buyer confirmation"
                      )}
                    </td>
                    <td>
                      {renderActions(p)}
                      <button
                        className="secondary"
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setSelected(p);
                        }}
                      >
                        View document history
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No documents have been published to the customer inbox.</p>
        )}
        {(rows.next || rows.error) && (
          <button
            className="secondary"
            disabled={rows.busy}
            onClick={() => void rows.load()}
          >
            {rows.error ? "Retry older documents" : "Load older documents"}
          </button>
        )}
      </section>
      {selected && (
        <DocumentHistory
          key={selected.id}
          publication={selected}
          personal={personal}
          close={() => {
            setSelected(null);
            opener.current?.focus();
          }}
        />
      )}
    </>
  );
}
