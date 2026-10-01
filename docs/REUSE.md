# Reuse and licensing assessment

Date: 2026-09-30. Candidates only: no third-party application code has been imported. A source review is not a runtime/product qualification or legal clearance of a combined work.

## OPUS reuse

Earlier source assessment used OPUS trunk `89b758ce90bd6d51979186cfd1813fc940d37fb0`. Local reports reviewed in the OPUS checkout were `docs/research/2026-09-30-distributor-separation-feasibility.md` and `docs/research/2026-09-30-distributor-module-dependency-audit.md`. The feasibility report is not committed at that baseline, so no GitHub report link at that commit is claimed. Source-code claims in the reports reference the baseline; D-002 must retain an accessible, versioned source manifest and reproduce relevant findings before adoption.

Useful slices: invoice/credit core, supplier POs/receipts, inventory valuation/serial/RMA concepts, warranty claim policies, customer account/payment primitives and owning-interface/event patterns. Missing/adaptation-heavy slices: persisted buyer cart/sales order, distributor pick/pack/shipment, coherent multi-location stock positions and reservation truth, sold-serial warranty ownership and portal composition.

Known assessment findings to reproduce before reuse: stock reservation can alter physical on-hand; generic serial issue writes a job identity; warranty paths depend on installed Assets; portal/billing retain mutual payment and field-service dependencies. They are source findings, not newly reproduced runtime failures here. Do not copy modules on the assumption that hiding UI removes their runtime/schema dependencies. Inventory any retained migrations, SQL/RLS functions, shared providers and startup registrations. Maintain a source manifest and process for carrying future fixes into the separate product.

Confirm ownership, embedded third-party licenses and permission to republish before any OPUS source goes into this public repo. D-002 gates this. No whole OPUS schema/code fork is performed by planning.

## Open-source shortlist

Repository/license pages checked during research on 2026-09-30. Pin exact files, commit/release and transitive dependencies during D-002; default-branch terms can change for later versions. No candidate is selected merely because it appears below.

| Candidate | Potential role | License / architectural treatment |
| --- | --- | --- |
| [InvenTree](https://github.com/inventree/InvenTree) | Inventory alternative/reference; API/plugin integration | [MIT](https://github.com/inventree/InvenTree/blob/master/LICENSE). Permissive for copied covered code with retained notices. Python/Django backend: extracting its inventory engine into TypeScript is significant porting work; adopting its API means another service, not a drop-in module. Choose one inventory authority. |
| [InvenTree app](https://github.com/inventree/inventree-app) | Standalone scanning/mobile alternative | [MIT](https://github.com/inventree/inventree-app/blob/master/LICENSE). Existing backend contracts require compatibility/adaptation; physical device and workflow proof still needed. |
| [ZXing Browser](https://github.com/zxing-js/browser) | Embedded browser barcode/camera component | [MIT](https://github.com/zxing-js/browser/blob/master/LICENSE). Evaluate actual label formats, camera/device behavior and its decoder dependencies. |
| [ZXing WASM](https://github.com/Sec-ant/zxing-wasm) | Alternative barcode decoder | Wrapper MIT; included ZXing-C++ Apache 2.0 and Zint BSD-3-Clause according to repository notices. Preserve all relevant licenses; compare hardware/format/bundle tradeoffs rather than integrating both by default. |
| [ERPNext](https://github.com/frappe/erpnext) and [Webshop](https://github.com/frappe/webshop) | Whole-platform route for distribution and commerce | GPL v3. Commercial use allowed; distributing covered modified/combined work requires GPL compliance/corresponding source. Prefer assessment as a complete platform or truly independent integration before code transplant. Hosting and browser-delivered code need delivery-model review. |
| [OCA stock-logistics-shopfloor](https://github.com/OCA/stock-logistics-shopfloor) | Odoo warehouse/scanning alternative | AGPL v3 default, check each module manifest. Modified network-accessible covered work must offer corresponding source to remote users; Odoo stack coupling remains. |
| [Medusa](https://github.com/medusajs/medusa) | Modular commerce alternative | MIT core with [enterprise exceptions](https://github.com/medusajs/medusa/blob/develop/ENTERPRISE-LICENSE.md), including RBAC/SSO. Listed proprietary files require commercial rights; visible source is not blanket permission. Full distribution workflow still needs integration. |

License fundamentals: [MIT](https://choosealicense.com/licenses/mit/), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0), [GPL text used by ERPNext](https://github.com/frappe/erpnext/blob/develop/license.txt), [OCA AGPL text](https://github.com/OCA/stock-logistics-shopfloor/blob/18.0/LICENSE). Refactoring copied code does not erase its license. An API or bus is not an automatic legal separation guarantee. Review the actual derivative/combined-work boundary, delivery model, trademarks/assets and dependencies with appropriate license expertise before commercial adoption. Do not choose this product's license by guessing.

## Project UB benefit and current limits

Local workspace: /Users/stevensmith/Documents/Project UB; remote [SJS1001/PROJECT-UB](https://github.com/SJS1001/PROJECT-UB). Local HEAD observed `957bb533d694781eef369e278adb03df5f0038b6` on 2026-09-30, with concurrent uncommitted work. No UB test suite was run by this planning task, and no uncommitted change is counted as a qualified Distributor dependency.

Read-only evidence: current README, source `src/bus.ts` constructor and `src/contracts.ts` SourceBinding. Runtime explicitly refuses live modes; source binding admits a synthetic fixture connector/environment. Earlier code-grounded audit at `f5057e1c66d2ef6e8bae985a90617501a60c5dda` described durable local ingestion, scoped identities, versioned mapping/provenance, queue/replay and publication receipts. That audit predates current local HEAD; its reported test results are historical, not reproduced here. Current handoff also distinguishes local slices from full disconnected release-candidate readiness.

Benefits to evaluate: import/customer/supplier-source normalization, reviewed external IDs, provenance, context/freshness views and replayable reconciliation. UB financial references do not post accounting entries; inventory context does not allocate or transact distributor stock. A local publication receipt does not certify external business completion.

Recommendation: preserve an optional adapter boundary now, qualify one synthetic context workflow later, adopt live connectivity only when source rights, security, exact-version compatibility, recovery and real provider evidence exist. The distributor's ordering/billing/warehouse operations must continue with UB disabled. D-042–D-044 are separately estimated and do not block native product delivery.


## Original UPS protocol implementation — 2026-10-01

The default-disabled UPS CIE client was written originally against public UPS API field contracts. The actual [UPS API documentation license](https://github.com/UPS-API/api-documentation/blob/main/LICENSE) was read: MIT, copyright 2023 UPS-API. No SDK/vendor implementation, generated schema, source sample or actual label was imported into this repository. Synthetic label bytes are original fixtures. No dependency/lockfile change or new copied-code notice is required by this checkpoint. Any later copying/generation must preserve applicable notices and undergo its own review; vendor API/account agreements and product publication rights remain separate and unresolved. The [local receipt](evidence/LOCAL-UPS-SANDBOX-2026-10-01.md) binds private downloaded reference/license hashes.
