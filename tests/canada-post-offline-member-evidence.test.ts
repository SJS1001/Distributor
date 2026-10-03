import assert from "node:assert/strict";
import test from "node:test";
import { Application } from "../src/server/application.ts";
import { canonical, digest } from "../src/server/core.ts";
import type {
  CarrierIntent,
  CanadaPostManifestClient,
} from "../src/server/carrier-bookings.ts";
import {
  reviewCanadaPostShipment,
  canadaPostConfigurationHash,
} from "../src/server/canada-post-evidence.ts";
import { fixture, accept, chooseProviders } from "./fixtures.ts";
import { origin } from "./canada-post-fixture.ts";

// Synthetic native fixture derived from the published proposed-reference review tests.
async function setup(
  t: Parameters<typeof fixture>[0],
  region: "CA" | "US" = "CA",
  currency: "CAD" | "USD" = "CAD",
  reports = false,
  options: {
    differentConfiguration?: boolean;
    deposit?: boolean;
    promote?: boolean;
    ordinary?: boolean;
    hold?: boolean;
  } = {},
) {
  const f = fixture(t, { eventReports: reports }, region, currency);
  chooseProviders(f, f.actor, "cp-choice", {
    accountId: f.buyer,
    region,
    mode: "provider-exceptions",
    providers: ["canada-post"],
    version: 1,
    acknowledgment: "Synthetic explicit choice",
  });
  const binding = {
    orgId: f.actor.orgId,
    warehouseId: f.w1,
    testApplication: true as const,
    customerNumber: "6767676",
    contractId: "123456",
    company: "Synthetic",
    shippingPoint: options.deposit
      ? { kind: "deposit" as const, siteId: "A1B2" }
      : { kind: "pickup" as const, postalCode: "M5V1A1" },
    services: [{ service: "DOM.EP", code: "DOM.EP" as const }],
  };
  const configurationHash = canadaPostConfigurationHash(binding);
  const configuration = {
    hash: configurationHash,
    provider: "canada-post" as const,
    accountHint: "Synthetic account",
    details: ["Synthetic domestic"],
    services: [{ service: "DOM.EP", description: "Synthetic service" }],
  };
  const outsideConfigurationHash = options.differentConfiguration
    ? canadaPostConfigurationHash({
        ...binding,
        company: "Other retained company",
      })
    : configurationHash;
  const entries = [0, 1, 2].map((n) => {
    const selectedHash = n === 2 ? outsideConfigurationHash : configurationHash;
    const selectedConfiguration = { ...configuration, hash: selectedHash };
    const orderId = accept(f, 1, `order-${n}`).id;
    const picks = f.app.fulfillment.picks(f.actor, orderId);
    for (const p of picks)
      f.app.fulfillment.pick(f.actor, `pick-${n}-${p.id}`, {
        orderId,
        allocationId: p.id,
        serial: p.serial,
      });
    const address = "Synthetic CA destination";
    const shipmentId = f.app.fulfillment.pack(f.actor, `pack-${n}`, {
      orderId,
      revision: f.app.orders.order(f.actor, orderId).revision,
      mode: "carrier",
      address,
      lines: picks.map((p) => ({ allocationId: p.id, quantity: p.quantity })),
    }).id;
    const b = f.app.carriers.prepare(
      f.actor,
      `booking-${n}`,
      {
        shipmentId,
        previousId: null,
        provider: "canada-post",
        service: "DOM.EP",
        origin,
        destination: { ...origin, name: "Receiver" },
        parcel: {
          weightGrams: 1000,
          lengthMm: 100,
          widthMm: 100,
          heightMm: 100,
        },
        reviewedDestination: address,
        acknowledgment: "Synthetic parcel review",
        configurationHash: selectedHash,
      },
      selectedConfiguration,
    );
    return { bookingId: b.id, reviewHash: b.reviewHash };
  });
  const input = { configurationHash, entries: entries.slice(0, 2) };
  const group = f.app.carriers.prepareCanadaPostGroup(f.actor, "group", input);
  const pdf = Buffer.from("%PDF-1.7\nSynthetic native label only\n%%EOF");
  const observation = (
    intent: CarrierIntent,
    groupId: string,
    configurationHash = canadaPostConfigurationHash(binding),
  ) => ({
    bookingId: intent.bookingId,
    reviewHash: intent.reviewHash,
    configurationHash,
    groupId,
    customerRequestId:
      "D" +
      digest(
        canonical({
          configurationHash,
          bookingId: intent.bookingId,
          reviewHash: intent.reviewHash,
          groupId,
        }),
      )
        .slice(0, 31)
        .toUpperCase(),
    shipmentId: "S" + digest(intent.bookingId).slice(0, 20),
    tracking: "1234567890123456",
    status: "created" as const,
    label: { mediaType: "application/pdf" as const, bytes: Buffer.from(pdf) },
  });
  let calls = 0;
  const client = {
    testApplication: true as const,
    configurationHash,
    create: async (i: CarrierIntent, g: string, guard: () => void) => {
      guard();
      calls++;
      return observation(i, g);
    },
    lookup: async () => {
      throw Error("no lookup");
    },
  };
  await f.app.carriers.createCanadaPostMember(
    f.actor,
    group.id,
    entries[0]!.bookingId,
    client,
  );
  await assert.rejects(
    f.app.carriers.createCanadaPostMember(
      f.actor,
      group.id,
      entries[1]!.bookingId,
      {
        ...client,
        create: async (_i, _g, guard) => {
          guard();
          calls++;
          throw Error("lost synthetic response");
        },
      },
    ),
    /lost synthetic response/,
  );
  assert.equal(calls, 2);
  const outside = options.ordinary
    ? null
    : f.app.carriers.prepareCanadaPostGroup(f.actor, "outside-group", {
        configurationHash: outsideConfigurationHash,
        entries: entries.slice(2),
      });
  const outsideShipmentId = "OUTSIDE_CREATED_SHIPMENT";
  const outsideTracking = "9999999999999999";
  if (outside) {
    await f.app.carriers.createCanadaPostMember(
      f.actor,
      outside.id,
      entries[2]!.bookingId,
      {
        ...client,
        configurationHash: outsideConfigurationHash,
        create: async (i, g, guard) => {
          guard();
          calls++;
          return {
            ...observation(i, g, outsideConfigurationHash),
            shipmentId: outsideShipmentId,
            tracking: outsideTracking,
          };
        },
      },
    );
    if (options.promote) {
      const manifest: CanadaPostManifestClient = {
        testApplication: true,
        configurationHash: outsideConfigurationHash,
        manifestIdentity(input) {
          const reviewHash = digest(
            canonical({
              configurationHash: outsideConfigurationHash,
              ...input,
              entries: input.entries.toSorted((a, b) =>
                a.shipmentId.localeCompare(b.shipmentId),
              ),
            }),
          );
          return {
            manifestId: input.manifestId,
            groupId: input.groupId,
            configurationHash: outsideConfigurationHash,
            reviewHash,
            customerReference: "D" + reviewHash.slice(0, 11).toUpperCase(),
            shipmentIds: input.entries.map((e) => e.shipmentId).sort(),
          };
        },
        async transmitManifest(input, guard) {
          guard();
          return {
            ...this.manifestIdentity(input),
            poNumber: "N123456789",
            manifestDate: "2026-10-01",
            totalCents: 2373,
            document: { mediaType: "application/pdf", bytes: Buffer.from(pdf) },
          };
        },
        async recoverManifest() {
          throw Error("no recovery");
        },
      };
      const reviewed = f.app.carriers.reviewCanadaPostManifest(
        f.actor,
        outside.id,
        manifest,
      );
      await f.app.carriers.transmitCanadaPostManifest(
        f.actor,
        outside.id,
        reviewed.reviewHash,
        manifest,
      );
    }
  } else {
    await f.app.carriers.execute(f.actor, entries[2]!.bookingId, {
      provider: "canada-post",
      sandbox: true,
      configuration: { ...configuration, hash: outsideConfigurationHash },
      async book(i, guard) {
        guard();
        calls++;
        return {
          bookingId: i.bookingId,
          reviewHash: i.reviewHash,
          reference: outsideShipmentId,
          tracking: outsideTracking,
          label: { mediaType: "application/pdf", bytes: Buffer.from(pdf) },
        };
      },
      async lookup() {
        throw Error("no lookup");
      },
    });
  }
  assert.equal(calls, 3);
  if (options.hold !== false)
    f.app.platform.isolateRestore("a".repeat(64), "2026-10-03T00:00:00.000Z");
  return {
    ...f,
    originalFixture: f,
    binding,
    outside,
    outsideShipmentId,
    outsideTracking,
    groupId: group.id,
    bookingId: entries[1]!.bookingId,
    createdId: entries[0]!.bookingId,
    entries,
    region,
    currency,
    reports,
    pdf,
    configurationHash,
  };
}

