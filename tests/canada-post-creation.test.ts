import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { dirname, join } from "node:path";
import { Application } from "../src/server/application.ts";
import { digest } from "../src/server/core.ts";
import { setup, native, raw, type F } from "./canada-post-fixture.ts";
import { client, observation } from "./canada-post-creation-fixture.ts";
import { chooseProviders } from "./fixtures.ts";
import type { CanadaPostShipmentObservation } from "../src/server/canada-post-test.ts";
function prepare(f: F) {
  return f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input).id;
}
function member(
  f: F,
  groupId: string,
  bookingId = f.input.entries[0]!.bookingId,
) {
  return f.app.database.owned("integration").get<{
    state: string;
    token: string | null;
    started_at: number | null;
    provider_shipment_id: string | null;
    tracking: string | null;
    label_bytes: Uint8Array | null;
    label_hash: string | null;
  }>("SELECT * FROM integration_canada_post_members WHERE group_id=? AND booking_id=?", groupId, bookingId)!;
}
const entry = (f: F, i = 0) => f.input.entries[i]!.bookingId;
function strict(f: F) {
  chooseProviders(f, f.actor, "withdraw", {
    accountId: f.buyer,
    region: "CA",
    mode: "strict",
    providers: [],
    version: 2,
    acknowledgment: "Synthetic withdrawal",
  });
}

test("immutable two-member creation closes only the complete group, keeps native booking/stock/money unchanged and survives restart", async (t) => {
  const f = setup(t, 2),
    groupId = prepare(f),
    before = native(f),
    c = client();
  let view = await f.app.carriers.createCanadaPostMember(
    f.actor,
    groupId,
    entry(f),
    c,
  );
  assert.equal(view.state, "creating");
  assert.deepEqual(view.entries.map((m) => m.state).sort(), [
    "created",
    "pending",
  ]);
  const row = member(f, groupId);
  assert.equal(row.label_hash, digest(Buffer.from(row.label_bytes!)));
  assert.equal(row.token, null);
  view = await f.app.carriers.createCanadaPostMember(
    f.actor,
    groupId,
    entry(f, 1),
    c,
  );
  assert.equal(view.state, "closed");
  assert.ok(view.entries.every((m) => m.state === "created"));
  assert.deepEqual(native(f), before);
  for (const id of f.shipments)
    assert.equal(f.app.carriers.review(f.actor, id).booking!.state, "pending");
  assert.throws(() => f.app.carriers.label(f.actor, entry(f)), {
    code: "STATE",
  });
  f.app.close();
  f.app = new Application(f.path);
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, groupId).state,
    "closed",
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), c),
    { code: "STATE" },
  );
  await assert.rejects(
    f.app.carriers.reconcileCanadaPostMember(f.actor, groupId, entry(f), c),
    { code: "STATE" },
  );
  assert.equal(c.creates, 2);
  assert.equal(c.lookups, 0);
});

test("lost creation response requires read-only recovery, empty results never authorize resend, remaining pending member resumes only after confirmation", async (t) => {
  const f = setup(t, 2),
    groupId = prepare(f),
    c = client(),
    before = native(f);
  c.create = async (_i, _g, guard) => {
    guard();
    c.creates++;
    throw new Error("lost response");
  };
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), c),
    /lost response/,
  );
  assert.equal(member(f, groupId).state, "unknown");
  assert.equal(member(f, groupId).label_bytes, null);
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), c),
    { code: "STATE" },
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f, 1), c),
    { code: "STATE" },
  );
  c.lookup = async () => {
    c.lookups++;
    return null;
  };
  assert.equal(
    (
      await f.app.carriers.reconcileCanadaPostMember(
        f.actor,
        groupId,
        entry(f),
        c,
      )
    ).state,
    "unknown",
  );
  assert.equal(member(f, groupId).token, null);
  f.app.close();
  f.app = new Application(f.path);
  const recovered = client();
  assert.equal(
    (
      await f.app.carriers.reconcileCanadaPostMember(
        f.actor,
        groupId,
        entry(f),
        recovered,
      )
    ).state,
    "creating",
  );
  assert.equal(
    (
      await f.app.carriers.createCanadaPostMember(
        f.actor,
        groupId,
        entry(f, 1),
        recovered,
      )
    ).state,
    "closed",
  );
  assert.equal(c.creates, 1);
  assert.equal(recovered.creates, 1);
  assert.equal(recovered.lookups, 1);
  assert.deepEqual(native(f), before);
});

