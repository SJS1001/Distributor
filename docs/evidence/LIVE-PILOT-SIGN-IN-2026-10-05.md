# Public pilot administrator pre-fill — 2026-10-05

Owner-authorized change deployed to <https://dstrbtr.ca/#admin-sign-in>.
The existing pilot administrator credentials are deliberately public while this
setting is enabled. This is the actual sample-data pilot, not a separate demo.

Source commit `31972f9c52185ce4f86368f6dfbac933dddfd96d`. Local-only Linux/amd64 Fly build deployed image
`registry.fly.io/distributor-ca-sjs1001:deployment-01M46MSR22BDMJ7ZE31MD0VNJ9`,
registry digest `sha256:ca251b672287f8b8af4a40e1fbda405499f47d53dba0bf6afff63cea59a4c5fe`.
Existing Toronto Machine `817052c44d9028` started with 1/1 healthy checks.
Schema25, existing database, account/password and provider settings preserved.
No CI, remote builder, new infrastructure, PR or merge.

Two backend checks and eight isolated Chromium scenarios pass, including enabled
and disabled configuration, normal password authentication, unauthenticated API
protection, one-click administrator login, empty customer entrance, manual edits,
existing application/activation and account review. TypeScript, build, scoped
formatting, whitespace and planning structure checks pass. Existing bundle-size
warning remains; full historical test suite was not rerun for this change.

Live Chromium at 1440 and 390 pixels passed at 18:23 UTC: administrator email and
masked password prefilled, clicked Sign in without typing, authenticated session
role verified as admin, logout completed, customer fields empty, no page errors
or horizontal overflow. Public config returns no-store. Test data credentials
stay outside Git and compiled assets, but the enabled runtime response intentionally
makes them available to visitors. No business records or account settings were
changed by verification. This is not physical iPhone Safari qualification.

Fresh encrypted pre-release backup downloaded to protected local storage and
restored into an isolated new database; live database untouched. Snapshot hash
`a5d32fe84f44cba7c5c32fd9839d42ad11f01bf62d2f368e06e4e51778fdb0ed`. Existing schema25 image
`registry.fly.io/distributor-ca-sjs1001:deployment-01M46KNJ2Y7B9G242TDXHG0ZXR`
is compatible for code rollback without replacing the live database.

Initial live verification navigated before logout completed and timed out waiting
for customer login. Its next version incorrectly assumed logout always returns
the home heading. The final harness waits for the logout response and signed-out
UI before navigation; both final live journeys pass. These were verification
harness errors, retained separately from final evidence. A machine-list snapshot
during replacement showed the old image; subsequent status confirmed the new
started image and health.

[Fly runbook](../FLY-CANADA.md) records runtime configuration and removal: disable
public sign-in, remove credential configuration, rotate the published password
and revoke sessions before real data. The broader [remaining work](../REMAINING-WORK.md)
and product qualification are unchanged.