import {
  compareCanadaPostOfflineMemberEvidence as compare,
  canadaPostOfflineMemberEvidenceLimits as limits,
} from "../src/server/canada-post-offline-member-evidence.ts";
type F = Awaited<ReturnType<typeof setup>>;
function proposal(f: F) {
  return {
    groupId: f.groupId,
    bookingId: f.bookingId,
    providerShipmentId: "PROPOSED_UNUSED_ID",
    tracking: "8888888888888888",
  };
}
function inputs(f: F): any {
  return f.app.database.transaction(() => {
    const native =
      f.app.carrierOfflineMemberReview.reviewUnknownMemberInTransaction(
        f.actor,
        f.groupId,
        f.bookingId,
      );
    const proposedReferences =
      f.app.carrierOfflineMemberReview.reviewProposedReferencesInTransaction(
        f.actor,
        proposal(f),
      );
    const platform = native.preparations.map((p) =>
      f.app.platformOfflineCarrierReview.getInTransaction(
        f.actor,
        f.groupId,
        p.bookingId as string,
      ),
    );
    const custody = native.preparations.map((p) =>
      f.app.fulfillment.reviewPackedCarrierCustodyInTransaction(
        f.actor,
        p.intent.shipmentId,
      ),
    );
    const members = native.preparations.map((p) => {
      const request = reviewCanadaPostShipment(
        f.binding,
        structuredClone(p.intent) as CarrierIntent,
        native.groups[0]!.provider_group_id as string,
      );
      const m = native.members.find((m) => m.booking_id === p.bookingId)!;
      const target = p.bookingId === f.bookingId;
      const tracking = target ? proposal(f).tracking : (m.tracking as string);
      return {
        bookingId: p.bookingId,
        reviewHash: p.intent.reviewHash,
        configurationHash: f.configurationHash,
        groupId: request.groupId,
        customerRequestId: request.customerRequestId,
        shipmentId: target
          ? proposal(f).providerShipmentId
          : m.provider_shipment_id,
        tracking,
        status: "created",
        details: {
          customerRequestId: request.customerRequestId,
          trackingPin: tracking,
          shipmentStatus: "created",
          ...(f.binding.shippingPoint.kind === "pickup"
            ? { cpcPickupIndicator: true, finalShippingPoint: "M5V1A1" }
            : { shippingPointId: "A1B2" }),
          shipmentDetail: {
            groupId: request.groupId,
            deliverySpec: structuredClone(request.body.deliverySpec),
          },
        },
        label: {
          encoding: "base64",
          bytes: f.pdf.length,
          sha256: digest(f.pdf),
          data: f.pdf.toString("base64"),
        },
      };
    });
    return structuredClone({
      version: 1,
      native,
      proposedReferences,
      account: f.binding,
      platform,
      custody,
      members,
    });
  });
}
function freezeCheck(v: unknown): void {
  if (v && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(freezeCheck);
  }
}
function rehash(v: any, key: string) {
  const { [key]: _old, ...body } = v;
  v[key] = digest(canonical(body));
}
function reseal(v: any) {
  rehash(v.native, "reviewHash");
  v.proposedReferences.memberReviewHash = v.native.reviewHash;
  rehash(v.proposedReferences, "reviewHash");
  for (const p of v.platform) rehash(p, "factsHash");
  for (const c of v.custody) rehash(c, "custodyHash");
}
const refused = (v: unknown) =>
  assert.throws(
    () => compare(v),
    /^Error: CANADA_POST_OFFLINE_EVIDENCE: unsupported or inconsistent captured facts$/,
  );
