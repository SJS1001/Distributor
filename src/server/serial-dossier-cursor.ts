import { canonical, check, text, type Actor } from "./core.ts";

// Only the cursor codec is shared. Every module resolves its own scoped anchor.
export function serialCursor(
  actor: Actor,
  unitId: string,
  section: "shipments" | "claims",
  after?: string,
) {
  const binding = [
    1,
    section,
    actor.orgId,
    unitId,
    actor.role === "warehouse" ? [...actor.sites].sort() : null,
  ];
  let anchorId: string | null = null;
  if (after !== undefined) {
    const token = text(after, "Serial dossier cursor", 4096);
    let parsed: unknown;
    try {
      const bytes = Buffer.from(token, "base64url");
      check(
        bytes.toString("base64url") === token,
        "VALIDATION",
        "Invalid serial dossier cursor.",
        400,
      );
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      check(false, "VALIDATION", "Invalid serial dossier cursor.", 400);
    }
    check(
      Array.isArray(parsed) &&
        parsed.length === 6 &&
        canonical(parsed.slice(0, 5)) === canonical(binding) &&
        typeof parsed[5] === "string" &&
        parsed[5].length > 0 &&
        parsed[5].length <= 128,
      "VALIDATION",
      "Serial dossier cursor does not match this view.",
      400,
    );
    anchorId = parsed[5];
  }
  return {
    anchorId,
    next: (id: string) =>
      Buffer.from(JSON.stringify([...binding, id])).toString("base64url"),
  };
}
