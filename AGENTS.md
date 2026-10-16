# Canopy working notes

## Scope and working rules

- Canopy is a gradual restart of the Mainbrella platform. Move one small,
  independently verifiable slice at a time.
- **Write only inside this repository. All sibling directories are read-only**,
  including `../web`, `../backend`, `../raindrop`, and `../ai-receptionist`.
  Do not run sibling install, build, test, migration, or deployment commands;
  those can write generated files or change state. Inspect their source instead.
- Existing sibling deployments and customer data remain authoritative. Work here
  does not authorize changing their Workers, databases, OAuth configuration,
  domains, wallets, or other live resources.
- Inspect current code and Git status before editing. Preserve unrelated changes.
  Prefer the smallest coherent change and the existing TypeScript/npm/Vite/Worker
  patterns. Add dependencies only for a concrete need.
- Keep builds and tests self-contained. No runtime imports or dependency links
  into sibling repositories. Record copied/adapted source in
  [migration-sources.json](migration-sources.json), including its actual source
  revision, file hash, destination, and intentional differences.
- Use compact, accessible product UI: ordinary headings, labeled forms, account
  rows, useful feedback, and readable spacing. Avoid heroes, decorative cards,
  marketing copy, and extra controls. Preserve keyboard access and responsive
  behavior at 390×844, 768×1024, 1280×800, and 1440×900.
- Validate the affected behavior and report results and limitations. Documentation
  changes do not require rerunning application tests. Update these handoff notes
  when a milestone is completed or its scope changes.

## Where work stopped

Handoff updated **2026-10-16**, with Voice extraction in the working tree after
commit `3d09706e`. Completed milestones:

| Milestone | Commit | Status |
| --- | --- | --- |
| Local email/password accounts, sessions, shared contracts/client | `94f620c` | Implemented and locally verified |
| Optional Google browser sign-in | `922cf30` | Implemented and automatically tested; real provider verification pending |
| Isolated email/password staging | `394eeb5` | Deployed and verified; deployment record in `STAGING.md` |
| Dark console theme | `570ffa6` | Implemented and locally verified; deployment not recorded |
| Product shell, catalog placeholders, account menu | `61180e1` | Implemented and locally verified; deployment not recorded |
| Fast frontend-only staging deployment command | `2f5956e` | Implemented; staging build and dry run verified |
| Standalone Voice product extraction | Working tree | Implemented and locally verified; no deployment or console installation |

**Next implementation milestone: install and open Voice from the Canopy console.**
Voice's runtime, UI, owner adapter, and independent build/export now exist in
`products/voice`. No console installation API, persistent installation state,
provisioning flow, or account handoff exists yet. The console catalog is still
presentation only. Real Google verification remains pending but does not block
this next milestone; email/password is available.
This sequencing supersedes the older next-checkpoint paragraph in the README;
the README's broader product architecture remains a plan, not completed work.

Last implementation handoff: **2026-10-16**. The first account milestone is in
commit `94f620c` (`first brella under`). The **Google browser sign-in milestone is
complete** in commit `922cf30` (`google`), including the optional console control,
shared client, Worker verification, identity-conflict protection, and automated
regressions. Real Google login remains an outstanding verification checkpoint.
The isolated **email/password staging milestone is also deployed and verified**
on 2026-10-16 at `https://stg.mainbrella.com`, using
`https://api-stg.mainbrella.com`. See [STAGING.md](STAGING.md) for the deployment
record, repeatable commands, verification, and teardown.
The [README](README.md) contains setup instructions, the inspected source
inventory, and the broader migration plan; distinguish that plan from working code.

Console appearance updated on **2026-10-16**: dark theme for sign-in and account
views, native controls, focus/error states, and the optional Google button.
Layout and authentication behavior are unchanged. Type checks, local/staging
console builds, and all 14 local browser tests passed; screenshots were inspected
across the four target viewport sizes and palette contrast checked. Google UI
checks still use the stub SDK. This theme change has not been deployed.

