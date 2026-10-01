let csrf = "";
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
    throw new Error(
      `${result.message ?? "Request failed."}${result.code ? ` (${result.code})` : ""}`,
    );
  return result as T;
}
// Keep a durable key for the exact attempt until the caller observes success.
// A lost response can be retried without creating a second business effect.
export async function command(name: string, payload: unknown) {
  const signature = JSON.stringify({ name, payload });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signature),
  );
  const storageKey = `distributor-command:${Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("")}`;
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const result = await request(`/api/commands/${name}`, {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify(payload),
  });
  sessionStorage.removeItem(storageKey);
  return result;
}

export async function downloadDocument(
  kind: "invoice" | "credit",
  documentId: string,
) {
  const storageKey = `distributor-document:${kind}:${documentId}`;
  return downloadPdf(
    `/api/billing/documents/${kind}/${encodeURIComponent(documentId)}/pdf`,
    {},
    storageKey,
  );
}

export async function downloadStockLabel(
  unitId: string,
  revision: number,
  copies: number,
) {
  return downloadPdf(
    `/api/stock/${encodeURIComponent(unitId)}/label`,
    { revision, copies },
    `distributor-label:${unitId}:${revision}:${copies}`,
  );
}

export async function downloadInboxDocument(publicationId: string) {
  return downloadPdf(
    `/api/billing/inbox/${encodeURIComponent(publicationId)}/pdf`,
    {},
    `distributor-inbox:${publicationId}`,
  );
}

async function downloadPdf(path: string, payload: unknown, storageKey: string) {
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const response = await fetch(path, {
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
  const bytes = await response.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (
    !response.headers.get("content-type")?.startsWith("application/pdf") ||
    hash !== response.headers.get("x-document-sha256")
  )
    throw new Error("PDF integrity check failed. Retry the download.");
  const filename =
    response.headers
      .get("content-disposition")
      ?.match(/filename="([A-Za-z0-9_.-]+)"/)?.[1] ?? "document.pdf";
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  sessionStorage.removeItem(storageKey);
  return response.headers.get("x-download-receipt");
}
