import React, { useEffect, useRef } from "react";
import { usePages } from "./billing-inbox.tsx";
import "./operations-lane.css";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Long generated ids are shortened for scanning; the full value stays available.
function ShortId({ value }: { value: string }) {
  if (!uuid.test(value)) return <>{value}</>;
  return (
    <code className="ops-id" title={value} aria-label={value}>
      {value.slice(0, 8)}
    </code>
  );
}
function RecordedTime({ value }: { value: string }) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(value);
  if (!match) return <>{value}</>;
  return (
    <time dateTime={value} title={value} className="ops-time">
      {match[1]} <span>{match[2]} UTC</span>
    </time>
  );
}

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
    <section className="panel ops-audit" aria-label="Audit history">
      <h2 ref={heading} tabIndex={-1}>
        Audit history
      </h2>
      <p>
        Newest recorded entries appear first. Use Refresh to include new
        activity. Hover or focus a short ID to see it in full.
      </p>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} audit{" "}
        {rows.items.length === 1 ? "record" : "records"} loaded
        {rows.busy ? " · Loading…" : ""}
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
                  <td>
                    <RecordedTime value={row.created_at} />
                  </td>
                  <td>
                    <ShortId value={row.actor_id} />
                  </td>
                  <td>
                    <code className="ops-action">{row.action}</code>
                  </td>
                  <td>
                    <ShortId value={row.reference} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.loaded && !rows.busy && !rows.items.length && (
        <p className="empty">
          No audit records are recorded. Actions taken in the workspace appear
          here; use Refresh after new activity.
        </p>
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
