# Local QuickBooks revocation and schema-v3 evidence

Partial D-009/D-029/D-036/D-039 engineering, not product/provider acceptance. All 44 tasks and 10 gates remain NOT VERIFIED. [Hash-bearing companion](LOCAL-QUICKBOOKS-REVOCATION-2026-10-01.json), [operator procedure](../QUICKBOOKS-REVOCATION.md), [schema procedure](../SCHEMA-UPGRADES.md) and [runtime procedure](../RUNTIME.md).

Parent `aabad6ae1e1440886fab690bc02638ffe57004d2`, branch `codex/local-distributor-checkpoint`. Candidate hashes identify the actual tested version; the later local commit is recorded in the handoff. Direct macOS arm64 workstation, Node 24.16.0/npm 11.13.0; private synthetic CA/US stores on one machine. No actual Intuit, provider or printer request, CI/cloud runner/session, push/PR, deployment, purchase or live customer data. Original implementation; package/lockfile, historical receipts and retained notices unchanged. No SDK source copied.

| Check | Actual outcome |
| --- | --- |
| `npm test` | PASS 1495/1495; includes 33 new revocation checks and expanded independently frozen v1/v2 upgrade and old-archive refusal coverage |
| `npm run test:e2e` | PASS 67/67 after a production build; existing Chromium phone/desktop journeys exercise native HTTP/UI behavior, not a new revocation browser control |
| `npm run typecheck` | PASS, exit 0 |
| `npm run format:check` | PASS, exit 0 |
| `npm run verify:runtime` | PASS, exit 0; 187 copied inputs, 27 child commands, CA/US each start twice, exact PDF/ZPL replay, authenticated session revocation and encrypted local backup/restore |
| Build comparison | Separate verifier production output and browser-suite output have identical file sets and bytes (three files) |

The companion retains 287 tested-input hashes, command/log exits and hashes, historical evidence/notice hashes, the actual runtime receipt and independent frozen-v2 provenance. Top-level test start/end timestamps were not recorded; log modification times are expressly filesystem metadata. Runtime child commands retain actual start/end times. Backend test-fixture edits occurred after the browser/runtime commands began; those commands do not import the modified backend test file. All production/browser/server inputs match the candidate, and the final full backend run includes the revised fixtures.

## What the checks establish

Intercepted fetch verifies the sole fixed Basic-authenticated JSON revocation request, local disable and cancellation before sending, exact receipt retry without resend, native stock/money conservation and restart retention. Unknown responses, failed/oversized reads, redirects, key/worker/password/customer-choice/revision/restore drift, strict CLI inputs and audit failures refuse or retain unresolved fences. Both evidence review outcomes retain disabled credentials; active claims cannot be prematurely reviewed or overwritten by late replies. Independent operating-system contenders and actual process termination demonstrate one durable claim and no implicit resend. Two held OAuth exchanges prove late tokens cannot reinstall credentials or cause a later company read after confirmed/uncertain revocation.

Encrypted recovery retains revocation history, turns copied active claims unknown, advances disabled credential revisions, revokes sessions and preserves the provider hold. Frozen earlier schema fixtures verify explicit fresh-file upgrades for US/CA and both optional reporting profiles with conserved sessions, stock, invoices, encrypted credentials and version-two carrier groups. Normal startup refuses older/drifted layouts before constructors. Authenticated older encrypted archives reject without implicit migration or source overwrite.

## Failures retained and corrected

Initial regressions retained older current-version expectations. New response tests then exposed a real nested transaction: confirmation attempted a second `BEGIN` and discarded valid HTTP 200 responses. The claim checker now runs under the caller's transaction. SQLite null-prototype assertion fixtures and a repeated idempotent residency choice were corrected so the intended late drift is actually exercised. The frozen-v2 fixture's warehouse property and the deferred helper's ES2023 compatibility errors are retained too.

The first full browser run failed 7/67 journeys. The concurrent runtime verifier explicitly used `NODE_ENV=development` and wrote into shared `dist/`; retained trace records show development asset `index-BUqmUk2G.js` and duplicate initial GETs consuming injected read failures. The verifier now builds with production environment/mode into its own private directory. Concurrent final browser/runtime checks pass and their production outputs match byte for byte. No browser assertion or React StrictMode behavior was weakened. Original failed logs/traces remain private and hashed in the companion; the earlier runtime pass is superseded for production-bundle evidence.

## Limits

Synthetic protocol, process and schema checks do not qualify actual Intuit responses, company/grant revocation, production credentials, key custody, inactive-worker recovery, vendor terms, physical residency, hardware, incident response, load, disk/power faults, RPO/RTO, stopped-writer cutover or independent human/security acceptance. Operator-confirmed evidence remains an assertion distinct from a provider response. In-memory strings and older ciphertext in WAL/backups are not securely erased. Other already-issued grants/tokens and requests in flight require independent reconciliation. These results do not pass any product gate or complete the full-system objective.
