# Canopy working notes

Handoff updated **2026-10-16**, after reviewing commits `038501a` through
`604eb12` (`installed`). This is the current implementation handoff; older
milestone prose in README, STAGING, and Voice installation docs has not yet been
reconciled with `604eb12`. Follow actual code and the distinctions below.

## Scope and working rules

- Canopy is a gradual restart of Mainbrella. Move in small, independently
  verifiable slices; preserve unrelated changes in a dirty worktree.
- **Write only inside this repository. All sibling directories are read-only**,
  including `../web`, `../backend`, `../raindrop`, `../ai-receptionist`, and
  `../appflare`. Inspect their source; do not run sibling install, build, test,
  migration, or deployment commands, which can change files or live state.
- Existing sibling deployments and customer data remain authoritative. Work here
  does not authorize changing their Workers, databases, OAuth configuration,
  domains, wallets, or other live resources.
- Inspect code and Git status before editing. Prefer the existing TypeScript,
  npm, Vite, and Worker patterns. Add dependencies only for a concrete need.
- Keep builds/tests self-contained with no runtime imports or dependency links
  into sibling repositories. Record copied/adapted source in
  [migration-sources.json](migration-sources.json), including actual source
  revision, file hash, destination, and intentional differences.
- Use compact, accessible product UI: ordinary headings, labeled forms, rows,
  useful feedback, and readable spacing. Avoid heroes, decorative cards, and
  extra controls. Preserve keyboard access and responsive behavior at 390×844,
  768×1024, 1280×800, and 1440×900.
- Validate affected behavior and report evidence and limitations. Documentation
  changes do not require application tests. Update the handoff when scope or
  implementation changes; do not equate mocks, builds, or commits with deployment.

## Product goal and architectural boundary

The user wants this repository to support both the comprehensive Mainbrella
business with all its apps and a hobby operator running core with zero products,
one product, or a selected set in their own Cloudflare account. Operators must
also be able to install Appflare apps as products. Products maintained here must
remain self-contained apps that can themselves be distributed through Appflare.

Preserve the product separation already established:

- Each product owns its runtime, UI, data, migrations, bindings, and reproducible
  build/install artifact. It must not require unrelated Mainbrella products or
  the hosted Mainbrella deployment to function independently.
- Core owns installation records, identity, permissions, and optional shared
  services such as billing. Products use explicit authenticated interfaces to
  those services, not direct access to core tables or wallet storage.
- Keep standalone and platform-connected behavior as explicit adapters/modes of
  the same product implementation. Do not fork a second Voice engine.
- Distinguish catalog visibility, actual installation/readiness, and permission
  to use a product. Visibility settings are not lifecycle or authorization controls.
  Operator provisioning authority is separate from customer/product access.
- Support explicit owner-funded and managed billing policies. In owner-funded
  mode the operator pays Cloudflare/providers directly and controls access/limits.
  Managed mode requires usage authorization and metering; unavailable billing
  authorization must not silently allow free usage. No billing adapter exists yet.
- Third-party Appflare apps can be installed, registered, and opened without
  pretending they automatically support Mainbrella login or billing. Record those
  as supported capabilities only when an integration actually exists.
- Reuse a supported Appflare install path rather than creating another general
  marketplace. Declare real product dependencies or supported bundles explicitly.
  A root workspace install/build may include source dependencies for many apps;
  that does not require deploying or running all of them.

## Current implementation

| Area | Implemented state at `604eb12` |
| --- | --- |
| Core | Email/password accounts, optional Google browser sign-in, sessions/logout, dark console, account menu and configurable catalog. `npm run dev` starts accounts and console only: zero-product runtime works locally. |
| Voice extraction | Committed in `038501a`, with test/export fixes in `cfb462a` and `33ee0c1`. Product-local Worker/UI, D1, Durable Objects, owner authentication, browser/text calls, standalone telephony, history and independent source export. |
| Voice connection | `604eb12` adds installation inventory, CLI provisioning, status/readiness, console Open, one-time login handoff, per-user workspaces, and platform session revocation checks. These are implemented and locally tested, not a completed live installation milestone. |
| Missing installation flow | No console Install action or server-side installation-start API. The provisioner is a separate operator CLI. General product registration and Appflare integration are absent. |
| Other products | Compute and Builder are catalog placeholders. Running all Mainbrella apps is a goal, not current capability. |
| Shared services | Identity integration exists for Voice. Product entitlements and billing integration do not. |