Console shell added on **2026-10-16** as the first slice toward a reference
Mainbrella deployment in an operator's own Cloudflare account. The home lists
Compute, Builder, and Voice as **Not installed**, with honest placeholder pages,
a shared Mainbrella header/footer, and a keyboard-accessible account dropdown.
Public build-time settings in `platform/console/src/console-config.ts` control
the instance name and catalog visibility. These settings do not provision,
authorize, disable, or uninstall services. The Appflare catalog is an external
link only; runtime lifecycle controls and Appflare integration remain deferred.
Fragment routes preserve the existing static Worker configuration. The shell
adapts only the old web brand/chrome/disclosure patterns, with provenance in
`migration-sources.json`. All sibling checkouts remained read-only.

Verification: `npm run check` (23 auth/client tests), `npm run build:staging`, and
21 local browser tests passed. New checks cover product navigation/reload/history,
hidden products and an empty catalog, session-service failure, account-menu
keyboard/outside-click/focus dismissal, and the four target viewport sizes.
Screenshots were inspected. Google UI checks still use a stub SDK. The hosted
smoke script now follows the new product home and account dropdown; it has not
been run against this revision. The shell and dark theme have not been deployed.

Implemented:

| Location | Responsibility |
| --- | --- |
| `platform/accounts/` | Local Cloudflare Worker, email/password and Google browser signup/sign-in, shared sessions/logout, and identity SQL migrations |
| `platform/console/` | Dark Vite/TypeScript product shell, configurable public catalog, account dropdown, email form, optional Google control with loading/retry, and read-only account details |
| `packages/contracts/` | Public user/session types and runtime response validation |
| `packages/platform-client/` | Shared credentialed auth client with injectable fetch and no browser globals |
| `products/voice/` | Self-contained Voice Worker/UI, single-owner auth, D1/DO lifecycle, speech/telephony, transcript history and independent source export |
| `scripts/` | Local stack startup/cleanup, restricted Wrangler commands, staging deployment and hosted smoke test |
| `.github/workflows/ci.yml` | Clean install, type checks, auth tests, local/staging builds, and browser checks; no deployment |

Current API: `POST /auth/email`, `POST /auth/google`, `GET /auth/me`, and
`POST /auth/logout`.
An unused email creates a new local account; an existing email authenticates it.
Session responses retain the backend's `id`, `email`, `name`, `dob`, and
`created_at` fields. Preserve the existing scrypt parameters, password checks,
concurrent-signup behavior, hashed session tokens, and 30-day lifetime.

Important boundaries and implementation notes:

- Local and staging accounts are separate from production Mainbrella accounts.
  No customer data or production bindings were imported. Only dedicated Canopy
  staging resources were deployed; production remains unchanged.
- The three identity migrations (`001`, `002`, `012`) are byte-identical source
  copies for fresh local or isolated staging identity databases. They are **not**
  the complete `delta` migration stream. Do not renumber them or apply this subset
  to production or imported data.
- Loopback requests with `LOCAL_DEVELOPMENT=true` use `canopy_session` with
  HttpOnly/SameSite=Lax. This avoids overwriting sibling localhost sessions.
  Other hosts retain the original Secure/SameSite=None behavior. Do not broaden
  the development exception or origin allowlist to bypass authentication issues.
- Worker bindings use explicit types imported from
  `@cloudflare/workers-types/index.ts`. Loading its global declarations alongside
  Node types caused a `Buffer` collision; keep the module-based approach.
- Vite's `/auth` proxy is development-only. The separate staging console build
  explicitly calls `https://api-stg.mainbrella.com` with credentials. Its API
  allows exactly `https://stg.mainbrella.com`; production and localhost origins
  are rejected. The staging cookie is `__Host-canopy_stg_session`, Secure,
  HttpOnly, host-only, and independent from local and production sessions.
- Google is optional: set the same explicit test client ID as `GOOGLE_CLIENT_ID`
  in `platform/accounts/.dev.vars` and `VITE_GOOGLE_CLIENT_ID` in
  `platform/console/.env.local`. Both files are ignored. With no console client
  ID, no Google control or script is loaded; with no Worker client ID, the route
  fails closed. There is no production client fallback or configurable key URL.
- Google verification uses the source's RS256 signature, issuer, audience,
  expiry, issued-at and verified-email checks, with strict claim types, email
  validation, a bounded key-fetch timeout, and private provider errors. Google
  has a separate 20-attempts/minute/IP limiter; email limits are unchanged.
