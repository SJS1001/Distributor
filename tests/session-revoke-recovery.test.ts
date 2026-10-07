import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
import {
  forgetSessionRevokeAttempt,
  prepareSessionRevokeAttempt,
  readSessionRevokeAttempt,
  sessionRevokeStorageKey,
  submitSessionRevokeAttempt,
  type SessionRevokeAttempt,
} from "../src/web/session-revoke-recovery-contract.ts";
import { onSessionEnded, request } from "../src/web/api.ts";

const password = "long-test-only-password";
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("lost committed current-session reply survives sign-in and replays exact reference/key without ending replacement session", async (t) => {
  const f = fixture(t),
    http = await createHttp(f.app, { origin: "http://localhost" });
  t.after(() => http.close());
  const first = f.app.identity.login("admin@example.test", password),
    session = f.app.identity
      .security(first.actor, first.token)
      .sessionDetails!.find((item) => item.current)!,
    saved = storage(),
    attempt = await prepareSessionRevokeAttempt(
      saved,
      first.actor,
      session,
      password,
    );
  assert.ok(!JSON.stringify([...saved.values]).includes(password));
  assert.equal(
    Object.keys(
      JSON.parse(saved.getItem(sessionRevokeStorageKey(first.actor))!),
    )
      .sort()
      .join(","),
    "current,id,key,orgId,passwordDigest,reference,version",
  );
  const requests: { key: string; payload: unknown }[] = [];
  await assert.rejects(
    () =>
      submitSessionRevokeAttempt(attempt, password, async (key, payload) => {
        requests.push({ key, payload });
        const result = await http.inject({
          method: "POST",
          url: "/api/commands/user.session.end-own",
          headers: {
            origin: "http://localhost",
            cookie: `distributor_session=${first.token}`,
            "x-csrf-token": first.csrf,
            "idempotency-key": key,
          },
          payload,
        });
        assert.equal(result.statusCode, 200);
        assert.equal(result.json().sessionEnded, true);
        throw new Error("Synthetic lost committed response");
      }),
    /lost committed response/,
  );
  assert.throws(
    () => f.app.identity.session(first.token),
    (error: unknown) => (error as { code: string }).code === "UNAUTHENTICATED",
  );
  assert.deepEqual(readSessionRevokeAttempt(saved, first.actor), attempt);
  const replacement = f.app.identity.login("admin@example.test", password),
    restored = readSessionRevokeAttempt(saved, replacement.actor)!;
  let calls = 0;
  await assert.rejects(
    () =>
      submitSessionRevokeAttempt(restored, "different-password", async () => {
        calls++;
        throw new Error("Must not send");
      }),
    /same password/,
  );
  assert.equal(calls, 0);
  const receipt = await submitSessionRevokeAttempt(
    restored,
    password,
    async (key, payload) => {
      requests.push({ key, payload });
      const result = await http.inject({
        method: "POST",
        url: "/api/commands/user.session.end-own",
        headers: {
          origin: "http://localhost",
          cookie: `distributor_session=${replacement.token}`,
          "x-csrf-token": replacement.csrf,
          "idempotency-key": key,
        },
        payload,
      });
      assert.equal(result.statusCode, 200);
      assert.equal(result.headers["set-cookie"], undefined);
      return result.json();
    },
  );
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(receipt.sessionEnded, false);
  assert.equal(
    f.app.identity.session(replacement.token).actor.id,
    first.actor.id,
  );
  assert.equal(
    f.app.database
      .owned("platform")
      .get(
        "SELECT COUNT(*) AS n FROM platform_audit WHERE action='user.session.ended'",
      )!.n,
    1,
  );
  forgetSessionRevokeAttempt(saved, replacement.actor, restored.key);
  assert.equal(readSessionRevokeAttempt(saved, replacement.actor), null);
});

test("saved session attempts reject cross-actor, cross-organization and malformed restoration; old replies cannot remove a newer attempt", async () => {
  const saved = storage(),
    actor = { orgId: "org", id: "user" },
    attempt = await prepareSessionRevokeAttempt(
      saved,
      actor,
      { reference: "a".repeat(32), current: false },
      password,
    );
  assert.equal(
    readSessionRevokeAttempt(saved, { ...actor, id: "other" }),
    null,
  );
  assert.equal(
    readSessionRevokeAttempt(saved, { ...actor, orgId: "other" }),
    null,
  );
  saved.setItem(
    sessionRevokeStorageKey({ ...actor, id: "other" }),
    JSON.stringify(attempt),
  );
  assert.equal(
    readSessionRevokeAttempt(saved, { ...actor, id: "other" }),
    null,
  );
  for (const patch of [
    { reference: "secret-token" },
    { key: "not-a-key" },
    { passwordDigest: "not-a-digest" },
    { current: "true" },
    { version: 2 },
  ]) {
    saved.setItem(
      sessionRevokeStorageKey(actor),
      JSON.stringify({ ...attempt, ...patch }),
    );
    assert.equal(readSessionRevokeAttempt(saved, actor), null);
  }
  const newer: SessionRevokeAttempt = { ...attempt, key: crypto.randomUUID() };
  saved.setItem(sessionRevokeStorageKey(actor), JSON.stringify(newer));
  forgetSessionRevokeAttempt(saved, actor, attempt.key);
  assert.deepEqual(readSessionRevokeAttempt(saved, actor), newer);
  assert.deepEqual(
    await prepareSessionRevokeAttempt(
      saved,
      actor,
      { reference: "b".repeat(32), current: true },
      password,
    ),
    newer,
    "an uncertain attempt cannot be silently replaced",
  );
});

test("unverified receipts retain recoverable attempt instead of reporting success", async () => {
  const saved = storage(),
    actor = { orgId: "org", id: "user" },
    attempt = await prepareSessionRevokeAttempt(
      saved,
      actor,
      { reference: "b".repeat(32), current: false },
      password,
    );
  await assert.rejects(
    () =>
      submitSessionRevokeAttempt(attempt, password, async () => ({
        id: "other",
        sessionReference: attempt.reference,
        sessionsEnded: 1,
        sessionEnded: false,
      })),
    /receipt could not be verified/,
  );
  assert.deepEqual(readSessionRevokeAttempt(saved, actor), attempt);
});

test("owned session-end requests can suppress global expiry callback until their mounted actor checks the reply", async (t) => {
  const priorFetch = globalThis.fetch;
  let ended = 0;
  onSessionEnded(() => {
    ended++;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "UNAUTHENTICATED",
        message: "Session unavailable",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  t.after(() => {
    globalThis.fetch = priorFetch;
    onSessionEnded(null);
  });
  await assert.rejects(() =>
    request("/api/commands/user.session.end-own", {}, false),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ended, 0);
  await assert.rejects(() => request("/api/security"));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ended, 1);
});
