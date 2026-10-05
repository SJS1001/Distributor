# Canadian pilot: session navigation, breadcrumbs and verified notes

Release source `a5ca594`, schema28, existing Toronto Machine817052c44d9028. Site: https://dstrbtr.ca. Image `registry.fly.io/distributor-ca-sjs1001:notes28-20261005`, digest `sha256:68edcf739425661c0b82d4d2f138436c3de3e8703fb8a2983473ed738bef623e`.

Guests see sign-in/application links without account workspace/pricing links. Customers see their workspace, account pricing and confirmed sign-out. Staff see their staff workspace. Public and workspace breadcrumbs provide parent paths. Private append-only notes support customers, products, orders, invoices and shipments; server-recorded author/time and independent verifier/time are displayed. Verification records staff review, not factual certification.

## Conservation and verification

- Fresh encrypted schema27 archive restored with the previous image in an isolated network-disabled container. Clone migration preserved all837 existing rows across187 prior nonmetadata tables, passed integrity/FK checks and left the original source hash unchanged. Original database/sidecars retained in a private rollback directory.
- Schema28 fingerprint `ed47b3bea6faceab704b36d4b3a159014294996a630b9cb3880a961305c53bff`;396 source/package file hashes matched both local and deployed candidate. Health passed, regionCA.
- Source-frozen workstation regression6,047/6,047 passed with no failures/skips/cancellations,189.1s. Typecheck, build, formatting, plan validation and whitespace checks passed.
- Local synthetic browser checks: public navigation16/16, workspace breadcrumbs5/5, notes1/1. Notes exercise all record kinds, committed lost-response retry, separate verification, immutable originals/corrections, buyer exclusion and390px layout.
- Live read-only1440/390 guest/customer/admin checks passed: session-aware navigation, confirmed logout/reload, breadcrumbs, authorized staff reads of all five note kinds, customer note UI exclusion and direct403. Zero page errors, page overflow or attempted business writes. Screenshots reviewed. Live note mutations were deliberately not performed; mutation evidence is the local synthetic journey.

## Earlier failures and scope limits

Initial full suite had35 outdated schema fixtures and one source-conservation failure during concurrent edits. Fixture repairs and unchanged source-frozen recovery rerun passed, then the full suite passed. Registry authentication was renewed before isolated image verification. Live harness initially sampled a transient product state and used two incorrect tab labels; failed logs remain private alongside successful reruns. Post-release product transition and navigation fixes are tracked in the five-pass review rather than silently treating earlier evidence as current.

Screenshots revealed compressed staff mobile header labels, tracked for the administration pass. Browser width emulation does not qualify physical iPhone Safari/camera. Actual internal email/SMS relay, carrier/payment/accounting qualification and operational product gates remain outstanding. Notes recovery on expired sessions is a confirmed post-release finding, tracked in Pass4. Public test pre-fill remains owner-authorized for fictional pilot data only. No CI, runner, PR or merge occurred.
