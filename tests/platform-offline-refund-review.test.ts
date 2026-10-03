import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, accept, ship, chooseProviders } from "./fixtures.ts";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import {
  PlatformOfflineRefundReviewReader,
  platformOfflineRefundReviewLimits as limits,
} from "../src/server/platform-offline-refund-review.ts";

function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = region === "CA" ? "CAD" : "USD",
) {
  const f = fixture(t, {}, region, currency);
  const invoiceId = ship(f, accept(f, 1).id).invoiceId;
  const payment = f.app.database.transaction(() =>
    f.app.billing.verifiedPayment(
      f.actor,
      invoiceId,
      11300,
      "stripe",
      "pi_synthetic",
    ),
  );
  f.app.billing.issueCredit(f.actor, "credit", {
    invoiceId,
    reference: "CREDIT",
    reason: "Synthetic full credit",
    lines: [
      {
        lineId: String(f.app.billing.lines(f.actor, invoiceId)[0]!.id),
        quantity: 1,
      },
    ],
  });
  const input = {
    invoiceId,
    paymentId: payment.id,
    amount: 3000,
    reference: "REFUND",
    reason: "Synthetic refund",
  };
  const refundId = f.app.billing.refundRequest(f.actor, "original", input).id;
  chooseProviders(f, f.actor, "choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["stripe"],
    version: 1,
    acknowledgment: "Synthetic consent",
  });
  const effectId = f.app.integration.refund(f.actor, "queue-one", {
    refundId,
  }).id;
  const user = f.app.identity.createUser(f.actor, "reader", {
    email: "finance@synthetic.test",
    name: "Finance reader",
    role: "finance",
    sites: [f.w1],
    password: "long-synthetic-password",
  });
  const finance = f.app.identity.currentActor({ ...f.actor, id: user.id });
  const reader = f.app.platformOfflineRefundReview;
  const read = (
    actor = finance,
    refund: string = refundId,
    effect: string = effectId,
  ) =>
    f.app.database.transaction(() =>
      reader.getInTransaction(actor, refund, effect),
    );
  return Object.assign(f, {
    input,
    invoiceId,
    refundId,
    effectId,
    finance,
    reader,
    read,
  });
}
function fingerprint(f: ReturnType<typeof setup>) {
  const p = f.app.database.owned("platform");
  return canonical({
    commands: p.all(
      "SELECT * FROM platform_commands ORDER BY org_id,actor_id,name,key",
    ),
    audit: p.all("SELECT * FROM platform_audit ORDER BY id"),
    order: p.all("SELECT * FROM platform_audit_order ORDER BY sequence"),
    clock: p.all("SELECT * FROM platform_audit_clock"),
    hold: p.all("SELECT * FROM platform_recovery"),
    refunds: f.app.database
      .owned("billing")
      .all("SELECT * FROM billing_refunds ORDER BY id"),
    effects: f.app.database
      .owned("integration")
      .all("SELECT * FROM integration_effects ORDER BY id"),
  });
}
const integrity = { code: "RESTORE_RECEIPT_INTEGRITY" };
for (const [region, currency] of [
  ["CA", "CAD"],
  ["CA", "USD"],
  ["US", "USD"],
] as const)
  test(`${region}/${currency}: real native commands and audit linkage remain unchanged under hold`, (t) => {
    const f = setup(t, region, currency);
    f.app.platform.isolateRestore(
      digest("synthetic-hold"),
      "2026-10-03T00:00:00.000Z",
    );
    const before = fingerprint(f),
      r = f.read();
    assert.equal(r.requests.length, 1);
    assert.equal(r.queues.length, 1);
    assert.equal(r.requests[0]!.actorId, f.actor.id);
    assert.equal(r.requests[0]!.requestHash, digest(canonical(f.input)));
    assert.equal(
      r.queues[0]!.requestHash,
      digest(canonical({ refundId: f.refundId })),
    );
    for (const receipt of [...r.requests, ...r.queues]) {
      assert.equal(receipt.audit.actorId, receipt.actorId);
      assert.equal(receipt.audit.action, receipt.command);
      assert.equal(receipt.audit.reference, receipt.key);
      assert.equal(receipt.audit.requestHash, receipt.requestHash);
      assert.equal(
        receipt.audit.detailJson,
        canonical({ requestHash: receipt.requestHash }),
      );
      assert.equal(receipt.resultJson, JSON.stringify(receipt.result));
      assert.ok(receipt.audit.sequence > 0);
    }
    const { factsHash, ...body } = r;
    assert.equal(factsHash, digest(canonical(body)));
    assert.deepEqual(f.read(), r);
    assert.equal(fingerprint(f), before);
    assert.throws(() => f.app.platform.assertProviderAccess(), {
      code: "RECOVERY_HOLD",
    });
    assert.equal("authorized" in r, false);
  });

