# Operator-owned core and products

Implemented on 2026-10-16. Established staging has a real connected Voice installation; see [its deployment record](../STAGING.md). The separate fresh-core/Appflare milestone remains pending in [the live verification plan](milestone-deployment.md).

## Access boundary

The Cloudflare operator owns the instance, credentials, resource inventory and spending. Create an ordinary account first, inspect its Account ID, and pin that exact ID as `operatorUserId` in the own-account config. Setup writes it to the accounts Worker's `OPERATOR_USER_ID`. There is no first-signup promotion, email-based promotion, public provisioning endpoint, or browser-held Cloudflare token. Changing the pinned owner requires access to Worker configuration.

`VOICE_BILLING_MODE=owner_funded` explicitly authorizes the operator and accounts they grant to use the operator's resources. Other signups receive no Voice access. The operator can grant/revoke an existing account by ID on the product page, using `POST /products/voice/access`. The same boundary controls Cut's console link; Cut still authenticates its own administrators. Revocation invalidates Voice session validation and subsequent call authorization. Existing calls may finish within their 15-minute/60-turn bounds; revocation does not terminate an already-running model turn.

Voice asks `/internal/voice/authorize` before every new browser, text or signed carrier call. Missing core authorization, missing owner policy, a removed grant, and `managed` mode all deny usage. Managed mode is a reserved interface: no billing authorization adapter or metering service is implemented. No wallet access is implied.

Connected Voice defaults to **20 starts per rolling 24 hours for the entire instance and 2 concurrent calls**, in addition to existing per-user limits. These count failed/redacted calls and use a single atomic D1 insert across users. Limits are configurable in the install target (`dailyCallLimit`, `concurrentCallLimit`); invalid runtime values deny new calls. These bound call starts/duration/turns, not a currency spend guarantee. Standalone keeps its owner password and 100-start/3-concurrent limits.

## Fresh core, with zero installed products

Use Node 22.13+ and npm 10+. Copy `config/operator.example.json` to ignored `config/operator.json`. Choose your account, dedicated prefix, exact HTTPS origins, distinct account-scoped rate-limit namespaces, optional existing Appflare origin, and catalog selection. `products: []` gives an empty catalog; `['voice']` or `['voice','cut']` controls discovery. The separate `allowVoiceInstallation: true` enables operator requests; hiding a catalog entry does not change access or provisioning permission. Core deployment installs zero products in every case.

```sh
npm ci
npm run setup:core -- --config config/operator.json --plan
npm run setup:core -- --config config/operator.json
# The following changes live resources; run only for an authorized target.
npm run setup:core -- --config config/operator.json --deploy
```

Without `--deploy`, setup generates only ignored local Wrangler configs and private state. With `--plan`, it prints the target without authentication or writing config. With `--deploy`, it checks existing names/domains, creates a dedicated core D1, applies the additive core migrations, builds the console for the configured API, and deploys accounts plus console. Origins currently require custom domains in the chosen account; own-account setup does not provision DNS zones or an Appflare manager. Mainbrella production and established staging origins remain reserved for their existing commands.

New generated Voice targets default to the console's `/installed/voice/` path. Voice still owns its Worker, D1, Durable Objects and assets; console and accounts receive an optional private `VOICE` service binding only when Voice is installed. No new Voice hostname or certificate is required. An explicit separate `voiceOrigin` retains the older origin-based mode. A later core redeploy preserves an already-installed Voice binding; core-only setup still installs zero products.

Open the console, create your account, put its ID in `operatorUserId`, and rerun setup/deploy. Protect that account's password. Do this before installing Voice; public signup alone grants no paid use. Generated targets/state are in `.cache/core-installs/ACCOUNT-PREFIX/`. Keep an encrypted backup outside the public repository. No credentials belong in checked-in configuration.

`setup-core` pins a `CANOPY_INSTANCE_ID` marker in both core Workers and saves confirmed deployments in private inventory. A retry checks that marker against private state before touching an existing Worker, including recovery after a lost deploy response. A matching name without the marker is refused. Core bootstrap is a credentialed operator command, not an unattended lifecycle service.

