import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { Application } from "../src/server/application.ts";
import { createBackup, restoreBackup } from "../src/server/recovery.ts";
import { digest } from "../src/server/core.ts";
import type { CanadaPostManifestObservation } from "../src/server/canada-post-test.ts";
import { chooseProviders } from "./fixtures.ts";
import {
  closed,
  manifestClient,
  manifestObservation,
  type MF,
} from "./canada-post-manifest-fixture.ts";
import { setup, native, raw, allRows } from "./canada-post-fixture.ts";
import { client as creation } from "./canada-post-creation-fixture.ts";
const group = (f: MF) =>
  f.app.database.owned("integration").get<{
    state: string;
    token: string | null;
    observation: string | null;
    manifest_hash: string | null;
  }>("SELECT * FROM integration_canada_post_groups WHERE id=?", f.groupId)!;
const send = (f: MF) =>
  f.app.carriers.transmitCanadaPostManifest(
    f.actor,
    f.groupId,
    f.manifestReview.reviewHash,
    f.m,
  );
const recover = (f: MF) =>
  f.app.carriers.reconcileCanadaPostManifest(
    f.actor,
    f.groupId,
    f.manifestReview.reviewHash,
    f.m,
  );
function handover(
  f: MF,
  i = 0,
  tracking = f.app.carriers.review(f.actor, f.shipments[i]!).booking!.tracking!,
) {
  return f.app.fulfillment.commit(f.actor, `handover-${i}`, {
    shipmentId: f.shipments[i]!,
    carrier: "canada-post",
    tracking,
    handoverEvidence: "Synthetic warehouse handover receipt",
  });
}
function restrict(f: MF, name: string) {
  if (name === "consent")
    chooseProviders(f, f.actor, "withdraw", {
      accountId: f.buyer,
      region: "CA",
      mode: "strict",
      providers: [],
      version: 2,
      acknowledgment: "Synthetic withdrawal",
    });
  else if (name === "hold")
    f.app.database.transaction(() =>
      f.app.platform.isolateRestore("0".repeat(64), new Date().toISOString()),
    );
  else
    f.app.identity.setHold(f.actor, "credit-hold", {
      accountId: f.buyer,
      held: true,
      reason: "Synthetic hold",
    });
}
test("complete two-member manifest retains private evidence across restart and only exact explicit handover changes stock/money", async (t) => {
  const f = await closed(t, 2),
    before = native(f);
  assert.throws(() => handover(f, 0, "1234567890123456"), {
    code: "CARRIER_BOOKING_ACTIVE",
  });
  assert.equal((await send(f)).state, "transmitted");
  assert.deepEqual(native(f), before);
  const document = f.app.carriers.canadaPostManifestDocument(
    f.actor,
    f.groupId,
  );
  assert.equal(document.hash, digest(document.bytes));
  document.bytes.fill(0);
  assert.equal(
    f.app.carriers.canadaPostManifestDocument(f.actor, f.groupId).hash,
    digest(f.app.carriers.canadaPostManifestDocument(f.actor, f.groupId).bytes),
  );
  for (const shipment of f.shipments)
    assert.equal(
      f.app.carriers.review(f.actor, shipment).booking!.state,
      "booked",
    );
  f.app.close();
  f.app = new Application(f.path);
  assert.throws(() => handover(f, 0, "9999999999999999"), {
    code: "CARRIER_MISMATCH",
  });
  const first = handover(f);
  assert.equal(
    f.app.billing.invoices(f.actor).length,
    before.invoices.length + 1,
  );
  assert.deepEqual(handover(f), first);
  assert.equal(
    f.app.billing.invoices(f.actor).length,
    before.invoices.length + 1,
  );
  handover(f, 1);
  assert.equal(
    f.app.billing.invoices(f.actor).length,
    before.invoices.length + 2,
  );
  assert.ok(
    f.shipments.every(
      (id) => f.app.fulfillment.shipment(f.actor, id).state === "shipped",
    ),
  );
  await assert.rejects(send(f), { code: "STATE" });
  await assert.rejects(recover(f), { code: "STATE" });
  assert.equal(f.m.writes, 1);
  assert.equal(f.m.reads, 0);
});
test("lost reply retains identity across restart; empty read never authorizes resend and qualified read promotes all bookings atomically", async (t) => {
  const f = await closed(t, 2),
    before = native(f);
  f.m.transmitManifest = async (_i, guard) => {
    guard();
    f.m.writes++;
    throw new Error("lost reply");
  };
  await assert.rejects(send(f), /lost reply/);
  const claim = group(f).observation;
  assert.equal(group(f).state, "unknown");
  assert.equal(JSON.parse(claim!).kind, "manifest-claim");
  f.app.close();
  f.app = new Application(f.path);
  f.m.recoverManifest = async () => {
    f.m.reads++;
    return null;
  };
  assert.equal((await recover(f)).state, "unknown");
  assert.equal(group(f).observation, claim);
  assert.equal(group(f).token, null);
  await assert.rejects(send(f), { code: "STATE" });
  assert.deepEqual(native(f), before);
  f.m.recoverManifest = async (i) => {
    f.m.reads++;
    return manifestObservation(i);
  };
  assert.equal((await recover(f)).state, "transmitted");
  assert.equal(f.m.writes, 1);
  assert.equal(f.m.reads, 2);
  assert.deepEqual(native(f), before);
});
for (const stage of ["claim", "guard", "recovery"] as const)
  for (const name of ["consent", "hold", "credit"])
    test(`${name} is current at manifest ${stage} and prevents provider I/O`, async (t) => {
      const f = await closed(t),
        before = native(f);
      if (stage === "recovery") {
        f.m.transmitManifest = async (_i, g) => {
          g();
          throw new Error("lost");
        };
        await assert.rejects(send(f));
      }
      if (stage !== "guard") restrict(f, name);
      else
        f.m.transmitManifest = async (i, g) => {
          restrict(f, name);
          g();
          f.m.writes++;
          return manifestObservation(i);
        };
      await assert.rejects(stage === "recovery" ? recover(f) : send(f));
      assert.equal(f.m.writes, 0);
      assert.equal(f.m.reads, 0);
      assert.equal(group(f).state, stage === "claim" ? "closed" : "unknown");
      assert.deepEqual(native(f), before);
    });
