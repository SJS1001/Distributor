import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { Application } from "../src/server/application.ts";
import { DomainError } from "../src/server/core.ts";
import { LOGIN_ADMISSION_LIMITS } from "../src/server/iam.ts";
import { createHttp } from "../src/server/http.ts";
import { fixture } from "./fixtures.ts";

const origin = "http://localhost:3000";
const password = "long-test-only-password";
function rateLimited(operation: () => unknown) {
  assert.throws(
    operation,
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "RATE_LIMIT" &&
      error.status === 429,
  );
}
function globalCounter(f: ReturnType<typeof fixture>) {
  return f.app.database
    .owned("iam")
    .get(
      "SELECT email,count,reset_at FROM iam_attempts WHERE length(email)>254 AND email LIKE '%:global'",
    )!;
}

test("rotating unknown logins share a durable peer budget, ignore forwarded headers, and stop before scrypt", async (t) => {
  const f = fixture(t);
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-security-login",
  });
  t.after(() => http.close());
  const original = crypto.scryptSync;
  let calculations = 0;
  crypto.scryptSync = ((...args: Parameters<typeof crypto.scryptSync>) => {
    calculations++;
    return original(...args);
  }) as typeof crypto.scryptSync;
  syncBuiltinESMExports();
  try {
    for (let n = 0; n < LOGIN_ADMISSION_LIMITS.peer; n++) {
      const reply = await http.inject({
        method: "POST",
        url: "/api/login",
        remoteAddress: "192.0.2.40",
        headers: {
          origin,
          "x-forwarded-for": `198.51.100.${n}`,
          "fly-client-ip": `198.51.100.${n}`,
        },
        payload: {
          email: `rotating-${n}@unknown.test`,
          password: "incorrect-password",
        },
      });
      assert.equal(reply.statusCode, 401);
    }
    const sharedBefore = globalCounter(f).count;
    const denied = await http.inject({
      method: "POST",
      url: "/api/login",
      remoteAddress: "192.0.2.40",
      headers: {
        origin,
        "x-forwarded-for": "203.0.113.41",
        "fly-client-ip": "203.0.113.41",
      },
      payload: {
        email: "one-more@unknown.test",
        password: "incorrect-password",
      },
    });
    assert.equal(denied.statusCode, 429);
    assert.equal(denied.json().code, "RATE_LIMIT");
    assert.equal(calculations, LOGIN_ADMISSION_LIMITS.peer);
    assert.equal(globalCounter(f).count, sharedBefore);
    assert.equal(
      f.app.database
        .owned("iam")
        .get(
          "SELECT email FROM iam_attempts WHERE email='one-more@unknown.test'",
        ),
      undefined,
    );
    const otherPeer = await http.inject({
      method: "POST",
      url: "/api/login",
      remoteAddress: "192.0.2.41",
      headers: { origin },
      payload: { email: "admin@example.test", password },
    });
    assert.equal(otherPeer.statusCode, 200);
    assert.equal(calculations, LOGIN_ADMISSION_LIMITS.peer + 1);
    f.app.close();
    f.app = new Application(f.path, "CA");
    rateLimited(() =>
      f.app.identity.login(
        "restart@unknown.test",
        "incorrect-password",
        undefined,
        undefined,
        "192.0.2.40",
      ),
    );
    assert.equal(calculations, LOGIN_ADMISSION_LIMITS.peer + 1);
    const transportRows = f.app.database
      .owned("iam")
      .all<{ email: string }>(
        "SELECT email FROM iam_attempts WHERE length(email)>254",
      );
    assert.equal(
      transportRows.some((row) => row.email.includes("192.0.2.")),
      false,
    );
  } finally {
    crypto.scryptSync = original;
    syncBuiltinESMExports();
  }
});

test("global admission bounds distributed or native logins and resets only after its fixed window", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.app.identity.login("seed@unknown.test", "incorrect-password"),
    /Invalid credentials/,
  );
  const iam = f.app.database.owned("iam");
  iam.run(
    "UPDATE iam_attempts SET count=? WHERE email=?",
    LOGIN_ADMISSION_LIMITS.global - 1,
    globalCounter(f).email as string,
  );
  f.app.identity.login(
    "admin@example.test",
    password,
    undefined,
    undefined,
    "192.0.2.50",
  );
  rateLimited(() =>
    f.app.identity.login(
      "different@unknown.test",
      "incorrect-password",
      undefined,
      undefined,
      "192.0.2.51",
    ),
  );
  rateLimited(() => f.app.identity.login("admin@example.test", password));
  iam.run(
    "UPDATE iam_attempts SET reset_at=? WHERE length(email)>254",
    Date.now() - 1,
  );
  assert.equal(
    f.app.identity.login("admin@example.test", password).actor.id,
    f.actor.id,
  );
  assert.equal(globalCounter(f).count, 1);
});

