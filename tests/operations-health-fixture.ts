import type { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";

export const oldest = "2020-01-02T03:04:05.000Z";
export function seedOperationsHealth(app: Application, actor: Actor) {
  const store = app.database.owned("integration");
  for (let i = 0; i < 35; i++)
    store.run(
      "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,created_at,residency_version) VALUES(?,?,?,?,?,?,?,?,?,1)",
      `health-effect-${i}`,
      actor.orgId,
      "PRIVATE-ACCOUNT",
      "stripe",
      "checkout",
      `PRIVATE-REF-${i}`,
      '{"private":"PRIVATE-PAYLOAD"}',
      "pending",
      oldest,
    );
  store.run(
    "UPDATE integration_effects SET state='unknown',error='PRIVATE-ERROR' WHERE id='health-effect-34'",
  );
  for (const [provider, state] of [
    ["quickbooks", "blocked"],
    ["unrecognized", "rejected"],
    ["stripe", "completed"],
  ])
    store.run(
      "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,result,created_at,residency_version) VALUES(?,?,?,?,?,?,?,?,?,?,1)",
      `health-${provider}`,
      actor.orgId,
      "PRIVATE-ACCOUNT",
      provider!,
      "refund",
      "PRIVATE-REFERENCE",
      "{}",
      state!,
      '{"status":"requires_action","reference":"PRIVATE-RESULT"}',
      oldest,
    );
  store.run(
    "INSERT INTO integration_refund_polls(effect_id,org_id,retry_at) VALUES('health-stripe',?,0)",
    actor.orgId,
  );
  for (const [i, state, retry] of [
    [0, "pending", 0],
    [1, "waiting", Date.now() + 86400000],
    [2, "failed", 0],
    [3, "processing", 0],
  ] as const) {
    store.run(
      "INSERT INTO integration_callbacks(id,org_id,binding_id,event_id,session_id,effect_id,hash,state,retry_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      `health-callback-${i}`,
      actor.orgId,
      "PRIVATE-BINDING",
      `PRIVATE-EVENT-${i}`,
      "PRIVATE-SESSION",
      "health-stripe",
      "PRIVATE-HASH",
      state,
      retry,
      oldest,
    );
    store.run(
      "INSERT INTO integration_refund_callbacks(id,org_id,binding_id,event_id,effect_id,provider_reference,event_type,hash,state,retry_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      `health-refund-callback-${i}`,
      actor.orgId,
      "PRIVATE-BINDING",
      `PRIVATE-EVENT-${i}`,
      "health-stripe",
      "PRIVATE-REFERENCE",
      "refund.updated",
      "PRIVATE-HASH",
      state,
      retry,
      oldest,
    );
  }
  store.run(
    "INSERT INTO integration_carrier_bookings(id,org_id,shipment_id,state,review_hash,intent,token,started_at,created_at) VALUES('health-carrier',?,'PRIVATE-SHIPMENT','unknown','PRIVATE-HASH','PRIVATE-ADDRESS','PRIVATE-TOKEN',0,?)",
    actor.orgId,
    oldest,
  );
  store.run(
    "INSERT INTO integration_canada_post_groups(id,org_id,warehouse_id,configuration_hash,provider_group_id,review_hash,state,created_at) VALUES('health-group',?,'PRIVATE-WAREHOUSE','PRIVATE-HASH','PRIVATE-GROUP','PRIVATE-HASH','unknown',?)",
    actor.orgId,
    oldest,
  );
  store.run(
    "INSERT INTO integration_canada_post_members(group_id,booking_id,org_id,review_hash,active,state) VALUES('health-group','health-carrier',?,'PRIVATE-HASH',1,'unknown')",
    actor.orgId,
  );
  app.database
    .owned("billing")
    .run(
      "INSERT INTO billing_refunds(id,org_id,invoice_id,payment_id,amount,reference,state,created_at) VALUES('health-refund',?,'PRIVATE-INVOICE','PRIVATE-PAYMENT',1,'PRIVATE-REFUND','unknown',?)",
      actor.orgId,
      oldest,
    );
  for (let i = 0; i < 4; i++)
    app.database.transaction(() =>
      app.platform.event(actor, "SyntheticHealthFact", `health-fact-${i}`, {
        note: "PRIVATE-EVENT-PAYLOAD",
      }),
    );
  const platform = app.database.owned("platform");
  const events = platform.all<{ id: string }>(
    "SELECT id FROM platform_events WHERE org_id=? ORDER BY rowid LIMIT 4",
    actor.orgId,
  );
  const states = ["quarantined", "retry", "leased", "completed"];
  events.forEach(({ id }, i) =>
    platform.run(
      "INSERT INTO platform_deliveries(consumer_id,event_id,org_id,consumer_version,state,attempts,cycle_attempts,revision,lease_token,lease_until,available_at,created_at,updated_at,completed_at) VALUES('event-report',?,?,1,?,1,1,1,?,?,0,?,?,?) ON CONFLICT(consumer_id,event_id) DO UPDATE SET state=excluded.state,lease_token=excluded.lease_token,lease_until=excluded.lease_until,available_at=excluded.available_at,created_at=excluded.created_at,updated_at=excluded.updated_at,completed_at=excluded.completed_at",
      id,
      actor.orgId,
      states[i]!,
      i === 2 ? "PRIVATE-LEASE" : null,
      i === 2 ? 0 : null,
      oldest,
      oldest,
      i === 3 ? oldest : null,
    ),
  );
  // Foreign organization rows must never increase any local observation.
  store.run(
    "INSERT INTO integration_effects(id,org_id,account_id,provider,kind,reference,payload,state,created_at,residency_version) VALUES('health-foreign','foreign-org','PRIVATE-FOREIGN','stripe','checkout','foreign','{}','pending',?,1)",
    "1990-01-01T00:00:00.000Z",
  );
}
