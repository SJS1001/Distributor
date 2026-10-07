# Canadian Fly.io pilot

Prepared 2026-10-05 for the real application and one or two testers. The owner approved the US$10–15/month pilot budget on 2026-10-05. The pilot is deployed and its HTTPS login and authenticated workspace were verified. No CI is required.

## Live installation

| Item | Prepared choice |
| --- | --- |
| App name | `distributor-ca-sjs1001` (created) |
| Region | Toronto, `yyz` |
| Compute | One shared CPU, 1 GB RAM; always running |
| Data | One 3 GB volume, `/data/distributor.db`, CA/CAD |
| Network | New custom private network `distributor-ca-sjs1001` |
| Public access | https://dstrbtr.ca/; website, native login and reviewed contractor enrollment |
| Image | Local Linux/amd64 build; no remote builder or CI runner |
| External integrations | Payment, accounting and carrier access disabled |

The same process serves the compiled React interface and native Fastify API.
Keep exactly one Machine: independent SQLite volumes do not replicate. This
pilot accepts downtime during a restart or deployment. Do not scale out or
create a second worker Machine with a separate database.

The root entrypoint checks that `/data` is a mount, sets only its root directory
ownership/mode, and executes Node as uid 1000. It refuses a missing volume rather
than writing the database to the ephemeral root filesystem. Source and installed
dependencies remain root-owned. Existing restored files must already be readable
and writable by uid 1000; startup deliberately does not recursively rewrite them.

The public website starts at `/`. Customers sign in at `/#customer-sign-in`; staff
use `/#admin-sign-in`; contractors apply at `/#apply`. The legacy `/#sign-in` link
still works. These entrances do not set roles: the server-authenticated account
determines access. Administrators review applications under System & controls →
Administration → Trade applications. Approved buyers activate with a private
24-hour invitation. Read [enrollment](ENROLLMENT.md) for review, explicit terms,
revocation and manual invitation delivery. Automated email delivery and email
verification are not configured.

## Cost reviewed before provisioning

Fly's calculator, inspected 2026-10-05 with one shared core, 1024 MB RAM, `yyz`,
3 GB volume, Small/10 GB bandwidth and no reservation or managed database, showed
**US$7.92/month**: compute $0.78, memory $6.69, volume $0.45. Budget roughly
US$10–15/month for this small pilot, excluding taxes; this is an estimate, not an
enforced spending cap. Account-wide allowances may already be consumed by other
applications. Snapshots and additional transfer can add charges.