const changes = (f: F) =>
  f.app.database.owned("integration").get("SELECT total_changes() AS n")!.n;

for (const currency of ["CAD", "USD"] as const)
  for (const reports of [false, true])
    test(`CA/${currency}, reports=${reports}: complete actual native join, immutable detached redacted output, no writes`, async (t) => {
      const f = await setup(t, "CA", currency, reports),
        before = changes(f),
        v = inputs(f);
      const result = compare(v);
      freezeCheck(result);
      assert.equal(changes(f), before);
      assert.equal(result.members.length, 2);
      assert.equal(result.currency, currency);
      assert.equal(result.nativeReviewHash, v.native.reviewHash);
      assert.equal(
        result.proposedReferenceHash,
        v.proposedReferences.reviewHash,
      );
      for (const m of result.members) {
        const p = v.native.preparations.find(
          (p: any) => p.bookingId === m.bookingId,
        );
        const r = reviewCanadaPostShipment(
          f.binding,
          p.intent,
          v.native.groups[0].provider_group_id,
        );
        assert.equal(m.bodyHash, digest(canonical(r.body)));
        assert.equal(m.labelHash, digest(f.pdf));
        assert.equal(m.labelBytes, f.pdf.length);
        assert.equal(m.customerRequestId, r.customerRequestId);
      }
      assert.ok(
        result.blockers.includes(
          "SOURCE_INTERVAL_AND_PROVIDER_TRUTH_NOT_QUALIFIED",
        ),
      );
      assert.ok(
        result.blockers.includes(
          "PROVIDER_ACCOUNT_EQUIVALENCE_AND_EXTERNAL_REFERENCES_UNQUALIFIED",
        ),
      );
      assert.ok(
        result.blockers.includes("CALLER_COPIES_REQUIRE_FRESH_NATIVE_JOINS"),
      );
      const encoded = JSON.stringify(result);
      assert.ok(!encoded.includes(f.pdf.toString("base64")));
      assert.ok(!encoded.includes(f.binding.customerNumber));
      assert.equal(Object.hasOwn(result, "verified"), false);
      v.members[0].tracking = "changed";
      v.account.company = "changed";
      v.native.blockers.length = 0;
      assert.equal(JSON.stringify(result), encoded);
      assert.deepEqual(compare(inputs(f)), result);
    });

