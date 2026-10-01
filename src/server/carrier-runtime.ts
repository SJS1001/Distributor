import { check, permit, type Actor } from "./core.ts";
import type { Application } from "./application.ts";
import type { CarrierAdapter } from "./carrier-bookings.ts";
import { carrierNames, type CarrierName } from "../shared/carrier-booking.ts";

export type CarrierBinding = { orgId: string; adapter: CarrierAdapter };

// One explicitly selected sandbox carrier per organization in this initial runtime.
// No environment setting or production bootstrap creates a carrier binding.
export class CarrierRuntime {
  private readonly bindings: CarrierBinding[];
  constructor(
    private readonly app: Application,
    bindings: CarrierBinding[],
  ) {
    check(
      bindings.length > 0 &&
        new Set(bindings.map((binding) => binding.orgId)).size ===
          bindings.length,
      "CARRIER_CONFIG",
      "Select one sandbox carrier per organization.",
      500,
    );
    this.bindings = bindings.map((binding) => {
      check(
        typeof binding.orgId === "string" &&
          binding.orgId.length > 0 &&
          carrierNames.includes(binding.adapter.provider) &&
          binding.adapter.sandbox === true &&
          typeof binding.adapter.book === "function" &&
          typeof binding.adapter.lookup === "function",
        "CARRIER_CONFIG",
        "A named sandbox carrier adapter is required.",
        500,
      );
      return { ...binding };
    });
  }
  private principal(actor: Actor) {
    actor = this.app.identity.currentActor(actor);
    permit(actor, ["warehouse"]);
    check(
      !this.app.identity.security(actor).passwordChangeRequired,
      "PASSWORD_CHANGE_REQUIRED",
      "Change your password before reviewing carrier bookings.",
      403,
    );
    return actor;
  }
  enabled(actor: Actor, provider: CarrierName) {
    actor = this.principal(actor);
    return this.bindings.some(
      (binding) =>
        binding.orgId === actor.orgId && binding.adapter.provider === provider,
    );
  }
  private binding(actor: Actor) {
    actor = this.principal(actor);
    const binding = this.bindings.find(
      (binding) => binding.orgId === actor.orgId,
    );
    check(
      binding,
      "CARRIER_DISABLED",
      "No qualified carrier adapter is configured for this organization.",
      503,
    );
    return { actor, adapter: binding.adapter };
  }
  execute(actor: Actor, bookingId: string) {
    const current = this.binding(actor);
    return this.app.carriers.execute(current.actor, bookingId, current.adapter);
  }
  reconcile(actor: Actor, bookingId: string) {
    const current = this.binding(actor);
    return this.app.carriers.reconcile(
      current.actor,
      bookingId,
      current.adapter,
    );
  }
}