## Request and install connected Voice

Select Voice for discovery, explicitly enable `allowVoiceInstallation`, and keep `VOICE_INSTALL_ENABLED=true` plus `VOICE_BILLING_MODE=owner_funded` in the accounts config. The console shows **Install Voice** only for the pinned operator. It submits a durable server-authorized request; it does not expose credentials or run a Cloudflare install in the browser. Duplicate requests retain the request ID. A failed request can be retried. **Check again** and reload reflect saved state.

Run the credentialed operator runner against the generated Voice target:

```sh
npm run install:voice -- --config .cache/core-installs/ACCOUNT-PREFIX/voice.json --plan
npm run install:voice -- --config .cache/core-installs/ACCOUNT-PREFIX/voice.json
```

The credentialed runner is required. To make the console Install/Retry actions execute automatically while your operator terminal is running, start:

```sh
npm run operator:run -- --config .cache/core-installs/ACCOUNT-PREFIX/voice.json --watch
```

It polls only the pinned owner's Voice requests, delegates to the same leased installer, and resumes interrupted work after lease expiry. Without `--watch`, it checks once. Ctrl-C stops its child and lease renewal. No Cloudflare credentials enter the console, and no hosted provisioning daemon is included. The direct `install:voice` command can also install without a console request. It verifies the pinned owner exists, atomically claims the installation identity and version, renews a short lease, creates only dedicated Voice resources, migrates/deploys Voice, checks authenticated schema/runtime evidence, installs the paired secret in accounts, and builds/deploys the console for the actual target. Credentials stay in Wrangler's local operator context. Private secrets and inventory are under `.cache/voice-installs/` with owner-only file modes. Back them up to recover from a fresh clone. Do not delete them as cache cleanup.

Two independent checkouts cannot adopt or lease one another's installation identity. Expired leases can be resumed only with the matching private state and source version. No automatic upgrade is offered. A successful retry of an already-installed matching version rechecks readiness without redeploying. An interrupted console deployment remains a failed installation and can be retried through the same request/runner. Success is published only after Voice, accounts, console and deployed-version inventory have all been verified/persisted.

The installer waits up to five minutes for transient DNS, connection timeouts and HTTP 502/503/504 readiness responses after deployment. It reports the hostname and failure while waiting; authentication, installation-ID and version mismatches still fail. A local resolver can cache a negative DNS answer longer than this window. If public DNS resolves the new hostname but the installer reports `ENOTFOUND`, let that resolver's cache expire and rerun the same command with the preserved private state. Do not recreate the database or change the hostname to bypass the failure.

A lost D1 creation response is ambiguous. The runner refuses to adopt a matching name without its recorded UUID, even if creation intent exists. Review the account, creation time and private intent against Cloudflare evidence, then explicitly pass `--recover-database UUID` with the original private state. Core setup supports the same recovery flag. A name alone never authorizes adoption.

`GET /products/voice` reports `not_installed`, `pending`, `installing`, `failed`, `unavailable`, or `ready`, plus caller access and operator controls. Mounted installations return the console `origin` plus `basePath: "/installed/voice"`; accounts checks readiness and issues handoffs through the private binding. `ready` requires exact installation ID/version, schema queries and configured AI/DO/calling bindings. It does not prove real inference. **Open Voice** obtains a short-lived single-use product handoff; product sessions still validate platform logout and access revocation. There is no password fallback in Canopy mode.

## Move an existing Voice installation to the console path

After reviewing and testing the intended source, use the existing target and preserved private state:

```sh
npm run install:voice -- --config config/voice.staging.json --mount --plan
npm run install:voice -- --config config/voice.staging.json --mount
```

This is an explicit one-time URL/source transition, not a general automatic upgrade. The installer verifies the previous inventory, refuses active calls or configured carriers requiring callback review, and leases the same installation ID and version transition. It retains the database, namespace, secret, workspaces and grants. Migration `015` adds a mount path to core inventory; existing rows keep their origin until explicitly moved. The original product SQL migrations are unchanged.