test("refresh current IAM in caller transaction; stale grants, password, customer association and org changes refuse", (t) => {
  const f = setup(t),
    iam = f.app.database.owned("iam");
  assert.throws(
    () => f.reader.getInTransaction(f.finance, f.refundId, f.effectId),
    { code: "TRANSACTION" },
  );
  for (const [sql, args, code] of [
    ["UPDATE iam_users SET active=0 WHERE id=?", [f.finance.id], "FORBIDDEN"],
    [
      "UPDATE iam_users SET role='warehouse' WHERE id=?",
      [f.finance.id],
      "FORBIDDEN",
    ],
    [
      "UPDATE iam_users SET account_id=? WHERE id=?",
      [f.buyer, f.finance.id],
      "FORBIDDEN",
    ],
    [
      "UPDATE iam_users SET org_id='copied-other-org' WHERE id=?",
      [f.finance.id],
      "FORBIDDEN",
    ],
    [
      "UPDATE iam_organizations SET region='US' WHERE id=?",
      [f.actor.orgId],
      "FORBIDDEN",
    ],
    [
      "UPDATE iam_user_security SET password_change_required=1 WHERE user_id=?",
      [f.finance.id],
      "PASSWORD_CHANGE_REQUIRED",
    ],
  ] as const) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          iam.run(sql, ...args);
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      { code },
    );
    assert.equal(f.read().requests.length, 1);
  }
  assert.equal(f.read(f.actor).queues.length, 1);
});

test("all historical authors and legitimate repeated pending or terminal queue attempts are preserved", (t) => {
  const f = setup(t);
  f.app.integration.refund(f.finance, "queue-two", { refundId: f.refundId });
  f.app.database
    .owned("integration")
    .run(
      "UPDATE integration_effects SET state='blocked' WHERE id=?",
      f.effectId,
    );
  // Native queue() returns an existing effect's state; Billing remains pending.
  f.app.integration.refund(f.finance, "queue-terminal", {
    refundId: f.refundId,
  });
  f.app.database
    .owned("iam")
    .run("UPDATE iam_users SET active=0 WHERE id=?", f.actor.id);
  const r = f.read();
  assert.equal(r.queues.length, 3);
  assert.deepEqual(r.queues.map((x) => x.result.state).sort(), [
    "blocked",
    "pending",
    "pending",
  ]);
  assert.deepEqual(
    new Set(r.queues.map((x) => x.actorId)),
    new Set([f.actor.id, f.finance.id]),
  );
  assert.equal(r.requests[0]!.actorId, f.actor.id);
});

test("missing subjects return explicit empty local facts, while conflicting refund/effect linkage refuses", (t) => {
  const f = setup(t);
  const absent = f.read(f.finance, "missing-refund", "missing-effect");
  assert.deepEqual(absent.requests, []);
  assert.deepEqual(absent.queues, []);
  assert.equal(absent.history.commands, 2);
  assert.equal(absent.history.audits, 2);
  assert.throws(() => f.read(f.finance, f.refundId, "other-effect"), integrity);
  assert.throws(() => f.read(f.finance, "other-refund", f.effectId), integrity);
  for (const id of [" alias", "alias\n", "", "x".repeat(161)])
    assert.throws(() => f.read(f.finance, id), { code: "VALIDATION" });
});

test("malformed unrelated command results cannot disappear behind result selection", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  for (const raw of [
    '{"private-marker":',
    '{"id":"unrelated","state":"pending","state":"blocked"}',
    '{"id":"unrelated","state":"pending","extra":true}',
    "null",
  ]) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          p.run(
            "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
            f.actor.orgId,
            f.actor.id,
            "stripe.refund",
            "unrelated",
            digest("unrelated"),
            raw,
            "2026-10-03T00:00:00.000Z",
          );
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      (error: unknown) => {
        assert.equal((error as { code: string }).code, integrity.code);
        assert.doesNotMatch((error as Error).message, /private-marker/);
        return true;
      },
    );
  }
  assert.equal(f.read().queues.length, 1);
});

