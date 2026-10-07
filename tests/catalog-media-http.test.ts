import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { fixture } from "./fixtures.ts";
import { createHttp } from "../src/server/http.ts";
const origin = "https://media.example.test";
const password = "long-test-only-password";
const image = () => {
  const c = createCanvas(10, 10);
  return {
    kind: "image",
    title: "Synthetic equipment",
    altText: "Synthetic fixture image",
    mediaType: "image/png",
    contentBase64: c.toBuffer("image/png").toString("base64"),
  };
};
async function setup(t: Parameters<typeof fixture>[0]) {
  const f = fixture(t);
  const http = await createHttp(f.app, { origin });
  await http.ready();
  t.after(() => {
    void http.close();
  });
  const login = async (email: string) => {
    const r = await http.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(r.statusCode, 200);
    const c = r.cookies[0]!;
    return {
      origin,
      cookie: `${c.name}=${c.value}`,
      "x-csrf-token": r.json().csrf as string,
    };
  };
  const admin = await login("admin@example.test");
  f.app.identity.createUser(f.actor, "http-media-buyer", {
    name: "buyer",
    email: "buyer@media.test",
    password,
    role: "buyer",
    accountId: f.buyer,
    sites: [],
  });
  const buyer = await login("buyer@media.test");
  return {
    ...f,
    http,
    admin,
    buyerHeaders: buyer,
    base: `/api/catalog/products/${f.product}/resources`,
  };
}
test("HTTP catalog upload requires session, admin, CSRF and idempotency; strict bounded JSON", async (t) => {
  const f = await setup(t);
  const send = (
    headers: Record<string, string>,
    payload: Record<string, unknown> = image(),
  ) => f.http.inject({ method: "POST", url: f.base, headers, payload });
  assert.equal(
    (await send({ origin, "idempotency-key": "anonymous" })).statusCode,
    401,
  );
  assert.equal(
    (
      await send({
        ...f.admin,
        "x-csrf-token": "wrong",
        "idempotency-key": "csrf",
      })
    ).statusCode,
    403,
  );
  assert.equal((await send({ ...f.admin })).statusCode, 400);
  assert.equal(
    (await send({ ...f.buyerHeaders, "idempotency-key": "buyer" })).statusCode,
    403,
  );
  assert.equal(
    (
      await send(
        { ...f.admin, "idempotency-key": "extra" },
        { ...image(), orgId: "other" },
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await send(
        { ...f.admin, "idempotency-key": "too-large" },
        { ...image(), contentBase64: "A".repeat(12 * 1024 * 1024) },
      )
    ).statusCode,
    413,
  );
  const headers = { ...f.admin, "idempotency-key": "upload" };
  const r = await send(headers);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().state, "draft");
  assert.deepEqual((await send(headers)).json(), r.json());
  assert.equal(
    (await send(headers, { ...image(), title: "Different" })).statusCode,
    409,
  );
});
test("HTTP resource byte, range and image access freshly enforce publication and buyer policy with private delivery", async (t) => {
  const f = await setup(t);
  const uploaded = await f.http.inject({
    method: "POST",
    url: f.base,
    headers: { ...f.admin, "idempotency-key": "upload" },
    payload: image(),
  });
  assert.equal(uploaded.statusCode, 200);
  const resource = uploaded.json();
  const url = `${f.base}/${resource.id}/bytes`;
  const get = (headers: Record<string, string>) =>
    f.http.inject({ method: "GET", url, headers });
  assert.equal((await get({})).statusCode, 401);
  assert.equal((await get(f.buyerHeaders)).statusCode, 404);
  const publish = await f.http.inject({
    method: "POST",
    url: `${f.base}/${resource.id}/publish`,
    headers: { ...f.admin, "idempotency-key": "publish" },
    payload: {
      expectedVersion: 1,
      permissionAffirmed: true,
      permissionBasis: "Synthetic fixture owned image",
    },
  });
  assert.equal(publish.statusCode, 200);
  const bytes = await get(f.buyerHeaders);
  assert.equal(bytes.statusCode, 200);
  assert.match(String(bytes.headers["content-type"]), /^image\/png/);
  assert.equal(bytes.headers["cache-control"], "private, no-store");
  assert.equal(bytes.headers["x-content-type-options"], "nosniff");
  assert.match(String(bytes.headers["content-security-policy"]), /sandbox/);
  assert.match(
    String(bytes.headers["content-disposition"]),
    /^inline; filename="catalog-/,
  );
  assert.equal(bytes.rawPayload.length, resource.bytes);
  const policy = f.app.catalog.purchasingPolicy(f.actor, f.buyer);
  f.app.catalog.setPurchasingPolicy(f.actor, "revoke", {
    ...policy,
    mode: "none",
    productIds: [],
    reason: "Synthetic rights revocation",
  });
  for (const h of [
    f.buyerHeaders,
    { ...f.buyerHeaders, range: "bytes=0-19" },
    { ...f.buyerHeaders, "if-none-match": resource.contentHash },
  ])
    assert.equal((await get(h)).statusCode, 403);
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: f.base,
        headers: f.buyerHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "GET",
        url: `${f.base}/${resource.id}/history`,
        headers: f.buyerHeaders,
      })
    ).statusCode,
    403,
  );
});

