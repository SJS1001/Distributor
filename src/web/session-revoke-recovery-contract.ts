import type { SessionDetail } from "../shared/session-details.ts";

export type SessionRevokeActor = { id: string; orgId: string };
export type SessionRevokeAttempt = SessionRevokeActor & {
  version: 1;
  reference: string;
  key: string;
  passwordDigest: string;
  current: boolean;
};
type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const sessionRevokeStoragePrefix = "distributor-session-revoke:";
export const sessionRevokeStorageKey = (actor: SessionRevokeActor) =>
  `${sessionRevokeStoragePrefix}${encodeURIComponent(actor.orgId)}:${encodeURIComponent(actor.id)}`;

export function readSessionRevokeAttempt(
  storage: AttemptStorage,
  actor: SessionRevokeActor,
): SessionRevokeAttempt | null {
  try {
    const raw = storage.getItem(sessionRevokeStorageKey(actor));
    if (!raw || raw.length > 2000) return null;
    const value = JSON.parse(raw) as Partial<SessionRevokeAttempt>;
    if (
      value.version !== 1 ||
      value.id !== actor.id ||
      value.orgId !== actor.orgId ||
      typeof value.reference !== "string" ||
      !/^[a-f0-9]{32}$/.test(value.reference) ||
      typeof value.key !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        value.key,
      ) ||
      typeof value.passwordDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.passwordDigest) ||
      typeof value.current !== "boolean"
    )
      return null;
    // Rebuild only the permitted fields; never restore arbitrary stored data.
    return {
      version: 1,
      id: actor.id,
      orgId: actor.orgId,
      reference: value.reference,
      key: value.key,
      passwordDigest: value.passwordDigest,
      current: value.current,
    };
  } catch {
    return null;
  }
}
export async function sessionRevokePasswordDigest(password: string) {
  if (!password || password.length > 256)
    throw new Error("Enter your current password.");
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function prepareSessionRevokeAttempt(
  storage: AttemptStorage,
  actor: SessionRevokeActor,
  session: Pick<SessionDetail, "reference" | "current">,
  password: string,
): Promise<SessionRevokeAttempt> {
  const existing = readSessionRevokeAttempt(storage, actor);
  if (existing) return existing;
  if (!session.reference || !/^[a-f0-9]{32}$/.test(session.reference))
    throw new Error("Refresh your sessions before selecting one to end.");
  const attempt: SessionRevokeAttempt = {
    version: 1,
    id: actor.id,
    orgId: actor.orgId,
    reference: session.reference,
    current: session.current,
    key: crypto.randomUUID(),
    passwordDigest: await sessionRevokePasswordDigest(password),
  };
  storage.setItem(sessionRevokeStorageKey(actor), JSON.stringify(attempt));
  return attempt;
}
export function forgetSessionRevokeAttempt(
  storage: AttemptStorage,
  actor: SessionRevokeActor,
  expectedKey?: string,
) {
  if (
    expectedKey !== undefined &&
    readSessionRevokeAttempt(storage, actor)?.key !== expectedKey
  )
    return;
  storage.removeItem(sessionRevokeStorageKey(actor));
}
export type SessionRevokeReceipt = {
  id: string;
  sessionReference: string;
  sessionsEnded: 1;
  sessionEnded: boolean;
};
export async function submitSessionRevokeAttempt(
  attempt: SessionRevokeAttempt,
  password: string,
  execute: (
    key: string,
    payload: { sessionReference: string; currentPassword: string },
  ) => Promise<SessionRevokeReceipt>,
) {
  if ((await sessionRevokePasswordDigest(password)) !== attempt.passwordDigest)
    throw new Error(
      "Reenter the same password used for this saved attempt. The request has not been sent.",
    );
  const receipt = await execute(attempt.key, {
    sessionReference: attempt.reference,
    currentPassword: password,
  });
  if (
    receipt.id !== attempt.id ||
    receipt.sessionReference !== attempt.reference ||
    receipt.sessionsEnded !== 1 ||
    typeof receipt.sessionEnded !== "boolean"
  )
    throw new Error(
      "The saved session-end receipt could not be verified. Retry this attempt.",
    );
  return receipt;
}
