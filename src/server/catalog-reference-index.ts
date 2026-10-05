import reference from "../web/gree-catalog-data.json" with { type: "json" };
import type { RequestedReference } from "../shared/catalog-reference.ts";
import { check, text } from "./core.ts";
/** Static manufacturer references identify interest only; they never establish native product equivalence. */
export function validateReference(input: RequestedReference) {
  const familyId = text(input.familyId, "Reference family", 128);
  const family = reference.products.find((p) => p.id === familyId);
  check(family, "REFERENCE", "Choose a current reference family.", 400);
  const model = family.models.find((m) => m.id === input.modelId);
  check(
    family.models.length ? !!model : input.modelId === null,
    "REFERENCE",
    "Choose a model belonging to the reference family.",
    400,
  );
  return {
    familyId,
    modelId: model?.id ?? null,
    label: `${family.title}${model ? ` — ${model.title}` : ""}`,
  };
}