Key entry points:

- `platform/accounts/src/products.ts`: `GET /products/voice`,
  `POST /products/voice/open`, and secret-authenticated
  `POST /internal/voice/session`.
- `platform/accounts/migrations/013_product_installations.sql`: persisted
  installation/version/resource inventory and lease fields. It currently enforces
  `CHECK (product = 'voice')`; it is not a general product registry.
- `platform/console/src/voice-product.ts`: real status, retry/check, and Open UI.
  `console-config.ts` controls discovery only; Appflare is still an external link.
- `scripts/install-voice.mjs`: direct Cloudflare/Wrangler installer; private retry
  state and inventory live under ignored `.cache/voice-installs/`. Preserve that
  state; an existing installation cannot currently be resumed from a fresh clone
  without its private operator state.
- `products/voice/worker/app/canopy.ts` and `auth-core.ts`: explicit
  `VOICE_AUTH_MODE=canopy`, hashed single-use handoffs, product-local sessions,
  and platform session validation. Standalone owner/password mode remains available.

### Why staging still says Voice is unavailable

Read-only review on **2026-10-16** found the latest console assets deployed at
`https://stg.mainbrella.com/`. The API at
`https://api-stg.mainbrella.com/products/voice` returned:

```json
{"product":"voice","state":"not_installed","version":null,"origin":null}
```

This means the API has no registered Voice installation. It was not a stale
frontend or proof of a failing installed runtime. Do not infer the absence of
all orphaned Cloudflare resources from this status alone.

`npm run deploy:staging` deploys **accounts and console only**.
`npm run deploy:staging:site` deploys **console only**. Neither installs Voice.
`604eb12` adds the separate `npm run install:voice:staging` command. Its checked-in
`config/voice.staging.json` proposes Worker/database `canopy-voice-stg` and
`https://voice-stg.mainbrella.com`. That configuration is neither deployment
proof nor authorization to create those resources. No real Voice install was
performed or verified during the review. Recheck live state before implementation.

## Review findings to address before extending installation

1. **P1 — Installing Voice grants public signups operator-funded inference.**
   `platform/accounts/src/products.ts` checks only for a valid user before issuing
   a Voice handoff. `scripts/install-voice.mjs` sets `VOICE_ENABLED=true` globally.
   Once installed with calling enabled, any new email/password account can use
   the operator's AI resources; limits in `products/voice/worker/lib/voice.ts`
   are per user, not per instance.
   Add explicit owner/invite/product-access policy and appropriate usage limits
   before enabling this path publicly. Public Mainbrella will additionally need
   managed billing authorization; a private hobby install must not require it.
2. **P2 — Custom targets receive a console pointing at Mainbrella staging.**
   The installer accepts another `accountsOrigin` but always invokes
   `build:staging`, whose `platform/console/vite.config.ts` hardcodes
   `https://api-stg.mainbrella.com`. Build the console for the actual target and
   provide a reproducible own-account core setup. Preserve dedicated staging
   guards rather than weakening them to accept arbitrary targets.
3. **P2 — Canopy workspaces cannot use the preserved phone integration.**
   `products/voice/worker/app/voice.ts` creates random agent IDs in Canopy mode.
   Twilio/Telnyx configuration, webhook, and media checks in `worker/lib/voice.ts`,
   `worker/lib/voice-telnyx.ts`, and the carrier handlers still require the fixed
   standalone `AGENT_ID`. Locally reproduced: valid provider configuration returns
   true for the standalone ID and false for a Canopy agent. Define carrier/number
   ownership and route to the authorized workspace; do not simply remove identity
   checks. Preserve standalone calls, signature verification, and replay protection.
