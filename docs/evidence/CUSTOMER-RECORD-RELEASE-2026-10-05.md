# Customer pricing entrance and staff customer records

## Release history

Source `8e2e219` on `codex/local-distributor-checkpoint`, published to the owner-authorized Distributor repository. Image `registry.fly.io/distributor-ca-sjs1001:customers29-20261005`, registry digest `sha256:2bc319a04abde031f3d224f6e086c99da9160145b19bd9498159387d52580c1d`. All 400 tracked source/package files matched the built image. No PR, merge or CI runner was used.

The public product action now enters customer sign-in for guests and staff; signed-in buyers enter their account pricing. The selected equipment reference survives the switch. Staff operations remain a separate navigation destination. Selecting a customer in staff operations opens a dedicated record with Overview, History, Terms, Pricing, Notes and Contacts tabs. History has Orders, Invoices and Payments subsections. URLs, breadcrumbs, reload and browser history retain the selected record and tab. See `../CUSTOMER-RECORDS.md` for the three-experience contract.

## Verification before release

- Complete workstation regression: **6,057 passed**, zero failed, skipped or cancelled; 193.5 seconds.
- Public browser journeys: **20 passed**.
- Customer records, pricing, notes, recovery, override and storefront browser journeys: **20 passed**.
- Workspace navigation browser journeys: **5 passed**.
- Typecheck, formatting, planning structure and staged diff checks passed. Planning structure does not establish product gate acceptance.
- Desktop and 390px customer-record screenshots visually inspected. The selected customer's identity stays above six tabs. Contacts and current breadcrumbs remain visible on a phone-sized viewport. A scrolled full-page screenshot artifact was corrected in the verification capture, with no production CSS change.
- Synthetic contact edits prove durable persistence, exact replay after lost response/401/reload, one record after retry, account isolation and recorded authorship. Backend role, paging and both schema-profile upgrade checks are detailed in `CUSTOMER-RECORD-BACKEND-2026-10-05.md`.

## Deployment progress

Writer stopped; encrypted schema28 backup downloaded to owner-private storage and restored successfully with the prior image in an isolated, network-disabled container. The restore verified the old snapshot and schema, invalidated sessions and retained provider hold in the recovery copy. Original live database was not replaced by that restore.

The installed Fly CLI duplicated a digest when given a digest-only image identifier and refused the update before changing the machine. Retried with the unique release tag, which resolved to the same verified registry digest. Historical failure log retained privately.

The first clone-upgrade attempt refused a staging directory with mode0755 before writing a candidate. Correcting it to0700 allowed the upgrade. All941 old rows across189 tables were preserved exactly; the source file remained unchanged and integrity/foreign-key checks passed. The existing reports-enabled profile was retained, yielding schema29 hash `5593a454c0963d61d717eb07c41e3fb008602656833dd1fb07a438c0defa62e6`. A prewritten verification assertion had assumed the disabled profile and was corrected to the verified live profile before use. The reviewed clone was activated with the original schema28 database and sidecars retained for rollback.

Initial deployed source and schema checks passed, but the live desktop journey caught public product sign-out rewriting the URL to Overview and showing “Product not found.” This failed receipt is retained privately. Source `c724406` fixes session cleanup to retain public equipment/filter context and adds buyer/staff logout/reload regressions. A visual review also corrected stretched customer purchasing checkboxes and bounded the product checklist.

Final patch verification: all20 public browser journeys,8 notes-recovery journeys and1 desktop/phone purchasing-layout journey passed. Build, typecheck and changed-file formatting passed. The full6057-test backend run above belongs to `8e2e219`; the patch changes only browser source/styles and browser tests, with no backend or schema changes.

Final image `registry.fly.io/distributor-ca-sjs1001:customers29b-20261005`, digest `sha256:390276cd8f84923f44b89fd98b392551916dca7c2a4148309ae6a177c6ebb085`, matches401 tracked source/package files. The first registry upload stalled after its short-lived authentication expired; it was stopped, authentication renewed, and retry completed. Both logs are retained. Code-only update uses the same Toronto machine and schema29 database.

## Final live verification

At 2026-10-05 21:28 UTC, source `c724406` passed the final read-only live journeys at both 1440px and 390px. Guest and staff product actions enter customer sign-in; buyer actions enter their own pricing; equipment references survive sign-in. Each customer record tab, record reload, directory return and browser-back navigation passed. Buyer requests for staff contacts returned403 and staff notes were absent from the buyer interface. Public product sign-out retained the equipment URL and guest pricing entrance, and the session endpoint returned401. Both journeys recorded zero page errors and zero attempted business writes.

All401 tracked source/package hashes matched the deployed machine. Schema29 retained the reports-enabled fingerprint above, database quick-check passed, foreign-key violations were zero, and HTTP health passed. Final desktop Terms and phone Contacts screenshots were inspected. The owner's existing live product browser tab was refreshed and its “Log in to see pricing” action confirmed while retaining the staff session.

Private receipts and screenshots are retained under `local-evidence/customer-record-release-20261005/`; the initial failed live receipt remains alongside the final passing receipt. This completes this customer-record and pricing-entrance release, not the broader operational qualification gates.

## Limits

Browser checks use Chromium desktop/phone-size viewports, not a physical iPhone Safari camera test. Live business data changes are excluded from smoke tests; editing/recovery are exercised in synthetic workstation fixtures. Invoice history has invoice numbers and balances but no canonical invoice detail route. Provider operations, actual residency qualification and broad product acceptance are not inferred from this release. The earlier five reviews were functional hardening; the owner's visual criticism remains recorded in `FIVE-PASS-POLISH-2026-10-05.md`.