test("US native carrier reader remains allowed but Platform refuses; no invented US join", async (t) => {
  const f = await setup(t, "US", "USD");
  assert.throws(() => inputs(f), { code: "CARRIER_PROVENANCE_REGION" });
});

test("native proposed lookup refuses actual outside-group shipment/tracking collisions and account ambiguity", async (t) => {
  const f = await setup(t);
  for (const patch of [
    { providerShipmentId: f.outsideShipmentId },
    { tracking: f.outsideTracking },
  ])
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.carrierOfflineMemberReview.reviewProposedReferencesInTransaction(
            f.actor,
            { ...proposal(f), ...patch },
          ),
        ),
      { code: "CARRIER_OFFLINE_REFERENCE_CONFLICT" },
    );
  const other = await setup(t, "CA", "CAD", false, {
    differentConfiguration: true,
  });
  assert.throws(() => inputs(other), {
    code: "CARRIER_OFFLINE_ACCOUNT_AMBIGUOUS",
  });
});

test("ordinary booking and manifest-promoted native references remain in checked scope", async (t) => {
  for (const options of [{ ordinary: true }, { promote: true }]) {
    const f = await setup(t, "CA", "CAD", false, options),
      v = inputs(f);
    compare(v);
    assert.equal(v.proposedReferences.references.bookings, 1);
    assert.equal(
      v.proposedReferences.references.promotedCopies,
      options.promote ? 1 : 0,
    );
    assert.throws(
      () =>
        f.app.database.transaction(() =>
          f.app.carrierOfflineMemberReview.reviewProposedReferencesInTransaction(
            f.actor,
            { ...proposal(f), tracking: f.outsideTracking },
          ),
        ),
      { code: "CARRIER_OFFLINE_REFERENCE_CONFLICT" },
    );
  }
});