for (const name of ["consent", "credit"])
  test(`post-write ${name} change retains confirmation while native handover applies current policy`, async (t) => {
    const f = await closed(t),
      before = native(f);
    f.m.transmitManifest = async (i, g) => {
      g();
      f.m.writes++;
      restrict(f, name);
      return manifestObservation(i);
    };
    assert.equal((await send(f)).state, "transmitted");
    assert.deepEqual(native(f), before);
    if (name === "credit")
      assert.throws(() => handover(f), { code: "CREDIT_HOLD" });
    else handover(f);
  });
for (const stage of ["claim", "guard", "completion"] as const)
  test(`fresh warehouse authority at manifest ${stage}`, async (t) => {
    const f = await closed(t),
      user = f.app.identity.createUser(f.actor, "staff", {
        email: "manifest@example.test",
        name: "Synthetic operator",
        password: "long-test-only-password",
        role: "warehouse",
        sites: [f.w1],
      }),
      operator = f.app.identity.currentActor({ ...f.actor, id: user.id });
    const withdraw = () =>
      f.app.identity.updateUser(f.actor, "withdraw-site", {
        userId: user.id,
        revision: 1,
        email: "manifest@example.test",
        name: operator.name,
        role: "warehouse",
        sites: [f.w2],
        active: true,
        currentPassword: "long-test-only-password",
        reason: "Synthetic withdrawal",
      });
    if (stage === "claim") withdraw();
    else
      f.m.transmitManifest = async (i, g) => {
        if (stage === "guard") withdraw();
        g();
        f.m.writes++;
        if (stage === "completion") withdraw();
        return manifestObservation(i);
      };
    await assert.rejects(
      f.app.carriers.transmitCanadaPostManifest(
        operator,
        f.groupId,
        f.manifestReview.reviewHash,
        f.m,
      ),
      { code: "FORBIDDEN" },
    );
    assert.equal(f.m.writes, stage === "completion" ? 1 : 0);
    assert.equal(group(f).state, stage === "claim" ? "closed" : "unknown");
    if (stage === "completion")
      assert.equal((await recover(f)).state, "transmitted");
  });
const mutations: Record<
  string,
  (value: CanadaPostManifestObservation) => void
