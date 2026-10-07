import { check, integer, now, permit, text, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import { CUSTOMER_MINIMUM_ORDER_INITIALIZE } from "./customer-minimum-order-schema.ts";
import type {
  CustomerMinimumOrder,
  SaveCustomerMinimumOrder,
} from "../shared/customer-minimum-order.ts";
export class CustomerMinimumOrders {
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
  ) {
    this.store = database.owned("iam");
    this.store.migrate(CUSTOMER_MINIMUM_ORDER_INITIALIZE);
  }
  get(actor: Actor, accountId: string): CustomerMinimumOrder {
    return this.database.transaction(() => this.current(actor, accountId));
  }
  /** Current scoped policy inside the caller's native command transaction. */
  current(actor: Actor, accountId: string): CustomerMinimumOrder {
    this.database.requireTransaction();
    actor = this.identity.currentActor(actor);
    check(
      text(accountId, "Customer", 128) === accountId,
      "VALIDATION",
      "Use the exact customer ID.",
      400,
    );
    const customer = this.identity.customer(actor, accountId);
    const row = this.store.get<{
      minimumSubtotal: number;
      minimumEquipmentQuantity: number;
      revision: number;
      updatedAt: string;
      updatedBy: string;
    }>(
      "SELECT minimum_subtotal AS minimumSubtotal,minimum_equipment_quantity AS minimumEquipmentQuantity,revision,updated_at AS updatedAt,updated_by AS updatedBy FROM iam_customer_minimum_orders WHERE org_id=? AND account_id=?",
      actor.orgId,
      accountId,
    );
    return {
      accountId,
      currency: customer.currency,
      minimumSubtotal: 0,
      minimumEquipmentQuantity: 0,
      revision: 0,
      updatedAt: null,
      updatedBy: null,
      ...row,
      canManage: ["admin", "commercial"].includes(actor.role),
    };
  }
  save(
    actor: Actor,
    key: string,
    input: SaveCustomerMinimumOrder,
  ): CustomerMinimumOrder {
    return this.platform.command(
      actor,
      "account.minimum-order.save",
      key,
      input,
      () => {
        actor = this.identity.currentActor(actor);
        permit(actor, ["commercial"]);
        this.identity.customer(actor, input.accountId);
      },
      () => {
        const previous = this.current(actor, input.accountId);
        check(
          integer(input.expectedRevision, "Minimum order revision", 0, 1e9) ===
            previous.revision,
          "STALE_VERSION",
          "Customer minimum order changed. Reload before editing.",
          409,
        );
        const minimumSubtotal = integer(
          input.minimumSubtotal,
          "Minimum merchandise subtotal",
          0,
          1e12,
        );
        const minimumEquipmentQuantity = integer(
          input.minimumEquipmentQuantity,
          "Minimum equipment quantity",
          0,
          100000,
        );
        const reason = text(input.reason, "Minimum order reason", 1000),
          at = now();
        this.store.run(
          "INSERT INTO iam_customer_minimum_orders VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id,account_id) DO UPDATE SET minimum_subtotal=excluded.minimum_subtotal,minimum_equipment_quantity=excluded.minimum_equipment_quantity,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
          actor.orgId,
          input.accountId,
          minimumSubtotal,
          minimumEquipmentQuantity,
          previous.revision + 1,
          at,
          actor.id,
        );
        const policy = this.current(actor, input.accountId);
        this.platform.audit(
          actor,
          "account.minimum-order.saved",
          input.accountId,
          { previous, policy, reason },
        );
        return policy;
      },
    );
  }
}