test("full membership, exact native identity, custody, claims and transmission refuse even with rehashed copied facts", async (t) => {
  const f = await setup(t),
    original = inputs(f);
  compare(original);
  const cases: [string, (v: any) => void][] = [
    ["missing external", (v) => v.members.pop()],
    ["extra external", (v) => v.members.push(structuredClone(v.members[0]))],
    ["missing native", (v) => v.native.members.pop()],
    [
      "extra group",
      (v) => v.native.groups.push(structuredClone(v.native.groups[0])),
    ],
    ["missing platform sibling", (v) => v.platform.pop()],
    ["missing custody", (v) => v.custody.pop()],
    [
      "replacement",
      (v) => (v.native.preparations[0].intent.previousId = "old-booking"),
    ],
    ["later custody", (v) => (v.custody[0].shipment.state = "shipped")],
    ["coverage", (v) => (v.custody[0].history.coverage = 1)],
    ["custody lines", (v) => v.custody[0].allocations[0].quantity++],
    [
      "claim",
      (v) => {
        v.native.members[0].token = "retained-claim";
        v.native.members[0].started_at = 1;
      },
    ],
    [
      "group claim",
      (v) => {
        v.native.groups[0].token = "retained-claim";
        v.native.groups[0].started_at = 1;
      },
    ],
    ["transmitted group", (v) => (v.native.groups[0].state = "transmitted")],
    ["manifest", (v) => (v.native.groups[0].manifest_hash = "a".repeat(64))],
    ["inactive", (v) => (v.native.members[0].active = 0)],
    [
      "second unknown",
      (v) => {
        v.native.members.find((m: any) => m.booking_id !== f.bookingId).state =
          "unknown";
      },
    ],
    ["copied org", (v) => (v.native.orgId = "other-org")],
    [
      "US assertion",
      (v) => {
        v.native.region = "US";
        v.proposedReferences.region = "US";
      },
    ],
    ["changed account preimage", (v) => (v.account.contractId = "654321")],
    [
      "extra credential field",
      (v) => (v.account.clientSecret = "synthetic-not-a-credential"),
    ],
    [
      "configuration drift",
      (v) => (v.native.groups[0].configuration_hash = "b".repeat(64)),
    ],
    [
      "proposal swap",
      (v) => (v.proposedReferences.proposed.providerShipmentId = "OTHER_ID"),
    ],
    [
      "proposal tracking swap",
      (v) => (v.proposedReferences.proposed.tracking = "7777777777777777"),
    ],
    [
      "wrong target",
      (v) => (v.proposedReferences.proposed.bookingId = f.createdId),
    ],
    ["scope malformed", (v) => (v.proposedReferences.scopeHash = "bad")],
    ["removed scope blocker", (v) => v.proposedReferences.blockers.pop()],
    ["forged count", (v) => v.proposedReferences.references.distinct++],
    [
      "native sibling reference",
      (v) =>
        (v.native.members.find(
          (m: any) => m.state === "created",
        ).provider_shipment_id = "changed"),
    ],
  ];
  for (const [name, change] of cases) {
    await t.test(name, () => {
      const v = structuredClone(original);
      change(v);
      reseal(v);
      refused(v);
    });
  }
});

