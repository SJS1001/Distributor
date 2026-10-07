import React, { useEffect, useRef } from "react";
import { InfoBubble } from "./info-bubble.tsx";
import { usePages } from "./billing-inbox.tsx";
import "./operations-lane.css";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Generated ids stay complete so every user can read and copy them; they wrap
// inside the cell instead of widening the table.
function RecordId({ value }: { value: string }) {
  if (!uuid.test(value)) return <>{value}</>;
  return (
    <details>
      <summary>Identifier ending {value.slice(-8)}</summary>
      <code className="ops-id">{value}</code>
    </details>
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
  currentActorName?: string | null;
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
      <div className="info-heading">
        <h2 ref={heading} tabIndex={-1}>
          Audit history
        </h2>
        <InfoBubble label="Audit history">
          Newest recorded entries appear first. Use Refresh to include new
          activity.
        </InfoBubble>
      </div>
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
        <div
          className="table-wrap"
          role="region"
          tabIndex={0}
          aria-label="Audit records"
        >
          <p className="table-scroll-cue">
            Scroll across the table to review all fields and actions.
          </p>
          <table>
            <thead>
              <tr>
                <th>Recorded time</th>
                <th>Actor</th>
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
                    <p>
                      {row.currentActorName ? (
                        <>
                          Current actor name:{" "}
                          <strong>{row.currentActorName}</strong>
                        </>
                      ) : (
                        "Actor name unavailable"
                      )}
                    </p>
                    <RecordId value={row.actor_id} />
                  </td>
                  <td>
                    <span>
                      {row.action.replaceAll(".", " · ").replaceAll("_", " ")}
                    </span>
                    <details>
                      <summary>Exact action code</summary>
                      <code className="ops-action">{row.action}</code>
                    </details>
                  </td>
                  <td>
                    <RecordId value={row.reference} />
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
