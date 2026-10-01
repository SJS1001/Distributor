import { check, type Role } from "./core.ts";
import { FactorCipher } from "./totp.ts";

const roles: readonly Role[] = [
  "admin",
  "warehouse",
  "commercial",
  "finance",
  "warranty",
  "buyer",
  "support",
];

export function validateMfaPolicy(
  required: readonly Role[],
  key?: string,
): readonly Role[] {
  check(
    Array.isArray(required) &&
      required.every((role) => roles.includes(role)) &&
      new Set(required).size === required.length,
    "CONFIG",
    "MFA required roles must be distinct known roles.",
    500,
  );
  const cipher = new FactorCipher(key);
  check(
    !required.length || cipher.available,
    "CONFIG",
    "Required authenticator roles need an MFA encryption key.",
    500,
  );
  return Object.freeze([...required]);
}

export function configuredMfaRoles(
  value = process.env.MFA_REQUIRED_ROLES,
): readonly Role[] {
  if (value === undefined || value === "") return [];
  const selected = value.split(",");
  check(
    selected.every((role) => roles.includes(role as Role)) &&
      new Set(selected).size === selected.length,
    "CONFIG",
    "MFA_REQUIRED_ROLES must contain distinct comma-separated known roles without spaces.",
    500,
  );
  return Object.freeze(selected as Role[]);
}
