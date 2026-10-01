import { createHash, randomUUID } from "node:crypto";

export type Row = Record<string, string | number | null | Uint8Array>;
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export function check(
  value: unknown,
  code: string,
  message: string,
  status = 409,
): asserts value {
  if (!value) throw new DomainError(code, message, status);
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const digest = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
export function integer(
  value: unknown,
  name: string,
  minimum = 0,
  maximum = 1_000_000_000,
): number {
  check(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum,
    "VALIDATION",
    `${name} must be an integer between ${minimum} and ${maximum}.`,
    400,
  );
  return value;
}
export function text(value: unknown, name: string, maximum = 160): string {
  check(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= maximum,
    "VALIDATION",
    `${name} is required (maximum ${maximum} characters).`,
    400,
  );
  return value.trim();
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export type Role =
  | "admin"
  | "warehouse"
  | "commercial"
  | "finance"
  | "warranty"
  | "buyer"
  | "support";
export type Actor = {
  id: string;
  orgId: string;
  accountId: string | null;
  role: Role;
  sites: string[];
  name: string;
};
export function permit(actor: Actor, roles: Role[]) {
  check(
    actor.role === "admin" || roles.includes(actor.role),
    "FORBIDDEN",
    "This action is not permitted.",
    403,
  );
}
export function site(actor: Actor, warehouseId: string) {
  check(
    actor.role === "admin" || actor.sites.includes(warehouseId),
    "FORBIDDEN",
    "Warehouse access is not permitted.",
    403,
  );
}
export function account(actor: Actor, accountId: string) {
  check(
    actor.role !== "buyer" || actor.accountId === accountId,
    "FORBIDDEN",
    "Account access is not permitted.",
    403,
  );
}
export function tax(net: number, basisPoints: number): number {
  integer(net, "net", 0, 1_000_000_000_000);
  integer(basisPoints, "tax rate", 0, 10000);
  return Number((BigInt(net) * BigInt(basisPoints) + 5000n) / 10000n);
}