for (const stage of ["claim", "guard"] as const)
  for (const restriction of ["consent", "hold", "credit"] as const)
    test(`${restriction} is current at ${stage}, and failed guard never sends`, async (t) => {
      const f = setup(t),
        groupId = prepare(f),
        c = client();
      const restrict = () => {
        if (restriction === "consent") strict(f);
        else if (restriction === "hold")
          f.app.database.transaction(() =>
            f.app.platform.isolateRestore(
              "0".repeat(64),
              new Date().toISOString(),
            ),
          );
        else
          f.app.identity.setHold(f.actor, "credit-hold", {
            accountId: f.buyer,
            held: true,
            reason: "Synthetic credit hold",
          });
      };
      if (stage === "claim") restrict();
      else
        c.create = async (i, g, guard) => {
          restrict();
          guard();
          c.creates++;
          return observation(i, g);
        };
      await assert.rejects(
        f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), c),
      );
      assert.equal(c.creates, 0);
      assert.equal(
        member(f, groupId).state,
        stage === "claim" ? "pending" : "unknown",
      );
    });

test("foreign organization, warehouse scope, malformed client and changed configuration fail before claims or I/O", async (t) => {
  const f = setup(t),
    foreign = setup(t),
    groupId = prepare(f),
    c = client();
  await assert.rejects(
    foreign.app.carriers.createCanadaPostMember(
      foreign.actor,
      groupId,
      entry(f),
      c,
    ),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), {
      ...c,
      configurationHash: "b".repeat(64),
    }),
    { code: "CARRIER_CONFIG" },
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), {
      ...c,
      testApplication: false,
    } as unknown as typeof c),
    { code: "CARRIER_DISABLED" },
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, groupId, "absent", c),
    { code: "NOT_FOUND" },
  );
  assert.equal(member(f, groupId).state, "pending");
  assert.equal(c.creates, 0);
});

const mutations: [string, (r: CanadaPostShipmentObservation) => void][] = [
  [
    "booking",
    (r) => {
      r.bookingId = "foreign";
    },
  ],
  [
    "review",
    (r) => {
      r.reviewHash = "b".repeat(64);
    },
  ],
  [
    "configuration",
    (r) => {
      r.configurationHash = "b".repeat(64);
    },
  ],
  [
    "group",
    (r) => {
      r.groupId = "OTHER";
    },
  ],
  [
    "correlation",
    (r) => {
      r.customerRequestId = "UNRELATED";
    },
  ],
  [
    "provider ID",
    (r) => {
      r.shipmentId = "bad/id";
    },
  ],
  [
    "tracking",
    (r) => {
      r.tracking = "bad";
    },
  ],
  [
    "unexpected transmission",
    (r) => {
      r.status = "transmitted";
    },
  ],
  [
    "PDF",
    (r) => {
      r.label.bytes = Buffer.from("bad");
    },
  ],
  [
    "oversize",
    (r) => {
      r.label.bytes = Buffer.alloc(1048577);
    },
  ],
  [
    "extra field",
    (r) => {
      Object.assign(r, { unreviewed: true });
    },
  ],
];
for (const [name, mutate] of mutations)
  test(`unqualified ${name} result remains unknown without persisted artifact`, async (t) => {
    const f = setup(t),
      groupId = prepare(f),
      c = client(),
      before = native(f);
    c.create = async (i, g, guard) => {
      guard();
      c.creates++;
      const r = observation(i, g);
      mutate(r);
      return r;
    };
    await assert.rejects(
      f.app.carriers.createCanadaPostMember(f.actor, groupId, entry(f), c),
      { code: "CARRIER_RESULT" },
    );
    const row = member(f, groupId);
    assert.equal(row.state, "unknown");
    assert.equal(row.label_bytes, null);
    assert.equal(row.provider_shipment_id, null);
    assert.equal(row.token, null);
    assert.deepEqual(native(f), before);
  });

for (const mode of ["missing", "twice"] as const)
  test(`${mode} write guard does not persist a result`, async (t) => {
    const f = setup(t),
      g = prepare(f),
      c = client();
    c.create = async (i, group, guard) => {
      if (mode === "twice") {
        guard();
        guard();
      }
      return observation(i, group);
    };
    await assert.rejects(
      f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c),
      { code: mode === "twice" ? "STATE" : "CARRIER_RESULT" },
    );
    assert.equal(member(f, g).state, "unknown");
  });

