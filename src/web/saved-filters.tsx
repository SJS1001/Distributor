import React, { useEffect, useState } from "react";
export function savedFilterKey(orgId: string, actorId: string, kind: string) {
  return `distributor:saved-filters:v1:${encodeURIComponent(orgId)}:${encodeURIComponent(actorId)}:${kind}`;
}
export function readSavedFilters(
  raw: string | null,
  allowed: readonly string[],
): string[] {
  try {
    const values: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(values)
      ? [
          ...new Set(
            values.filter(
              (v): v is string => typeof v === "string" && allowed.includes(v),
            ),
          ),
        ].slice(0, allowed.length)
      : [];
  } catch {
    return [];
  }
}
/** Deliberately stores only named enum filters, never customer queries, records or drafts. */
export function SavedFilters({
  scope,
  allowed,
  labels = {},
  value,
  apply,
  disabled,
}: {
  scope: string;
  allowed: readonly string[];
  labels?: Record<string, string>;
  value: string;
  apply: (value: string) => void;
  disabled: boolean;
}) {
  const [saved, setSaved] = useState<string[]>([]),
    [message, setMessage] = useState("");
  useEffect(() => {
    try {
      setSaved(readSavedFilters(localStorage.getItem(scope), allowed));
    } catch {
      setSaved([]);
    }
    setMessage("");
  }, [scope, allowed]);
  const write = (values: string[]) => {
    try {
      localStorage.setItem(scope, JSON.stringify(values));
      setSaved(values);
      setMessage("Saved filters updated for your account on this browser.");
    } catch {
      setMessage(
        "This browser could not save the filter. Your current queue is unchanged.",
      );
    }
  };
  return (
    <details className="saved-filters">
      <summary>Saved filters</summary>
      <p>Saved for your organization and user on this browser.</p>
      <button
        type="button"
        disabled={disabled || !allowed.includes(value) || saved.includes(value)}
        onClick={() => write([...saved, value])}
      >
        Save current filter
      </button>
      {saved.map((filter) => (
        <span key={filter}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => apply(filter)}
          >
            {labels[filter] ?? filter}
          </button>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove saved filter ${labels[filter] ?? filter}`}
            onClick={() => write(saved.filter((v) => v !== filter))}
          >
            Remove
          </button>
        </span>
      ))}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
