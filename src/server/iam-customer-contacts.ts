import { check, id, integer, now, permit, text, type Actor } from "./core.ts";
import type { Database, Store } from "./database.ts";
import type { Identity } from "./iam.ts";
import type { Platform } from "./platform.ts";
import { CUSTOMER_CONTACTS_INITIALIZE } from "./customer-contacts-schema.ts";
import type {
  CustomerContact,
  CustomerContacts,
  SaveCustomerContact,
} from "../shared/customer-record.ts";
const fields =
  "id,account_id AS accountId,name,title,email,phone,archived,revision,created_at AS createdAt,created_by AS createdBy,updated_at AS updatedAt,updated_by AS updatedBy";
type ContactRow = Omit<CustomerContact, "archived"> & { archived: number };
const view = (row: ContactRow): CustomerContact => ({
  ...row,
  archived: !!row.archived,
});
export class CustomerContactsModule {
  private store: Store;
  constructor(
    private database: Database,
    private platform: Platform,
    private identity: Identity,
  ) {
    this.store = database.owned("iam");
    this.store.migrate(CUSTOMER_CONTACTS_INITIALIZE);
  }
  private reader(actor: Actor, accountId: string, write = false) {
    actor = this.identity.currentActor(actor);
    permit(
      actor,
      write
        ? ["commercial", "finance", "support"]
        : ["commercial", "finance", "support", "warehouse", "warranty"],
    );
    check(
      text(accountId, "Customer", 128) === accountId,
      "VALIDATION",
      "Use the exact customer ID.",
      400,
    );
    this.identity.customer(actor, accountId);
    return actor;
  }
  list(actor: Actor, accountId: string): CustomerContacts {
    return this.database.transaction(() => {
      actor = this.reader(actor, accountId);
      return {
        items: this.store
          .all<ContactRow>(
            `SELECT ${fields} FROM iam_customer_contacts WHERE org_id=? AND account_id=? ORDER BY updated_at DESC,id DESC LIMIT 100`,
            actor.orgId,
            accountId,
          )
          .map(view),
        canManage: ["admin", "commercial", "finance", "support"].includes(
          actor.role,
        ),
      };
    });
  }
  save(actor: Actor, key: string, input: SaveCustomerContact): CustomerContact {
    return this.platform.command(
      actor,
      "account.contact.save",
      key,
      input,
      () => {
        actor = this.reader(actor, input.accountId, true);
        if (input.contactId !== undefined)
          this.contact(actor, input.accountId, input.contactId);
      },
      () => {
        const previous =
          input.contactId === undefined
            ? null
            : this.contact(actor, input.accountId, input.contactId);
        check(
          integer(input.expectedRevision, "Contact revision", 0, 1e9) ===
            (previous?.revision ?? 0),
          "STALE_VERSION",
          "Contact changed. Reload before editing.",
          409,
        );
        check(
          typeof input.archived === "boolean",
          "VALIDATION",
          "Choose the contact archive status.",
          400,
        );
        const optional = (value: string, label: string, max: number) => {
          check(
            typeof value === "string" && value.length <= max,
            "VALIDATION",
            `${label} must be at most ${max} characters.`,
            400,
          );
          return value.trim();
        };
        const email = optional(input.email, "Email", 254);
        check(
          !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
          "VALIDATION",
          "Enter a valid contact email or leave it empty.",
          400,
        );
        if (!previous)
          check(
            this.store.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM iam_customer_contacts WHERE org_id=? AND account_id=?",
              actor.orgId,
              input.accountId,
            )!.n < 100,
            "CONTACT_LIMIT",
            "This customer already has 100 contact records, including archived contacts. Edit an existing record.",
            409,
          );
        const at = now();
        const contact: CustomerContact = {
          id: previous?.id ?? id(),
          accountId: input.accountId,
          name: text(input.name, "Contact name", 200),
          title: optional(input.title, "Title", 200),
          email,
          phone: optional(input.phone, "Phone", 80),
          archived: input.archived,
          revision: (previous?.revision ?? 0) + 1,
          createdAt: previous?.createdAt ?? at,
          createdBy: previous?.createdBy ?? actor.id,
          updatedAt: at,
          updatedBy: actor.id,
        };
        this.store.run(
          "INSERT INTO iam_customer_contacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,title=excluded.title,email=excluded.email,phone=excluded.phone,archived=excluded.archived,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
          contact.id,
          actor.orgId,
          contact.accountId,
          contact.name,
          contact.title,
          contact.email,
          contact.phone,
          Number(contact.archived),
          contact.revision,
          contact.createdAt,
          contact.createdBy,
          contact.updatedAt,
          contact.updatedBy,
        );
        this.platform.audit(actor, "account.contact.saved", contact.id, {
          accountId: input.accountId,
          previous,
          contact,
        });
        return contact;
      },
    );
  }
  private contact(
    actor: Actor,
    accountId: string,
    contactId: string,
  ): CustomerContact {
    const row = this.store.get<ContactRow>(
      `SELECT ${fields} FROM iam_customer_contacts WHERE org_id=? AND account_id=? AND id=?`,
      actor.orgId,
      accountId,
      text(contactId, "Contact", 128),
    );
    check(row, "NOT_FOUND", "Contact not found for this customer.", 404);
    return view(row);
  }
}