test("provider details, request references, duplicate proposed pair, full schema and PDF compare exactly", async (t) => {
  const f = await setup(t),
    original = inputs(f);
  compare(original);
  const cases: [string, (v: any) => void][] = [
    [
      "details group",
      (v) => (v.members[0].details.shipmentDetail.groupId = "wrong"),
    ],
    [
      "details tracking",
      (v) => (v.members[0].details.trackingPin = "5555555555555555"),
    ],
    [
      "detail status",
      (v) => (v.members[0].details.shipmentStatus = "transmitted"),
    ],
    ["request id", (v) => (v.members[0].customerRequestId = "other")],
    ["detail extra", (v) => (v.members[0].details.extra = true)],
    [
      "detail nested extension",
      (v) => (v.members[0].details.shipmentDetail.deliverySpec.options = []),
    ],
    [
      "body price/account",
      (v) =>
        (v.members[0].details.shipmentDetail.deliverySpec.settlementInfo.contractId =
          "111111"),
    ],
    [
      "replacement body destination",
      (v) =>
        (v.members[0].details.shipmentDetail.deliverySpec.destination.name =
          "Other"),
    ],
    ["external status", (v) => (v.members[0].status = "transmitted")],
    ["shipment malformed", (v) => (v.members[0].shipmentId = "../escape")],
    ["PDF hash", (v) => (v.members[0].label.sha256 = "f".repeat(64))],
    ["PDF size", (v) => v.members[0].label.bytes++],
    ["PDF noncanonical", (v) => (v.members[0].label.data += "=")],
    [
      "PDF malformed",
      (v) => {
        const b = Buffer.from("NOT A PDF");
        const e = v.members.find((e: any) => e.bookingId === f.bookingId);
        e.label = {
          encoding: "base64",
          bytes: b.length,
          sha256: digest(b),
          data: b.toString("base64"),
        };
      },
    ],
    [
      "same shipment distinct tracking",
      (v) => {
        const target = v.members.find((e: any) => e.bookingId === f.bookingId);
        target.shipmentId = v.members.find(
          (e: any) => e.bookingId !== f.bookingId,
        ).shipmentId;
        v.proposedReferences.proposed.providerShipmentId = target.shipmentId;
      },
    ],
    [
      "same tracking distinct shipment",
      (v) => {
        const target = v.members.find((e: any) => e.bookingId === f.bookingId);
        target.tracking = v.members.find(
          (e: any) => e.bookingId !== f.bookingId,
        ).tracking;
        target.details.trackingPin = target.tracking;
        v.proposedReferences.proposed.tracking = target.tracking;
      },
    ],
  ];
  for (const [name, change] of cases)
    await t.test(name, () => {
      const v = structuredClone(original);
      change(v);
      reseal(v);
      refused(v);
    });
});

test("Platform original receipts, all group lineage and exact events cannot be omitted or weakened by rehashing", async (t) => {
  const f = await setup(t),
    original = inputs(f);
  compare(original);
  const cases: [string, (v: any) => void][] = [
    [
      "whole history drift",
      (v) => (v.platform[0].history.hash = "b".repeat(64)),
    ],
    [
      "original result",
      (v) => (v.platform[0].commands[0].result.reviewHash = "b".repeat(64)),
    ],
    [
      "missing claim",
      (v) =>
        v.platform[0].audits.splice(
          v.platform[0].audits.findIndex((a: any) =>
            a.action.endsWith("claimed"),
          ),
          1,
        ),
    ],
    [
      "dropped group event",
      (v) =>
        v.platform[0].events.splice(
          v.platform[0].events.findIndex((e: any) =>
            e.type.endsWith("group.prepared"),
          ),
          1,
        ),
    ],
    [
      "extra event",
      (v) =>
        v.platform[0].events.push(structuredClone(v.platform[0].events[0])),
    ],
    [
      "actor lineage",
      (v) => {
        for (const p of v.platform) {
          const a = p.audits.find((a: any) =>
            a.action.endsWith("member.created"),
          );
          a.actorId = "other-actor";
        }
      },
    ],
    [
      "completed claim changed to reconcile",
      (v) => {
        for (const p of v.platform) {
          const a = p.audits.find((a: any) =>
            a.action.endsWith("member.claimed"),
          );
          a.detail.send = false;
          a.detailJson = canonical(a.detail);
        }
      },
    ],
    [
      "retained manifest claim",
      (v) => {
        for (const p of v.platform) {
          const a = p.audits.find((a: any) =>
            a.action.endsWith("member.claimed"),
          );
          a.action = "carrier.canada-post.manifest.claimed";
        }
      },
    ],
    [
      "unknown original payload claim",
      (v) =>
        (v.platform[0].commands[0].audit.detail.requestHash = "f".repeat(64)),
    ],
    ["removed blocker", (v) => v.platform[0].blockers.pop()],
  ];
  for (const [name, change] of cases)
    await t.test(name, () => {
      const v = structuredClone(original);
      change(v);
      reseal(v);
      refused(v);
    });
});