Sources: [calculator](https://fly.io/calculator/),
[pricing](https://docs.fly.io/about/pricing/),
[configuration](https://docs.fly.io/reference/configuration/),
[custom private networks](https://docs.fly.io/networking/custom-private-networks/).
Recheck prices and account limits when provisioning. No paid managed Postgres,
dedicated IPv4, reservation, separate website host or domain is needed for this
first installation.

## Provisioning reference (initial installation completed)

Use this checkout and explicit Distributor app arguments throughout. Verify the
signed-in owner and chosen organization immediately before creation. Do not
reuse or modify another application's databases, credentials, networks or files.
If the provisional name is unavailable, update both `app` and `PUBLIC_ORIGIN` in
`fly.toml` to the new name before proceeding.

```sh
cd /Users/stevensmith/Documents/Distributor
/opt/homebrew/bin/flyctl auth whoami
/opt/homebrew/bin/flyctl config validate --config fly.toml
docker build --platform linux/amd64 -t distributor:fly-ca-preflight .
```

These commands record the approved initial resource creation; do not rerun them against existing resources:

```sh
/opt/homebrew/bin/flyctl apps create distributor-ca-sjs1001 \
  --org personal --network distributor-ca-sjs1001
/opt/homebrew/bin/flyctl volumes create distributor_data \
  --app distributor-ca-sjs1001 --region yyz --size 3
/opt/homebrew/bin/flyctl ips allocate-v4 --shared --app distributor-ca-sjs1001
/opt/homebrew/bin/flyctl ips allocate-v6 --app distributor-ca-sjs1001
/opt/homebrew/bin/flyctl deploy --config fly.toml --app distributor-ca-sjs1001 \
  --local-only --ha=false --strategy immediate
```

Inspect the resulting Machine/volume region, count, size and network; verify
HTTPS redirects, health, real browser assets and authentication before handing
out the link. Default Fly deployments can create spare Machines and use remote
builders; preserve `--ha=false` and `--local-only` on subsequent deployments.
The health route checks application startup/region, not every business workflow
or backup integrity. Do not add a release command: release Machines have no
access to the application volume.

Bootstrap the empty store using the existing native CLI through a protected SSH
session, executing as `node` in `/app`, with the chosen organization name and
administrator email. Send the initial bootstrap password through protected stdin, not
command arguments, logs or checked-in environment files. The later owner-approved
public test sign-in exception is described below.
Do not use `npm run demo`, copy a workstation database, or leave the default
synthetic organization/email. Confirm populated-store bootstrap refuses reuse.
See [user access](USER-ACCESS.md) for adding the second tester and required
password changes. Configure a persistent, separately retained MFA encryption
key before enabling authenticator enrollment; do not invent or discard keys.

## Data, recovery and remaining qualification

`yyz` constrains the primary Machine and attached volume location. It does not
prove all logs, snapshots, edge processing, account support or future provider
processing stays in Canada. Qualify these separately before promising strict
Canadian residency or loading real customer data. Provider exceptions remain
customer choices under the existing residency policy.

Five days of automatic Fly snapshots are requested. Snapshots alone are not a
qualified backup/restore procedure. Retain an independently recoverable backup,
verify its storage jurisdiction and encryption-key custody, and rehearse restore
before valuable business data is entrusted to this pilot. Use the existing
[recovery runbook](RECOVERY.md); do not claim the currently unconfigured restore
host authority/fencing adapter becomes implemented through Fly hosting.

Before each later upgrade, inspect the current schema and follow
[schema upgrades](SCHEMA-UPGRADES.md). Keep the previous image identity and a
reviewed database backup. A previous container image is not a safe rollback
across an incompatible schema change. Background provider/report workers remain
unscheduled and require their own bounded operating setup. Hosting is not
provider, finance, device, security or product-gate acceptance.

## Live domain and access

- Website: https://dstrbtr.ca/
- Customer login: https://dstrbtr.ca/#customer-sign-in
- Administration login: https://dstrbtr.ca/#admin-sign-in
- Contractor application: https://dstrbtr.ca/#apply

GoDaddy apex A `66.241.125.254` and AAAA `2a09:8280:1::1a8:520e:0` point to Fly.
The existing `www` CNAME points to the apex. `_acme-challenge` CNAME points to
`dstrbtr.ca.6kg5r23.flydns.net` for Fly certificate issuance/renewal; preserve it.
Registrar NS/SOA/domainconnect and DMARC records were preserved. No MX records
were present. Apex and www certificates are issued. HTTP redirects to HTTPS;
www and the Fly hostname redirect browser navigation to the canonical apex.
API mutations accept only the canonical Origin; aliases are not alternate login
origins. No DNS change for email delivery has been made.

Machine `817052c44d9028`, volume `vol_re1jk0pykok3pdd4`; one shared CPU, 1024 MB
RAM, encrypted 3-GB volume in Toronto. See the [launch receipt](evidence/LIVE-CANADA-LAUNCH-2026-10-05.md)
for image identity, migration and bounded live checks. MFA encryption key is a
Fly secret; protected initial administrator details and key custody are in the
ignored local `private-data/fly-ca/` directory. The administrator identity and initial password are retained only in that private directory; neither is published in repository documentation.
Move keys/password into the owner's durable password vault and select a new
private administrator password in the Security page. No automated mail provider
or recovery email is configured. The real pilot initially launched empty. The owner
subsequently authorized [Gree sample data in this pilot](GREE-PILOT-SAMPLE.md);
its stock, prices, customers and commercial records are explicitly fictional.

## Enrollment ingress and upgrades

`ENROLLMENT_ORGANIZATION_ID` binds applications to the one Canadian organization.
`ENROLLMENT_FLY_CLIENT_IP=true` accepts the single IP supplied by Fly's HTTP
handler only in Fly runtime with the IPv4 listener. The isolated custom network
and exclusively HTTP/TLS public services are part of this trust boundary; do not
add direct TCP ingress or an IPv6/private listener without requalifying it. Other
hosts ignore arbitrary forwarded headers. Invalid/missing Fly addresses fail
closed. See [Fly ingress documentation](https://docs.fly.io/networking/services).

The schema23→24 rollout stopped the application with `sleep infinity`, created
an encrypted old-image backup, downloaded it to protected owner-local storage,
and successfully decrypted/restored that archive in a network-disabled local
container. Candidate code upgraded a fresh clone; all 163 preexisting nonmetadata
tables (11 rows, including one administrator) compared equal. Original database
and sidecars remain in `/data/rollback-schema23-20261005/`; upgraded schema24
was activated at `/data/distributor.db`. The old image cannot open schema24.
This bounded backup check does not qualify the protected restore host authority,
RPO/RTO, storage jurisdiction or disaster recovery procedure.

For later code-only releases, local build and direct deployment remain permitted:

```sh
cd /Users/stevensmith/Documents/Distributor
/opt/homebrew/bin/flyctl deploy --config fly.toml --app distributor-ca-sjs1001 \
  --local-only --ha=false --strategy immediate
```

For every schema-changing release, stop writers, retain a recoverable encrypted
backup and previous image, upgrade a fresh clone with the reviewed source hash,
compare and review it, then activate during maintenance. Do not use the simple
code-only command to bypass that procedure. Explicit `app` process configuration
ensures a maintenance command is replaced on deployment. No CI, release Machine,
remote builder, scheduled worker or scale-out is configured.

## Storefront upgrade, 2026-10-05

Schema 25 and the four storefront features are now active on the same Toronto Machine. The [storefront release receipt](evidence/LIVE-STOREFRONT-2026-10-05.md) records the exact image, encrypted archive restore, source-preserving clone checks, sample access grants, live verification and retained schema-24 rollback pair. Earlier schema-23/24 receipts above remain historical; use the current image/schema pair when operating the pilot.


## Temporary public administrator pre-fill — 2026-10-05

The owner explicitly approved filling the existing pilot administrator email and
password for every visitor at `/#admin-sign-in`, because this installation is
being used with sample data. Testers only click **Sign in**. This intentionally
grants public access to the existing administrator account, including data and
user-account changes; it is not a separate isolated or read-only demo.

Runtime configuration is disabled by default. Enable only with
`PUBLIC_PILOT_ADMIN_SIGN_IN=true` and both `PUBLIC_PILOT_ADMIN_EMAIL` and
`PUBLIC_PILOT_ADMIN_PASSWORD`. The pilot deployment supplies these through Fly
configuration; credential values stay out of Git and compiled assets. While
enabled, the unauthenticated `/api/pilot-sign-in` response deliberately publishes
those credentials with `Cache-Control: no-store`. Configuration storage does not
make them private after enabling this feature. Normal password, MFA, role, Origin
and session checks still apply. A changed password must also update the runtime
value, or pre-filled login fails normally.

Customer and legacy sign-in do not auto-fill this account. Changing entrances
clears automatically filled values; a delayed response does not overwrite a
tester's manual edits. Failure to load configuration leaves ordinary login usable.

Before adding real data, disable `PUBLIC_PILOT_ADMIN_SIGN_IN` and redeploy/restart,
remove both credential configuration values, rotate the now-public administrator
password, and revoke existing sessions using the native security controls. Merely
hiding the UI is insufficient. No real-data readiness is asserted by this option.


## Temporary public customer pre-fill and phone scanner — 2026-10-05

The owner also requested customer pre-fill. Enable independently with
`PUBLIC_PILOT_CUSTOMER_SIGN_IN=true`, `PUBLIC_PILOT_CUSTOMER_EMAIL` and
`PUBLIC_PILOT_CUSTOMER_PASSWORD`. `GET /api/pilot-sign-in?audience=customer`
deliberately publishes those values with no-store; the default/admin audience
retains its existing administrator configuration. Both options default disabled.
Legacy sign-in remains manual.

The Canadian sample pilot uses a separate Public sample customer buyer on the
existing fictional approved customer account. The earlier buyer's changed password
and revision were preserved. Customer access uses normal authentication and
account/product purchasing permissions; it has no staff permissions. Before real
data, disable both public pre-fill flags, remove all four credential values,
rotate both published passwords and revoke their sessions.

`/#scanner` is a public camera reader with QR/copy/device-sharing links, also
linked beneath Administration. Email/SMS buttons open local composers, not an
internal delivery service. Physical iPhone behavior remains to be qualified; see
[scanning](SCANNING.md). No additional server or schema change is needed.

## Pricing and workflow upgrade, 2026-10-05

Current pilot source is `d65610e`, schema27, image `workflow27-20261005` on the same Toronto Machine. See the [pricing/workflow release receipt](evidence/LIVE-PRICING-WORKFLOWS-2026-10-05.md) for the encrypted restore,806-row conservation check, live browser proof and retained rollback pair. The optional internal scanner relay is implemented but unconfigured; [delivery setup](SCANNER-LINK-DELIVERY.md) describes the boundary.

## Navigation and notes upgrade, 2026-10-05

Source `a5ca594`, schema28, image `notes28-20261005` supersedes the pricing release above on the same Toronto Machine. See [navigation/notes release receipt](evidence/LIVE-NAVIGATION-NOTES-2026-10-05.md) for backup restoration,837-row conservation and live read-only checks. Five subsequent review/fix passes are tracked [here](evidence/FIVE-PASS-POLISH-2026-10-05.md).


## Five-pass polish release, 2026-10-05

Source `fa48391`, schema28, image `polish28-20261005` supersedes notes28 on the same Toronto Machine. Digest: `sha256:010d3013ada2ad079e5506b22466c8da3e26cee02519a4f1f5b66186f957e68c`. Local and deployed checks matched395 tracked source/package files; database integrity and foreign-key checks passed, and HTTP health is good. No schema migration was required. Previous `notes28-20261005` image and its encrypted restore-verified backup remain retained for recovery. Final desktop/phone-width guest/customer/admin checks passed. See the [completed five-pass review](evidence/FIVE-PASS-POLISH-2026-10-05.md) for exact evidence, historical failed harness checks and remaining qualification.

## UI polish and invoice detail release, 2026-10-06

Source `bd41544`, schema 29, image `polish29-20261006` supersedes `customers29b-20261005` on the same Toronto Machine. Digest `sha256:0196cfe5bae05686489ca12fbf3df803687ef5b1c808896c99a10a1fa77d1fd0`. This code-only release has no migration.

All 409 tracked source and package files matched the machine. Database integrity and foreign-key checks passed, and health is 200. The previous image is retained for rollback. Verification and limits are in the 2026-10-06 HANDOFF entry.

## Staff sign-out landing release, 2026-10-06

Source `828d878`, schema 29, image `polish29b-20261006` supersedes `polish29-20261006` on the same Toronto Machine (version 13). Digest `sha256:b0e456406d579658b778f44c3ec98493b10d13c3931da0e7e17e021a1714fa1d`. This code-only release has no migration. It was deployed from a clean export of the pushed commit.

- All 409 tracked source and package files matched the machine.
- Database integrity and foreign-key checks passed (0 violations).
- Health is 200 and the Fly health check passes.

A read-only live capture took 24 screenshots with 0 page errors and 0 business writes. It confirmed that the staff sign-out lands on "Administration sign in." `polish29-20261006` is retained for rollback.

## Session-ended handling release, 2026-10-06

Source `fd560fd`, schema 29, image `polish29c-20261006` supersedes `polish29b-20261006` on the same Toronto Machine (version 14). Digest `sha256:d318c9c9a3f61a7a7dc85852316ab099d93cc197ab483bf1a951ecf5886d2d63`. This code-only release has no migration. It was deployed from a clean export of the pushed commit.

- All 409 tracked source and package files matched the machine.
- Database integrity and foreign-key checks passed (0 violations).
- Health is 200 and the Fly health check passes.

A read-only live capture took 26 screenshots with 0 page errors and 0 business writes. It removed one administrator browser's cookie and then made an in-app read; that browser landed on "Administration sign in." with "Your session has ended. Sign in again." The abandoned server session was then signed out (200). `polish29b-20261006` is retained for rollback.

## Sign-in notice clearing release, 2026-10-06

Source `8b92c2f`, schema 29, image `polish29d-20261006` supersedes `polish29c-20261006` on the same Toronto Machine (version 15). Digest `sha256:9018b6ac1158a621e4615011ff022d41ded73d4c205582d881c13ae9407fd7c6`. This code-only release has no migration. It was deployed from a clean export of the pushed commit.

- All 409 tracked source and package files matched the machine.
- Database integrity and foreign-key checks passed (0 violations).
- Health is 200 and the Fly health check passes.

A read-only live capture took 28 screenshots with 0 page errors and 0 business writes. It confirmed:

- The session-ended notice appears at "Administration sign in.", and the abandoned session was signed out (200).
- Signing in again from that page leaves no notice (0 found).

`polish29c-20261006` is retained for rollback.
