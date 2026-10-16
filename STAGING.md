# Current product installation status — 2026-10-16

Established staging now has connected Voice installed. Recovery completed at **15:04:23 UTC on 2026-10-16**; the live `https://api-stg.mainbrella.com/products/voice` response reports `ready` at `https://voice-stg.mainbrella.com`. Cut remains `not_installed`. Earlier core-only deployment records below are historical.

The repository implements portable core setup, operator-only installation requests, product grants, owner-funded Voice limits, atomic installer leases, carrier workspace routing and Appflare/Cut inventory reconciliation. Staging's connected Voice runtime and paired core configuration are deployed; the independent Appflare/Cut workflow remains unverified live. `deploy:staging` still deploys **accounts and console only**; `deploy:staging:site` deploys **console only**. The separate Voice installer requires an existing pinned operator user and explicit owner-funded configuration. Catalog discovery is not product readiness.

See [operator installation](docs/operator-installation.md) for commands and recovery, and [the exact proposed resource/secret/retention plan](docs/milestone-deployment.md) for a separate fresh `canopy-m2` core, Voice, Appflare and Cut. **That separate plan's authorization and full live verification remain pending.** Do not replace historical IDs below with build or fixture IDs.

## Connected Voice installation and DNS recovery

The user configured the existing staging account as operator with explicit `owner_funded` policy and ran `install:voice` using `config/voice.staging.json`. The first attempt successfully created/migrated/deployed Voice but failed its immediate readiness fetch: local resolver `100.100.100.100` returned NXDOMAIN for the newly attached custom domain. The saved installation was resumed with its original identity, secret, database UUID and unchanged product source. No database was recreated or manually marked installed.

Cloudflare and Google DNS independently returned matching public A records. The recovery command used a private process-scoped DNS lookup override for `voice-stg.mainbrella.com` only, with ordinary HTTPS hostname/certificate verification. System DNS settings were unchanged. The same credentialed CLI then verified exact authenticated runtime identity/version, deployed accounts with the paired secret and the staging console, persisted version inventory, and published installation success.

| Resource | Actual identity / deployed version |
| --- | --- |
| Voice installation | `3f90a4c4-d1d6-4dde-af40-935571e8afa0` |
| Voice Worker | `canopy-voice-stg`, version `10ec9b25-2dd3-45f4-95ee-a9209b8cb963` |
| Voice D1 | `canopy-voice-stg`, UUID `ca4ffd2f-1a5a-4085-a367-c5d20624a29b` |
| Voice Durable Object namespace | `52f306893ed743b88cdadd96b0ab1519`, `ReceptionistCall` |
| Accounts Worker | `canopy-accounts-stg`, version `02be0005-5ae8-4a84-b6c4-a8a9e2088506` |
| Console Worker | `canopy-console-stg`, version `6c050d4f-2e69-4671-b36e-70d978614e0b` |
| Product source | `0631dd11563dc636dd10cbba294e505772ea31b3` with dirty working tree, fingerprint version `0.1.0+a86a292f4148b67f` |

Exact hashes, deployed versions and recovery evidence remain private in `.cache/voice-installs/bb5c3a21c28c623d/{inventory,dns-recovery-result}.json`; preserve the entire directory and its secret/recovery files. The scoped DNS loader is a one-run recovery artifact and must not become a permanent DNS configuration.

Installer readiness now retries transient DNS, network timeouts and HTTP 502/503/504 for up to five minutes, preserving identity/version/authentication checks and cancellation. All **12 installer/operator script tests** passed, including the two new retry regressions; Voice client and staging console builds passed during the actual installation. The earlier full unit/browser suites were not rerun for this installer-only change. The live core API independently returned `ready` after completion. Signed-in opening, real inference, carrier behavior and the four deployed browser viewports were not verified in this recovery; no inference or carrier action was performed. This establishes staging installation readiness, not the separate fresh-core/Appflare milestone.

---

# Canopy staging

The dark product home and account dropdown are deployed and verified on staging
as of **2026-10-16**. The deployment records below distinguish the initial
email/password milestone from the latest shell deployment and hosted smoke test.

Staging uses the existing Mainbrella Cloudflare account
`2b7a9be82bb64187230703b024e25157`, with separate resources:

| Resource | Staging | Existing production (unchanged) |
| --- | --- | --- |
| Console Worker / custom domain | `canopy-console-stg` / `stg.mainbrella.com` | `mainbrella-web` / `mainbrella.com` |
| Accounts Worker / custom domain | `canopy-accounts-stg` / `api-stg.mainbrella.com` | `mainbrella-api` / `api.mainbrella.com` |
| D1 | Fresh `canopy-accounts-stg` | `delta` |
| Rate-limit namespaces | `2001` (email), `2002` (Google) | Existing namespaces unchanged |
| Session cookie | `__Host-canopy_stg_session` | `mainbrella_session` |

