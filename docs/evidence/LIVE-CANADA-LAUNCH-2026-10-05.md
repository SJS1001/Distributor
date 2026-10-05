# Canadian real-application pilot launch — 2026-10-05

## Version and environment

Owner-authorized Fly deployment and dstrbtr.ca connection; one or two testers,
Canadian real app, no demo data. Based on local source commit
`bfb82337ea6938088283610c0e8c18a4373ff837` plus the reviewed working changes.
The final 819-path source/test/build manifest SHA-256 is
`c7afa96e67fce7aef9afd358db9629168092fac114e28e0dd117a3c31f6d502b`.
Its per-file hashes are retained privately at
`local-evidence/fly-preflight/final-source.sha256`. Documentation is outside that
manifest. It is a post-check fingerprint, not a claim that every file was tested.

Final image: `registry.fly.io/distributor-ca-sjs1001:deployment-01M46B0N7V7ZV5MB679FC2VQSX`,
registry digest `sha256:deb84b82401f50a064f1b44c6ba478d18371cc7f4f07e3f0b95c747ed997edb9`.
One started Machine `817052c44d9028`, `yyz`, shared CPU/1024 MB, encrypted 3-GB
volume `vol_re1jk0pykok3pdd4`, isolated custom network `distributor-ca-sjs1001`.
Schema24, CA/CAD. All builds were local Linux/amd64; no remote builder, CI,
runner, PR or merge was used. Live providers/carriers are disabled; background
workers are unscheduled. Empty business store with one administrator.

## Delivered and checked

- Website, native sign-in, public contractor application, staff approval/rejection,
  explicit pricing/credit terms, invitation reissue/revoke and one-time buyer activation.
- GoDaddy apex A/AAAA point to Fly; existing www CNAME retained; ACME CNAME
  added. Registrar/domainconnect/DMARC preserved; no MX was present or added.
  Apex/www certificates issued. HTTP→HTTPS 301; www and Fly browser navigation→apex 308.
- Live health 200, CA; anonymous application queue 401; invalid public body 400
  through qualified Fly ingress; cross-origin mutation 403; administrator login
  and dashboard 200, Secure/HttpOnly cookie, empty authorized queue 200;
  logout 200 followed by session refusal 401.
- Actual browser rendered home/application form, signed in as the real
  administrator, and opened Administration → Trade applications (empty).
  Final image rechecked health, authenticated Administration title, operational
  qualification banner, queue and signout. No production test applications,
  products, customers or orders were inserted.
- Final frontend TypeScript/build and dedicated browser suite 5/5 passed,
  including actual isolated application→approval→activation→buyer login,
  admin-queue refusal for buyer and replay refusal. Title assertion checks
  `Overview · dstrbtr` after login. Existing browser entry points now explicitly
  use `/#sign-in`; the full browser omnibus was not rerun.
- Backend final focused 19/19: enrollment15, frozen-schema23 migration2,
  canonical-origin1 and proxy-address1. Separate migration suite113/113,
  Identity9/9 and older schema paths9/9 passed on the backend owner's recorded
  inputs. See [enrollment](../ENROLLMENT.md) and HANDOFF for scope/hashes.
- Independent bounded read-only security review identified quota consumption,
  approval reauthentication timing and proxy addressing issues; all were
  repaired with focused regressions. Closure found no remaining concrete defect
  in that delta. Reviewer did not independently run tests or certify security.

## Backup and schema change

The application writer was stopped using the maintenance command before backup.
Old-image encrypted archive was created, downloaded to ignored private storage,
and successfully decrypted/restored in a local network-disabled container.
Archive size 1,986,866 bytes; snapshot size 1,986,560 bytes; snapshot SHA-256
`df400ec06d12db2a0463b18c9f51debfa6053af5f6bf7e0c70e182b651d77d38`.
Key retained separately with private file permissions; no credentials are in Git.

Old schema23 fingerprint:
`90a8fb975571d8c284d2e95959c12eb5f4b1665c776475ffc783feb7cc44936d`.
Explicit source-qualified upgrade wrote a fresh clone with schema24 fingerprint:
`94505c964f6991277c202fc0c9673563be5e2b0c94d69e70b75a4f15764c2508`.
All 163 preexisting nonmetadata tables and 11 rows compared equal; one admin,
zero applications, SQLite integrity OK. Original database and sidecars retained
under `/data/rollback-schema23-20261005/`; reviewed clone activated at the original
runtime path. Explicit Fly process configuration restored the normal Node command.

Previous schema23 image digest:
`sha256:29e9962426dc2997c1b350cdca6ad83328bfbcf6f978880342fcf6ef32782cf8`.
Initial schema24 image digest:
`sha256:db52f8ad18a9c0351a00f8053fc22982a3d63f14abaf8e6a32b93dbff5a7aa4b`.
The final code-only deployment corrected authenticated document titles and the
workspace qualification banner; it required no second migration.
Do not roll back the code across schema versions without restoring the matching
reviewed database. This archive check does not qualify live protected restore
host authority/fencing, RPO/RTO, snapshot location or full disaster recovery.

## Retained failures and limits

Initial deploy validation refused missing HTTP service process membership after
adding an explicit process command; corrected with `processes = ["app"]` before
successful deployment. The final frontend title regression first saw stale built
assets; rebuilt and passed all five checks. A planning check initially found the
not-yet-written launch receipt; receipt added before the final check. Earlier
backend expectation/type fixes and security regressions remain in the handoff
and local evidence; no failed result is presented as a pass.

Private artifacts under `local-evidence/fly-preflight/` include backup and restore
receipts, upgrade/activation logs, earlier failed and successful deployments,
final image/Machine JSON, live checks, redirects and browser screenshots. No raw
runtime data, account credentials or recovery keys are source artifacts.

Manual invitation delivery is required; automated email and verified email
ownership are absent. Live Stripe/QuickBooks/carrier qualification, scheduled
workers, protected restore composition, finance/device/operator acceptance and
ancillary residency qualification remain outstanding. Only the primary compute
and volume are verified in Toronto. No complete production readiness, full
regression, universal demo parity, or passed product gate is claimed.

Fresh command-local GitHub checks identify `sjsmithbot` with repository
`pull=true`, `push=false`. Source publication remains blocked; no owner identity
substitution, repository permission change or push attempt was made.
