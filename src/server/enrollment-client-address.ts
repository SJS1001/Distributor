import { isIP } from "node:net";
import { check } from "./core.ts";

// This opt-in is only for an origin reachable exclusively through Fly's HTTP
// handler. Never infer trust from the presence of a client-supplied header.
export function enrollmentClientAddress(
  peer: string,
  flyClientIp: string | string[] | undefined,
  flyProxy: boolean,
): string {
  if (!flyProxy) return peer;
  check(
    typeof flyClientIp === "string" && isIP(flyClientIp) !== 0,
    "ENROLLMENT_PROXY",
    "Enrollment is temporarily unavailable.",
    503,
  );
  return flyClientIp as string;
}