4. **P2 — Concurrent installers can deploy the wrong installation identity.**
   In `scripts/install-voice.mjs`, two checkouts can both read no installation;
   A wins `INSERT OR IGNORE`, then B acquires the lease without an
   `installation_id` condition or checking the returned identity. B deploys its
   own identity while the registry retains A's; readiness never matches. This was
   reproduced with the exact migration/SQL in memory. Make ownership/lease claims
   atomic, verify identity, and handle expiry/interruption without duplicate or
   conflicting resources. A host-local lock alone is insufficient.

The installer unit tests currently cover target validation and database creation
retry, not the full provisioning state machine. Installation browser tests in
`scripts/test-voice-installation.mjs` seed an already-installed row and use
simulated AI. Their passing result does not resolve these findings or prove a
real install. README, STAGING, and Voice docs also retain obsolete statements
that no inventory or account handoff exists; reconcile them with the next change.

## Next milestone — portable installation and Appflare registration

Prove this complete path: **fresh operator-owned core with zero products → select
and install Voice → reload and see verified status → open and perform a useful
action**, then **install/register one suitable non-Voice Appflare app alongside
Voice**. This is the next architectural proof, before extracting more first-party
products. Continue from the existing Voice code; do not repeat extraction.

Work in independently verifiable slices:

1. **Define and fix the access boundary.** Record operator authority, allowed
   product users, instance ownership, usage policy, and required credentials.
   Self-service signup must not confer provisioning authority or automatic paid
   product access. Implement the minimal access/usage interface with Voice as a
   real consumer. Owner-funded mode is sufficient for the first install; preserve
   a clear managed-billing seam without migrating the authoritative wallet or
   claiming a managed service works before its adapter exists.
2. **Make core and Voice portable.** Provide explicit own-account configuration
   for core origins, resource names/bindings, and product selection. Fix the
   staging-origin leak and installer race, preserve retry state/resource ownership,
   and resolve Canopy carrier ownership/routing. Verify both zero-product startup
   and standalone Voice without core. Preserve existing staging resource isolation.
3. **Add a small installation registry and operator flow.** Evolve the Voice-only
   schema with a new migration, retaining existing records. Store product/source
   identity, version, provisioner/ownership, resource references, origin, lifecycle
   state, and supported health/open/integration capabilities. Add a compact,
   server-authorized console installation flow with pending/failure/retry feedback.
   Keep credentials out of browser code. Readiness must come from supported
   runtime evidence. Voice and other apps advertising platform identity require
   an explicit cross-host auth handoff; other apps retain their own authentication.
4. **Connect one supported Appflare path.** Reinspect `../appflare` source/docs
   read-only before choosing the adapter. The inspected manager install entry is
   an admin-authenticated server function, not an established external provisioning
   API; documented install links require operator review. Use a supported installer
   flow and register/reconcile its actual result in Canopy. A catalog link alone
   is insufficient. Select one suitable non-Voice app, record its source/version,
   ownership and capabilities, and prove it appears and opens after reload.
5. **Verify distribution and the live path.** Generate an immutable Voice catalog
   manifest, validate/pack it through the supported toolchain inside Canopy, and
   retain the independent source-export path. Prepare exact dedicated test targets,
   resource inventory, secrets requirements, retention and cleanup before seeking
   any still-needed deployment authorization. Existing staging authorization covers
   core only; this handoff adds no live-resource authorization. Complete authorized
   local work first and present a concrete deployment plan if approval is needed.

Acceptance evidence must include:

- Core with zero installed products; Voice alone/standalone; connected Voice plus
  an Appflare app; each using the configured operator account and API origin.
- Unauthorized provisioning and product access rejected; duplicate/concurrent
  requests and interrupted installs recover without adopting unrelated resources.
