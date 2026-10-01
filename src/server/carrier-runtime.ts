import { check, permit, type Actor } from "./core.ts";
import type { Application } from "./application.ts";
import type { CarrierAdapter } from "./carrier-bookings.ts";
import { carrierNames, type CarrierName } from "../shared/carrier-booking.ts";

export type CarrierBinding = { orgId: string; adapter: CarrierAdapter };

// Explicit organization/provider registrations; dispatch follows the stored review.
// No environment setting or production bootstrap creates a carrier binding.
export class CarrierRuntime {
  private readonly bindings: readonly CarrierBinding[];
  constructor(
    private readonly app: Application,
    bindings: readonly CarrierBinding[],
  ) {
    check(
      Array.isArray(bindings) && bindings.length > 0,
      "CARRIER_CONFIG",
      "Explicit sandbox carrier registrations are required.",
      500,
    );
    const selected = new Set<string>();
    this.bindings = Object.freeze(
      Array.from(bindings, (binding) => {
        check(
          binding &&
            typeof binding.orgId === "string" &&
            binding.orgId.length > 0 &&
            binding.orgId.length <= 128 &&
            binding.orgId === binding.orgId.trim() &&
            !/[\u0000-\u001f\u007f]/.test(binding.orgId) &&
            binding.adapter &&
            carrierNames.includes(binding.adapter.provider) &&
            binding.adapter.sandbox === true &&
            typeof binding.adapter.book === "function" &&
            typeof binding.adapter.lookup === "function",
          "CARRIER_CONFIG",
          "A named sandbox carrier adapter is required.",
          500,
        );
        const key = JSON.stringify([binding.orgId, binding.adapter.provider]);
        check(
          !selected.has(key),
          "CARRIER_CONFIG",
          "Only one sandbox adapter may be registered for each organization and carrier.",
          500,
        );
        selected.add(key);
        // Capture identity and method handles, retaining the trusted adapter's receiver.
        return Object.freeze({
          orgId: binding.orgId,
          adapter: Object.freeze({
            provider: binding.adapter.provider,
            sandbox: true as const,
            book: binding.adapter.book.bind(binding.adapter),
            lookup: binding.adapter.lookup.bind(binding.adapter),
          }),
        });
      }),
    );
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
  private binding(actor: Actor, bookingId: string) {
    actor = this.principal(actor);
    const provider = this.app.carriers.providerForBooking(actor, bookingId);
    const binding = this.bindings.find(
      (binding) =>
        binding.orgId === actor.orgId && binding.adapter.provider === provider,
    );
    check(
      binding,
      "CARRIER_DISABLED",
      "No matching sandbox carrier adapter is configured for this organization and booking.",
      503,
    );
    return { actor, adapter: binding.adapter };
  }
  execute(actor: Actor, bookingId: string) {
    const current = this.binding(actor, bookingId);
    return this.app.carriers.execute(current.actor, bookingId, current.adapter);
  }
  reconcile(actor: Actor, bookingId: string) {
    const current = this.binding(actor, bookingId);
    return this.app.carriers.reconcile(
      current.actor,
      bookingId,
      current.adapter,
    );
  }
}
