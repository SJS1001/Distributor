import { check } from "./core.ts";

/** Deliberately public credentials, only for an owner-authorized sample pilot. */
export function configuredPilotSignIn(
  env: NodeJS.ProcessEnv = process.env,
  audience: "ADMIN" | "CUSTOMER" = "ADMIN",
) {
  if (env[`PUBLIC_PILOT_${audience}_SIGN_IN`] !== "true") return undefined;
  const email = env[`PUBLIC_PILOT_${audience}_EMAIL`]?.trim();
  const password = env[`PUBLIC_PILOT_${audience}_PASSWORD`];
  check(
    Boolean(email && password),
    "CONFIG",
    "Public pilot sign-in requires both account credentials.",
    500,
  );
  return { email: email!, password: password! };
}
