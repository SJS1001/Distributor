# Local offline refund completeness return receipt

Exact tested code/test/report commit: `87a913c0fd05b6b177e43f12420b7622a749d687`. Root independently captured and verified both returned cloud patches from baseline `072086fe84588f7a6b59aed23296ad22c9f9f4bb`, reviewed their owned deltas, applied them to published receipt-recovery checkpoint `21e097d45a6a0e9968e0460c3907cd2f35fff11f`, and replayed the affected boundary here. [656-input manifest](LOCAL-OFFLINE-REFUND-COMPLETENESS-2026-10-03.json), SHA256 `8092d5875251d3ded65598c9c27ad9ffcb45e1b85e81ff088bc368c103d799d5`, matches committed blobs. Direct Darwin arm64/Node24.16.0/SQLite3.53.0/OpenSSL3.5.6 verification.

## Actual outcome

- Focused eight-file replay235/235pass, zero failures/cancellations/skips/todos,4593.517209ms, exit0. Includes the ten added real owning-API gap reproduction cases and existing Integration/Billing/Platform/private-parser/receipt-recovery cases. Complete TypeScript, owned-file format, planning and whitespace pass. Planning structure only:44tasks,10gates,11scenarios,14decision sheets,22requirements,336Markdown files/1750links.
- Prior full native3826/3826 at `a613763fd568eb9d9918c57f28e4aa5869d08616` covers the unchanged655 inputs. Only one new test file expands inputs to656 here. No current full3836-test result is claimed.
- Integration cloud return `a1f1ac70b0328da8088e6935c4f52872584e0928` contains only the [ten-test gap reproduction](../../tests/integration-offline-failed-refund-application.test.ts) and [owned report](../INTEGRATION-OFFLINE-FAILED-REFUND-APPLICATION-2026-10-03.md); raw27935bytes/SHA256565a85252b0593c1970550609ea542da3f606814c1e56ede77fcfbb5ec52a19c. No writer was delivered. Its own208-pass cloud result is historical cloud evidence, separate from root235-pass integration.
- Security composition cloud return `c707802c81ccf6553b8c9e2eccbe5c86bfbc1977` contains only its [review](../RESTORE-OFFLINE-FAILED-REFUND-COMPOSITION-REVIEW-2026-10-03.md); raw32157bytes/SHA256c9f61276e8a9d55d95997350736536ce50ed0f3fb5177b49db20ea7bb7d84a4b. It ran document scope/format checks, no new tests. No cloud parent commit or unrelated path imported. Both requested Astra/high; effective runtime settings unavailable/unverified.

## Reproduced gaps and next engineering

The actual Integration reader conservatively retains BILLING_COMPLETE_HISTORY_REQUIRED, PLATFORM_RECEIPT_HISTORY_REQUIRED and INBOX_UNATTRIBUTED_HISTORY_UNAVAILABLE. Calling separate Billing or Platform readers cannot silently discharge its blockers. Synthetic tests demonstrate that organizationless inbox rows and orphan/cross-organization callbacks with a proposed refund reference can remain outside the target-only review hash. Poll/lease consistency or a canonically hashed provenance row does not prove native completeness or external truth.

A second prerequisite is a strict bounded frozen projection of the captured original refund request and candidate receipt/poll history: the present comparison drops fields required to join current native facts without rereading private raw evidence. Root owns the shared static composition, Application wiring and exact owner-result recovery joins. Integration and security owners will receive these two independent prerequisites after this return checkpoint is published. The accepted-requirement audit continues under its existing owner.

The historical security report proposes Billing application before Integration. Root must resolve that order against the original first-unknown-review contract: Integration preflight/application must observe the original unknown Billing state within one held outer transaction before Billing changes it, unless a separately verified split preflight contract preserves the exact same join. This report is evidence and recommendation, not authorization to choose an unsafe order.

Technical/infrastructure owners must supply independently qualified current trust/revocation, source/candidate COMMIT interlock and actual source/residency evidence. Finance/product supplies tax/terms/mappings/customer residency choices; logistics/providers supplies contracts/sandbox access and carrier/device qualification (Purolator contract access absent); QA/operators supplies real accepted cycles and numeric targets. Wake conditions are the corresponding qualified inputs. All44 registered tasks/ten product gates remain NOT VERIFIED; optional UB deferred. Full product incomplete. No writer, provider IO, CI/runners/workflow, PR, merge or deployment introduced.

Private ignored logs retained locally:

| Log                                                  | SHA256                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `cloud-completeness-return-focused-2026-10-03.log`   | `5e115954593e5e9535c1abd8797e1e86fb832643554315713bb1973709ba0dde` |
| `cloud-completeness-return-typecheck-2026-10-03.log` | `8a702e6f87c8a6ca129035a44568229aa0a0ce49ce48d85c056ac1c3a87c0c57` |
| `cloud-completeness-return-format-2026-10-03.log`    | `17aa973d3f004560237d9a95171210b0671deff23d61628eecf7322ff5938f20` |
| `cloud-completeness-return-plan-2026-10-03.log`      | `ff725ac543b0bce7dca8bce010c14d97047abfb85df34323c5dbf90bd1c8c2d8` |

Self-review: reviewed exact owned source/test/report deltas, retained historical limitations, no blocker bypass, owner boundaries preserved, no schema/dependency/license changes, no private input publication,655 prior hashes unchanged and656 current hashes match committed blobs.
