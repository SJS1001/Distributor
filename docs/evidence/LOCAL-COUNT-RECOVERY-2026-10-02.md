# Local count recovery verification — 2026-10-02

Parent `9e784f7fb5a3bd6a34761b768c7c216464431ee9`, branch `codex/local-distributor-checkpoint`. Direct workstation checks on macOS arm64, Node 24.16.0 and production headless Chromium with disposable synthetic stores. The [machine receipt](LOCAL-COUNT-RECOVERY-2026-10-02.json) binds tested inputs, assets and private failure artifacts. No CI runner, provider IO, PR, merge or deployment.

## Reproduction and change

Three old-build journeys reproduced missing recovery after an actually committed observation, approval or rejection lost its reply and the browser reloaded. Dedicated count reviews persist exact payload/key and original stock/policy evidence before transport. Fixed readonly recovery survives reload/navigation/sign-in. Web Locks, storage validation and exact evidence comparison coordinate tabs. Uncertain/malformed responses and cleanup failures retain original attempts. Current native authority and refusal rules remain in force. Historical approval recovery after later stock/policy changes replays the original receipt without overwriting newer facts. Native source/schema/dependencies unchanged.

The initial complete run exposed two fixtures incorrectly reading a bounded stock summary and shared count stock pushing an older transfer fixture off-page: three failures, one interrupted test, 164 passes and 40 not run. Count journeys now use a separate disposable store and inspect all stock pages. The first isolation attempt used the wrong API base URL and was interrupted; its artifacts remain private. Scoped test configuration avoids changing other journeys. These are fixture corrections, not application pagination changes.

The second complete run passed 207 tests and failed the legacy count retry selector, which still expected Continue. The selector now names Retry exact count operation; the corrected legacy journey passes separately and in the final suite. No native behavior changed for this correction.

## Fresh outcomes

- Complete production Chromium suite: **208/208 passed in 3.8 minutes**.
- Nineteen new retained-count journeys pass, including original approval replay after later stock and policy changes.
- TypeScript, production build and formatting pass. The existing large-bundle warning remains.
- Changed-source React scan: zero errors, three warnings (component size, keyed kind dependency and existing App complexity). The full application baseline is not described as clean.
- Native inputs unchanged; no fresh native suite result claimed.

Self-review checks immutable exact attempt identity, retained evidence, stock/policy drift, current authority, pre-effect versus uncertain refusals, storage/locks, cleanup, original quantity/cost, dialog identity/focus and abandoned outcomes. The component's kind dependency is stable because the application key includes kind, organization, account and selected count; the static warning is preserved. Browser storage protection/loss, older uncertain attempts, other devices, physical custody and production/operator/provider/residency qualification remain open. All 44 tasks and 10 gates remain NOT VERIFIED; full-system completion is not claimed.
