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

test("customer pilot enablement is independent and authenticates only as the assigned buyer", async (t) => {
  const f = fixture(t);
  const buyer = {
    email: "pilot-buyer@example.test",
    password: "synthetic-buyer-password",
  };
  f.app.identity.createUser(f.actor, "pilot-buyer", {
    ...buyer,
    name: "Sample buyer",
    role: "buyer",
    accountId: f.buyer,
    sites: [],
    requirePasswordChange: false,
  });
  assert.equal(
    configuredPilotSignIn({ PUBLIC_PILOT_ADMIN_SIGN_IN: "true" }, "CUSTOMER"),
    undefined,
  );
  assert.throws(() =>
    configuredPilotSignIn(
      { PUBLIC_PILOT_CUSTOMER_SIGN_IN: "true" },
      "CUSTOMER",
    ),
  );
  assert.deepEqual(
    configuredPilotSignIn(
      {
        PUBLIC_PILOT_CUSTOMER_SIGN_IN: "true",
        PUBLIC_PILOT_CUSTOMER_EMAIL: buyer.email,
        PUBLIC_PILOT_CUSTOMER_PASSWORD: buyer.password,
      },
      "CUSTOMER",
    ),
    buyer,
  );
  const http = await createHttp(f.app, {
    origin: "http://localhost",
    publicPilotCustomerSignIn: buyer,
  });
  t.after(() => http.close());
  assert.deepEqual((await http.inject({ url: "/api/pilot-sign-in" })).json(), {
    enabled: false,
  });
  assert.deepEqual(
    (await http.inject({ url: "/api/pilot-sign-in?audience=unknown" })).json(),
    { enabled: false },
  );
  const config = await http.inject({
    url: "/api/pilot-sign-in?audience=customer",
  });
  assert.deepEqual(config.json(), { enabled: true, ...buyer });
  assert.equal(config.headers["cache-control"], "no-store");
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost" },
    payload: buyer,
  });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().actor.role, "buyer");
  assert.equal(login.json().actor.accountId, f.buyer);
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  assert.equal(
    (await http.inject({ url: "/api/users", headers: { cookie } })).statusCode,
    403,
  );
});