- Google subject lookup is stable across email changes. A Google credential
  cannot claim a password account or another Google subject. Conditional SQL
  guards concurrent signup/linking; only legacy rows with neither credential
  may be linked. Both providers use the existing session/cookie/logout code.
- Native sign-in, password recovery, welcome email, analytics/consent
  integrations, profile editing, API keys, billing, projects, admin screens,
  Compute, and Builder are outside the completed milestones. Voice is packaged
  separately with owner authentication; hosted identity/billing and console
  installation remain unfinished.
- At the initial inventory, `backend/docs/source-ownership.md` was untracked and
  described a source layout absent from the actual tree. Do not assume those
  moves occurred; inspect current source and the recorded revisions. That file
  and all sibling working-tree changes were left untouched.

## Run and verify

Use Node 22.13+ and npm 10+; CI uses Node 22. From Canopy:

```sh
npm ci
npm run dev
```

Console: `http://127.0.0.1:5175`; accounts Worker: `127.0.0.1:8789`.
Startup checks both ports, applies local migrations, and starts both processes.
Ctrl-C stops the stack. Local D1 persists under `platform/accounts/.wrangler/`;
caches/logs are ignored under `.cache/`. Do not delete local state casually.

```sh
npm run check
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser
```

An installed Chrome/Chromium executable can instead be selected with
`CANOPY_CHROMIUM_PATH`. Browser tests start their own stack, require both ports
to be free, and create test accounts in the local development database.
Screenshots are in ignored `test-results/`.

Verification recorded for the completed Google milestone:

- All TypeScript checks, Worker dry-run build, and console build. No dependencies
  were added; the initial milestone had also verified a fresh `npm ci`.
- 22 auth/client tests, including real local RSA signing and signature checks,
  invalid claims/keys, provider failures, identity conflicts, concurrent
  signup/linking, plus the existing password/session/origin/rate regressions.
- 14 browser tests: 6 existing email/session tests against real local D1 and
  8 Google UI tests with a stubbed SDK/API. These cover configured/absent Google,
  script timeout/retry, email fallback, duplicate/late callbacks, logout,
  keyboard controls and all four viewport sizes. Screenshots were inspected;
  Google screenshots use the test button, not Google's hosted iframe.
- Source hashes matched the provenance manifest; all three migration copies
  were unchanged; sibling Git statuses were unchanged.
- Browser teardown released both ports. Preserve the process-group cleanup and
  Playwright graceful shutdown from the first milestone. npm may log exit 143
  when Vite is terminated during teardown; the browser command exits successfully.

These are the local Google milestone results, not evidence of Google working
on the hosted staging deployment or of a completed remote CI run. Google browser
tests do not authenticate with Google; Worker tests stub Google's key response.
A real Google smoke test was **not run** because no explicit test OAuth client
was supplied.

## Completed slice — standalone Voice extraction

The user requested moving Voice from `../backend` and `../web`, using the existing
standalone extraction as reference. The adopted implementation is in
`products/voice`, based on `ai-receptionist` at
`7d3e023318f36f7a45e5d155c46d96e3896f9502`, compared against backend
`0bc20dec148c1a78b40aa252a76735103d1dbe1f` and web
`3dcea8975e2936ec26da95395b5df3f9042fa5f0`. Identical hosted speech/telephony helpers,
browser transport and number-search tests were copied directly where applicable.
`migration-sources.json` records all copied hashes, actual revisions, adaptations,
and the hosted comparison inventory. All siblings remained read-only.

The product retains one receptionist, owner password authentication, browser/text
calls, Twilio/Telnyx webhooks and media bridges, speech/language settings, number
search, call history, transcript deletion/retention, limits and replay protection.
Its three standalone SQL migrations are unchanged; they belong to Voice's own D1,
never the accounts database or `delta`. The class `ReceptionistCall`, Durable Object
migration `v1`, and provider routes are preserved. The runtime has no sibling
imports, shared platform database access, hosted wallet, or production bindings.