- Persisted status after reload; readiness mismatch/unavailability; useful retry;
  explicit login handoff, user isolation, and logout/revocation.
- A useful Voice action through the real deployed runtime, plus carrier routing
  tests for Canopy and standalone modes. Record real AI/phone verification only
  for explicitly configured and authorized providers; distinguish fixtures.
- Keyboard behavior and the four target viewports. Third-party apps must not
  claim shared identity/billing unless implemented and tested.
- A real authorized install record separate from local tests/dry runs: source and
  deployed versions, account, Workers, D1/DO resources, origins, verification,
  partial-install recovery, retention, and cleanup. Never delete core/shared data
  implicitly when removing a product.
- Updated AGENTS, README, STAGING/deployment record, and Voice installation/Appflare
  docs explaining exactly which commands deploy core versus install products.

Defer more first-party extractions, a general installer framework, automatic
upgrades, production data/wallet migration, and destructive uninstall UI. Do not
mark this milestone complete based only on a build, seeded registry, or CLI script.

## Boundaries to preserve

- Auth remains `POST /auth/email`, `POST /auth/google`, `GET /auth/me`, and
  `POST /auth/logout`. Preserve scrypt parameters, password/concurrent-signup
  checks, hashed tokens, 30-day platform sessions, and public user fields `id`,
  `email`, `name`, `dob`, `created_at` when adding access policy.
- Identity migrations `001`, `002`, `012` are unchanged source copies for fresh
  Canopy databases, not the complete production `delta` stream. Do not renumber
  them or apply this subset to imported/production data. `013` adds Canopy product
  inventory. Keep subsequent changes additive.
- Loopback plus `LOCAL_DEVELOPMENT=true` uses `canopy_session`, HttpOnly and
  SameSite=Lax. Other hosts retain Secure/SameSite=None. Staging uses host-only
  `__Host-canopy_stg_session` and allows exactly `https://stg.mainbrella.com`.
  Do not broaden cookie exceptions or CORS to work around installation problems.
- Voice's original migrations `0001`–`0003` remain unchanged source copies;
  `0004_canopy_sessions.sql` adds per-user workspaces and handoff/session storage.
  All belong only to Voice D1. Preserve `ReceptionistCall`, its DO migration `v1`,
  provider routes, data retention, call limits, and replay protections.
- Voice standalone uses an owner password of at least 16 characters and eight-hour
  hashed sessions. `canopy_voice_session` is separate from platform/older local
  cookies; HTTPS adds the `__Host-` prefix, Secure, HttpOnly, and SameSite=Strict.
  Canopy mode uses product-local sessions linked to platform sessions; do not
  assume cookies cross hosts or restore password fallback in that mode.
- Voice was adopted from `ai-receptionist` at `7d3e023318f36f7a45e5d155c46d96e3896f9502`,
  compared against backend `0bc20dec148c1a78b40aa252a76735103d1dbe1f` and web
  `3dcea8975e2936ec26da95395b5df3f9042fa5f0`. Full provenance is in the manifest.
  Canopy is the maintained extracted source; sibling releases still use their
  existing code until an intentional release transition.
- Voice export preserves its dependency closure/root lock resolutions without
  platform workspace dependencies. The Appflare template still has a sentinel
  zero SHA; the manifest generator requires a clean committed pin. The new
  monorepo pin has not been packed or installed remotely. Appflare source reviewed
  at `ccafe08b4958d8e2f80299ee310b99a7f5d00eca` supports Voice's D1, same-app DO,
  AI, and assets; do not assume Container or external Worker bindings are supported
  for future Compute/Builder packages. Recheck compatibility when implementing.
- Worker bindings use explicit imports from `@cloudflare/workers-types/index.ts`;
  avoid mixing global Worker declarations with Node types. Keep Voice's Worker
  and client type checks separate and preserve process cleanup in test/dev scripts.

## Run and verify

