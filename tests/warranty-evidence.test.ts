import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { Application } from "../src/server/application.ts";
import { createHttp } from "../src/server/http.ts";
import { digest, type Actor, type Role } from "../src/server/core.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import {
  evidenceMaxBytes,
  type EvidenceUpload,
} from "../src/shared/warranty-evidence.ts";
import { fixture, accept, ship } from "./fixtures.ts";

type Fixture = ReturnType<typeof fixture>;
function claim(f: Fixture, serial = "S1") {
  ship(f, accept(f, 1, serial).id);
  return f.app.warranty.submit(f.actor, `claim-${serial}`, {
    accountId: f.buyer,
    unitId: f.app.inventory.trace(f.actor, serial).unit.id,
    type: "warranty",
    issue: "Synthetic attachment inspection",
    evidence: "Synthetic report",
  });
}
function payload(
  value = "Synthetic evidence\n",
  audience: "staff" | "customer" = "customer",
): EvidenceUpload {
  return {
    filename: "evidence.txt",
    mediaType: "text/plain",
    audience,
    description: "Synthetic inspection evidence",
    contentBase64: Buffer.from(value).toString("base64"),
  };
}
function user(f: Fixture, role: Role, accountId = f.buyer) {
  const created = f.app.identity.createUser(f.actor, `user-${role}`, {
    name: role,
    email: `${role}@example.test`,
    password: "long-user-test-password",
    role,
    accountId,
    sites: role === "buyer" ? [] : [f.w1],
  });
  return f.app.identity.currentActor({ ...f.actor, id: created.id });
}
function update(
  f: Fixture,
  actor: Actor,
  values: Partial<{
    role: Role;
    accountId: string;
    sites: string[];
    active: boolean;
  }> = {},
) {
  const row = f.app.identity.users(f.actor).find((u) => u.id === actor.id)!;
  return f.app.identity.updateUser(
    f.actor,
    `update-${actor.id}-${row.revision}`,
    {
      userId: actor.id,
      revision: Number(row.revision),
      email: String(row.email),
      name: String(row.name),
      role: actor.role,
      accountId: actor.accountId ?? undefined,
      sites: actor.sites,
      active: true,
      currentPassword: "long-test-only-password",
      reason: "Synthetic grant change",
      ...values,
    },
  );
}
function facts(f: Fixture) {
  return {
    stock: f.app.inventory.stock(f.actor),
    orders: f.app.orders.list(f.actor),
    invoices: f.app.billing.invoices(f.actor),
    shipments: f.app.fulfillment.shipments(f.actor),
    claims: f.app.warranty.list(f.actor),
  };
}
test("claim evidence persists exact bytes, immutable metadata, compact receipts and unchanged native facts across restart", (t) => {
  const f = fixture(t),
    c = claim(f),
    before = facts(f),
    p = payload();
  const file = f.app.warranty.evidence.upload(f.actor, "upload", c.id, p);
  assert.equal(file.contentHash, digest(Buffer.from("Synthetic evidence\n")));
  assert.deepEqual(
    f.app.warranty.evidence.upload(f.actor, "upload", c.id, p),
    file,
  );
  assert.deepEqual(
    f.app.warranty.evidence.upload(f.actor, "new-key", c.id, p),
    file,
  );
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(
        f.actor,
        "upload",
        c.id,
        payload("changed"),
      ),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(f.actor, "changed-description", c.id, {
        ...p,
        description: "Changed",
      }),
    { code: "EVIDENCE_DUPLICATE" },
  );
  const first = f.app.warranty.evidence.download(
    f.actor,
    "download",
    ` ${c.id} `,
    ` ${file.id} `,
  );
  assert.equal(first.bytes.toString(), "Synthetic evidence\n");
  assert.equal(first.filename, `warranty-evidence-${file.id}.txt`);
  f.app.close();
  f.app = new Application(f.path);
  assert.deepEqual(
    f.app.warranty.evidence.upload(f.actor, "upload", c.id, p),
    file,
  );
  assert.deepEqual(
    f.app.warranty.evidence.download(f.actor, "download", c.id, file.id),
    first,
  );
  const rows = f.app.warranty.evidence.list(f.actor, c.id);
  assert.deepEqual(rows, { items: [file], next: null });
  assert.equal(Object.hasOwn(rows.items[0]!, "content"), false);
  const receipts = f.app.database
    .owned("platform")
    .all(
      "SELECT * FROM platform_commands WHERE name LIKE 'warranty.evidence.%'",
    );
  assert.ok(
    receipts.every(
      (r) =>
        !String(r.result).includes(p.contentBase64) &&
        !String(r.result).includes("contentBase64"),
    ),
  );
  assert.deepEqual(facts(f), before);
});
test("customer evidence access follows real account, site, role, active and password restrictions before cached retries", (t) => {
  const f = fixture(t),
    c = claim(f),
    buyer = user(f, "buyer"),
    warehouse = user(f, "warehouse"),
    warranty = user(f, "warranty"),
    finance = user(f, "finance"),
    support = user(f, "support");
  const customer = f.app.warranty.evidence.upload(
    buyer,
    "buyer-upload",
    c.id,
    payload(),
  );
  const staff = f.app.warranty.evidence.upload(
    warehouse,
    "staff-upload",
    c.id,
    payload("Internal note", "staff"),
  );
  assert.deepEqual(f.app.warranty.evidence.list(buyer, c.id).items, [customer]);
  assert.throws(() => f.app.warranty.evidence.list(buyer, c.id, staff.id), {
    code: "NOT_FOUND",
  });
  assert.throws(
    () => f.app.warranty.evidence.download(buyer, "staff-read", c.id, staff.id),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(
        buyer,
        "staff-write",
        c.id,
        payload("No", "staff"),
      ),
    { code: "FORBIDDEN" },
  );
  assert.equal(f.app.warranty.evidence.list(finance, c.id).items.length, 2);
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(
        finance,
        "finance-upload",
        c.id,
        payload(),
      ),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.warranty.evidence.list({ ...support, role: "admin" }, c.id),
    { code: "FORBIDDEN" },
  );
  const downloaded = f.app.warranty.evidence.download(
    warranty,
    "read",
    c.id,
    customer.id,
  );
  assert.ok(downloaded.receipt.id);
  update(f, warranty, { sites: [f.w2] });
  assert.throws(
    () => f.app.warranty.evidence.download(warranty, "read", c.id, customer.id),
    { code: "FORBIDDEN" },
  );
  update(f, warehouse, { role: "support" });
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(
        warehouse,
        "staff-upload",
        c.id,
        payload("Internal note", "staff"),
      ),
    { code: "FORBIDDEN" },
  );
  const other = f.app.identity.createCustomer(f.actor, "other", {
    name: "Other synthetic account",
    tier: "standard",
    creditLimit: 100000,
  }).id;
  update(f, buyer, { accountId: other });
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(buyer, "buyer-upload", c.id, payload()),
    { code: "FORBIDDEN" },
  );
  assert.throws(
    () => f.app.warranty.evidence.list({ ...f.actor, orgId: "foreign" }, c.id),
    { code: "FORBIDDEN" },
  );
  f.app.identity.resetPassword(f.actor, "reset", {
    userId: finance.id,
    revision: 1,
    password: "replacement-user-password",
    currentPassword: "long-test-only-password",
    reason: "Synthetic reset",
  });
  assert.throws(() => f.app.warranty.evidence.list(finance, c.id), {
    code: "PASSWORD_CHANGE_REQUIRED",
  });
  update(f, support, { active: false });
  assert.throws(() => f.app.warranty.evidence.list(support, c.id), {
    code: "FORBIDDEN",
  });
});
test("file formats, exact size boundary, canonical encoding and safe names are validated before retaining bytes", (t) => {
  const f = fixture(t),
    c = claim(f);
  const invalid = [
    { contentBase64: "" },
    { contentBase64: "YQ" },
    { contentBase64: "YR==" },
    { contentBase64: "YQ==\n" },
    { filename: "../note.txt" },
    { filename: "x\\note.txt" },
    { filename: "bad\n.txt" },
    { description: " " },
    { mediaType: "text/html" },
    { audience: "public" },
    { contentBase64: Buffer.from([0xff]).toString("base64") },
    { contentBase64: Buffer.from("bad\0text").toString("base64") },
    { mediaType: "image/png" },
    { mediaType: "image/jpeg" },
    { mediaType: "application/pdf" },
  ];
  invalid.forEach((p, i) =>
    assert.throws(() =>
      f.app.warranty.evidence.upload(f.actor, `invalid-${i}`, c.id, {
        ...payload(),
        ...p,
      } as EvidenceUpload),
    ),
  );
  assert.equal(f.app.warranty.evidence.list(f.actor, c.id).items.length, 0);
  const max = payload("x".repeat(evidenceMaxBytes));
  const full = f.app.warranty.evidence.upload(f.actor, "maximum", c.id, max);
  assert.equal(full.bytes, evidenceMaxBytes);
  assert.equal(
    f.app.warranty.evidence.download(f.actor, "maximum-read", c.id, full.id)
      .bytes.length,
    evidenceMaxBytes,
  );
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(
        f.actor,
        "too-large",
        c.id,
        payload("x".repeat(evidenceMaxBytes + 1)),
      ),
    { code: "EVIDENCE_SIZE" },
  );
  // Signature fixtures: checking is not a malware scan or a full format parser.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1kAAAAASUVORK5CYII=",
    "base64",
  );
  const pdf = Buffer.from("%PDF-1.7\nSynthetic format fixture\n%%EOF\n");
  for (const [mediaType, bytes] of [
    ["image/png", png],
    ["application/pdf", pdf],
    [
      "image/jpeg",
      Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex"),
    ],
  ] as const) {
    const file = f.app.warranty.evidence.upload(f.actor, mediaType, c.id, {
      ...payload(),
      mediaType,
      contentBase64: bytes.toString("base64"),
    });
    assert.deepEqual(
      f.app.warranty.evidence.download(
        f.actor,
        `read-${mediaType}`,
        c.id,
        file.id,
      ).bytes,
      bytes,
    );
  }
});
test("paged evidence isolates cursors by claim and customer audience and enforces the permanent file cap", (t) => {
  const f = fixture(t),
    c = claim(f),
    second = claim(f, "S2"),
    buyer = user(f, "buyer");
  for (let i = 0; i < 20; i++)
    f.app.warranty.evidence.upload(
      f.actor,
      `page-${i}`,
      c.id,
      payload(`File ${i}`, i < 12 ? "customer" : "staff"),
    );
  const first = f.app.warranty.evidence.list(f.actor, c.id),
    next = f.app.warranty.evidence.list(f.actor, c.id, first.next!);
  assert.equal(first.items.length, 10);
  assert.equal(next.items.length, 10);
  assert.equal(next.next, null);
  assert.equal(
    new Set([...first.items, ...next.items].map((x) => x.id)).size,
    20,
  );
  const publicPage = f.app.warranty.evidence.list(buyer, c.id);
  assert.equal(publicPage.items.length, 10);
  assert.equal(
    f.app.warranty.evidence.list(buyer, c.id, publicPage.next!).items.length,
    2,
  );
  assert.throws(
    () => f.app.warranty.evidence.list(f.actor, second.id, first.items[0]!.id),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      f.app.warranty.evidence.download(
        f.actor,
        "cross-claim",
        second.id,
        first.items[0]!.id,
      ),
    { code: "NOT_FOUND" },
  );
  assert.throws(
    () =>
      f.app.warranty.evidence.upload(
        f.actor,
        "over-cap",
        c.id,
        payload("One more"),
      ),
    { code: "EVIDENCE_LIMIT" },
  );
  assert.equal(
    f.app.warranty.evidence.upload(
      f.actor,
      "duplicate-at-cap",
      c.id,
      payload("File 0"),
    ).contentHash,
    digest(Buffer.from("File 0")),
  );
});
test("late audit faults roll back file bytes and receipts; corrupt stored bytes and cached metadata block downloads", (t) => {
  const f = fixture(t),
    c = claim(f),
    before = facts(f),
    store = f.app.database.owned("warranty"),
    platform = f.app.database.owned("platform");
  const audit = f.app.platform.audit.bind(f.app.platform);
  f.app.platform.audit = () => {
    throw Error("Injected audit failure");
  };
  assert.throws(
    () => f.app.warranty.evidence.upload(f.actor, "upload", c.id, payload()),
    /Injected audit failure/,
  );
  f.app.platform.audit = audit;
  assert.equal(store.all("SELECT * FROM warranty_evidence").length, 0);
  assert.equal(
    platform.all(
      "SELECT * FROM platform_commands WHERE name LIKE 'warranty.evidence.%'",
    ).length,
    0,
  );
  const file = f.app.warranty.evidence.upload(
    f.actor,
    "upload",
    c.id,
    payload(),
  );
  f.app.platform.audit = () => {
    throw Error("Injected audit failure");
  };
  assert.throws(
    () => f.app.warranty.evidence.download(f.actor, "read", c.id, file.id),
    /Injected audit failure/,
  );
  f.app.platform.audit = audit;
  assert.equal(
    platform.all(
      "SELECT * FROM platform_commands WHERE name='warranty.evidence.download'",
    ).length,
    0,
  );
  f.app.warranty.evidence.download(f.actor, "read", c.id, file.id);
  store.run(
    "UPDATE warranty_evidence SET content=? WHERE id=?",
    Buffer.alloc(file.bytes, 120),
    file.id,
  );
  assert.throws(
    () => f.app.warranty.evidence.download(f.actor, "read", c.id, file.id),
    { code: "EVIDENCE_INTEGRITY" },
  );
  store.run(
    "UPDATE warranty_evidence SET content=?,description=? WHERE id=?",
    Buffer.from("Synthetic evidence\n"),
    "Corrupt metadata",
    file.id,
  );
  assert.throws(
    () => f.app.warranty.evidence.download(f.actor, "read", c.id, file.id),
    { code: "EVIDENCE_INTEGRITY" },
  );
  assert.deepEqual(facts(f), before);
});
test("encrypted regional backup restores evidence bytes and idempotency while omitting later uploads and ending copied sessions", async (t) => {
  const f = fixture(t),
    c = claim(f),
    p = payload(),
    file = f.app.warranty.evidence.upload(f.actor, "upload", c.id, p);
  const read = f.app.warranty.evidence.download(f.actor, "read", c.id, file.id);
  const login = f.app.identity.login(
    "admin@example.test",
    "long-test-only-password",
  );
  const archive = join(dirname(f.path), "evidence.backup"),
    target = join(dirname(f.path), "recovered.db"),
    key = randomBytes(32);
  await createBackup(f.path, archive, "CA", key);
  f.app.warranty.evidence.upload(
    f.actor,
    "later",
    c.id,
    payload("Later evidence"),
  );
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  t.after(() => restored.close());
  assert.deepEqual(restored.warranty.evidence.list(f.actor, c.id).items, [
    file,
  ]);
  assert.deepEqual(
    restored.warranty.evidence.upload(f.actor, "upload", c.id, p),
    file,
  );
  assert.deepEqual(
    restored.warranty.evidence.download(f.actor, "read", c.id, file.id),
    read,
  );
  assert.throws(() => restored.identity.session(login.token), {
    code: "UNAUTHENTICATED",
  });
  assert.ok(restored.platform.recoveryHold());
});
async function race(
  t: { after: (fn: () => void) => void },
  f: Fixture,
  claimId: string,
  inputs: { key: string; payload: EvidenceUpload }[],
) {
  const children = inputs.map(() =>
    fork(new URL("./warranty-evidence-child.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }),
  );
  t.after(() => children.forEach((c) => c.kill()));
  const waits = children.map((c, i) => {
    let readyResolve: () => void,
      readyReject: (e: Error) => void,
      resultResolve: (v: any) => void,
      resultReject: (e: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    const result = new Promise<{ ok: boolean; result?: any; code?: string }>(
      (resolve, reject) => {
        resultResolve = resolve;
        resultReject = reject;
      },
    );
    let stderr = "";
    c.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      const e = Error("Evidence process timeout");
      readyReject(e);
      resultReject(e);
      c.kill();
    }, 15000);
    c.on("message", (m: any) => {
      if (m.ready) readyResolve();
      else {
        clearTimeout(timer);
        resultResolve(m);
      }
    });
    c.on("error", (e) => {
      clearTimeout(timer);
      readyReject(e);
      resultReject(e);
    });
    c.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        const e = Error(`Evidence process ${code}: ${stderr}`);
        readyReject(e);
        resultReject(e);
      }
    });
    c.send({
      action: "init",
      path: f.path,
      actor: f.actor,
      claimId,
      ...inputs[i],
    });
    return { ready, result };
  });
  const results = Promise.all(waits.map((x) => x.result));
  // Attach a failure handler immediately, even if a child fails before readiness.
  void results.catch(() => {});
  await Promise.all(waits.map((x) => x.ready));
  children.forEach((c) => c.send({ action: "go" }));
  return results;
}
test(
  "independent upload processes consume one exact receipt and serialize the last file slot",
  { timeout: 25000 },
  async (t) => {
    const f = fixture(t),
      c = claim(f);
    const same = await race(
      t,
      f,
      c.id,
      [0, 1].map(() => ({ key: "same", payload: payload() })),
    );
    assert.ok(same.every((x) => x.ok));
    assert.deepEqual(same[0]!.result, same[1]!.result);
    for (let i = 1; i < 19; i++)
      f.app.warranty.evidence.upload(
        f.actor,
        `fill-${i}`,
        c.id,
        payload(`File ${i}`),
      );
    const last = await race(
      t,
      f,
      c.id,
      [0, 1].map((i) => ({ key: `last-${i}`, payload: payload(`Last ${i}`) })),
    );
    assert.equal(last.filter((x) => x.ok).length, 1);
    assert.equal(last.find((x) => !x.ok)!.code, "EVIDENCE_LIMIT");
    assert.equal(
      f.app.database
        .owned("warranty")
        .get("SELECT COUNT(*) AS n FROM warranty_evidence")!.n,
      20,
    );
  },
);
test("HTTP uploads keep ordinary limits and origin/CSRF/session protection, and downloads are verified no-store attachments", async (t) => {
  const f = fixture(t),
    c = claim(f),
    origin = "http://127.0.0.1:3000";
  const http = await createHttp(f.app, {
    origin,
    staticRoot: "/nonexistent-distributor-test",
  });
  t.after(() => http.close());
  const login = await http.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: {
      email: "admin@example.test",
      password: "long-test-only-password",
    },
  });
  const cookie = login.cookies[0]!,
    headers = {
      origin,
      cookie: `${cookie.name}=${cookie.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": "http-upload",
    };
  const url = `/api/warranty/claims/${c.id}/evidence`;
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { origin },
        payload: payload(),
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, origin: "https://foreign.example" },
        payload: payload(),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers: { ...headers, "x-csrf-token": "bad" },
        payload: payload(),
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url,
        headers,
        payload: { ...payload(), unexpected: true },
      })
    ).statusCode,
    400,
  );
  const large = payload("x".repeat(evidenceMaxBytes));
  const response = await http.inject({
    method: "POST",
    url,
    headers,
    payload: large,
  });
  assert.equal(response.statusCode, 200, response.body);
  const file = response.json();
  const list = await http.inject({ method: "GET", url, headers });
  assert.deepEqual(list.json().items, [file]);
  assert.match(String(list.headers["cache-control"]), /no-store/);
  const downloadUrl = `${url}/${file.id}/download`;
  const readHeaders = { ...headers, "idempotency-key": "http-read" };
  const read = await http.inject({
    method: "POST",
    url: downloadUrl,
    headers: readHeaders,
    payload: {},
  });
  assert.equal(read.statusCode, 200, read.body.slice(0, 500));
  assert.equal(read.rawPayload.length, evidenceMaxBytes);
  assert.equal(digest(read.rawPayload), file.contentHash);
  assert.equal(read.headers["content-type"], "application/octet-stream");
  assert.equal(
    read.headers["content-disposition"],
    `attachment; filename="warranty-evidence-${file.id}.txt"`,
  );
  assert.equal(read.headers["x-content-type-options"], "nosniff");
  assert.match(String(read.headers["content-security-policy"]), /sandbox/);
  assert.equal(read.headers["x-document-sha256"], file.contentHash);
  assert.match(String(read.headers["cache-control"]), /no-store/);
  const retry = await http.inject({
    method: "POST",
    url: downloadUrl,
    headers: readHeaders,
    payload: {},
  });
  assert.equal(
    retry.headers["x-download-receipt"],
    read.headers["x-download-receipt"],
  );
  assert.equal(
    (
      await http.inject({
        method: "POST",
        url: "/api/commands/warranty.submit",
        headers,
        payload: { padding: "x".repeat(300000) },
      })
    ).statusCode,
    413,
  );
});
