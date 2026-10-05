import { check } from "./core.ts";

/** Deliberately public credentials, only for an owner-authorized sample pilot. */
export function configuredPilotSignIn(env: NodeJS.ProcessEnv = process.env) {
  if (env.PUBLIC_PILOT_ADMIN_SIGN_IN !== "true") return undefined;
  const email = env.PUBLIC_PILOT_ADMIN_EMAIL?.trim();
  const password = env.PUBLIC_PILOT_ADMIN_PASSWORD;
  check(
    Boolean(email && password),
    "CONFIG",
    "Public pilot sign-in requires both administrator credentials.",
    500,
  );
  return { email: email!, password: password! };
}