> = {
  "review identity": (v) => {
    v.reviewHash = "b".repeat(64);
  },
  "native manifest": (v) => {
    v.manifestId = "different";
  },
  "provider group": (v) => {
    v.groupId = "different";
  },
  configuration: (v) => {
    v.configurationHash = "b".repeat(64);
  },
  reference: (v) => {
    v.customerReference = "D00000000000";
  },
  "member omission": (v) => {
    v.shipmentIds = [];
  },
  "duplicate member": (v) => {
    v.shipmentIds.push(v.shipmentIds[0]!);
  },
  "invalid purchase order": (v) => {
    v.poNumber = "https://bad";
  },
  "invalid date": (v) => {
    v.manifestDate = "2026-02-30";
  },
  "fractional cent": (v) => {
    v.totalCents = 1.5;
  },
  "negative price": (v) => {
    v.totalCents = -1;
  },
  "huge price": (v) => {
    v.totalCents = 100_000_001;
  },
  "wrong media": (v) => {
    (v.document as { mediaType: string }).mediaType = "image/png";
  },
  "bad PDF": (v) => {
    v.document.bytes = Buffer.from("bad");
  },
  "oversized PDF": (v) => {
    v.document.bytes = Buffer.alloc(1_048_577);
  },
  "extra field": (v) => {
    Object.assign(v, { url: "https://bad" });
  },
};
for (const [name, mutate] of Object.entries(mutations))
  test(`manifest ${name} is refused after one write without native effects`, async (t) => {
    const f = await closed(t),
      before = native(f);
    f.m.transmitManifest = async (i, g) => {
      g();
      f.m.writes++;
      const result = manifestObservation(i);
      mutate(result);
      return result;
    };
    await assert.rejects(send(f), { code: "CARRIER_RESULT" });
    assert.equal(group(f).state, "unknown");
    assert.equal(group(f).manifest_hash, null);
    assert.deepEqual(native(f), before);
    assert.equal(f.m.writes, 1);
    await assert.rejects(send(f), { code: "STATE" });
    assert.equal((await recover(f)).state, "transmitted");
    assert.equal(f.m.reads, 1);
  });
for (const mode of ["missing", "double"] as const)
  test(`${mode} manifest guard never qualifies`, async (t) => {
    const f = await closed(t);
    f.m.transmitManifest = async (i, g) => {
      if (mode === "double") {
        g();
        g();
      }
      return manifestObservation(i);
    };
    await assert.rejects(send(f), {
      code: mode === "missing" ? "CARRIER_RESULT" : "STATE",
    });
    assert.equal(group(f).state, "unknown");
    assert.equal(group(f).manifest_hash, null);
  });
