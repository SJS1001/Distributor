# Native MVP source and focused verification — 2026-10-05

Base commit: `6f71f00d1b8dacfcf1e9e4389a8b607b026bd703` plus uncommitted working tree. Environment: Node v24.16.0, local macOS workstation, synthetic temporary SQLite databases and Chromium. No CI/runners or product gate acceptance.

Source fingerprint: SHA256 `6ab2b574be68655c1ae5e871795c2e53d04625ffde8746ac2e64820329eadc3d` over the sorted compact JSON map of 771 source/test/configuration paths to SHA256 values. Full map retained in ignored `local-evidence/native-demo-source-manifest-20261005.json`. It identifies the reviewed working tree, not a deployed version or complete transitive dependency freeze. The final formatter changed only presentation; the launcher default was adjusted from3100 to3200 to avoid a preexisting listener.

## Results

- `npm run typecheck`: passed after native runtime, seed, UI notice and browser test integration.
- `npm run build`: passed. Existing large main-bundle warning remains.
- `npx tsx --test tests/native-demo-gateway.test.ts`: agent-owned run, 6/6 passed. Actual CA/US databases, credentials/session replay isolation, product mutation, invoice PDF hash, 300KiB warranty evidence upload/download, Origin/CSRF, reset, byte-exact forwarding/Set-Cookie, active leases, expiry/capacity and rate controls.
- `npx playwright test --config tests/native-demo-browser.config.ts`: final 1/1 passed, 4.0seconds total. Onboarding, every native page title, incoming allocation sample data, buyer restriction, role switch, independent visitor and reset; no page errors. Initial run failed on an incorrect heading in the test; next run exposed a genuine global-aside CSS collision blocking the demo-controls link. Both were corrected before the passing run.
- `npx playwright test --config tests/incoming-supply-navigation.config.ts`: 1/1 passed in earlier focused run, including committed/lost reply, intervening403, reload and identical retry, one resulting commitment, partial release and390px layout.
- `npx tsx scripts/demo-parity-inventory.ts --write`: 15 pages,133 commands,313 registered HTTP method/path pairs excluding automatic HEAD/static,94 web files,12 operator CLI/worker files. Counts establish source registration, not successful execution of every path.
- Scoped Prettier and `git diff --check`: passed. React Doctor remained59/100 with four errors/eighteen warnings in existing edited components; this is not reported as clean.
- Backend incoming/upgrade/regression checks are recorded separately in [incoming evidence](LOCAL-INCOMING-SUPPLY-2026-10-05.md),175 distinct cases across separate runs.
- Local launcher HTTP200 at `http://127.0.0.1:3200/demo`. The initial default3100 startup failed EADDRINUSE; existing listener preserved, new runtime launched3200 and default updated.

## Representation and limitations

The MVP composes `Application`/`createHttp` and serves the same `dist` frontend build as the native application; it does not duplicate handlers, forms or domain logic. Eight sample accounts cover all seven roles plus independent finance review. Native source reuse is verified by inspection and focused execution. No assertion is made that all133 commands or313 method/path pairs were executed in every success/failure/recovery state.

Public Sites version1 remains the earlier simplified prototype. The expanded static draft is unpublished. This native runtime is local; sharing it requires Node-capable hosting. External providers/carriers/email, operator CLI procedures, background workers, physical hardware and infrastructure qualification are not demonstrated. No provider simulation is disguised as actual transport. Production signup/residency and deployment gates remain open. No commit, push, PR, merge, CI or deployment performed.