test("hostile proxies, revoked proxies and accessors execute no caller code at every input boundary", async (t) => {
  const f = await setup(t),
    original = inputs(f);
  compare(original);
  const positions: [string, (v: any, x: unknown) => unknown][] = [
    ["root", (_v, x) => x],
    ["native", (v, x) => ((v.native = x), v)],
    ["array", (v, x) => ((v.members = x), v)],
    ["member", (v, x) => ((v.members[0] = x), v)],
    ["account services", (v, x) => ((v.account.services = x), v)],
    ["PDF", (v, x) => ((v.members[0].label = x), v)],
    ["Platform receipt", (v, x) => ((v.platform[0].commands[0] = x), v)],
    ["custody", (v, x) => ((v.custody[0] = x), v)],
  ];
  for (const [name, put] of positions)
    await t.test(name, () => {
      let trapped = false;
      const proxy = new Proxy(
        {},
        {
          get() {
            trapped = true;
            throw Error("trap");
          },
          getPrototypeOf() {
            trapped = true;
            throw Error("trap");
          },
          ownKeys() {
            trapped = true;
            throw Error("trap");
          },
        },
      );
      refused(put(structuredClone(original), proxy));
      assert.equal(trapped, false);
      const revoked = Proxy.revocable([], {});
      revoked.revoke();
      refused(put(structuredClone(original), revoked.proxy));
      const getter = Object.defineProperty({}, "x", {
        enumerable: true,
        get() {
          trapped = true;
          throw Error("getter");
        },
      });
      refused(put(structuredClone(original), getter));
      assert.equal(trapped, false);
    });
});

