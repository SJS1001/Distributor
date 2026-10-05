import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredPilotSignIn } from "../src/server/pilot-sign-in.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture } from "./fixtures.ts";

const credentials = {
  email: "admin@example.test",
  password: "long-test-only-password",
};

test("public pilot credentials require explicit enablement and complete configuration", () => {
  assert.equal(configuredPilotSignIn({}), undefined);
  const values = {
    PUBLIC_PILOT_ADMIN_EMAIL: credentials.email,
    PUBLIC_PILOT_ADMIN_PASSWORD: credentials.password,
  };
  assert.equal(configuredPilotSignIn(values), undefined);
  assert.throws(() =>
    configuredPilotSignIn({ PUBLIC_PILOT_ADMIN_SIGN_IN: "true" }),
  );
  assert.deepEqual(
    configuredPilotSignIn({ ...values, PUBLIC_PILOT_ADMIN_SIGN_IN: "true" }),
    credentials,
  );
});

test("public pilot config defaults off; enabled credentials use normal authenticated login", async (t) => {
  const f = fixture(t);
  for (const enabled of [false, true]) {
    const http = await createHttp(f.app, {
      origin: "http://localhost",
      ...(enabled ? { publicPilotSignIn: credentials } : {}),
    });
    try {
      const config = await http.inject({ url: "/api/pilot-sign-in" });
      assert.equal(config.statusCode, 200);
      assert.equal(config.headers["cache-control"], "no-store");
      assert.deepEqual(
        config.json(),
        enabled ? { enabled: true, ...credentials } : { enabled: false },
      );
      assert.equal((await http.inject({ url: "/api/users" })).statusCode, 401);
      const login = await http.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin: "http://localhost" },
        payload: credentials,
      });
      assert.equal(login.statusCode, 200);
      assert.equal(login.json().actor.role, "admin");
      assert.equal(
        (
          await http.inject({
            method: "POST",
            url: "/api/login",
            headers: { origin: "http://localhost" },
            payload: { ...credentials, password: "wrong-password" },
          })
        ).statusCode,
        401,
      );
    } finally {
      await http.close();
    }
  }
});