The staging configurations are `platform/accounts/wrangler.staging.jsonc` and
`platform/console/wrangler.staging.jsonc`. The default accounts configuration
remains local-only. No production bindings, service bindings, cron jobs, buckets,
customer data, or OAuth settings are copied. Billing and account quotas are
shared because these resources use the same Cloudflare account.

## Routing and sessions

The console's staging build calls `https://api-stg.mainbrella.com/auth/*` directly
with credentials. It does not need Vite's development proxy. The API allows only
the exact browser origin `https://stg.mainbrella.com`; production and localhost
origins are rejected. Requests without an Origin header still support API clients.

Staging cookies are host-only (no Domain), HttpOnly, Secure, Path=/,
SameSite=None, and retain the existing 30-day lifetime. The `__Host-` prefix
prevents a parent-domain cookie from impersonating this cookie in compliant
browsers. Both staging hosts are HTTPS and belong to the same site. Production
cookie names are ignored by the staging API; staging sessions live in its D1 only.

Google is disabled in both staging builds and API configuration. In particular,
the staging build cannot inherit `VITE_GOOGLE_CLIENT_ID` from ignored local env
files. Email/password authentication works independently. A separate test Web
OAuth client and an authorized `https://stg.mainbrella.com` origin are needed
before enabling and testing Google. The existing verifier still fetches Google's
fixed key endpoint per verification with a five-second timeout; no application
key cache is introduced here. Real Google verification and a caching review
remain a separate checkpoint. Production OAuth is unchanged.

## Prepare and deploy

Run only from Canopy, with Node 22.13+ and npm 10+. Wrangler's logs, credentials,
and cache stay under ignored `.cache/`; sibling repositories remain read-only.

```sh
node scripts/wrangler.mjs staging login   # If not already authenticated here
node scripts/wrangler.mjs staging whoami
npm run check
npm run build:staging
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser
```

If a remote command reports `Authentication error [code: 10000]` or
`Invalid access token [code: 9109]`, repeat the repository's `staging login`
command, complete browser authentication, and confirm `staging whoami` succeeds
before retrying deployment. This refreshes Canopy's isolated credentials under
`.cache/`; an expired OAuth session may fail automatic refresh.

Before the first deployment, check the account's Worker domains and routes for
both production and staging hosts, verify that the staging hostnames are free,
and record production deployment IDs. Cloudflare creates the new DNS records and
certificates for Worker custom domains; do not replace existing conflicting DNS.

For a new database only:

```sh
npm run db:create:staging
# Put the returned NEW database ID in platform/accounts/wrangler.staging.jsonc.
npm run deploy:staging
```

The deployment command runs checks and staging builds, applies the identity
migrations to staging, deploys the API, then deploys the console. It creates no
database automatically. These three migrations (`001`, `002`, `012`) initialize
a fresh identity database only; never point them at `delta` or an imported
production database. Keep the existing filenames and SQL unchanged.

Repeat deployment uses the existing recorded database; do not run the database
creation command again.

For frontend-only changes (HTML, CSS, browser code, and public assets), use:

```sh
npm run deploy:staging:site
```

This builds the console once in staging mode, then deploys only
`canopy-console-stg` at `stg.mainbrella.com` through the restricted Wrangler
wrapper. It skips type checks, tests, local builds, Wrangler dry runs, database
migrations, and API deployment. The staging API configuration and Google-disabled
build settings still apply. Use the full `npm run deploy:staging` when changes
also require API or database updates; run checks separately as needed.

After deployment, run the explicitly remote smoke test:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run smoke:staging
```

This creates one disposable account in staging per run, exercises the real hosted
email flow, and saves its result and viewport screenshots in ignored
`test-results/staging/`. It does not authenticate with Google or create
production accounts.

The wrapper exposes fixed staging commands, rejects arbitrary arguments, checks
the staging names/account/domains, and rejects the production `delta` ID. The
separate `dist-staging` output keeps local and staging console builds independent.
CI builds and tests locally; it does not deploy.

## Verify after deployment

1. Confirm HTTPS for both staging hosts and a working console root page.
2. In a real browser at `https://stg.mainbrella.com`, create a disposable email
   account, reload, sign out, sign in again, and verify the session is revoked
   after logout. Check the API calls use `api-stg.mainbrella.com` and the cookie
   uses the staging name, Secure, HttpOnly, and no Domain attribute.