Use Node 22.13+ and npm 10+; CI uses Node 22. From Canopy:

```sh
npm ci
npm run dev
```

Core runs at `http://127.0.0.1:5175` (console) and `127.0.0.1:8789` (accounts).
Startup checks ports, applies local migrations, and starts only core. Ctrl-C stops
both processes. Preserve local D1 under `platform/accounts/.wrangler/` and private
operator state; logs/caches are ignored. Do not delete state casually.

For standalone Voice, copy `products/voice/.dev.vars.example` to `.dev.vars` in
that directory, set a private `ADMIN_PASSWORD`, then run:

```sh
npm run db:migrate:local --workspace @canopy/voice
npm run dev:voice
```

Voice runs at `http://127.0.0.1:8791`; normal local development disables calling
and remote bindings. Use deterministic fixtures for local call verification.

```sh
npm run check
npm run build:staging
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser:voice
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser:installation
npm run export:voice
```

`CANOPY_CHROMIUM_PATH` can select installed Chrome/Chromium. Browser tests start
and stop their own stacks, require free ports, and write ignored `test-results/`.
Core browser tests create local test accounts; installation fixtures use in-memory
D1 and simulated AI. Exports require a clean commit, or `-- --allow-dirty` for a
clearly marked non-release verification export in `products/voice/dist/source`.

Review verification at `604eb12` on **2026-10-16**: type checks, `npm test`
(**98 tests: 29 accounts/client, 3 installer helpers, 66 Voice**), staging builds
and Worker dry runs, and **6 installation browser tests** passed. The carrier-ID
mismatch and installer race were reproduced separately. Earlier extraction
verification covered standalone Voice browsers and a separate export install,
build, and tests; those were not rerun in the review. No paid inference, real
phone call, remote install, or deployment occurred during review. CI configuration
includes browser/export checks and no deployment; local results do not prove a
completed remote CI run.

## Existing staging resources and pending Google checkpoint

Dedicated core staging uses Cloudflare account `2b7a9be82bb64187230703b024e25157`:

| Resource | Staging |
| --- | --- |
| Console | `canopy-console-stg` at `stg.mainbrella.com` |
| API | `canopy-accounts-stg` at `api-stg.mainbrella.com` |
| D1 | `canopy-accounts-stg`, UUID `824e7e4b-b015-416a-93ec-f09ad56ef4d9` |
| Rate-limit namespaces | `2001` (email), `2002` (Google) |

[STAGING.md](STAGING.md) records prior deployed versions, hosted email/session
smoke results, and teardown. Its older version IDs are historical, not a claim
about the latest live Worker IDs. `deploy:staging` checks/builds/migrates/deploys
core; `deploy:staging:site` skips backend/tests/migrations for a frontend-only
update. The Wrangler wrapper restricts these commands to the dedicated staging
resources. Do not recreate the staging database. Production `mainbrella-web`,
`mainbrella-api`, `mainbrella.com`, `api.mainbrella.com`, and `delta` are outside
this work. Billing/quotas share the CF account; data/bindings/cookies are separate.
`npm run smoke:staging` creates one disposable staging account per run and writes
ignored results under `test-results/staging/`; it does not verify Voice installation.

Google implementation is complete; real provider verification remains pending
and does not block the product milestone. It is optional and disabled on staging.
Local setup requires the same separate test Web client ID in Worker
`GOOGLE_CLIENT_ID` and console `VITE_GOOGLE_CLIENT_ID` (ignored local files).
Preserve strict RS256/issuer/audience/time/verified-email checks, stable subject
lookup, identity-conflict protection, private provider errors, bounded key fetch,
and the separate rate limiter. Automated UI/provider fixtures are not real Google
login. With an explicitly supplied test client, verify creation, repeat login,
reload, logout, and password-account conflicts. Do not reuse production OAuth
settings or change production origins. Before enabling staging Google, configure
its exact origin and review key-fetch caching; record real results separately.
