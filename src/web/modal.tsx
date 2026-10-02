import React, { useEffect, useLayoutEffect, useRef } from "react";
import { ScanInput } from "./scan-input.tsx";
type Item = Record<string, any>;
export type Field = {
  name: string;
  label: string;
  type?:
    | "number"
    | "textarea"
    | "checkbox"
    | "password"
    | "multiselect"
    | "date"
    | "datetime-local";
  options?: { value: string; label: string }[];
  value?: string | number | boolean | string[];
  optional?: boolean;
  help?: string;
  content?: React.ReactNode;
  max?: number;
  maxLength?: number;
  min?: number;
  scan?: "single" | "lines";
};
export type Dialog = {
  title: string;
  fields: Field[];
  perform: (values: Item) => Promise<unknown>;
  description?: React.ReactNode;
  submitLabel?: string;
};
export function Modal({
  dialog,
  busy,
  error,
  close,
  submit,
}: {
  dialog: Dialog;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (values: Item) => Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  const busyRef = useRef(busy);
  // A suspended render must not replace the visible dialog's keyboard actions.
  useLayoutEffect(() => {
    closeRef.current = close;
    busyRef.current = busy;
  }, [close, busy]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current!;
    const focusables = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          "input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href]",
        ),
      );
    focusables()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusables(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    element.addEventListener("keydown", keyboard);
    return () => {
      element.removeEventListener("keydown", keyboard);
      if (previous?.isConnected) previous.focus();
    };
  }, [dialog.title]);
  useEffect(() => {
    // Disabling the submit button can move focus outside the dialog. Restore
    // it after a rejected command so keyboard recovery remains available.
    const element = ref.current;
    if (!busy && error && element && !element.contains(document.activeElement))
      element
        .querySelector<HTMLElement>(
          "input,select,textarea,button:not(:disabled)",
        )
        ?.focus();
  }, [busy, error]);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title">{dialog.title}</h2>
        {dialog.description && (
          <div className="description">{dialog.description}</div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <form
          key={dialog.title}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget),
              values: Item = {};
            for (const f of dialog.fields)
              values[f.name] =
                f.type === "multiselect"
                  ? form.getAll(f.name).map(String)
                  : f.type === "checkbox"
                    ? form.get(f.name) === "on"
                    : f.type === "number"
                      ? Number(form.get(f.name))
                      : String(form.get(f.name) ?? "");
            void submit(values);
          }}
        >
          {dialog.fields.map((f) => (
            <div
              key={f.name}
              className={
                f.type === "checkbox" ? "form-field check" : "form-field"
              }
            >
              {f.type === "checkbox" ? (
                <input
                  name={f.name}
                  aria-labelledby={`field-label-${f.name}`}
                  type="checkbox"
                  defaultChecked={Boolean(f.value)}
                />
              ) : null}
              <span id={`field-label-${f.name}`}>{f.label}</span>
              {f.content ??
                (f.type === "checkbox" ? null : f.options ? (
                  <select
                    name={f.name}
                    aria-labelledby={`field-label-${f.name}`}
                    multiple={f.type === "multiselect"}
                    required={!f.optional}
                    defaultValue={
                      f.type === "multiselect"
                        ? Array.isArray(f.value)
                          ? f.value
                          : []
                        : String(f.value ?? f.options[0]?.value ?? "")
                    }
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.scan ? (
                  <ScanInput
                    name={f.name}
                    label={f.label}
                    value={String(f.value ?? "")}
                    multiline={f.scan === "lines"}
                    optional={Boolean(f.optional)}
                    disabled={busy}
                  />
                ) : f.type === "textarea" ? (
                  <textarea
                    name={f.name}
                    aria-labelledby={`field-label-${f.name}`}
                    required={!f.optional}
                    maxLength={f.maxLength}
                    defaultValue={String(f.value ?? "")}
                  />
                ) : (
                  <input
                    name={f.name}
                    aria-labelledby={`field-label-${f.name}`}
                    type={f.type ?? "text"}
                    required={!f.optional}
                    min={f.type === "number" ? (f.min ?? 0) : undefined}
                    max={f.max}
                    step={f.type === "number" ? 1 : undefined}
                    defaultValue={String(f.value ?? "")}
                  />
                ))}{" "}
              {f.help && <small>{f.help}</small>}
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button disabled={busy}>
              {busy
                ? "Saving…"
                : (dialog.submitLabel ??
                  (dialog.fields.length ? "Continue" : "Close"))}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