Use `npm run dev:voice` after setting a private password in
`products/voice/.dev.vars` and running
`npm run db:migrate:local --workspace @canopy/voice`. The product runs at
`http://127.0.0.1:8791`; normal local runs disable remote bindings and calling.
The `canopy_voice_session` cookie is distinct from Canopy accounts and older
standalone localhost installs. Worker bindings use an explicit Env module, with
Worker and client globals checked separately. Runtime SDK dependencies are
retained; Wrangler/Worker types and the patched Miniflare test runtime align with
the existing workspace toolchain.

Canopy is the maintained source for this extracted product. `npm run export:voice`
from a clean commit creates `products/voice/dist/source` with the product source,
license, provenance, source revision and its own lockfile. It preserves every
dependency resolution from the root lock and needs no platform workspace to build.
`-- --allow-dirty` marks verification exports as not releases. This export and the
monorepo Appflare template distribute the same implementation; no third engine
or speculative shared package was introduced. Existing sibling deployments still
use their existing code until an intentional release transition.

Verification: `npm run check` passed 23 account/client tests and 64 Voice tests,
all type checks and builds. `npm run build:staging` and 21 existing account/console/
Google browser tests passed. Six new Voice browser tests passed owner login,
save/reload, a full text turn through the real local call runtime, history,
transcript deletion, logout, errors/retry, keyboard controls and all four target
viewports including dialogs. Screenshots were inspected. A product-only export
passed a separate install, type checks, build and 64 tests. Normal local Wrangler
startup, migrations and unauthenticated access checks also passed. Tests use
deterministic AI/carrier fixtures; no paid inference or real phone call was made.

The [installation boundary](products/voice/docs/installation.md) records ownership,
operator authorization, credentials, retention, direct Wrangler setup and cleanup.
The [Appflare template](products/voice/docs/appflare.md) targets a future published
Canopy pin and has not been packed or installed remotely. No target account or live
Voice resources were selected. Staging commands still deploy only accounts and the
console. This completes packaging, not the full install/status/open milestone.

## Next milestone — first product installation

The goal is one complete path: an authorized operator chooses a product in Canopy,
installs it into the operator's Cloudflare account, sees its actual installation
status after reload, and opens a working product. A catalog link, a configuration
toggle, or a successful build alone does not complete this milestone.

**Voice is selected and packaged** with the single-owner standalone boundary
described above. Continue from that code and its installation documentation.
Recheck the source pin and current Appflare packaging when implementing the adapter.
Do not repeat the extraction or bundle full hosted/standalone engine convergence
into the first install unless required by the chosen path. The product source
export is its independent distribution boundary.

Work in these independently verifiable slices:

1. **Define the install boundary.** Record the chosen product, source/build version,
   target account, resource ownership, required settings and secrets, and the
   operator authorization model. Existing self-service signup does not confer
   permission to provision resources. Inspect Appflare's current supported install
   path and integration surface before choosing an adapter; the existing external
   link is not an integration. Reuse a supported installer where practical rather
   than building a general marketplace. Recheck packaging compatibility before
   selecting Compute or Builder; do not assume their bindings are supported.
2. **Package one working product.** Keep its implementation and deploy configuration
   under `products/<product>`, with only necessary shared contracts. Include its
   runtime, UI, migrations and explicit resource bindings as needed. Build without
   sibling imports or installs, record copied/adapted source provenance, and avoid
   production Mainbrella dependencies. Preserve a supported standalone install
   boundary; unrelated products and hosted billing must not be prerequisites.
3. **Connect installation to Canopy.** Add the smallest server-side install/status
   contract and compact console flow for that product. Keep provisioning credentials
   out of browser code. Persist the installation identity, version and owned
   resource references. Enforce operator permissions server-side, handle duplicate
   requests and interrupted attempts without creating duplicate resources, and show
   useful pending/failure/retry feedback. Determine readiness from deployed runtime
   evidence, not catalog visibility or an optimistic client flag. Open the product
   with an explicit authentication handoff; do not assume cookies cross hosts.
4. **Prove the complete path.** Test unauthorized access, successful install,
   duplicate requests, failure/retry, reload, runtime health and opening the product
   to perform one useful action. Verify the relevant keyboard and viewport behavior.
   Record a real install into dedicated test resources separately from mocks and
   dry runs, including installed version, resource inventory and cleanup procedure.
   Define partial-install cleanup and data retention before exposing removal;
   deleting shared identity or unrelated resources must never be implicit.

