import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";
import type { WarrantyDecision } from "../shared/warranty-decisions.ts";

export function WarrantyDecisions({
  claimId,
  buyer,
  onClose,
}: {
  claimId: string;
  buyer: boolean;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const pager = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const rows = usePages<WarrantyDecision>(
    `/api/warranty/claims/${encodeURIComponent(claimId)}/decisions`,
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (rows.busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (rows.loaded && !rows.next && !rows.error) heading.current?.focus();
    else pager.current?.focus();
  }, [rows.busy, rows.loaded, rows.next, rows.error]);
  return (
    <section aria-label="Review and remedy history">
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          Review and remedy history
        </h2>
        <button className="secondary" onClick={onClose}>
          Close decision history
        </button>
      </div>
      <p>
        Claim {claimId.slice(0, 8)}. Recorded review, manufacturer and remedy
        decisions in recording order. Receipt and inspection details are held
        separately.
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} decisions loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {rows.loaded && !rows.busy && !rows.error && !rows.items.length && (
        <p>No review or remedy decisions recorded.</p>
      )}
      {rows.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Decision</th>
                <th>Recorded</th>
                {!buyer && (
                  <>
                    <th>Reason</th>
                    <th>Recorded by</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.action.replaceAll(".", " · ").replaceAll("_", " ")}
                  </td>
                  <td>{item.createdAt}</td>
                  {!buyer && (
                    <>
                      <td>{item.reason}</td>
                      <td>{item.actorId}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        ref={pager}
        className="secondary"
        disabled={rows.busy || (rows.loaded && !rows.next && !rows.error)}
        onClick={() => {
          restoreFocus.current = true;
          void rows.load();
        }}
      >
        {rows.error
          ? "Retry decision history"
          : rows.loaded && !rows.next
            ? "All decisions loaded"
            : "Load more decisions"}
      </button>
    </section>
  );
}
