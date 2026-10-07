import React from "react";

export type SessionDetail = {
  label: string;
  expiresAt: number;
  current: boolean;
};

export function SessionList({
  sessions,
}: {
  sessions?: readonly SessionDetail[];
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
            <li key={session.label}>
              <strong>{session.label}</strong>
              {session.current && " · This session"}
              <br />
              Expires{" "}
              <time dateTime={new Date(session.expiresAt).toISOString()}>
                {new Date(session.expiresAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
      <p className="ops-note">
        Device, location and last activity are not recorded. Session numbers are
        list labels and may change when the list changes. If a sign-in is
        unfamiliar, end all your sessions.
      </p>
    </div>
  );
}