test("bounded hostile bytes/depth/arrays/numbers/extras refuse without mutating inputs or native state", async (t) => {
  const f = await setup(t),
    original = inputs(f),
    before = changes(f);
  compare(original);
  const cases: [string, (v: any) => void][] = [
    [
      "oversize PDF before decode",
      (v) => (v.members[0].label.data = "A".repeat(limits.string + 1)),
    ],
    [
      "oversize declared PDF",
      (v) => (v.members[0].label.bytes = limits.pdfBytes + 1),
    ],
    ["wide array", (v) => (v.members = Array(4001).fill(null))],
    ["sparse array", (v) => (v.members = Array(2))],
    ["extra field", (v) => (v.native.extra = "unsupported")],
    [
      "unsafe integer",
      (v) =>
        (v.proposedReferences.references.members = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["negative zero", (v) => (v.native.version = -0)],
    ["nonfinite", (v) => (v.native.version = Infinity)],
    ["Buffer bytes", (v) => (v.members[0].label = Buffer.from("%PDF-"))],
    ["cycle", (v) => (v.cycle = v)],
    [
      "depth",
      (v) => {
        let x: any = {};
        v.extra = x;
        for (let i = 0; i < 25; i++) {
          x.child = {};
          x = x.child;
        }
      },
    ],
    [
      "nondata prototype",
      (v) => Object.setPrototypeOf(v.native, { inherited: true }),
    ],
    ["hidden field", (v) => Object.defineProperty(v, "hidden", { value: 1 })],
    ["symbol field", (v) => (v[Symbol("hidden")] = 1)],
    [
      "aggregate UTF8",
      (v) => (v.members = Array.from({ length: 20 }, () => "é".repeat(500000))),
    ],
  ];
  for (const [name, change] of cases)
    await t.test(name, () => {
      const v = structuredClone(original);
      change(v);
      refused(v);
    });
  assert.equal(changes(f), before);
  assert.deepEqual(compare(original), compare(inputs(f)));
});

test("native deposit configuration uses the existing fixed request/detail helper without pickup fallback", async (t) => {
  const f = await setup(t, "CA", "CAD", false, { deposit: true }),
    v = inputs(f);
  compare(v);
  v.members[0].details.cpcPickupIndicator = true;
  refused(v);
});

test("pure detached results survive native restart; copied facts cannot become a current-native or provider permit", async (t) => {
  const f = await setup(t),
    v = inputs(f),
    before = compare(v);
  f.app.close();
  assert.deepEqual(compare(v), before); // No DB/IO lookup hidden in the comparator.
  f.app = new Application(f.path);
  f.originalFixture.app = f.app;
  assert.deepEqual(compare(inputs(f)), before);
  const copied = structuredClone(v);
  copied.native.hold.snapshot_hash = "c".repeat(64);
  copied.proposedReferences.hold.snapshot_hash = "c".repeat(64);
  reseal(copied);
  const consistentCopy = compare(copied);
  assert.notEqual(consistentCopy.inputHash, before.inputHash);
  assert.ok(
    consistentCopy.blockers.includes(
      "CALLER_COPIES_REQUIRE_FRESH_NATIVE_JOINS",
    ),
  );
  assert.ok(
    consistentCopy.blockers.includes(
      "PRIVATE_CAPTURE_AND_QUALIFIED_COORDINATOR_REQUIRED",
    ),
  );
  assert.deepEqual(compare(inputs(f)), before); // Neither native hold nor durable history changed.
});

test("each temporary PDF decode is erased after success and failure; error never contains input bytes", async (t) => {
  const f = await setup(t),
    original = inputs(f),
    from = Buffer.from,
    captured: Buffer[] = [];
  Buffer.from = ((...args: unknown[]) => {
    const b = Reflect.apply(from, Buffer, args) as Buffer;
    if (args[1] === "base64") captured.push(b);
    return b;
  }) as typeof Buffer.from;
  try {
    compare(original);
    assert.equal(captured.length, 3);
    assert.ok(captured.every((b) => b.every((x) => x === 0)));
    captured.length = 0;
    const bad = structuredClone(original);
    bad.members.find((m: any) => m.bookingId === f.bookingId).label.sha256 =
      "f".repeat(64);
    refused(bad);
    assert.ok(captured.length >= 1);
    assert.ok(captured.every((b) => b.every((x) => x === 0)));
  } finally {
    Buffer.from = from;
  }
  assert.deepEqual(compare(original), compare(inputs(f)));
});

function coherentSiblingChange(
  original: any,
  f: F,
  kind: "origin" | "configuration",
) {
  let v = structuredClone(original);
  const prep = v.native.preparations.find(
    (p: any) => p.bookingId === f.bookingId,
  );
  const old = prep.intent.reviewHash;
  if (kind === "origin") prep.intent.origin.name = "Different retained origin";
  else
    prep.intent.configuration.accountHint =
      "Different retained display binding";
  const { bookingId, reviewHash, ...body } = prep.intent;
  const next = digest(canonical(body));
  v = JSON.parse(JSON.stringify(v).replaceAll(old, next));
  const changed = v.native.preparations.find(
    (p: any) => p.bookingId === f.bookingId,
  );
  const booking = v.native.bookingHistory.find(
    (b: any) => b.id === f.bookingId,
  );
  booking.intent = canonical(changed.intent);
  changed.intentHash = digest(booking.intent);
  const g = v.native.groups[0],
    oldGroup = g.review_hash;
  const nextGroup = digest(
    canonical({
      configurationHash: g.configuration_hash,
      providerGroupId: g.provider_group_id,
      warehouseId: g.warehouse_id,
      entries: v.native.orderedMembers,
    }),
  );
  v = JSON.parse(JSON.stringify(v).replaceAll(oldGroup, nextGroup));
  const intent = v.native.preparations.find(
    (p: any) => p.bookingId === f.bookingId,
  ).intent;
  const r = reviewCanadaPostShipment(
    f.binding,
    intent,
    v.native.groups[0].provider_group_id,
  );
  const e = v.members.find((m: any) => m.bookingId === f.bookingId);
  e.customerRequestId = r.customerRequestId;
  e.details.customerRequestId = r.customerRequestId;
  e.details.shipmentDetail.deliverySpec = structuredClone(r.body.deliverySpec);
  reseal(v);
  return v;
}
for (const kind of ["origin", "configuration"] as const)
  test(`coherently rehashed sibling ${kind} drift still violates the exact native group contract`, async (t) => {
    const f = await setup(t),
      v = inputs(f);
    compare(v);
    refused(coherentSiblingChange(v, f, kind));
  });