test("duplicate provider identity cannot close a second native member", async (t) => {
  const f = setup(t, 2),
    g = prepare(f),
    c = client();
  await f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c);
  const first = member(f, g);
  c.create = async (i, group, guard) => {
    guard();
    const r = observation(i, group);
    r.shipmentId = first.provider_shipment_id!;
    return r;
  };
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, g, entry(f, 1), c),
    { code: "CARRIER_RESULT" },
  );
  assert.equal(member(f, g, entry(f, 1)).state, "unknown");
  assert.equal(member(f, g).state, "created");
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, g).state,
    "unknown",
  );
});

test("late completion audit failure rolls back artifact/event/closure and permits lookup recovery only", async (t) => {
  const f = setup(t),
    g = prepare(f),
    c = client(),
    original = f.app.platform.audit.bind(f.app.platform),
    before = native(f);
  const mock = t.mock.method(
    f.app.platform,
    "audit",
    (...args: Parameters<typeof original>) => {
      original(...args);
      if (args[1] === "carrier.canada-post.member.created")
        throw new Error("late audit failure");
    },
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c),
    /late audit failure/,
  );
  assert.equal(member(f, g).state, "unknown");
  assert.equal(member(f, g).label_bytes, null);
  assert.deepEqual(native(f), before);
  mock.mock.restore();
  await f.app.carriers.reconcileCanadaPostMember(f.actor, g, entry(f), c);
  assert.equal(c.creates, 1);
  assert.equal(c.lookups, 1);
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, g).state,
    "closed",
  );
});

test("expired in-flight completion cannot overwrite a newer read-only claim or closure", async (t) => {
  const f = setup(t),
    g = prepare(f),
    c = client();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  c.create = async (i, group, guard) => {
    guard();
    await barrier;
    return observation(i, group);
  };
  const old = f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c);
  const oldRejected = assert.rejects(old, { code: "STATE" });
  assert.equal(member(f, g).state, "creating");
  assert.equal(f.app.carriers.recoverStaleCanadaPostMembers(0, "foreign"), 0);
  assert.equal(
    f.app.carriers.recoverStaleCanadaPostMembers(0, f.actor.orgId),
    1,
  );
  assert.equal(f.app.carriers.recoverStaleCanadaPostMembers(0), 0);
  const recovered = await f.app.carriers.reconcileCanadaPostMember(
    f.actor,
    g,
    entry(f),
    client(),
  );
  assert.equal(recovered.state, "closed");
  const row = member(f, g);
  release();
  await oldRejected;
  assert.deepEqual(member(f, g), row);
});

function message(child: ChildProcess) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("child IPC timeout")),
      10000,
    );
    child.once("message", (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    child.once("error", reject);
  });
}
test("a separate process owns the claim; actual SIGKILL leaves recoverable uncertainty without automatic resend", async (t) => {
  const f = setup(t),
    g = prepare(f),
    c = client();
  const child = fork(
    join(import.meta.dirname, "canada-post-creation-child.ts"),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  let reply = message(child);
  child.send({ path: f.path, actor: f.actor, groupId: g, bookingId: entry(f) });
  assert.equal((await reply).claimed, true);
  assert.equal(member(f, g).state, "creating");
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c),
    { code: "STATE" },
  );
  assert.equal(c.creates, 0);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.equal(member(f, g).state, "creating");
  assert.equal(f.app.carriers.recoverStaleCanadaPostMembers(0), 1);
  assert.equal(
    (await f.app.carriers.reconcileCanadaPostMember(f.actor, g, entry(f), c))
      .state,
    "closed",
  );
  assert.equal(c.creates, 0);
  assert.equal(c.lookups, 1);
});