Done means the console can install, report and open that one usable product, the
product has a reproducible independent build/install path, and the real test
deployment is recorded. Run the affected checks and auth regressions, then update
this handoff, README and deployment documentation with what actually works.
This handoff update authorizes no new deployment or production changes; retain the
existing staging scope and resource boundaries when planning the test install.

Defer additional products, a general installer framework, automatic upgrades,
billing/wallet migration, production data migration and destructive uninstall UI.
The shell/theme also still need a recorded staging deployment and hosted smoke
result; do not treat the earlier account-only smoke as verification of this shell.

## Pending checkpoint — real Google smoke test

The implementation milestone is done; do not repeat the Google extraction or
bundle another product into it. Its sources were reinspected at the revisions
recorded in `migration-sources.json`.

Use an explicitly supplied separate test Web OAuth client, follow the README
configuration, and open `http://localhost:5175`. Verify Google account creation,
repeat login, reload, logout, and rejection of a password account with the same
email. Record the real provider result separately from the automated tests and
update these notes. Without that test client, leave this checkpoint pending and
keep Google optional. Do not change production OAuth origins or use the sibling
production client as a fallback.

## Completed milestone — isolated staging deployment

The user authorized separate staging hosts before real Google verification;
Google remains disabled there. Staging uses the same Cloudflare account as
production, `2b7a9be82bb64187230703b024e25157`, with these dedicated resources:

| Resource | Staging |
| --- | --- |
| Console | `canopy-console-stg` at `stg.mainbrella.com` |
| API | `canopy-accounts-stg` at `api-stg.mainbrella.com` |
| D1 | `canopy-accounts-stg`, UUID `824e7e4b-b015-416a-93ec-f09ad56ef4d9` |
| Rate-limit namespaces | `2001` (email), `2002` (Google) |

The Worker versions and detailed verification record are in [STAGING.md](STAGING.md).
Production `mainbrella-web`, `mainbrella-api`, `mainbrella.com`,
`api.mainbrella.com`, and `delta` are unchanged. Account billing and quotas
are shared; data, Workers, origins, cookies, and bindings are separate.

Use `npm run build:staging` for local staging builds and dry runs.
`npm run deploy:staging` checks, builds, migrates only the staging database,
and deploys only the staging Workers. The Wrangler wrapper accepts fixed staging
actions; existing local commands remain restricted. Credentials, logs, snapshots,
and caches stay inside ignored `.cache/`. Do not recreate the existing staging
database or migrate production data. CI includes staging dry runs but no deploy.

Added `npm run deploy:staging:site` on **2026-10-16** for fast frontend-only
updates. It builds the console in staging mode once and uses the existing
restricted `staging deploy:console` action. It skips checks, tests, local builds,
dry runs, migrations, and API deployment; use the full command for backend
changes. The staging console build and console Wrangler dry run passed. No
remote deployment was performed while adding this command.

Verification passed: all TypeScript checks, 23 auth/client tests, local and
staging builds, 14 local browser tests, and a real hosted Chromium email smoke
test. The hosted test verified signup, returning login, reload, logout/revocation,
wrong passwords, cross-origin credentialed API calls, secure host-only staging
cookies, exact CORS allowlisting, disabled Google, four viewport sizes, and no
browser script errors. Repeat with
`PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run smoke:staging`;
each run creates one disposable staging account and saves ignored results under
`test-results/staging/`. Production deployment records, custom domains, and
zone Worker routes matched the pre-deployment snapshots; read-only production
HTTP checks returned 200. Sibling working trees were left unchanged. These are
operator-run checks, not a remote CI result.

The real Google checkpoint remains pending. Before enabling it on staging,
supply a separate test Web OAuth client authorized for
`https://stg.mainbrella.com`, review the verifier's per-request key fetching
and caching, and enable the explicit client ID in both staging builds/configs.
Do not inherit ignored local client IDs or reuse production OAuth settings.
Billing, Raindrop, and other product migrations remain deferred.