test("missing, duplicate, cross-org, orphan, changed-hash and malformed audit linkage refuses without changing source", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  const audit = p.get(
    "SELECT * FROM platform_audit WHERE org_id=? AND action='stripe.refund'",
    f.actor.orgId,
  )!;
  const before = fingerprint(f);
  const mutations = [
    () => {
      p.run(
        "DELETE FROM platform_audit_order WHERE audit_id=?",
        audit.id as string,
      );
    },
    () => {
      p.run(
        "UPDATE platform_audit_order SET org_id='other-org' WHERE audit_id=?",
        audit.id as string,
      );
    },
    () => {
      p.run(
        "UPDATE platform_audit SET org_id='other-org' WHERE id=?",
        audit.id as string,
      );
    },
    () => {
      p.run(
        "UPDATE platform_audit SET actor_id=? WHERE id=?",
        f.finance.id,
        audit.id as string,
      );
    },
    () => {
      p.run(
        "UPDATE platform_audit SET detail=? WHERE id=?",
        canonical({ requestHash: digest("changed") }),
        audit.id as string,
      );
    },
    () => {
      p.run(
        "UPDATE platform_audit SET detail=? WHERE id=?",
        '{"requestHash":"x","private":"hidden"}',
        audit.id as string,
      );
    },
    () => {
      p.run(
        "INSERT INTO platform_audit SELECT 'duplicate',org_id,actor_id,action,reference,detail,created_at FROM platform_audit WHERE id=?",
        audit.id as string,
      );
    },
    () => {
      p.run(
        "DELETE FROM platform_commands WHERE org_id=? AND name='stripe.refund'",
        f.actor.orgId,
      );
    },
  ];
  for (const mutate of mutations) {
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          mutate();
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      integrity,
    );
    assert.equal(fingerprint(f), before);
  }
});

test("cross-org and unsupported histories never supply a matching local receipt", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  const first = f.read();
  p.run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    "other-org",
    f.actor.id,
    "stripe.refund",
    "foreign",
    "bad",
    "not-json",
    "invalid",
  );
  p.run(
    "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
    f.actor.orgId,
    f.actor.id,
    "stripe.checkout",
    "unrelated",
    "bad",
    "not-json",
    "invalid",
  );
  assert.deepEqual(f.read(), first);
});

test("bounded command and audit preflight occurs before retained JSON parse", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  const marker = '{"private-budget-marker":';
  let parsed = 0;
  const parse = JSON.parse,
    spy = t.mock.method(
      JSON,
      "parse",
      (...args: Parameters<typeof JSON.parse>) => {
        if (args[0].includes("private-budget-marker")) parsed++;
        return parse(...args);
      },
    );
  try {
    for (const kind of ["commands", "audits", "row", "aggregate"]) {
      assert.throws(
        () =>
          f.app.database.transaction(() => {
            const n =
              kind === "commands"
                ? limits.commands
                : kind === "audits"
                  ? limits.audits
                  : kind === "aggregate"
                    ? 150
                    : 1;
            const body =
              marker +
              "€".repeat(
                kind === "row" ? 23000 : kind === "aggregate" ? 20000 : 0,
              );
            for (let i = 0; i < n; i++) {
              if (kind === "audits")
                p.run(
                  "INSERT INTO platform_audit VALUES(?,?,?,?,?,?,?)",
                  `synthetic-${i}`,
                  f.actor.orgId,
                  f.actor.id,
                  "stripe.refund",
                  `extra-${i}`,
                  body,
                  "2026-10-03T00:00:00.000Z",
                );
              else
                p.run(
                  "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
                  f.actor.orgId,
                  f.actor.id,
                  "stripe.refund",
                  `extra-${i}`,
                  digest("extra"),
                  body,
                  "2026-10-03T00:00:00.000Z",
                );
            }
            f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
          }),
        integrity,
      );
      assert.equal(parsed, 0, kind);
    }
  } finally {
    spy.mock.restore();
  }
});

test("same-writer uncommitted receipts and audits are visible together and late refusal rolls everything back", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    first = f.read(),
    before = fingerprint(f);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        const q = first.queues[0]!;
        p.run(
          "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
          q.orgId,
          q.actorId,
          q.command,
          "copied-attempt",
          q.requestHash,
          q.resultJson,
          q.createdAt,
        );
        f.app.platform.audit(f.actor, q.command, "copied-attempt", {
          requestHash: q.requestHash,
        });
        assert.equal(
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId).queues
            .length,
          2,
        );
        throw new Error("synthetic late failure");
      }),
    /synthetic late failure/,
  );
  assert.equal(fingerprint(f), before);
  assert.deepEqual(f.read(), first);
});

