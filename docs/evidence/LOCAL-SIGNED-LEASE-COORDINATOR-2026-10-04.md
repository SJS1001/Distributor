# Signed original lease retirement workstation receipt

Tested source `929346d4bfd5c698ea5f5fa1e0505f7bb4c35be9` on macOS arm64, Node v24.16.0. All 733 captured runtime inputs match both actual working bytes and the committed Git blobs in [the machine-readable receipt](LOCAL-SIGNED-LEASE-COORDINATOR-2026-10-04.json).

Full direct workstation regression: 5,581/5,581 pass, zero failed/cancelled/skipped/todo, exit 0, 111347.535833 ms. The affected replay passed 256/256 before the final swallowed-reentry case; all 25 coordinator cases are covered by the full run. Complete TypeScript, runtime formatting, plan structure and whitespace checks exit 0. Earlier cross-owner snapshot, reopening profile, late-fault table and cleanup fixture failures are preserved as hashed private logs.

The coordinator verifies signed current qualification, actual owner/store identities, distinct current finance principals, native/command/raw payload joins and claim-start ordering under the actual writer and COMMIT interlock. Late expiry, clock reversal, role loss, owner substitution and swallowed same-database reentry roll back the native lease retirement and both retained receipts. Restart/lost-response recovery returns the original durable preimage read-only. Missing historical claim-start and external qualification requirements remain disclosed; no historical audit is invented.

This verifies synthetic implementation behavior. Actual provider/source truth, current authority, infrastructure residency and a fence valid through COMMIT return remain unqualified. All 44 tasks and ten product gates are NOT VERIFIED. No default trusted host, Application route, PR, merge, CI/runner job, provider operation or deployment is introduced.