test("claim audit rollback leaves closed group byte-for-byte unchanged and makes no request", async (t) => {
  const f = await closed(t),
    before = allRows(f),
    original = f.app.platform.audit.bind(f.app.platform);
  const mock = t.mock.method(
    f.app.platform,
    "audit",
    (...args: Parameters<typeof original>) => {
      original(...args);
      if (args[1] === "carrier.canada-post.manifest.claimed")
        throw new Error("claim audit rollback");
    },
  );
  await assert.rejects(send(f), /claim audit rollback/);
  assert.deepEqual(allRows(f), before);
  assert.equal(f.m.writes, 0);
  mock.mock.restore();
  await send(f);
});
test("completion event rollback undoes private manifest and every promoted member, then read-only recovery succeeds", async (t) => {
  const f = await closed(t, 2),
    before = native(f),
    original = f.app.platform.event.bind(f.app.platform);
  let seen = 0;
  const mock = t.mock.method(
    f.app.platform,
    "event",
    (...args: Parameters<typeof original>) => {
      original(...args);
      if (args[1] === "carrier.booking.booked" && ++seen === 2)
        throw new Error("second promotion failure");
    },
  );
  await assert.rejects(send(f), /second promotion failure/);
  assert.equal(group(f).state, "unknown");
  assert.equal(group(f).manifest_hash, null);
  for (const shipment of f.shipments)
    assert.equal(
      f.app.carriers.review(f.actor, shipment).booking!.state,
      "pending",
    );
  assert.deepEqual(native(f), before);
  mock.mock.restore();
  assert.equal((await recover(f)).state, "transmitted");
  assert.equal(f.m.writes, 1);
});
test("separate connection cannot claim the same manifest and expired late completion cannot overwrite recovered confirmation", async (t) => {
  const f = await closed(t),
    second = new Application(f.path);
  t.after(() => second.close());
  let release!: () => void;
  f.m.transmitManifest = async (i, g) => {
    g();
    f.m.writes++;
    await new Promise<void>((r) => {
      release = r;
    });
    return manifestObservation(i);
  };
  const pending = send(f);
  assert.equal(group(f).state, "transmitting");
  const contender = manifestClient();
  await assert.rejects(
    second.carriers.transmitCanadaPostManifest(
      f.actor,
      f.groupId,
      f.manifestReview.reviewHash,
      contender,
    ),
    { code: "STATE" },
  );
  assert.equal(contender.writes, 0);
  assert.equal(
    second.carriers.recoverStaleCanadaPostManifests(0, "foreign-org"),
    0,
  );
  assert.equal(
    second.carriers.recoverStaleCanadaPostManifests(0, f.actor.orgId),
    1,
  );
  assert.equal(
    (
      await second.carriers.reconcileCanadaPostManifest(
        f.actor,
        f.groupId,
        f.manifestReview.reviewHash,
        contender,
      )
    ).state,
    "transmitted",
  );
  const confirmed = group(f);
  release();
  await assert.rejects(pending, { code: "STATE" });
  assert.deepEqual(group(f), confirmed);
  assert.equal(f.m.writes, 1);
  assert.equal(contender.reads, 1);
});
test("recovery refuses changed retained provider identity before any read", async (t) => {
  const f = await closed(t);
  f.m.transmitManifest = async (_i, g) => {
    g();
    throw new Error("lost");
  };
  await assert.rejects(send(f));
  raw(
    f,
    "UPDATE integration_canada_post_members SET provider_shipment_id='different' WHERE group_id=?",
    f.groupId,
  );
  await assert.rejects(recover(f), { code: "CARRIER_MISMATCH" });
  assert.equal(f.m.reads, 0);
});
test("foreign organization, changed client configuration and stale review refuse without a claim", async (t) => {
  const f = await closed(t),
    foreign = setup(t),
    before = group(f);
  assert.throws(
    () =>
      foreign.app.carriers.canadaPostManifestDocument(foreign.actor, f.groupId),
    { code: "NOT_FOUND" },
  );
  await assert.rejects(
    f.app.carriers.transmitCanadaPostManifest(
      { ...f.actor, orgId: "foreign" },
      f.groupId,
      f.manifestReview.reviewHash,
      f.m,
    ),
  );
  await assert.rejects(
    f.app.carriers.transmitCanadaPostManifest(
      f.actor,
      f.groupId,
      "0".repeat(64),
      f.m,
    ),
    { code: "CARRIER_MISMATCH" },
  );
  await assert.rejects(
    f.app.carriers.transmitCanadaPostManifest(
      f.actor,
      f.groupId,
      f.manifestReview.reviewHash,
      { ...f.m, configurationHash: "b".repeat(64) },
    ),
    { code: "CARRIER_CONFIG" },
  );
  assert.deepEqual(group(f), before);
  assert.equal(f.m.writes, 0);
});
for (const field of ["manifest", "member", "booking"] as const)
  test(`tampered retained ${field} blocks handover with no stock/money effects`, async (t) => {
    const f = await closed(t);
    await send(f);
    const before = native(f);
    if (field === "manifest")
      raw(
        f,
        "UPDATE integration_canada_post_groups SET manifest_hash=? WHERE id=?",
        "0".repeat(64),
        f.groupId,
      );
    else if (field === "member")
      raw(
        f,
        "UPDATE integration_canada_post_members SET tracking='9999999999999999' WHERE group_id=?",
        f.groupId,
      );
    else
      raw(
        f,
        "UPDATE integration_carrier_bookings SET reference='different' WHERE id=?",
        f.input.entries[0]!.bookingId,
      );
    assert.throws(() => handover(f), { code: "CARRIER_MISMATCH" });
    assert.deepEqual(native(f), before);
  });
