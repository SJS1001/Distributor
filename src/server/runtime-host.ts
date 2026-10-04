import type {
  RestoreActivationAdapter,
  RestoreNativeDispositionConfiguration,
} from "./restore-activation.ts";
import type { RestoreApprover } from "./restore-review.ts";
import type { OfflineFailedRefundHost } from "./restore-offline-failed-refund-coordinator.ts";
import type { OfflineOriginalCancellationHost } from "./restore-offline-original-cancellation-coordinator.ts";
import type { OfflineOriginalLeaseRetirementHost } from "./restore-offline-original-lease-retirement-coordinator.ts";
import type { OfflineCanadaPostMemberHost } from "./restore-offline-canada-post-member-coordinator.ts";
import type { OfflineCheckoutPaidHost } from "./restore-offline-checkout-paid-coordinator.ts";
import type { Region } from "./iam.ts";

/** Trusted code composition, never caller evidence or a tenant setting.
 * Each process resolves its own current authority against the same deployment.
 * Implementations must retain the existing adapter/interlock guarantees; this
 * type and its installation do not establish infrastructure qualification. */
export type RestoreRuntimeConfiguration = Readonly<{
  version: 1;
  activation?: Readonly<{
    adapter: RestoreActivationAdapter;
    loadTrust(): RestoreApprover[];
  }>;
  nativeDispositions?: RestoreNativeDispositionConfiguration;
  offline?: Readonly<{
    failedRefund?: OfflineFailedRefundHost;
    originalCancellation?: OfflineOriginalCancellationHost;
    originalLeaseRetirement?: OfflineOriginalLeaseRetirementHost;
    canadaPostMember?: OfflineCanadaPostMemberHost;
    checkoutPaid?: OfflineCheckoutPaidHost;
  }>;
}>;

export type RestoreHostContext = Readonly<{
  databasePath: string;
  region: Region;
}>;