for (const stage of ["claim", "guard", "completion"] as const)
  test(`warehouse grant withdrawal at ${stage} refuses stale authority and retains uncertainty after a claim`, async (t) => {
    const f = setup(t),
      g = prepare(f),
      c = client();
    const user = f.app.identity.createUser(f.actor, "warehouse-user", {
      email: "native-creation@example.test",
      name: "Synthetic operator",
      password: "long-test-only-password",
      role: "warehouse",
      sites: [f.w1],
    });
    const operator = f.app.identity.currentActor({ ...f.actor, id: user.id });
    const withdraw = () =>
      f.app.identity.updateUser(f.actor, "site-withdrawal", {
        userId: user.id,
        revision: 1,
        email: "native-creation@example.test",
        name: operator.name,
        role: "warehouse",
        sites: [f.w2],
        active: true,
        currentPassword: "long-test-only-password",
        reason: "Synthetic site withdrawal",
      });
    if (stage === "claim") withdraw();
    else
      c.create = async (i, group, guard) => {
        if (stage === "guard") withdraw();
        guard();
        c.creates++;
        if (stage === "completion") withdraw();
        return observation(i, group);
      };
    await assert.rejects(
      f.app.carriers.createCanadaPostMember(operator, g, entry(f), c),
      { code: "FORBIDDEN" },
    );
    assert.equal(c.creates, stage === "completion" ? 1 : 0);
    assert.equal(member(f, g).state, stage === "claim" ? "pending" : "unknown");
    assert.equal(member(f, g).label_bytes, null);
    if (stage === "completion")
      assert.equal(
        (
          await f.app.carriers.reconcileCanadaPostMember(
            f.actor,
            g,
            entry(f),
            client(),
          )
        ).state,
        "closed",
      );
  });

test("late claim audit failure leaves the member wholly pending and makes no provider request", async (t) => {
  const f = setup(t),
    g = prepare(f),
    c = client(),
    original = f.app.platform.audit.bind(f.app.platform),
    before = member(f, g);
  const mock = t.mock.method(
    f.app.platform,
    "audit",
    (...args: Parameters<typeof original>) => {
      original(...args);
      if (args[1] === "carrier.canada-post.member.claimed")
        throw new Error("late claim failure");
    },
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c),
    /late claim failure/,
  );
  assert.deepEqual(member(f, g), before);
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, g).state,
    "prepared",
  );
  assert.equal(c.creates, 0);
  mock.mock.restore();
  await f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c);
  assert.equal(c.creates, 1);
});

test("customer withdrawal during an authorized creation preserves the qualified observation but blocks remaining sends", async (t) => {
  const f = setup(t, 2),
    g = prepare(f),
    c = client();
  c.create = async (i, group, guard) => {
    guard();
    c.creates++;
    strict(f);
    return observation(i, group);
  };
  assert.equal(
    (await f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c))
      .state,
    "creating",
  );
  assert.equal(member(f, g).state, "created");
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, g, entry(f, 1), c),
  );
  assert.equal(c.creates, 1);
});

test("two distinct members can hold claims concurrently, closure waits for both observations", async (t) => {
  const f = setup(t, 2),
    g = prepare(f),
    c = client();
  const releases: (() => void)[] = [];
  c.create = async (i, group, guard) => {
    guard();
    c.creates++;
    await new Promise<void>((resolve) => releases.push(resolve));
    return observation(i, group);
  };
  const first = f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c),
    second = f.app.carriers.createCanadaPostMember(f.actor, g, entry(f, 1), c);
  assert.equal(c.creates, 2);
  assert.ok(
    f.app.carriers
      .reviewCanadaPostGroup(f.actor, g)
      .entries.every((m) => m.state === "creating"),
  );
  releases[0]!();
  assert.equal((await first).state, "creating");
  releases[1]!();
  assert.equal((await second).state, "closed");
});

test("encrypted restore retains created bytes and unknown members, and provider hold prevents reconciliation I/O", async (t) => {
  const f = setup(t, 2),
    g = prepare(f),
    c = client();
  await f.app.carriers.createCanadaPostMember(f.actor, g, entry(f), c);
  c.create = async (_i, _g, guard) => {
    guard();
    throw new Error("lost second reply");
  };
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(f.actor, g, entry(f, 1), c),
  );
  const view = f.app.carriers.reviewCanadaPostGroup(f.actor, g),
    first = member(f, g),
    second = member(f, g, entry(f, 1)),
    key = randomBytes(32),
    archive = join(dirname(f.path), "creation.backup"),
    target = join(dirname(f.path), "creation-restored.db");
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  try {
    const rf = { ...f, app: restored };
    assert.deepEqual(restored.carriers.reviewCanadaPostGroup(f.actor, g), view);
    assert.deepEqual(member(rf, g), first);
    assert.deepEqual(member(rf, g, entry(f, 1)), second);
    const reader = client();
    await assert.rejects(
      restored.carriers.reconcileCanadaPostMember(
        f.actor,
        g,
        entry(f, 1),
        reader,
      ),
      { code: "RECOVERY_HOLD" },
    );
    assert.equal(reader.lookups, 0);
    assert.deepEqual(member(rf, g, entry(f, 1)), second);
  } finally {
    restored.close();
  }
});
