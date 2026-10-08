# Architecture and integration review — 2026-10-07

## Reviewed structure

Baseline `6471e00f5128fc0d85487a8ff81813342b855c57`; final source and verification are identified in the integration register. This review covers the modular application, database ownership fence, HTTP task boundaries, durable command recovery and the changed workflow composition. It does not establish capacity or infrastructure qualification.

The application remains a modular monolith. `application.ts` composes identity, catalog, inventory, procurement, orders, fulfillment, billing, warranty and integration owners. Cross-module work uses explicit operations and callbacks. `database.ts` installs a SQLite authorizer that rejects access to other owners' tables, disallows owner-scoped transaction escapes and requires synchronous native transactions. Business transactions use `BEGIN IMMEDIATE`, foreign keys and full synchronous persistence. HTTP commands enter named operations; browser visibility does not confer authority.

The new warranty-custody fence is a task-shaped callback from inventory into warranty, within the existing stock transaction. Inventory does not query warranty tables. The repaired-original handover changes custody, claim disposition and immutable receipt atomically, preserves the original warranty entitlement, and integrates with inventory costing and reconciliation. No generic CRUD or new event-bus dependency was added. Independent review found and corrected the initially missing cost-movement classification.

Login admission uses the existing identity-owned durable table. Independent review reproduced a two-connection capacity race and required atomic account-slot reservation plus capacity enforcement when recording the eventual password failure. This is an example of why single-request tests cannot establish concurrency correctness.

Customer editors separate current reads, reviewed draft revisions and retained uncertain commands. Workspace Refresh advances reads; it must not replace a reviewed revision or invent a new operation after a lost reply. Reload recovery must restore a readable frozen form from the retained exact request and recheck current authority. The pricing reload defect was found during integration rather than assumed covered by the earlier refresh checks.

## Maintainability and operational limits

`main.tsx` is approximately 9,800 lines and `http.ts` approximately 5,200 lines in this candidate. These large composition boundaries increase review and change risk. Shared controls, task tabs, separate feature components, shared contracts and enforced backend ownership provide useful structure, but this review does not rate the implementation's maintainability as ideal. Future extraction should move complete feature boundaries with their existing recovery and authorization tests, rather than spreading generic helpers across owners. A large rewrite is not required to correct the reproduced defects in this iteration.

React Doctor reports maintainability advisories, including complexity, effect dependencies and component size. Those are review inputs, not a product quality score. Meaningful draft, revision, authorization-loss, reload and lost-response checks are used to challenge the changed effects. The integration receipt records the final diagnostic result and any unresolved findings.

SQLite's single-writer model and synchronous password hashing need workload-specific capacity measurements before scaling claims. The new admission bound limits hashing abuse; it does not replace upstream traffic controls or qualify production throughput. Actual hardware, scanners/printers, payment/accounting/carrier providers, regional residency, backups and operational approvals require separate environment evidence. This local review neither verifies those gates nor authorizes deployment.
