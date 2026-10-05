export type ReferenceRequest = { familyId: string; modelId: string | null };
const valid = (value: string | null) =>
  value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
export function readReference(hash: string): ReferenceRequest | null {
  const query = new URLSearchParams(
    hash.includes("?") ? hash.split("?")[1] : hash.replace(/^#/, ""),
  );
  const familyId = valid(query.get("referenceFamily"));
  return familyId
    ? { familyId, modelId: valid(query.get("referenceModel")) }
    : null;
}
export function referenceHref(route: string, reference: ReferenceRequest) {
  const query = new URLSearchParams({ referenceFamily: reference.familyId });
  if (reference.modelId) query.set("referenceModel", reference.modelId);
  return `${route}${route.includes("=") ? "&" : "?"}${query}`;
}
