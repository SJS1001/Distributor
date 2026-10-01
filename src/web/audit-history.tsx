import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";

type Audit = {
  id: string;
  actor_id: string;
  action: string;
  reference: string;
  created_at: string;
};

export function AuditHistory() {
  const rows = usePages<Audit>("/api/audit/page");
  const heading = useRef<HTMLHeadingElement>(null);
  const continuing = useRef(false);
  useEffect(() => {
    if (
      continuing.current &&
      rows.loaded &&
      !rows.busy &&
      !rows.next &&
      !rows.error
    ) {
      continuing.current = false;
      heading.current?.focus();
    }
  }, [rows.loaded, rows.busy, rows.next, rows.error]);
  return (
    <section className="panel" aria-label="Audit history">
      <h2 ref={heading} tabIndex={-1}>
        Audit history
      </h2>
      <p>
        Newest recorded entries appear first. Use Refresh to include new
        activity.
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} audit records loaded{rows.busy ? " · Loading…" : ""}
      </p>
      {!!rows.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recorded time</th>
                <th>Actor ID</th>
                <th>Action</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((row) => (
                <tr key={row.id}>
                  <td>{row.created_at}</td>
                  <td>{row.actor_id}</td>
                  <td>{row.action}</td>
                  <td>{row.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p>No audit records are recorded.</p>
      )}
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => {
            continuing.current = rows.loaded;
            void rows.load();
          }}
        >
          {rows.error ? "Retry audit history" : "Load older audit records"}
        </button>
      )}
    </section>
  );
}
