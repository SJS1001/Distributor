import { request, RequestError } from "./api.ts";

type RetainedAttempt = { key: string; payload: unknown; command?: string };

/** Coordinate one exact retained command across same-origin tabs. */
export async function sendRetainedCommand(
  storageKey: string,
  command: string,
  attempt: RetainedAttempt,
  onRetained: () => void,
  onDefinitiveRejection: () => void,
) {
  if (!navigator.locks?.request)
    throw Error(
      "Browser coordination is unavailable. Restore browser coordination before changing this record.",
    );
  return navigator.locks.request(
    storageKey,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw Error(
          "Another tab is confirming a change for this record. Wait for it to finish before retrying.",
        );
      const serialized = JSON.stringify(attempt);
      const existing = localStorage.getItem(storageKey);
      if (existing !== null && existing !== serialized)
        throw Error(
          "Another saved change exists for this record. Reload and review that exact change before retrying.",
        );
      localStorage.setItem(storageKey, serialized);
      onRetained();
      const clearExact = () => {
        if (localStorage.getItem(storageKey) !== serialized)
          throw Error(
            "The saved change changed in another tab. Reload before continuing.",
          );
        localStorage.removeItem(storageKey);
      };
      try {
        await request(`/api/commands/${command}`, {
          method: "POST",
          headers: { "idempotency-key": attempt.key },
          body: JSON.stringify(attempt.payload),
        });
      } catch (error) {
        if (
          error instanceof RequestError &&
          [400, 409, 422].includes(error.status)
        ) {
          clearExact();
          onDefinitiveRejection();
        }
        throw error;
      }
      clearExact();
    },
  );
}