test("account lockouts do not spend shared budget and successful account login cannot clear transport budgets", (t) => {
  const f = fixture(t);
  const iam = f.app.database.owned("iam");
  for (let n = 0; n < 8; n++)
    assert.throws(
      () => f.app.identity.login("locked@unknown.test", "incorrect-password"),
      /Invalid credentials/,
    );
  const before = globalCounter(f).count;
  rateLimited(() =>
    f.app.identity.login("locked@unknown.test", "incorrect-password"),
  );
  assert.equal(globalCounter(f).count, before);
  f.app.identity.login("admin@example.test", password);
  assert.equal(globalCounter(f).count, Number(before) + 1);
});

test("attempt storage has a hard admission cap and expired cleanup removes only a bounded batch", (t) => {
  const f = fixture(t);
  const iam = f.app.database.owned("iam");
  f.app.database.transaction(() => {
    for (let n = 0; n < LOGIN_ADMISSION_LIMITS.maximumRows; n++)
      iam.run(
        "INSERT INTO iam_attempts VALUES(?,1,?)",
        `seed-${n}@unknown.test`,
        Date.now() + 900000,
      );
  });
  rateLimited(() =>
    f.app.identity.login(
      "overflow@unknown.test",
      "incorrect-password",
      undefined,
      undefined,
      "192.0.2.60",
    ),
  );
  assert.equal(
    iam.get("SELECT count(*) AS n FROM iam_attempts")!.n,
    LOGIN_ADMISSION_LIMITS.maximumRows,
  );
  iam.run("UPDATE iam_attempts SET reset_at=?", Date.now() - 1);
  assert.throws(
    () =>
      f.app.identity.login(
        "after-expiry@unknown.test",
        "incorrect-password",
        undefined,
        undefined,
        "192.0.2.60",
      ),
    /Invalid credentials/,
  );
  assert.equal(
    iam.get(
      "SELECT count(*) AS n FROM iam_attempts WHERE reset_at<?",
      Date.now(),
    )!.n,
    LOGIN_ADMISSION_LIMITS.maximumRows - LOGIN_ADMISSION_LIMITS.cleanupRows,
  );
  assert.equal(
    iam.get("SELECT count(*) AS n FROM iam_attempts")!.n,
    LOGIN_ADMISSION_LIMITS.maximumRows - LOGIN_ADMISSION_LIMITS.cleanupRows + 3,
  );
});

test("explicit Fly peer qualification refuses a missing trusted address and separates qualified clients", async (t) => {
  const f = fixture(t);
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-security-login",
    enrollmentFlyProxy: true,
  });
  t.after(() => http.close());
  const request = {
    method: "POST" as const,
    url: "/api/login",
    remoteAddress: "192.0.2.70",
    payload: { email: "admin@example.test", password },
  };
  assert.equal(
    (await http.inject({ ...request, headers: { origin } })).statusCode,
    503,
  );
  const first = await http.inject({
    ...request,
    headers: { origin, "fly-client-ip": "203.0.113.70" },
  });
  assert.equal(first.statusCode, 200);
  const iam = f.app.database.owned("iam");
  iam.run(
    "UPDATE iam_attempts SET count=? WHERE length(email)>254 AND email LIKE '%:peer:%'",
    LOGIN_ADMISSION_LIMITS.peer,
  );
  assert.equal(
    (
      await http.inject({
        ...request,
        headers: { origin, "fly-client-ip": "203.0.113.70" },
      })
    ).statusCode,
    429,
  );
  assert.equal(
    (
      await http.inject({
        ...request,
        headers: { origin, "fly-client-ip": "203.0.113.71" },
      })
    ).statusCode,
    200,
  );
});

test("parallel SQLite connections reserve the last account slot atomically before password hashing", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.app.identity.login("seed@unknown.test", "incorrect-password"),
    /Invalid credentials/,
  );
  const iam = f.app.database.owned("iam"),
    second = new Application(f.path, "CA");
  const original = crypto.scryptSync;
  const existing = Number(iam.get("SELECT count(*) AS n FROM iam_attempts")!.n);
  f.app.database.transaction(() => {
    for (let n = existing; n < LOGIN_ADMISSION_LIMITS.maximumRows - 1; n++)
      iam.run(
        "INSERT INTO iam_attempts VALUES(?,1,?)",
        `concurrent-seed-${n}@unknown.test`,
        Date.now() + 900000,
      );
  });
  let calculations = 0;
  crypto.scryptSync = ((...args: Parameters<typeof crypto.scryptSync>) => {
    calculations++;
    if (calculations === 1)
      rateLimited(() =>
        second.identity.login("racing@unknown.test", "incorrect-password"),
      );
    return original(...args);
  }) as typeof crypto.scryptSync;
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => f.app.identity.login("admitted@unknown.test", "incorrect-password"),
      /Invalid credentials/,
    );
    assert.equal(calculations, 1);
    assert.equal(
      iam.get("SELECT count(*) AS n FROM iam_attempts")!.n,
      LOGIN_ADMISSION_LIMITS.maximumRows,
    );
    assert.equal(
      iam.get(
        "SELECT count FROM iam_attempts WHERE email='admitted@unknown.test'",
      )!.count,
      1,
    );
    assert.equal(
      iam.get(
        "SELECT email FROM iam_attempts WHERE email='racing@unknown.test'",
      ),
      undefined,
    );
  } finally {
    crypto.scryptSync = original;
    syncBuiltinESMExports();
    second.close();
  }
});

