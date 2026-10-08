# Standalone Distributor platform — buildout tasks

Prepared 2026-10-08. Status: proposed work, not implemented or release-qualified.

Owner direction: create an independent product where distributors and buyer companies can onboard themselves. Preserve the published dstrbtr.ca demo for its existing audience. Eventually migrate that distributor into the platform as a subscriber company, preserving its buyer relationships. This plan does not authorize provisioning, purchases, deployment or migration.

## Starting point and boundaries

Reuse the native catalog/media, pricing, orders, inventory, fulfillment, billing and warranty/returns modules. Current organization fields are a foundation, not proof of multi-company isolation. IAM bootstrap permits only an empty store; user email is globally unique and identity is attached to one organization. Public enrollment is bound by the host to one distributor. It enrolls trade customers, not new platform subscriber companies.

Proposed model: platform operator → independent distributor workspaces; a buyer company may have separate approved trading relationships with multiple distributors. Supplier-specific prices, credit, minimums and approval remain separate. Company registration never automatically grants ordering approval. Validate this model before implementation. A shared login needs explicit memberships, authority and company selection.

Initial architecture recommendation: assess separate tenant databases and storage boundaries while retaining module interfaces. This does not require a machine per tenant. Decide deployment density, routing, regional placement and eventual database strategy from capacity/security evidence. Do not add companies to the published demo database as the SaaS foundation.

## Estimate and staffing assumptions

These are preliminary incremental estimates, not a fixed delivery promise or estimates for rewriting the existing application. Assumptions: two experienced full-stack engineers, part-time QA/security/operations support, regular owner/operator availability, reuse of existing modules, hosted web app, one initial regional pilot and limited import formats. Agent concurrency may accelerate implementation, but does not substitute for operating cycles, provider approvals or independent acceptance.

| Milestone | Elapsed time from start | Scope |
| --- | --- | --- |
| Interactive onboarding prototype | 3–5 weeks | Isolated synthetic environment; company setup and role journeys; no real-business readiness claim |
| Controlled distributor pilot | 8–12 weeks | Protected company workspaces, setup/imports, guided first transaction and training; selected operators and bounded usage |
| Public self-service release | 12–18 weeks | Pilot fixes, isolation/security, recovery/load acceptance, support and selected live integrations qualified |

Task estimates total **72–111 engineering person-days**, excluding a **20% contingency** (approximately **86–133 person-days** including contingency). Person-days do not equal elapsed days: dependencies, reviews and operator/provider availability constrain parallel work. With one engineer and intermittent specialist support, budget approximately **20–30 calendar weeks** for public release. Re-estimate after S-002/S-003; broader live integrations, complex accounting migration, native mobile apps and strict multi-region residency can extend these ranges. No hosting price or spending authorization is implied.

## Task list

Each checkbox requires current-version evidence before completion. Tasks may be decomposed further after the model/architecture review. Dependencies indicate required foundations; launch requires the combined acceptance gate.

| ID | Work package | Depends on | Person-days | Completion evidence |
| --- | --- | --- | --- | --- |
| S-001 | Protect demo and establish independent development/release boundaries | — | 3–5 | Recorded release, recoverable private backup including referenced media and keys, isolated restore, separate SaaS checkout/configuration, deployment target guard |
| S-002 | Company, membership, supplier relationship and onboarding design | S-001 | 5–8 | Reviewed contracts, onboarding wireframes, permissions matrix, country/currency and billing decisions; distributor subscriber distinguished from buyer account |
| S-003 | Tenant provisioning, regional routing and isolation | S-002 | 12–18 | Resumable/idempotent provisioning; separate database/storage boundaries; server-owned tenant context; authorization across APIs, files, exports, jobs and logs; two-company negative tests |
| S-004 | Shared identity, invitations, verification and recovery | S-002, S-003 | 10–15 | Verified email, recovery, MFA/administrator policy, memberships/company switcher, invitation expiry/revocation and safe session transitions; no public privileged sample access |
| S-005 | Distributor setup wizard and company configuration | S-003, S-004 | 8–12 | Saved progress; warehouse/team/catalog/policy setup; clear launch readiness; review of return and warranty terms separately; accessible desktop/phone journeys |
| S-006 | Product/customer/opening-stock imports and media | S-003, S-005 | 6–10 | Preview and row errors; repeat-import safeguards; product creation separate from stock receipt; serial/cost reconciliation; file limits and ownership |
| S-007 | Buyer onboarding and distributor relationships | S-003, S-004, S-005 | 5–8 | One buyer company requests two supplier relationships; independent staff approvals, prices, terms and minimums; no cross-supplier exposure |
| S-008 | Platform operations, subscriptions and selected integrations | S-003, S-004 | 10–15 | Platform support access audited; subscription billing separate from equipment payments; bounded jobs/quotas; monitoring, per-tenant backup/restore/export/deletion; selected mail/payment/accounting connections qualified |
| S-009 | Role training, complete journeys, security/load/recovery and pilot | S-005, S-006, S-007, S-008 | 8–12 | Isolated practice workspace; two independent distributors complete receiving→order→handover→invoice and return/warranty journeys; adversarial isolation and interrupted setup tests; realistic load/restore and operator observations; pilot corrections |
| S-010 | Existing-demo migration rehearsal and public release gate | S-009 | 5–8 | Dry-run preserves IDs/relationships, documents, images, serials, balances and audit history; reconciled results; reviewed cutover/rollback and independent launch target; demo migration only under separate owner approval |

