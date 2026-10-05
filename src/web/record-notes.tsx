import React, { useEffect, useState } from "react";
import { request, RequestError } from "./api.ts";
import type {
  RecordNoteKind,
  RecordNotesPage,
} from "../shared/record-notes.ts";
import "./record-notes.css";

type NotePage = RecordNotesPage;
type Attempt = {
  key: string;
  command: "notes.add" | "notes.verify";
  payload: {
    kind: RecordNoteKind;
    recordId: string;
    body?: string;
    noteId?: string;
  };
};
export function RecordNotes({
  kind,
  recordId,
  recoveryScope,
  actorId,
}: {
  kind: RecordNoteKind;
  recordId: string;
  recoveryScope: string;
  actorId: string;
}) {
  const storageKey = `distributor-notes:${recoveryScope}:${kind}:${recordId}`;
  const [saved] = useState(() => {
    try {
      const read = (raw: string | null): Attempt | null => {
        if (raw === null) return null;
        if (raw.length > 30000) throw Error();
        const a = JSON.parse(raw) as Attempt;
        if (
          typeof a.key !== "string" ||
          !/^[a-f0-9-]{36}$/.test(a.key) ||
          Object.keys(a).some(
            (k) => !["key", "command", "payload"].includes(k),
          ) ||
          a.payload?.kind !== kind ||
          a.payload.recordId !== recordId ||
          !(
            (a.command === "notes.add" &&
              typeof a.payload.body === "string" &&
              a.payload.body.length <= 4000 &&
              a.payload.body.trim() &&
              Object.keys(a.payload).every((k) =>
                ["kind", "recordId", "body"].includes(k),
              )) ||
            (a.command === "notes.verify" &&
              typeof a.payload.noteId === "string" &&
              a.payload.noteId.length <= 128 &&
              a.payload.noteId.trim() &&
              Object.keys(a.payload).every((k) =>
                ["kind", "recordId", "noteId"].includes(k),
              ))
          )
        )
          throw Error();
        return a;
      };
      const durableRaw = localStorage.getItem(storageKey),
        legacyRaw = sessionStorage.getItem(storageKey),
        durable = read(durableRaw),
        legacy = read(legacyRaw);
      // Never overwrite either unresolved attempt if old and new storage disagree.
      if (
        durable &&
        legacy &&
        JSON.stringify(durable) !== JSON.stringify(legacy)
      )
        throw Error();
      if (legacy) {
        // Persist before removing the same-tab copy; a failed migration stays locked.
        if (!durable) localStorage.setItem(storageKey, legacyRaw!);
        sessionStorage.removeItem(storageKey);
      }
      return { attempt: durable ?? legacy, error: "" };
    } catch {
      return {
        attempt: null,
        error:
          "Saved note attempt cannot be read. Restore browser storage and reload before adding or verifying notes.",
      };
    }
  });
  const [opened, setOpened] = useState(false),
    [page, setPage] = useState<NotePage | null>(null),
    [body, setBody] = useState(saved.attempt?.payload.body ?? ""),
    [attempt, setAttempt] = useState(saved.attempt),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(saved.error),
    [storageError, setStorageError] = useState(""),
    [notice, setNotice] = useState("");
  const path = `/api/notes/${kind}/${encodeURIComponent(recordId)}`;
  async function load(after?: string) {
    setBusy(true);
    try {
      const result = await request<NotePage>(
        `${path}${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      );
      setPage((p) =>
        after && p
          ? {
              ...result,
              items: [
                ...p.items,
                ...result.items.filter(
                  (n) => !p.items.some((old) => old.id === n.id),
                ),
              ],
            }
          : result,
      );
      setError(saved.error);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (opened && !page) void load();
  }, [opened]);
  async function send(next: Attempt) {
    setBusy(true);
    setError("");
    setNotice("");
    const serialized = JSON.stringify(next);
    function ownsSavedAttempt() {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null && JSON.stringify(JSON.parse(raw)) !== serialized) {
        setStorageError(
          "Another saved note attempt exists for this record. Reload to recover it before making changes.",
        );
        return false;
      }
      return true;
    }
    function clearSavedAttempt() {
      try {
        if (!ownsSavedAttempt()) return false;
        localStorage.removeItem(storageKey);
        setAttempt(null);
        return true;
      } catch {
        setStorageError(
          "Browser storage is unavailable. Restore it and reload before resolving this note attempt.",
        );
        return false;
      }
    }
    try {
      try {
        // A mounted second tab may not know that another tab saved an attempt.
        if (!ownsSavedAttempt()) return;
        localStorage.setItem(storageKey, serialized);
      } catch {
        setStorageError(
          "Browser storage is unavailable. Restore it and reload before resolving this note attempt.",
        );
        return;
      }
      setAttempt(next);
      await request(`/api/commands/${next.command}`, {
        method: "POST",
        headers: { "idempotency-key": next.key },
        body: JSON.stringify(next.payload),
      });
      if (!clearSavedAttempt()) return;
      if (next.command === "notes.add") setBody("");
      setNotice(
        next.command === "notes.add"
          ? "Staff note added."
          : "Independent verification recorded.",
      );
      await load();
    } catch (e) {
      if (
        e instanceof RequestError &&
        e.status < 500 &&
        ![401, 403, 408, 429].includes(e.status)
      ) {
        if (!clearSavedAttempt()) return;
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!attempt || !!saved.error || !!storageError || !page;
  return (
    <details
      className="record-notes"
      onToggle={(e) => setOpened(e.currentTarget.open)}
    >
      <summary>Staff notes</summary>
      {opened && (
        <div className="record-notes-content">
          <p>
            Private to authorized staff. Notes keep their original text; add a
            new note to correct an earlier one. Verification records a separate
            person's review.
          </p>
          {error && <p role="alert">{error}</p>}
          {storageError && <p role="alert">{storageError}</p>}
          {notice && <p role="status">{notice}</p>}
          {attempt && (
            <section aria-label="Pending note attempt">
              <p>
                A response was not confirmed. Retry this exact{" "}
                {attempt.command === "notes.add" ? "note" : "verification"}{" "}
                before making another change.
              </p>
              {attempt.payload.body && (
                <p className="record-note-body">{attempt.payload.body}</p>
              )}
              <button
                type="button"
                disabled={busy || !!saved.error || !!storageError}
                onClick={() => void send(attempt)}
              >
                Retry saved note attempt
              </button>
            </section>
          )}
          {!page && !busy && (
            <button type="button" onClick={() => void load()}>
              Retry loading staff notes
            </button>
          )}
          {busy && <p role="status">Loading or saving staff notes…</p>}
          {page && (
            <>
              <button type="button" disabled={busy} onClick={() => void load()}>
                Refresh staff notes
              </button>
              {!page.items.length && <p>No staff notes yet.</p>}
              <ol className="record-note-list">
                {page.items.map((note) => (
                  <li key={note.id}>
                    <p className="record-note-body">{note.body}</p>
                    <p>
                      Added by {note.authorName} ·{" "}
                      <time dateTime={note.createdAt}>
                        {new Date(note.createdAt).toLocaleString()}
                      </time>
                    </p>
                    {note.verification ? (
                      <p className="record-note-verified">
                        Verified by {note.verification.verifierName} ·{" "}
                        <time dateTime={note.verification.verifiedAt}>
                          {new Date(
                            note.verification.verifiedAt,
                          ).toLocaleString()}
                        </time>
                      </p>
                    ) : (
                      <>
                        <p>Unverified</p>
                        {page.canVerify && note.authorId !== actorId && (
                          <button
                            type="button"
                            disabled={locked}
                            onClick={() =>
                              void send({
                                key: crypto.randomUUID(),
                                command: "notes.verify",
                                payload: { kind, recordId, noteId: note.id },
                              })
                            }
                          >
                            Verify this note
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
              {page.next && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void load(page.next!)}
                >
                  Load older staff notes
                </button>
              )}
              <label>
                New staff note
                <textarea
                  value={body}
                  maxLength={4000}
                  disabled={locked}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={locked || !body.trim()}
                onClick={() =>
                  void send({
                    key: crypto.randomUUID(),
                    command: "notes.add",
                    payload: { kind, recordId, body: body.trim() },
                  })
                }
              >
                Add staff note
              </button>
            </>
          )}
        </div>
      )}
    </details>
  );
}
