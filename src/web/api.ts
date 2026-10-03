import {
  evidenceMaxBytes,
  evidenceMediaTypes,
  type EvidenceFile,
  type EvidenceUpload,
} from "../shared/warranty-evidence.ts";
import type { StockLabelOutput } from "../shared/stock-label.ts";
import {
  reconciliationMaxBytes,
  type ReconciliationReceipt,
} from "../shared/reconciliation.ts";
let csrf = "";
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}
export function setCsrf(value: string) {
  csrf = value;
}
export async function request<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "x-csrf-token": csrf,
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new RequestError(
      `${result.message ?? "Request failed."}${result.code ? ` (${result.code})` : ""}`,
      response.status,
      result.code,
    );
  return result as T;
}
// Keep a durable key for the exact attempt until the caller observes success.
// A lost response can be retried without creating a second business effect.
export async function command(
  name: string,
  payload: unknown,
  signal?: AbortSignal,
) {
  const signature = JSON.stringify({ name, payload });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signature),
  );
  const storageKey = `distributor-command:${Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("")}`;
  signal?.throwIfAborted();
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const result = await request(`/api/commands/${name}`, {
    signal,
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify(payload),
  });
  sessionStorage.removeItem(storageKey);
  return result;
}

export async function downloadReconciliation(
  receipt: ReconciliationReceipt,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/operations/reconciliation/${encodeURIComponent(receipt.id)}/document`,
    { credentials: "same-origin", signal },
  );
  if (!response.ok) {
    const result = await response.json();
    throw Error(
      `${result.message ?? "Report download failed."}${result.code ? ` (${result.code})` : ""}`,
    );
  }
  if (
    !response.headers
      .get("content-type")
      ?.startsWith("application/octet-stream") ||
    response.headers.get("x-document-media-type") !== "application/json" ||
    response.headers.get("cache-control") !== "no-store" ||
    response.headers.get("x-download-receipt") !== receipt.id ||
    response.headers.get("x-document-sha256") !== receipt.contentHash ||
    response.headers.get("content-disposition") !==
      `attachment; filename="${receipt.filename}"` ||
    !/^reconciliation-[a-f0-9-]{36}\.json$/.test(receipt.filename)
  )
    throw Error("Report download headers are invalid.");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Report download body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > reconciliationMaxBytes || size > receipt.bytes)
        throw Error("Report exceeds its retained size limit.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (size !== receipt.bytes || hash !== receipt.contentHash)
    throw Error("Report integrity check failed. Retry the download.");
  signal.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = receipt.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function uploadEvidence(claimId: string, payload: EvidenceUpload) {
  const signature = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ claimId, payload })),
  );
  const storageKey = `distributor-evidence-upload:${Array.from(new Uint8Array(signature), (v) => v.toString(16).padStart(2, "0")).join("")}`;
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const result = await request<EvidenceFile>(
    `/api/warranty/claims/${encodeURIComponent(claimId)}/evidence`,
    {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(payload),
    },
  );
  sessionStorage.removeItem(storageKey);
  return result;
}

export async function downloadEvidence(
  file: EvidenceFile,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const storageKey = `distributor-evidence-download:${file.claimId}:${file.id}`;
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const response = await fetch(
    `/api/warranty/claims/${encodeURIComponent(file.claimId)}/evidence/${encodeURIComponent(file.id)}/download`,
    {
      signal,
      method: "POST",
      credentials: "same-origin",
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
        "idempotency-key": key,
      },
    },
  );
  if (!response.ok) {
    const error = await response.json();
    throw Error(
      `${error.message ?? "Evidence download failed"} (${error.code ?? response.status})`,
    );
  }
  const bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  const receipt = response.headers.get("x-download-receipt");
  const filename = `warranty-evidence-${file.id}.${evidenceMediaTypes[file.mediaType]}`;
  if (
    bytes.byteLength !== file.bytes ||
    bytes.byteLength > evidenceMaxBytes ||
    hash !== file.contentHash ||
    hash !== response.headers.get("x-document-sha256") ||
    response.headers.get("x-evidence-media-type") !== file.mediaType ||
    !response.headers
      .get("content-type")
      ?.startsWith("application/octet-stream") ||
    response.headers.get("content-disposition") !==
      `attachment; filename="${filename}"` ||
    !receipt?.trim()
  )
    throw Error("Evidence integrity check failed. Retry the download.");
  signal?.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  sessionStorage.removeItem(storageKey);
  return receipt;
}

export async function downloadDocument(
  kind: "invoice" | "credit",
  documentId: string,
  signal?: AbortSignal,
) {
  const storageKey = `distributor-document:${kind}:${documentId}`;
  return downloadPdf(
    `/api/billing/documents/${kind}/${encodeURIComponent(documentId)}/pdf`,
    {},
    storageKey,
    undefined,
    signal,
  );
}

export async function downloadStockLabel(
  unitId: string,
  revision: number,
  copies: number,
  output: StockLabelOutput = "pdf",
) {
  if (output !== "pdf")
    return downloadPdf(
      `/api/stock/${encodeURIComponent(unitId)}/label`,
      { revision, copies, output },
      `distributor-label:${unitId}:${revision}:${copies}:${output}`,
      {
        mediaType: "application/octet-stream",
        filename: `Stock_${unitId}_${output}.zpl`,
        maxBytes: 4000000,
      },
    );
  return downloadPdf(
    `/api/stock/${encodeURIComponent(unitId)}/label`,
    { revision, copies },
    `distributor-label:${unitId}:${revision}:${copies}`,
  );
}

export async function downloadInboxDocument(
  publicationId: string,
  signal?: AbortSignal,
) {
  return downloadPdf(
    `/api/billing/inbox/${encodeURIComponent(publicationId)}/pdf`,
    {},
    `distributor-inbox:${publicationId}`,
    undefined,
    signal,
  );
}

async function downloadPdf(
  path: string,
  payload: unknown,
  storageKey: string,
  expected?: { mediaType: string; filename: string; maxBytes: number },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const response = await fetch(path, {
    signal,
    credentials: "same-origin",
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": key,
    },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `${error.message ?? "Download failed"} (${error.code ?? response.status})`,
    );
  }
  let bytes: ArrayBuffer;
  if (expected) {
    const reader = response.body?.getReader();
    if (!reader)
      throw Error("Label download body is missing. Retry the download.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > expected.maxBytes) {
          await reader.cancel();
          throw Error(
            "Label download exceeds its size limit. Retry the download.",
          );
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const combined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    bytes = combined.buffer;
  } else bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim() !==
      (expected?.mediaType ?? "application/pdf") ||
    (expected &&
      (bytes.byteLength === 0 ||
        response.headers.get("content-disposition") !==
          `attachment; filename="${expected.filename}"`)) ||
    hash !== response.headers.get("x-document-sha256")
  )
    throw new Error("Document integrity check failed. Retry the download.");
  const receipt = response.headers.get("x-download-receipt");
  if (!receipt?.trim())
    throw new Error("Download receipt is missing. Retry the download.");
  const filename =
    response.headers
      .get("content-disposition")
      ?.match(/filename="([A-Za-z0-9_.-]+)"/)?.[1] ?? "document.pdf";
  signal?.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: expected?.mediaType ?? "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  sessionStorage.removeItem(storageKey);
  return receipt;
}

export async function downloadCostFile(
  packetId: string,
  expectedHash: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const response = await fetch(
    `/api/accounting/costs/${encodeURIComponent(packetId)}/file`,
    { credentials: "same-origin", signal },
  );
  if (!response.ok) {
    const result = await response.json();
    throw Error(
      `${result.message ?? "Cost file download failed"} (${result.code ?? response.status})`,
    );
  }
  const bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (
    bytes.byteLength > 4 * 1024 * 1024 ||
    !response.headers.get("content-type")?.startsWith("application/json") ||
    hash !== expectedHash ||
    hash !== response.headers.get("x-document-sha256")
  )
    throw Error(
      "Cost file integrity check failed. Retry the reviewed download.",
    );
  const filename = response.headers
    .get("content-disposition")
    ?.match(/filename="([A-Za-z0-9_.-]+)"/)?.[1];
  if (!filename) throw Error("Cost file name is missing.");
  signal?.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function downloadCanadaPostManifest(
  groupId: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/canada-post/groups/${encodeURIComponent(groupId)}/manifest/document`,
    { credentials: "same-origin", signal },
  );
  if (!response.ok) {
    const result = await response.json();
    throw Error(
      `${result.message ?? "Manifest download failed"} (${result.code ?? response.status})`,
    );
  }
  if (
    !response.headers
      .get("content-type")
      ?.startsWith("application/octet-stream") ||
    response.headers.get("x-document-media-type") !== "application/pdf" ||
    response.headers.get("cache-control") !== "no-store"
  )
    throw Error("Manifest download headers are invalid.");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Manifest download body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576)
        throw Error("Manifest exceeds the document size limit.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (
    hash !== response.headers.get("x-document-sha256") ||
    new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
  )
    throw Error("Manifest integrity check failed. Retry the download.");
  signal.throwIfAborted();
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "canada-post-manifest.pdf";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
