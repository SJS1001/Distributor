import assert from "node:assert/strict";
import { setup, raw } from "./canada-post-fixture.ts";
import { client } from "./canada-post-creation-fixture.ts";
import { manifestClient } from "./canada-post-manifest-fixture.ts";
import { createHttp } from "../src/server/http.ts";

// An independent browser-only database. Synthetic aged claims represent an
// interrupted writer; actual paused callback fencing is verified in API tests.
export async function claimBrowser(after: (fn: () => void) => void) {
  const f = setup({ after }, 6, [
    {},
    {},
    {},
    {},
    { provider: "ups" },
    { provider: "ups" },
  ]);
  const member = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "claim-member",
    {
      configurationHash: f.input.configurationHash,
      entries: f.input.entries.slice(0, 2),
    },
  );
  const manifest = f.app.carriers.prepareCanadaPostGroup(
    f.actor,
    "claim-manifest",
    {
      configurationHash: f.input.configurationHash,
      entries: f.input.entries.slice(2, 3),
    },
  );
  await f.app.carriers.createCanadaPostMember(
    f.actor,
    manifest.id,
    f.input.entries[2]!.bookingId,
    client(),
  );
  const m = manifestClient();
  const identity = f.app.carriers.reviewCanadaPostManifest(
    f.actor,
    manifest.id,
    m,
  );
  m.transmitManifest = async (_input, guard) => {
    guard();
    throw Error("Synthetic lost manifest response");
  };
  await assert.rejects(
    f.app.carriers.transmitCanadaPostManifest(
      f.actor,
      manifest.id,
      identity.reviewHash,
      m,
    ),
    /Synthetic lost manifest response/,
  );
  const started = Date.now() - 240000;
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='creating' WHERE id=?",
    member.id,
  );
  raw(
    f,
    "UPDATE integration_canada_post_members SET state='creating',token='synthetic-member-interruption',started_at=? WHERE group_id=? AND booking_id=?",
    started,
    member.id,
    f.input.entries[0]!.bookingId,
  );
  raw(
    f,
    "UPDATE integration_canada_post_groups SET state='transmitting',token='synthetic-manifest-interruption',started_at=? WHERE id=?",
    started,
    manifest.id,
  );
  for (const i of [4, 5])
    raw(
      f,
      "UPDATE integration_carrier_bookings SET state='running',token=?,started_at=? WHERE id=?",
      `synthetic-booking-interruption-${i}`,
      started,
      f.input.entries[i]!.bookingId,
    );
  f.app.identity.createUser(f.actor, "claim-warehouse-reader", {
    email: "claim-warehouse@example.test",
    name: "Synthetic claim warehouse",
    role: "warehouse",
    sites: [f.w1],
    password: "long-test-only-password",
  });
  const http = await createHttp(f.app, { origin: "http://127.0.0.1:3121" });
  await http.listen({ host: "127.0.0.1", port: 3121 });
  return http;
}
