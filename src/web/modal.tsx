import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const validationRef = useRef<HTMLDivElement>(null);
  const focusValidation = useRef(false);
  const [invalidFields, setInvalidFields] = useState<
    { id: string; label: string; message: string }[]
  >([]);
  useEffect(() => {
    if (focusValidation.current && invalidFields.length)
      validationRef.current?.focus();
    focusValidation.current = false;
  }, [invalidFields]);
  useEffect(() => {
    setInvalidFields([]);
  }, [dialog.title]);
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
      ).filter(
        (item) =>
          !item.closest("[hidden], [inert]") &&
          item.getClientRects().length > 0,
      );
    // Open on the first field or action; the corner close button stays
    // reachable by Tab and Escape.
    (
      focusables().find((item) => !item.classList.contains("modal-close")) ??
      element
    ).focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusables(),
          first = items[0],
          last = items.at(-1);
        if (!items.length) {
          event.preventDefault();
          element.focus();
          return;
        }
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
    const element = ref.current;
    if (busy && element && !element.contains(document.activeElement))
      element.focus();
  }, [busy]);
  useEffect(() => {
    // Disabling the submit button can move focus outside the dialog. Restore
    // it after a rejected command so keyboard recovery remains available.
    const element = ref.current;
    if (!busy && error && element && !element.contains(document.activeElement))
      element
        .querySelector<HTMLElement>(
          "input,select,textarea,button:not(:disabled):not(.modal-close)",
        )
        ?.focus();
  }, [busy, error]);
  // Close only when both press and release land on the backdrop, so selecting
  // text inside the dialog and releasing outside it never discards entries.
  const pressedBackdrop = useRef(false);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (
          pressedBackdrop.current &&
          event.target === event.currentTarget &&
          !busy
        )
          close();
        pressedBackdrop.current = false;
      }}
    >
      <section
        ref={ref}
        className="modal"
        role="dialog"
        tabIndex={-1}
        aria-busy={busy}
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-header">
          <h2 id="dialog-title">{dialog.title}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close dialog"
            title="Close"
            disabled={busy}
            onClick={close}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {dialog.description && (
          <div className="description">{dialog.description}</div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {invalidFields.length > 0 && (
          <div
            className="error validation-summary"
            ref={validationRef}
            tabIndex={-1}
            role="alert"
            aria-label="Check these fields"
          >
            <strong>Check these fields before continuing</strong>
            <ul>
              {invalidFields.map((field) => (
                <li key={field.id}>
                  <a
                    href={`#${field.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(field.id)?.focus();
                    }}
                  >
                    {field.label}: {field.message}
                  </a>
                </li>
              ))}
            </ul>
            <p>
              Your entries are still here. Correct the fields, then continue.
            </p>
          </div>
        )}
        <form
          noValidate
          key={dialog.title}
          onInput={(event) => {
            const field = event.target;
            if (
              field instanceof HTMLInputElement ||
              field instanceof HTMLSelectElement ||
              field instanceof HTMLTextAreaElement
            ) {
              if (field.validity.valid) {
                field.removeAttribute("aria-invalid");
                setInvalidFields((current) =>
                  current.filter((item) => item.id !== field.id),
                );
              }
            }
          }}
          onSubmit={(e) => {
            e.preventDefault();
            const invalid = Array.from(
              e.currentTarget.querySelectorAll<
                HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
              >("input,select,textarea"),
            )
              .filter((field) => field.willValidate && !field.validity.valid)
              .map((field, index) => {
                if (!field.id) field.id = `dialog-invalid-${index}`;
                field.setAttribute("aria-invalid", "true");
                const label =
                  field.getAttribute("aria-label") ??
                  document.getElementById(
                    field.getAttribute("aria-labelledby") ?? "",
                  )?.textContent ??
                  field.labels?.[0]?.textContent ??
                  field.name ??
                  "Field";
                return {
                  id: field.id,
                  label: label.trim(),
                  message: field.validationMessage,
                };
              });
            focusValidation.current = invalid.length > 0;
            setInvalidFields(invalid);
            if (invalid.length) return;
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
                  id={`field-${f.name}`}
                  name={f.name}
                  aria-describedby={f.help ? `field-help-${f.name}` : undefined}
                  aria-labelledby={`field-label-${f.name}`}
                  type="checkbox"
                  defaultChecked={Boolean(f.value)}
                />
              ) : null}
              <span id={`field-label-${f.name}`}>{f.label}</span>
              {!f.content && f.type !== "checkbox" && (
                <small className="field-requirement">
                  {f.optional ? "Optional" : "Required"}
                </small>
              )}
              {f.content ??
                (f.type === "checkbox" ? null : f.options ? (
                  <select
                    id={`field-${f.name}`}
                    name={f.name}
                    aria-describedby={
                      f.help ? `field-help-${f.name}` : undefined
                    }
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
                    describedBy={f.help ? `field-help-${f.name}` : undefined}
                    label={f.label}
                    value={String(f.value ?? "")}
                    multiline={f.scan === "lines"}
                    optional={Boolean(f.optional)}
                    disabled={busy}
                  />
                ) : f.type === "textarea" ? (
                  <textarea
                    id={`field-${f.name}`}
                    name={f.name}
                    aria-describedby={
                      f.help ? `field-help-${f.name}` : undefined
                    }
                    aria-labelledby={`field-label-${f.name}`}
                    required={!f.optional}
                    maxLength={f.maxLength}
                    defaultValue={String(f.value ?? "")}
                  />
                ) : (
                  <input
                    id={`field-${f.name}`}
                    name={f.name}
                    aria-describedby={
                      f.help ? `field-help-${f.name}` : undefined
                    }
                    aria-labelledby={`field-label-${f.name}`}
                    type={f.type ?? "text"}
                    required={!f.optional}
                    maxLength={f.maxLength}
                    min={f.type === "number" ? (f.min ?? 0) : undefined}
                    max={f.max}
                    step={f.type === "number" ? 1 : undefined}
                    defaultValue={String(f.value ?? "")}
                  />
                ))}{" "}
              {f.help && <small id={`field-help-${f.name}`}>{f.help}</small>}
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
