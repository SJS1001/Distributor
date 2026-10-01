import { randomUUID } from "node:crypto";
import type { Actor, Role } from "../src/server/core.ts";
import { fixture } from "./fixtures.ts";
type Fixture = ReturnType<typeof fixture>;
export function warrantyUser(
  f: Fixture,
  role: Role,
  accountId = f.buyer,
  sites = [f.w1],
) {
  const nonce = randomUUID();
  const r = f.app.identity.createUser(f.actor, `authority-user-${nonce}`, {
    name: role,
    email: `authority-${nonce}@example.test`,
    password: "long-user-test-password",
    role,
    accountId,
    sites: role === "buyer" ? [] : sites,
  });
  return f.app.identity.currentActor({ ...f.actor, id: r.id });
}
export function warrantyGrants(
  f: Fixture,
  actor: Actor,
  changes: Record<string, unknown>,
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  f.app.identity.updateUser(
    f.actor,
    `authority-grants-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: Number(row.revision),
      email: String(row.email),
      name: String(row.name),
      role: row.role as Role,
      accountId: (row.accountId as string | null) ?? undefined,
      sites: row.sites as string[],
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic access change",
      ...changes,
    },
  );
}