The move saves previous inventory/configuration as `before-mount.json` in the original private directory. Its recorded transition pins both old and new target/source versions for interrupted retries. Until completion, retry with the same `--mount` command and source; after success the target file contains the mounted URL and stable private `stateKey`, so normal installer/runner commands resume without `--mount`. Preserve the entire original private directory. Successful repeated verification does not redeploy an installed matching version.

Voice is built with `VOICE_BASE_PATH=/installed/voice` and the same prefix in its Worker configuration. Its standalone/Appflare build remains at `/` with no platform dependency. The console gateway forwards only Voice session cookies, passes WebSocket upgrades, and exposes only a secret-authenticated non-browser readiness probe under `/_canopy/`; account handoffs use the private binding. The existing `__Host-canopy_voice_session` cookie remains Secure/HttpOnly/SameSite=Strict with `Path=/`, distinct from accounts cookies. Mounted Voice shares the console's browser origin and is suitable for this maintained product; third-party Appflare apps retain separate origins.

The old Voice hostname is retained as a GET/HEAD redirect to the mounted app, preserving existing bookmarks. It no longer serves the old application or accepts mutation requests. New mounted installations have no product hostname at all. This move does not delete resources or configure carrier providers.

## Carrier ownership

Standalone retains its fixed owner agent and number bindings. Connected Voice requires both `VOICE_CARRIER_AGENT_ID` and `VOICE_CARRIER_USER_ID` in its Worker config. Select the authorized user's saved agent from Voice D1, and bind the operator-owned Twilio/Telnyx numbers/SIP destinations to that exact pair. This first adapter assigns all configured destinations to one workspace; it does not provide number purchasing or multi-workspace number allocation. Configure credentials server-side, using the existing [carrier guide](../products/voice/docs/telephony.md).

Signatures, account/application/destination checks, one-time media tokens, replay tombstones and hangup retries remain required. An unrelated agent cannot inherit these numbers. A revoked product user cannot start a new incoming call. Carrier mapping or provider-secret changes after an install require an explicit reviewed Worker reconfiguration; rerunning an already-installed source version deliberately does not reconfigure it.

## Appflare: install and reconcile Cut

Use a separately installed operator-owned Appflare manager. The supported path is its documented `/install/cut` admin review page, not an invented external install API. Set `APPFLARE_ORIGIN` through core setup and include `cut` in discovery. **Continue in Appflare** records the request, then navigates to that page. An Appflare admin must review and confirm installation there. Canopy's request does not install the app.

After Appflare reports installation complete, copy `config/appflare.example.json` inside Canopy, select its manager Worker/D1 and actual Cut install ID, then:

```sh
npm run register:appflare -- --config config/appflare.json --plan
npm run register:appflare -- --config config/appflare.json
```

The adapter reads Appflare's install/resources tables through the Cloudflare API and verifies its manager D1 binding, catalog source (`MendyLanda/cut`), pinned SHA, artifact digest, current 100% deployed Worker version, resource ownership and serving origin. It probes `/admin` and writes only Canopy's registration. It never writes Appflare's D1 or calls its internal admin server functions. Retrying reconciles the same install; replacing another registered install is rejected. Store the actual result in `.cache/appflare-installs/`.

Cut appears as **Registered**, with reachability checked on refresh, and **Open Cut** navigates to `/admin` without a Canopy handoff. Its Appflare-generated password remains necessary. This adapter supports the public Workers/custom-domain catalog artifact path; Cloudflare Access's sign-in redirect is not proof of app health. Canopy advertises no shared identity or billing. Appflare remains responsible for app lifecycle and updates; rerun reconciliation after an intentional Appflare version/origin change.

## Retention and removal

Core identity, Voice conversations, Appflare state and Cut links belong to distinct resources. Voice keeps 30-day transcript retention by default and retains replay tombstones. Stop incoming traffic and disable new calling before abandoning a test install; let carrier hangup retries finish. Export required data and record retention choices before cleanup. Delete only explicitly approved, recorded dedicated product resources. Never implicitly delete core/shared identity or another product's data. No destructive uninstall UI is implemented.
