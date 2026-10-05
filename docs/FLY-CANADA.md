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

The public website starts at `/`. Sign in at `/#sign-in`; contractors apply at
`/#apply`. Administrators review applications under System & controls →
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
administrator email. Send the initial password through protected stdin, not
command arguments, logs, checked-in environment files or a permanent Fly secret.
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
- Login: https://dstrbtr.ca/#sign-in
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
