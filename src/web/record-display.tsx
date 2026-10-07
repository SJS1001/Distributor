import React, { useState } from "react";

export function ReadableTime({
  value,
}: {
  value: string | number | null | undefined;
}) {
  const date = value === null || value === undefined ? null : new Date(value);
  if (!date || !Number.isFinite(date.getTime()))
    return <span>{value ?? "Not recorded"}</span>;
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(date)}{" "}
      UTC
    </time>
  );
}

export function RecordIdentifier({
  value,
  label = "Full ID",
}: {
  value: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <details className="record-identifier">
      <summary>{label}</summary>
      <code style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>
        {value}
      </code>
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied");
          } catch {
            setStatus("Copy unavailable. Select the full identifier above.");
          }
        }}
      >
        Copy {label}
      </button>
      <span role="status">{status}</span>
    </details>
  );
}