Work-package checkboxes:

- [ ] S-001 Demo preservation and independent work boundary
- [ ] S-002 Model, architecture inputs and onboarding proposal
- [ ] S-003 Provisioning and isolation
- [ ] S-004 Identity and access
- [ ] S-005 Guided distributor setup
- [ ] S-006 Imports and media
- [ ] S-007 Buyer/supplier relationships
- [ ] S-008 Platform operations and selected integrations
- [ ] S-009 Training, acceptance and controlled pilot
- [ ] S-010 Migration rehearsal and public release gate

## Onboarding acceptance journey

Verified owner creates company → chooses country/currency/region → sets warehouse and team → configures trading/return/warranty policies → imports/adds products and opening stock → connects optional qualified services → invites customers → completes guided practice → reviews readiness → deliberately activates the workspace. Save progress automatically. Optional configuration can wait; required operating prerequisites must be explicit.

Training is role-specific (administrator, sales, warehouse, finance, warranty), contextual and replayable. Practice records remain isolated from live stock, documents and external providers. Measure success by operators completing real tasks with recoverable errors, not by walkthrough completion alone.

## Preserve the published demo

1. Record the exact application source/image, schema fingerprint, configuration and existing DNS/deployment identities. Latest recorded application release is source `c8b8b5eaef71a1b8e34ff643592f027a1225896b`, image `shop-images33-style-20261008`; see the [deployment receipt](evidence/SHOP-PHOTOS-DEPLOYMENT-2026-10-08.md). This is recorded evidence, not a fresh live inspection for this planning task.
2. Create a named release tag and retain the image. Git preserves source, not runtime data, media or secrets. Review image-retention arrangements separately.
3. Refresh encrypted backups of the database and all nonembedded referenced media; retain required encryption/configuration keys privately and rehearse a restore. Existing backup receipts are historical evidence; this task requires a fresh preservation checkpoint. Set ongoing backups if the demo remains writable.
4. Keep the current app `distributor-ca-sjs1001`, database volume, network, domain/DNS, credentials and integrations dedicated to the demo. Preserve its owner-authorized sample sign-in. Sample access must not be carried into private SaaS tenants.
5. Develop on a dedicated `codex/` SaaS branch and checkout. Use synthetic data and independent configuration. Before any hosted SaaS deployment, provision separately authorized app/network/volumes/storage/secrets/domain. Do not reuse the demo's `fly.toml` target; implement deployment checks that refuse it for SaaS releases.
6. Do not automatically deploy SaaS work to the demo. Demo maintenance requires a deliberately selected compatible release, backup and review. Separate branches prevent accidental source overlap; separate targets/data/credentials prevent operational damage.
7. Eventually rehearse migration using an isolated authorized copy. Reconcile company memberships, customer relationships, stock/serials, orders, invoices/balances, images, policies and audit history. At cutover pause writes or reconcile a final delta; retain the original installation until acceptance. After new writes, rollback requires data reconciliation, not simply switching DNS.

## Public release criteria

No unresolved critical/high defect in the agreed inspected scope; hostile cross-company access fails; all required role journeys and recovery scenarios pass on the candidate; selected providers work in their actual intended environment; restore and workload targets are measured; named operators accept the workflows; support ownership and incident procedures exist. Establish capacity, recovery objectives, subscription scope and residency commitments before making public promises.

This plan leaves the existing system unchanged. No release tag, backup, hosted resource, migration or deployment was performed by creating it.
