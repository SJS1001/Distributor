import { check, permit, site, type Actor } from "./core.ts";
import { captureCarrierConfiguration } from "./carrier-configuration.ts";
import type { Application } from "./application.ts";
import type {
  CarrierAdapter,
  CanadaPostCreationClient,
  CanadaPostManifestClient,
} from "./carrier-bookings.ts";
import {
  carrierNames,
  type CarrierName,
  type CarrierPrepare,
  type CarrierConfiguration,
} from "../shared/carrier-booking.ts";

export type CarrierBinding = {
  orgId: string;
  warehouseId?: string;
  adapter: CarrierAdapter;
};
export type CanadaPostBinding = {
  orgId: string;
  warehouseId: string;
  client: CanadaPostCreationClient & CanadaPostManifestClient;
};

// Explicit organization/provider registrations; dispatch follows the stored review.
// Startup registrations remain separately opt-in and sandbox-only.
export class CarrierRuntime {
  private readonly bindings: readonly CarrierBinding[];
  private readonly canadaPost: readonly CanadaPostBinding[];
  constructor(
    private readonly app: Application,
    bindings: readonly CarrierBinding[],
    canadaPost: readonly CanadaPostBinding[] = [],
  ) {
    check(
      Array.isArray(bindings) &&
        Array.isArray(canadaPost) &&
        bindings.length + canadaPost.length > 0,
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
        if (binding.warehouseId !== undefined) {
          check(
            typeof binding.warehouseId === "string" &&
              binding.warehouseId.length > 0 &&
              binding.warehouseId.length <= 128 &&
              binding.warehouseId === binding.warehouseId.trim() &&
              !/[\u0000-\u001f\u007f]/.test(binding.warehouseId),
            "CARRIER_CONFIG",
            "Supply an exact carrier warehouse identity.",
            500,
          );
          app.inventory.configurationWarehouse(
            binding.orgId,
            binding.warehouseId,
          );
        }
        const key = JSON.stringify([
          binding.orgId,
          binding.adapter.provider,
          binding.warehouseId ?? null,
        ]);
        check(
          !selected.has(key),
          "CARRIER_CONFIG",
          "Only one sandbox adapter may be registered for each organization, carrier and warehouse.",
          500,
        );
        check(
          !bindings.some(
            (other) =>
              other &&
              other !== binding &&
              other.orgId === binding.orgId &&
              other.adapter?.provider === binding.adapter.provider &&
              (other.warehouseId === undefined) !==
                (binding.warehouseId === undefined),
          ),
          "CARRIER_CONFIG",
          "Choose organization-wide or warehouse-specific bindings for each carrier without mixing them.",
          500,
        );
        selected.add(key);
        // Capture identity and method handles, retaining the trusted adapter's receiver.
        return Object.freeze({
          orgId: binding.orgId,
          ...(binding.warehouseId === undefined
            ? {}
            : { warehouseId: binding.warehouseId }),
          adapter: Object.freeze({
            provider: binding.adapter.provider,
            sandbox: true as const,
            book: binding.adapter.book.bind(binding.adapter),
            lookup: binding.adapter.lookup.bind(binding.adapter),
            ...(binding.adapter.configuration !== undefined
              ? {
                  configuration: captureCarrierConfiguration(
                    binding.adapter.configuration,
                    binding.adapter.provider,
                  ),
                }
              : {}),
          }),
        });
      }),
    );
    const groups = new Set<string>();
    const identifier = (v: unknown) =>
      typeof v === "string" &&
      v.length > 0 &&
      v.length <= 128 &&
      v === v.trim() &&
      !/[\u0000-\u001f\u007f]/.test(v);
    this.canadaPost = Object.freeze(
      Array.from(canadaPost, (binding) => {
        check(
          binding &&
            identifier(binding.orgId) &&
            identifier(binding.warehouseId) &&
            binding.client?.testApplication === true &&
            /^[a-f0-9]{64}$/.test(binding.client.configurationHash) &&
            [
              "create",
              "lookup",
              "manifestIdentity",
              "transmitManifest",
              "recoverManifest",
            ].every(
              (method) =>
                typeof binding.client[method as keyof typeof binding.client] ===
                "function",
            ),
          "CARRIER_CONFIG",
          "Supply an explicit Canada Post test client for one organization and warehouse.",
          500,
        );
        const key = JSON.stringify([binding.orgId, binding.warehouseId]);
        check(
          !groups.has(key),
          "CARRIER_CONFIG",
          "Only one Canada Post test client may be registered per organization and warehouse.",
          500,
        );
        groups.add(key);
        return Object.freeze({
          orgId: binding.orgId,
          warehouseId: binding.warehouseId,
          client: Object.freeze({
            testApplication: true as const,
            configurationHash: binding.client.configurationHash,
            create: binding.client.create.bind(binding.client),
            lookup: binding.client.lookup.bind(binding.client),
            manifestIdentity: binding.client.manifestIdentity.bind(
              binding.client,
            ),
            transmitManifest: binding.client.transmitManifest.bind(
              binding.client,
            ),
            recoverManifest: binding.client.recoverManifest.bind(
              binding.client,
            ),
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
  private warehouse(actor: Actor, warehouseId: string | undefined) {
    if (warehouseId !== undefined) {
      site(actor, warehouseId);
      this.app.inventory.warehouse(actor, warehouseId);
    }
  }
  private matching(
    actor: Actor,
    provider: CarrierName,
    warehouseId: string | undefined,
  ) {
    return this.bindings.find(
      (binding) =>
        binding.orgId === actor.orgId &&
        binding.adapter.provider === provider &&
        (binding.warehouseId === undefined ||
          binding.warehouseId === warehouseId),
    );
  }
  enabled(actor: Actor, provider: CarrierName, warehouseId?: string) {
    actor = this.principal(actor);
    this.warehouse(actor, warehouseId);
    if (provider === "canada-post") return false; // Grouped processing never uses individual dispatch.
    return this.matching(actor, provider, warehouseId) !== undefined;
  }
  configurations(
    actor: Actor,
    warehouseId?: string,
  ): readonly CarrierConfiguration[] {
    actor = this.principal(actor);
    this.warehouse(actor, warehouseId);
    return this.bindings
      .filter(
        (b) =>
          b.orgId === actor.orgId &&
          b.adapter.provider !== "canada-post" &&
          (b.warehouseId === undefined || b.warehouseId === warehouseId),
      )
      .flatMap((b) =>
        b.adapter.configuration
          ? [structuredClone(b.adapter.configuration)]
          : [],
      );
  }
  prepare(actor: Actor, key: string, input: CarrierPrepare) {
    actor = this.principal(actor);
    const warehouseId = this.app.carriers.warehouseForPreparation(actor, input);
    const binding = this.matching(actor, input.provider, warehouseId);
    check(
      binding ||
        !this.bindings.some(
          (b) =>
            b.orgId === actor.orgId && b.adapter.provider === input.provider,
        ),
      "CARRIER_DISABLED",
      "No carrier account is configured for this warehouse.",
      503,
    );
    return this.app.carriers.prepare(
      actor,
      key,
      input,
      binding?.adapter.configuration,
    );
  }
  private binding(actor: Actor, bookingId: string) {
    actor = this.principal(actor);
    const provider = this.app.carriers.providerForBooking(actor, bookingId);
    check(
      provider !== "canada-post",
      "CARRIER_DISABLED",
      "Canada Post requires reviewed grouped shipping.",
      503,
    );
    const warehouseId = this.app.carriers.warehouseForBooking(actor, bookingId);
    const binding = this.matching(actor, provider, warehouseId);
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
  canadaPostEnabled(actor: Actor, warehouseId: string) {
    actor = this.principal(actor);
    site(actor, warehouseId);
    this.app.inventory.warehouse(actor, warehouseId);
    return this.canadaPost.some(
      (b) => b.orgId === actor.orgId && b.warehouseId === warehouseId,
    );
  }
  private canadaPostBinding(actor: Actor, warehouseId: string) {
    actor = this.principal(actor);
    site(actor, warehouseId);
    this.app.inventory.warehouse(actor, warehouseId);
    const binding = this.canadaPost.find(
      (b) => b.orgId === actor.orgId && b.warehouseId === warehouseId,
    );
    check(
      binding,
      "CARRIER_DISABLED",
      "No Canada Post test client is configured for this organization and warehouse.",
      503,
    );
    return { actor, client: binding.client };
  }
  private groupBinding(actor: Actor, groupId: string) {
    const review = this.app.carriers.reviewCanadaPostGroup(actor, groupId);
    const current = this.canadaPostBinding(actor, review.warehouseId);
    check(
      current.client.configurationHash === review.configurationHash,
      "CARRIER_MISMATCH",
      "The Canada Post group uses a different reviewed configuration.",
    );
    return current;
  }
  prepareCanadaPostGroup(
    actor: Actor,
    key: string,
    input: {
      warehouseId: string;
      entries: readonly { bookingId: string; reviewHash: string }[];
    },
  ) {
    const current = this.canadaPostBinding(actor, input.warehouseId);
    check(
      Array.isArray(input.entries) &&
        input.entries.length >= 1 &&
        input.entries.length <= 100,
      "CARRIER_MISMATCH",
      "Select one to one hundred reviewed bookings.",
    );
    for (const entry of input.entries)
      check(
        this.app.carriers.canadaPostBookingWarehouse(
          current.actor,
          entry.bookingId,
        ) === input.warehouseId,
        "CARRIER_MISMATCH",
        "Every selected booking must belong to the configured warehouse.",
      );
    return this.app.carriers.prepareCanadaPostGroup(current.actor, key, {
      configurationHash: current.client.configurationHash,
      entries: input.entries,
    });
  }
  createCanadaPostMember(actor: Actor, groupId: string, bookingId: string) {
    const current = this.groupBinding(actor, groupId);
    return this.app.carriers.createCanadaPostMember(
      current.actor,
      groupId,
      bookingId,
      current.client,
    );
  }
  reconcileCanadaPostMember(actor: Actor, groupId: string, bookingId: string) {
    const current = this.groupBinding(actor, groupId);
    return this.app.carriers.reconcileCanadaPostMember(
      current.actor,
      groupId,
      bookingId,
      current.client,
    );
  }
  reviewCanadaPostManifest(actor: Actor, groupId: string) {
    const current = this.groupBinding(actor, groupId);
    return this.app.carriers.reviewCanadaPostManifest(
      current.actor,
      groupId,
      current.client,
    );
  }
  transmitCanadaPostManifest(
    actor: Actor,
    groupId: string,
    reviewHash: string,
  ) {
    const current = this.groupBinding(actor, groupId);
    return this.app.carriers.transmitCanadaPostManifest(
      current.actor,
      groupId,
      reviewHash,
      current.client,
    );
  }
  reconcileCanadaPostManifest(
    actor: Actor,
    groupId: string,
    reviewHash: string,
  ) {
    const current = this.groupBinding(actor, groupId);
    return this.app.carriers.reconcileCanadaPostManifest(
      current.actor,
      groupId,
      reviewHash,
      current.client,
    );
  }
}