test("HTTP linked images enforce approved host, rights, exact retries and scoped visibility without bytes or CSP expansion", async (t) => {
  const f = await setup(t);
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetches++;
    throw new Error("HTTP image links must not fetch");
  });
  const payload = {
    kind: "image",
    title: "Manufacturer equipment image",
    altText: "Equipment unit",
    externalUrl: "https://cdn.shopify.com/s/files/fixture.png",
  };
  const send = (headers: Record<string, string>, input = payload) =>
    f.http.inject({ method: "POST", url: f.base, headers, payload: input });
  assert.equal(
    (await send({ origin, "idempotency-key": "linked-guest" })).statusCode,
    401,
  );
  assert.equal(
    (await send({ ...f.buyerHeaders, "idempotency-key": "linked-buyer" }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await send({
        ...f.admin,
        "x-csrf-token": "wrong",
        "idempotency-key": "linked-csrf",
      })
    ).statusCode,
    403,
  );
  assert.equal((await send(f.admin)).statusCode, 400);
  for (const [i, externalUrl] of [
    "http://cdn.shopify.com/fixture.png",
    "https://cdn.shopify.com.evil.test/fixture.png",
    "https://user:pass@cdn.shopify.com/fixture.png",
    "javascript:alert(1)",
    `https://cdn.shopify.com/${"x".repeat(2000)}`,
  ].entries())
    assert.equal(
      (
        await send(
          { ...f.admin, "idempotency-key": `bad-linked-${i}` },
          { ...payload, externalUrl },
        )
      ).statusCode,
      400,
    );
  const headers = { ...f.admin, "idempotency-key": "linked-image" };
  const uploaded = await send(headers);
  assert.equal(uploaded.statusCode, 200);
  const resource = uploaded.json();
  assert.equal(resource.bytes, 0);
  assert.equal(resource.inspection, "link");
  assert.deepEqual((await send(headers)).json(), resource);
  assert.equal(
    (
      await send(headers, {
        ...payload,
        externalUrl: `${payload.externalUrl}?v=2`,
      })
    ).statusCode,
    409,
  );
  const list = () => f.http.inject({ url: f.base, headers: f.buyerHeaders });
  const drafts = await list();
  assert.deepEqual(drafts.json().items, []);
  assert.match(
    String(drafts.headers["content-security-policy"]),
    /img-src 'self' data: https:\/\/cdn\.shopify\.com;/,
  );
  const publishUrl = `${f.base}/${resource.id}/publish`;
  const rights = {
    expectedVersion: 1,
    permissionAffirmed: true,
    permissionBasis: "Owner-authorized image reference; fixture only",
  };
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: publishUrl,
        headers: { ...f.admin, "idempotency-key": "linked-no-rights" },
        payload: { ...rights, permissionAffirmed: false },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: publishUrl,
        headers: { ...f.admin, "idempotency-key": "linked-publish" },
        payload: rights,
      })
    ).statusCode,
    200,
  );
  assert.equal((await list()).json().items[0].externalUrl, payload.externalUrl);
  const bytes = await f.http.inject({
    url: `${f.base}/${resource.id}/bytes`,
    headers: f.buyerHeaders,
  });
  assert.equal(bytes.statusCode, 400);
  assert.equal(bytes.json().code, "RESOURCE_LINK");
  assert.equal(bytes.headers.location, undefined);
  assert.equal(
    (
      await f.http.inject({
        url: `${f.base}/${resource.id}/history`,
        headers: f.buyerHeaders,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.http.inject({
        method: "POST",
        url: `${f.base}/${resource.id}/retire`,
        headers: { ...f.admin, "idempotency-key": "linked-retire" },
        payload: { expectedVersion: 2, reason: "Superseded fixture link" },
      })
    ).statusCode,
    200,
  );
  assert.deepEqual((await list()).json().items, []);
  assert.equal(
    (
      await f.http.inject({
        url: `${f.base}/${resource.id}/bytes`,
        headers: f.buyerHeaders,
      })
    ).statusCode,
    404,
  );
  assert.equal(fetches, 0);
});