test("a concurrent successful login cannot make an earlier failure recreate a row past the cap", (t) => {
  const f = fixture(t),
    iam = f.app.database.owned("iam"),
    second = new Application(f.path, "CA");
  assert.throws(
    () => f.app.identity.login("seed@unknown.test", "incorrect-password"),
    /Invalid credentials/,
  );
  const count = Number(iam.get("SELECT count(*) AS n FROM iam_attempts")!.n);
  f.app.database.transaction(() => {
    for (let n = count; n < LOGIN_ADMISSION_LIMITS.maximumRows - 1; n++)
      iam.run(
        "INSERT INTO iam_attempts VALUES(?,1,?)",
        `recreated-seed-${n}@unknown.test`,
        Date.now() + 900000,
      );
  });
  const original = crypto.scryptSync;
  let calculations = 0;
  crypto.scryptSync = ((...args: Parameters<typeof crypto.scryptSync>) => {
    if (++calculations === 1) {
      assert.equal(
        second.identity.login("admin@example.test", password).actor.id,
        f.actor.id,
      );
      assert.throws(
        () =>
          second.identity.login(
            "takes-freed-slot@unknown.test",
            "incorrect-password",
          ),
        /Invalid credentials/,
      );
    }
    return original(...args);
  }) as typeof crypto.scryptSync;
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => f.app.identity.login("admin@example.test", "incorrect-password"),
      /Invalid credentials/,
    );
    assert.equal(calculations, 3);
    assert.equal(
      iam.get("SELECT count(*) AS n FROM iam_attempts")!.n,
      LOGIN_ADMISSION_LIMITS.maximumRows,
    );
    assert.equal(
      iam.get(
        "SELECT email FROM iam_attempts WHERE email='admin@example.test'",
      ),
      undefined,
    );
    rateLimited(() => f.app.identity.login("admin@example.test", password));
  } finally {
    crypto.scryptSync = original;
    syncBuiltinESMExports();
    second.close();
  }
});

test("saturated attempt storage refuses reauthentication before hashing and preserves its account limit", (t) => {
  const f = fixture(t),
    iam = f.app.database.owned("iam"),
    session = f.app.identity.login("admin@example.test", password);
  const sharedBefore = globalCounter(f).count;
  const count = Number(iam.get("SELECT count(*) AS n FROM iam_attempts")!.n);
  f.app.database.transaction(() => {
    for (let n = count; n < LOGIN_ADMISSION_LIMITS.maximumRows; n++)
      iam.run(
        "INSERT INTO iam_attempts VALUES(?,1,?)",
        `reauth-seed-${n}@unknown.test`,
        Date.now() + 900000,
      );
  });
  const reauthenticate = () =>
    f.app.identity.createUser(f.actor, "saturation-reauth", {
      email: "uncreated@example.test",
      name: "Uncreated user",
      password,
      role: "warehouse",
      sites: [f.w1],
      currentPassword: "incorrect-password",
    });
  const original = crypto.scryptSync;
  let calculations = 0;
  crypto.scryptSync = ((...args: Parameters<typeof crypto.scryptSync>) => {
    calculations++;
    return original(...args);
  }) as typeof crypto.scryptSync;
  syncBuiltinESMExports();
  try {
    rateLimited(reauthenticate);
    assert.equal(calculations, 0);
    assert.equal(f.app.identity.session(session.token).actor.id, f.actor.id);
    iam.run(
      "DELETE FROM iam_attempts WHERE email IN (SELECT email FROM iam_attempts WHERE email LIKE 'reauth-seed-%' LIMIT 1)",
    );
    for (let n = 0; n < 8; n++)
      assert.throws(
        reauthenticate,
        (error: unknown) =>
          error instanceof DomainError && error.code === "REAUTHENTICATE",
      );
    rateLimited(reauthenticate);
    assert.equal(calculations, 8);
    assert.equal(globalCounter(f).count, sharedBefore);
    assert.equal(
      iam.get("SELECT count(*) AS n FROM iam_attempts")!.n,
      LOGIN_ADMISSION_LIMITS.maximumRows,
    );
  } finally {
    crypto.scryptSync = original;
    syncBuiltinESMExports();
  }
});
