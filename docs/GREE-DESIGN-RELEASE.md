# GREE website and workspace redesign

Owner request (5 October 2026): use Gree.ca as the visual and product reference;
owner confirms permission to reuse the materials. Continue on the real Canadian
pilot, retaining buyer entitlement and distributor order approval.

This is an implementation follow-up to D-012 catalog and D-020
buyer portal surfaces in the project plan; it does not independently verify product
gates. See the authoritative task definitions in [TASKS.md](TASKS.md).

| Deliverable                                                       | State                              | Evidence                                                         |
| ----------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Official public product inventory and document links              | Live; local and live checks passed | [Catalog provenance](catalog/GREE-CA-CATALOG.md)                 |
| Public equipment website and separate access entrances            | Live; local and live checks passed | Public browser journey                                           |
| Product search, categories, model details, gallery, document tabs | Live; local and live checks passed | Manufacturer library browser journey                             |
| Customer and admin visual integration                             | Live; local and live checks passed | Storefront journey and screenshot review                         |
| Global product hiding, stock badge and expected date              | Live; local and live checks passed | Native availability and browser roundtrip                        |
| Canadian pilot publication                                        | Live                               | [Release receipt](evidence/LIVE-GREE-AVAILABILITY-2026-10-05.md) |

The full manufacturer library is public reference content. Prices, stock,
purchase permissions and order approval continue to come from native account
and inventory commands. An image, product document or link never grants ordering
permission. The older fictional sample equipment is preserved rather than mapped
to incompatible models from the new source. Staff can maintain that saleable
catalog through the existing product/image/document controls.

The public catalog is a dated snapshot, refreshed with the checked-in importer.
The full data bundle loads only when the library is opened. Published image URLs
are limited to Shopify's CDN by the server image policy. No manufacturer price,
stock or availability claim is imported. Public PDF links open the official file;
protected professional portal documents are not included.

Global availability applies to native saleable products across every account. Hiding
blocks new purchases and customer resource access, including stale quotes and staff
orders on behalf of customers. Existing orders remain historical facts. Stock badges
and expected dates are advisory and do not alter inventory or allocations. Restoring
visibility does not grant customer entitlements. Administrator changes require a
reason and matching revision and are audited. Schema26 adds one empty Catalog-owned
table through an explicit fresh-clone migration.
