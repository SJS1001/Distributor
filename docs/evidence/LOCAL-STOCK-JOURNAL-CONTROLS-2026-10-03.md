# Local stock-journal controls receipt — 2026-10-03

Parent: `2bfd8cf6c11803476d272eff8147c1fa00defb40`. Branch: `codex/local-distributor-checkpoint`. Environment: macOS arm64, Node 24.16.0; disposable synthetic CA/US stores. Direct workstation commands only.

The [review and history controls](../STOCK-JOURNAL-CONTROLS.md) expose strict authenticated preparation, independent decision and correction cancellation commands, twenty-descriptor journal queues and complete twenty-observation history pages. No execution, lease, dispatch or provider outcome route exists. Schema 12, dependencies and frontend remain unchanged.

## Verification

Full native checks pass 2,222/2,222 in 84,751.455083 ms, with zero failures/skips/cancellations/todo. Focused controls/queue/transport/correction checks pass 111/111 in 3,628.941 ms, including twenty new tests. TypeScript and formatting pass. Planning structure/links pass: 232 Markdown files and 1,301 local links, structure only. All 512 final tested input hashes match. The [machine receipt](LOCAL-STOCK-JOURNAL-CONTROLS-2026-10-03.json) binds tested inputs and private retained evidence.

Coverage checks organization/principal/role/filter-bound canonical cursors, insertion high-water bounds despite backdated timestamps, unavailable anchors, current authority before every read and cached command, frozen plan and observation hashes, history beyond one hundred observations, no-store responses, omitted private lease material, strict nested payloads, Origin/CSRF, exact retries, independent review, restore hold behavior, correction cancellation and original-unknown refusal. Reads conserve persisted business facts. Live filters can change membership between pages; this is not a historical state snapshot.

Isolated production installation/build/runtime passes: all 263 copied inputs match, with 69 development-only packages absent. CA and US each pass two startup cycles, PDF/ZPL-8/ZPL-12 rendering and encrypted backup/restore with providers disabled. Existing production bundle warning remains. No fresh browser or static diagnostic qualification is claimed.

## Failures and self-review

The initial focused run rejected an unsupported fixture role. A later focused run passed nineteen new controls tests but exposed an intermittent native correction timestamp mismatch: separate clock calls could cross a millisecond between the approval artifact and retained row. Approval now captures one timestamp for both. A deterministic advancing-clock regression verifies this fix; the final focused and full suites pass. Historical inconsistent rows are not silently rewritten and remain refused pending reviewed investigation. Failed and superseded logs remain separately retained privately.

Review checked module-owned reads, current authority, immutable review/source/company/permission fences, complete bounded history, correction ordering, exact cached-command access, unknown outcome preservation, strict HTTP boundaries and transaction conservation. Original repository modules and synthetic fixtures are used; no private source, new dependency or third-party code was copied. Raw logs, runtime data, keys, tokens and verification artifacts remain excluded.

## Limits and publication

Browser controls and durable uncertain-attempt recovery remain next. Explicit reviewed permission replacement, organization OAuth/company verification and remote revocation, original cancellation/fresh retry, multiple-date reconciliation, changed-journal/valuation corrections, durable restore activation and current Purolator contract remain open. Actual provider, finance, processor/infrastructure residency, device, security, load/recovery and operator qualification remain required.

All 44 tasks and ten gates remain NOT VERIFIED; full-system work remains incomplete. No CI runner/job/workflow, live provider IO, account, delegated/cloud session, PR, merge or deployment is created. Source/test/documentation commit `c14b3dc93b4f70e76716f21355c38e078e7944dd` was normally pushed; exact remote equality and a clean checkout were confirmed with all 512 committed tested input hashes and 38 private evidence hashes matching. Read-only GitHub checks confirmed push permission, zero workflows and zero Actions runs before publication. This publication record follows in a companion documentation commit.