test("frozen bytes and deterministic hashes survive restart; any retained audit change affects review hash", (t) => {
  const f = setup(t),
    first = f.read();
  assert.throws(
    () => Object.assign(first.queues[0]!.result, { state: "completed" }),
    TypeError,
  );
  assert.throws(
    () => Object.assign(first.queues[0]!.audit, { detailJson: "forged" }),
    TypeError,
  );
  f.app.close();
  f.app = new Application(f.path, "CA");
  const reader = new PlatformOfflineRefundReviewReader(
    f.app.database,
    f.app.identity,
  );
  const restarted = f.app.database.transaction(() =>
    reader.getInTransaction(f.finance, f.refundId, f.effectId),
  );
  assert.deepEqual(restarted, first);
  assert.notStrictEqual(restarted.queues[0], first.queues[0]);
  f.app.database
    .owned("platform")
    .run(
      "UPDATE platform_audit SET created_at=? WHERE id=?",
      "2026-10-03T00:00:00.001Z",
      first.queues[0]!.audit.id,
    );
  const changed = f.app.database.transaction(() =>
    reader.getInTransaction(f.finance, f.refundId, f.effectId),
  );
  assert.notEqual(changed.factsHash, first.factsHash);
  assert.equal(
    first.queues[0]!.audit.createdAt,
    restarted.queues[0]!.audit.createdAt,
  );
});

test("reader cannot escape a foreign SQL scope and all direct queries stay Platform-owned", (t) => {
  const f = setup(t);
  f.app.database.transaction(() => {
    f.app.database.execute("integration", () =>
      assert.throws(
        () => f.reader.getInTransaction(f.finance, f.refundId, f.effectId),
        { code: "TRANSACTION" },
      ),
    );
    assert.throws(() =>
      f.app.database
        .owned("integration")
        .all("SELECT * FROM platform_commands"),
    );
    assert.equal(
      f.reader.getInTransaction(f.finance, f.refundId, f.effectId).queues
        .length,
      1,
    );
  });
});

test("exact row capacity preserves every linked attempt and refuses the next instead of truncating", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform"),
    queue = f.read().queues[0]!;
  f.app.database.transaction(() => {
    for (let i = 0; i < limits.commands - 2; i++) {
      const key = `attempt-${String(i).padStart(4, "0")}`;
      p.run(
        "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
        queue.orgId,
        queue.actorId,
        queue.command,
        key,
        queue.requestHash,
        queue.resultJson,
        queue.createdAt,
      );
      f.app.platform.audit(f.actor, queue.command, key, {
        requestHash: queue.requestHash,
      });
    }
  });
  const exact = f.read();
  assert.equal(exact.history.commands, limits.commands);
  assert.equal(exact.history.audits, limits.audits);
  assert.equal(exact.queues.length, limits.commands - 1);
  assert.equal(exact.requests.length, 1);
  assert.throws(
    () =>
      f.app.database.transaction(() => {
        p.run(
          "INSERT INTO platform_commands VALUES(?,?,?,?,?,?,?)",
          queue.orgId,
          queue.actorId,
          queue.command,
          "one-too-many",
          queue.requestHash,
          queue.resultJson,
          queue.createdAt,
        );
        f.app.platform.audit(f.actor, queue.command, "one-too-many", {
          requestHash: queue.requestHash,
        });
        f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
      }),
    integrity,
  );
  assert.deepEqual(f.read(), exact);
});

test("retained times, hash spellings and raw JSON bytes cannot silently normalize", (t) => {
  const f = setup(t),
    p = f.app.database.owned("platform");
  for (const [column, value] of [
    ["created_at", "2026-02-30T00:00:00.000Z"],
    ["created_at", "2026-10-03T00:00:00Z"],
    ["hash", "A".repeat(64)],
    ["result", ` {"id":"${f.effectId}","state":"pending"}`],
    ["result", `{"id":"${f.effectId}","state":"succeeded"}`],
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() => {
          // Fixed test-only column allowlist; production exposes no SQL argument.
          p.run(
            `UPDATE platform_commands SET ${column}=? WHERE org_id=? AND name='stripe.refund'`,
            value!,
            f.actor.orgId,
          );
          f.reader.getInTransaction(f.finance, f.refundId, f.effectId);
        }),
      integrity,
    );
});
