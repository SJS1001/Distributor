import React from "react";
import type { SessionDetail } from "../shared/session-details.ts";
export type { SessionDetail } from "../shared/session-details.ts";

function SessionTime({ value }: { value: number | null }) {
  return value === null ? (
    <span>Unknown</span>
  ) : (
    <time dateTime={new Date(value).toISOString()}>
      {new Date(value).toLocaleString()}
    </time>
  );
}

export function SessionList({
  sessions,
  onRevoke,
  disabled = false,
}: {
  sessions?: readonly SessionDetail[];
  onRevoke?: (session: SessionDetail, opener: HTMLButtonElement) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      {sessions === undefined ? (
        <p role="status">
          Session details are unavailable. Refresh to try again.
        </p>
      ) : sessions.length === 0 ? (
        <p>No active sessions.</p>
      ) : (
        <ul aria-label="Your active sessions">
          {sessions.map((session) => (
            <li key={session.reference ?? session.label}>
              <strong>{session.deviceDescription ?? "Unknown device"}</strong>
              {session.current && " · This session"}
              <br />
              Signed in: <SessionTime value={session.createdAt} />
              <br />
              Last recorded API activity:{" "}
              <SessionTime value={session.lastActivityAt} />
              <br />
              Expires: <SessionTime value={session.expiresAt} />
              {session.reference && (
                <>
                  <br />
                  <small>Session reference: {session.reference}</small>
                </>
              )}
              {onRevoke && session.reference && (
                <>
                  <br />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(event) => onRevoke(session, event.currentTarget)}
                    aria-label={`End ${session.current ? "this session" : (session.deviceDescription ?? "unknown device session")} ${session.reference}`}
                  >
                    End {session.current ? "this session" : "session"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="ops-note">
        Device descriptions are reported by the browser and may be inaccurate.
        Location is not recorded. Activity is sampled at most once per minute.
        Older sessions may have unknown sign-in or device details. Session
        references stay the same until a session ends.
      </p>
    </div>
  );
}