test("another group's purchase order cannot qualify this group", async (t) => {
  const f = setup(t, 2),
    c = creation(),
    m = manifestClient(),
    groups = [];
  for (let i = 0; i < 2; i++) {
    const entry = f.input.entries[i]!,
      g = f.app.carriers.prepareCanadaPostGroup(f.actor, `group-${i}`, {
        configurationHash: f.input.configurationHash,
        entries: [entry],
      }).id;
    await f.app.carriers.createCanadaPostMember(f.actor, g, entry.bookingId, c);
    groups.push(g);
  }
  for (let i = 0; i < 2; i++) {
    const g = groups[i]!,
      review = f.app.carriers.reviewCanadaPostManifest(f.actor, g, m),
      promise = f.app.carriers.transmitCanadaPostManifest(
        f.actor,
        g,
        review.reviewHash,
        m,
      );
    if (i === 0) await promise;
    else await assert.rejects(promise, { code: "CARRIER_RESULT" });
  }
  assert.equal(m.writes, 2);
  assert.equal(
    f.app.carriers.reviewCanadaPostGroup(f.actor, groups[1]!).state,
    "unknown",
  );
});
test("encrypted restore retains confirmed private evidence and uncertain claims; restore hold blocks recovery reads", async (t) => {
  const f = await closed(t),
    key = randomBytes(32),
    archive = join(dirname(f.path), "manifest.backup"),
    target = join(dirname(f.path), "restored.db");
  f.m.transmitManifest = async (_i, g) => {
    g();
    throw new Error("lost");
  };
  await assert.rejects(send(f));
  const before = group(f);
  await createBackup(f.path, archive, "CA", key);
  await restoreBackup(archive, target, "CA", key);
  const restored = new Application(target);
  try {
    const rf = { ...f, app: restored };
    assert.deepEqual(group(rf), before);
    await assert.rejects(recover(rf), { code: "RECOVERY_HOLD" });
    assert.equal(f.m.reads, 0);
    assert.deepEqual(group(rf), before);
  } finally {
    restored.close();
  }
  f.m.recoverManifest = async (i) => manifestObservation(i);
  await recover(f);
  const document = f.app.carriers.canadaPostManifestDocument(
      f.actor,
      f.groupId,
    ),
    archive2 = join(dirname(f.path), "confirmed.backup"),
    target2 = join(dirname(f.path), "confirmed.db");
  await createBackup(f.path, archive2, "CA", key);
  await restoreBackup(archive2, target2, "CA", key);
  const restored2 = new Application(target2);
  try {
    assert.deepEqual(
      restored2.carriers.canadaPostManifestDocument(f.actor, f.groupId),
      document,
    );
  } finally {
    restored2.close();
  }
});
test("actual SIGKILL retains manifest claim for read-only recovery, no automatic resend", async (t) => {
  const f = await closed(t),
    child = fork(
      join(import.meta.dirname, "canada-post-manifest-child.ts"),
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
  const reply = once(child, "message");
  child.send({
    path: f.path,
    actor: f.actor,
    groupId: f.groupId,
    reviewHash: f.manifestReview.reviewHash,
  });
  assert.equal((await reply)[0].claimed, true);
  assert.equal(group(f).state, "transmitting");
  await assert.rejects(send(f), { code: "STATE" });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.equal(group(f).state, "transmitting");
  assert.equal(f.app.carriers.recoverStaleCanadaPostManifests(0), 1);
  assert.equal((await recover(f)).state, "transmitted");
  assert.equal(f.m.writes, 0);
  assert.equal(f.m.reads, 1);
});

test("unclosed creation group cannot claim a manifest or confuse member uncertainty with transmission uncertainty", async (t) => {
  const f = setup(t, 2),
    g = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", f.input).id,
    m = manifestClient(),
    c = creation();
  await assert.rejects(
    f.app.carriers.transmitCanadaPostManifest(f.actor, g, "0".repeat(64), m),
    { code: "STATE" },
  );
  await f.app.carriers.createCanadaPostMember(
    f.actor,
    g,
    f.input.entries[0]!.bookingId,
    c,
  );
  c.create = async (_i, _g, guard) => {
    guard();
    throw new Error("lost member");
  };
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(
      f.actor,
      g,
      f.input.entries[1]!.bookingId,
      c,
    ),
  );
  await assert.rejects(
    f.app.carriers.reconcileCanadaPostManifest(f.actor, g, "0".repeat(64), m),
    { code: "CARRIER_MISMATCH" },
  );
  assert.equal(m.writes, 0);
  assert.equal(m.reads, 0);
});
test("client methods and configuration are captured before awaited transmission; later client mutation cannot replace completion", async (t) => {
  const f = await closed(t);
  let release!: () => void;
  f.m.transmitManifest = async (i, g) => {
    g();
    f.m.writes++;
    await new Promise<void>((r) => {
      release = r;
    });
    return manifestObservation(i);
  };
  const pending = send(f);
  Object.assign(f.m, {
    configurationHash: "b".repeat(64),
    manifestIdentity: () => {
      throw new Error("changed identity");
    },
    transmitManifest: () => {
      throw new Error("changed send");
    },
    recoverManifest: () => {
      throw new Error("changed read");
    },
  });
  release();
  assert.equal((await pending).state, "transmitted");
  assert.equal(f.m.writes, 1);
});
test("label corruption while awaiting transmission refuses completion and leaves every native booking pending", async (t) => {
  const f = await closed(t);
  f.m.transmitManifest = async (i, g) => {
    g();
    f.m.writes++;
    raw(
      f,
      "UPDATE integration_canada_post_members SET label_hash=? WHERE group_id=?",
      "0".repeat(64),
      f.groupId,
    );
    return manifestObservation(i);
  };
  await assert.rejects(send(f), { code: "CARRIER_MISMATCH" });
  assert.equal(group(f).state, "unknown");
  assert.equal(
    f.app.carriers.review(f.actor, f.shipments[0]!).booking!.state,
    "pending",
  );
});