3. Verify preflight/credentialed responses accept the staging console and reject
   `https://mainbrella.com` and localhost. Check Google fails closed and its UI
   is absent. Check all four supported viewport sizes.
4. Recheck production Worker deployments, domain associations, and routes against
   the recorded values; do not create production accounts as part of testing.

## Teardown

Remove only the custom domains `stg.mainbrella.com` and `api-stg.mainbrella.com`
from their Canopy Workers, then delete `canopy-console-stg` and
`canopy-accounts-stg`. Confirm whether any staging account data must be retained
before separately deleting D1 `canopy-accounts-stg` by its recorded UUID. Worker
deletion does not imply database deletion. Keep production Workers, domains,
routes, databases, and OAuth configuration intact. Teardown is documented here,
not part of normal deployment or authorization to delete staging data.

## Initial deployment record

Deployed and verified on **2026-10-16**:

- D1 `canopy-accounts-stg`: `824e7e4b-b015-416a-93ec-f09ad56ef4d9`.
  Applied `001_initial.sql`, `002_auth_sessions.sql`, and
  `012_email_password.sql` to this newly created empty database.
- API Worker version: `2b78dc86-768c-455c-9179-e6f3f57d1df8`.
- Console Worker version: `82eceff5-f912-4437-8143-4272cf8e0a68`.
- All TypeScript checks, 23 auth/client tests, local builds, both staging dry-run
  builds, and 14 local browser tests passed. No dependencies added.
- Real Chromium smoke test at the hosted console passed signup, reload, logout,
  replay of a revoked session, wrong password, returning login, staging-only
  API requests, secure host-only cookies, allowed/rejected CORS preflights,
  disabled Google, four viewport sizes, and no browser script errors.
- Production custom domains, Worker deployment records, and zone Worker routes
  matched the pre-deployment snapshots. Both production URLs returned HTTP 200
  on read-only checks. No production resources or sibling files were changed.
- Local snapshots are under ignored `.cache/staging/`; hosted browser results
  and screenshots are under ignored `test-results/staging/`. This is local
  operator verification, not evidence of a completed remote CI run.

## Shell deployment record

The operator redeployed both staging Workers on **2026-10-16** from checkout
`cfb462a7a5623c627da07c097c8f1cb83658c7ba` with existing working-tree edits.
Cloudflare's read-only deployment records confirm these active versions:

- API: `9e9afc94-6f43-45cc-aee2-7fc3efeea59e`, deployed at 12:26:06 UTC.
- Console: `1143a1a7-0c6c-4ffc-b45c-b628f8df50e8`, deployed at 12:26:11 UTC.
- D1 remains `824e7e4b-b015-416a-93ec-f09ad56ef4d9`; the migration command
  reported no migrations to apply. No new resources were provisioned.
- The supplied deployment log confirms type checks, 23 account/client tests,
  64 Voice tests, local builds and staging dry runs passed. Voice was built and
  tested locally; only accounts and the console were deployed.
- `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run smoke:staging`
  passed against the hosted shell at **12:27:46 UTC**: product home, signup,
  reload, logout/revocation, wrong password, returning login, staging-only API
  calls, secure host-only cookies, exact CORS allowlisting, disabled Google,
  all four viewport sizes, and no browser script errors. The smoke script now
  waits for account details after reload before capturing account screenshots.
  Two smoke runs created two disposable staging accounts; both signed out.
- Active staging versions and domain associations were checked through the
  Cloudflare API. Production API deployments, production domains, and zone
  routes match the earlier 11:24:54 UTC snapshot. Production web already had a
  newer deployment at 12:09:42 UTC (version
  `8ce0582e-22d5-439a-8102-3c9b9eab3e5c`), before this staging redeploy, so it
  does not match that older baseline. Verification performed no production writes.
- Read-only deployment evidence is saved in ignored
  `.cache/staging/redeploy-2026-10-16.json`; the latest smoke result and viewport
  screenshots are in ignored `test-results/staging/`. These are operator-run
  and local browser results, not remote CI results.

Real Google authentication remains unverified and disabled on staging. No
production OAuth client or origins were reused or modified.

At the time of the historical shell record above, Voice had only been extracted
and verified locally. Its later real staging Worker, database, domain and
installation record are recorded in the connected Voice recovery section at the
top of this document. Core staging deploy commands continue to target only
console and accounts; product installation uses the separate installer. See
[Voice installation](products/voice/docs/installation.md).
