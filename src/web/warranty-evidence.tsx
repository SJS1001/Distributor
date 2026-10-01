import React, { useEffect, useRef, useState } from "react";
import { downloadEvidence, uploadEvidence } from "./api.ts";
import { usePages } from "./billing-inbox.tsx";
import {
  evidenceMaxBytes,
  evidenceMaxFiles,
  evidenceMediaTypes,
  type EvidenceFile,
  type EvidenceMediaType,
} from "../shared/warranty-evidence.ts";

function Files({
  claimId,
  download,
}: {
  claimId: string;
  download: (file: EvidenceFile) => void;
}) {
  const rows = usePages<EvidenceFile>(
    `/api/warranty/claims/${encodeURIComponent(claimId)}/evidence`,
  );
  return (
    <>
      {rows.error && (
        <p role="alert" className="error">
          {rows.error}
        </p>
      )}
      <p role="status">
        {rows.items.length} files loaded{rows.busy ? " · Loading…" : ""}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>File / visibility</th>
              <th>Description</th>
              <th>Integrity / uploaded</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.items.map((file) => (
              <tr key={file.id}>
                <td>
                  {file.filename}
                  <small>
                    {file.audience === "staff"
                      ? "Staff only"
                      : "Visible to customer"}{" "}
                    · {file.mediaType} · {file.bytes} bytes
                  </small>
                </td>
                <td>{file.description}</td>
                <td>
                  <small>SHA-256 {file.contentHash}</small>
                  <small>{file.createdAt}</small>
                </td>
                <td>
                  <button className="secondary" onClick={() => download(file)}>
                    Download evidence
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rows.next || rows.error) && (
        <button
          className="secondary"
          disabled={rows.busy}
          onClick={() => void rows.load()}
        >
          {rows.error ? "Retry evidence files" : "Load more evidence files"}
        </button>
      )}
    </>
  );
}

export function WarrantyEvidence({
  claimId,
  role,
  onClose,
}: {
  claimId: string;
  role: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<File | null>(null),
    [description, setDescription] = useState(""),
    [audience, setAudience] = useState<"customer" | "staff">(
      role === "buyer" ? "customer" : "staff",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [generation, setGeneration] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null),
    input = useRef<HTMLInputElement>(null),
    active = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    active.current = true;
    heading.current?.focus();
    return () => {
      active.current = false;
    };
  }, []);
  const run = async (perform: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await perform();
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "Evidence operation failed.");
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const upload = () =>
    run(async () => {
      if (!selected || selected.size < 1 || selected.size > evidenceMaxBytes)
        throw Error("Choose a file containing 1 byte to 5 MiB.");
      const extension = selected.name.split(".").at(-1)?.toLowerCase();
      const extensions: Record<string, EvidenceMediaType> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        pdf: "application/pdf",
        txt: "text/plain",
      };
      const mediaType = Object.hasOwn(evidenceMediaTypes, selected.type)
        ? (selected.type as EvidenceMediaType)
        : extensions[extension ?? ""];
      if (!mediaType)
        throw Error("Choose a JPEG, PNG, PDF or UTF-8 text file.");
      const bytes = new Uint8Array(await selected.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const result = await uploadEvidence(claimId, {
        filename: selected.name,
        mediaType,
        audience,
        description,
        contentBase64: btoa(binary),
      });
      if (!active.current) return;
      setSelected(null);
      setDescription("");
      if (input.current) input.current.value = "";
      setGeneration((n) => n + 1);
      setNotice(
        `Attached ${result.filename}. Evidence is retained with the claim.`,
      );
    });
  const download = (file: EvidenceFile) =>
    void run(async () => {
      await downloadEvidence(file);
      if (active.current)
        setNotice(`Verified ${file.filename} and prepared its download.`);
    });
  return (
    <section
      aria-label="Claim evidence files"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h2 ref={heading} tabIndex={-1}>
        Claim evidence files · {claimId.slice(0, 8)}
      </h2>
      <p>
        JPEG, PNG, PDF and UTF-8 text, up to 5 MiB each and {evidenceMaxFiles}{" "}
        files per claim. Customer-visible files can be read by the account's
        buyers. Files are retained as submitted; downloads are attachments.
      </p>
      <button className="secondary" disabled={busy} onClick={onClose}>
        Close evidence files
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      {["admin", "warranty", "warehouse", "commercial", "buyer"].includes(
        role,
      ) && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <fieldset disabled={busy}>
            <legend>Attach claim evidence</legend>
            <label>
              Evidence file
              <input
                ref={input}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,.txt"
                required
                onChange={(event) =>
                  setSelected(event.target.files?.[0] ?? null)
                }
              />
            </label>
            <label>
              Evidence description
              <textarea
                required
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {role !== "buyer" && (
              <label>
                Evidence visibility
                <select
                  value={audience}
                  onChange={(event) =>
                    setAudience(event.target.value as "customer" | "staff")
                  }
                >
                  <option value="staff">Staff only</option>
                  <option value="customer">Visible to customer</option>
                </select>
              </label>
            )}
            <button type="submit">Attach evidence</button>
          </fieldset>
        </form>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => setGeneration((n) => n + 1)}
      >
        Refresh evidence files
      </button>
      <div aria-disabled={busy} inert={busy || undefined}>
        <Files key={generation} claimId={claimId} download={download} />
      </div>
    </section>
  );
}
