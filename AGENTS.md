# Canopy working notes

Handoff updated **2026-10-16**, following `52d5794` and the local portable-installation implementation. The new code is not deployed. The real installation milestone remains open until the authorized live plan is executed; local fixtures and packaging do not complete it.

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

| Area | Implemented locally |
| --- | --- |
| Core | Existing email/password, optional Google, sessions and console. `npm run dev` starts core only, with zero product runtimes. Own-account config generation/provisioning is `scripts/setup-core.mjs`; product discovery may be empty. |
| Access | Cloudflare operator pins an existing `OPERATOR_USER_ID`; public signup never becomes operator. Explicit `product_access` grants, immediate session/revocation checks, and an owner-funded usage-authorization interface consumed by Voice. `managed` and missing policy fail closed; no managed billing adapter or wallet integration. |
| Voice | Same extracted standalone product plus explicit Canopy adapter, one-time handoffs, per-user workspaces and platform logout validation. Instance-wide atomic defaults: 20 starts/rolling day, 2 concurrent calls; standalone remains 100/3 with 15-minute/60-turn limits. |
| Installation | Operator-only `POST /products/voice/install` records a durable request. A credentialed CLI provisions it; `operator:run -- --config TARGET --watch` processes queued console requests and retries. No hosted provisioner is deployed. Atomic identity/version/lease claim, lease renewal, private retry state, exact runtime readiness, target-specific console build. |
| Registry | Additive migration `014` retains all `013` records and allows additional products, provenance, resource references, owner/provisioner and explicit integration capabilities. Discovery, installation readiness and user permission remain distinct. |
| Carriers | Connected mode requires exact configured carrier agent and user IDs; signed requests route only to that workspace. Standalone fixed-owner routing, signatures, destination/account/application checks and replay protections remain. Mapping/secret changes after install require intentional Worker reconfiguration, not an automatic upgrade. |
| Appflare | One explicit supported adapter: Cut catalog install through Appflare admin review, followed by credentialed read-only Cloudflare/Appflare inventory reconciliation. It records actual source/deployed version/resource evidence. Cut opens with its own authentication, with no shared identity/billing claim. No real Cut install has been performed. |
| Other products | Compute/Builder remain placeholders. More extraction, general installer frameworks, automatic upgrades, production migration and destructive uninstall remain deferred. |

Key files and operational constraints:

- `platform/accounts/src/products.ts`: `GET /products/{voice,cut}`, `POST .../install`, `POST .../access`, `POST .../open`, private `/internal/voice/{session,authorize}`. Product descriptions/status are public; provisioning and grants require the pinned operator. Opening requires a valid product grant and runtime evidence. Never restore automatic paid access to public signup.
- `platform/accounts/migrations/014_product_access.sql`: migration from Voice-only inventory, retained IDs/resources, explicit access and durable installation requests. Original migrations remain unchanged. `OPERATOR_USER_ID` comes from operator-controlled Worker configuration, never signup/email inference.
- `scripts/setup-core.mjs`: `--plan` is read-only; default generates ignored local configs/state; `--deploy` creates/deploys dedicated core only. Operator builds require explicit HTTPS accounts origin and selected catalog products. Dedicated staging builds keep their hardcoded origin and Google-disabled guards. Core bootstrap is operator-run, not an unattended lifecycle service.
- `scripts/install-voice.mjs`: explicit target/owner policy and existing owner account required. Same installation/version can resume with preserved private state; a losing checkout cannot acquire another identity. Heartbeat/guard failures stop child deployment commands. Existing installed versions are verified without redeployment; no automatic update or carrier reconfiguration occurs.
- Preserve `.cache/core-installs/`, `.cache/voice-installs/`, `.cache/appflare-installs/` and local D1. These contain private recovery state and inventory, not disposable caches. Back them up privately for a fresh clone. A matching D1 name without a recorded UUID is refused even after creation intent. After reviewing actual creation evidence, the operator may explicitly use `--recover-database UUID`; do not silently adopt unknown resources.
- Core setup verifies a `CANOPY_INSTANCE_ID` marker in both core Workers against preserved private state. It can recover a lost deployment response when that marker matches; an unrelated same-name Worker is refused. A source/version mismatch in Voice requires an explicit reviewed recovery/release decision.
- `scripts/register-appflare.mjs`: one Cut catalog-artifact adapter, not a general marketplace. Reads the manager D1 binding/install/resources, checks source SHA/artifact digest/current 100% Worker version and serving hostname, then writes Canopy inventory only. Reconciliation of the same install is idempotent; replacing another identity is rejected. `/admin` probes indicate reachability, not shared authentication or a deep health contract. Protected/unsupported origin flows are not certified by this adapter.
- `platform/console/src/voice-product.ts`: compact state/open/request/access controls shared by Voice/Cut; permissions refresh on navigation, login/logout and explicit Check again. `console-config.ts`/`VITE_PRODUCT_SELECTION` affect discovery only.
- `products/voice/worker/lib/voice.ts`: calls check core usage authorization in Canopy mode; atomic global quotas count failed/redacted calls. Invalid limit config denies starts. Revocation prevents new requests/calls; an already-running call can finish within existing duration/turn limits. There is no currency-denominated spend guarantee or active-call kill service.
- `products/voice/worker/app/voice-{twilio,telnyx}.ts`: `VOICE_CARRIER_AGENT_ID` plus `VOICE_CARRIER_USER_ID` assign all configured destinations to a single connected workspace. Preserve signature/account/application/destination/media-token/replay checks. Do not simply remove identity checks to enable another agent.

## Verification and outstanding live milestone

Current local verification: **109 unit/runtime tests**, **34 browser tests**, type checks, target-specific builds and Worker dry runs pass. Independent Voice export install/type checks/68 tests/build and supported Appflare pack/hash/upload checks pass. Exact snapshot/artifact hashes, logs and limitations are in [milestone verification](docs/milestone-verification.md). Installation browsers simulate the credentialed runner, Appflare/Cut and AI; they do not provision resources. The dedicated carrier tests generate actual signatures against local fixtures. The full standalone suite remains separate. See [operator installation](docs/operator-installation.md), [Voice distribution](products/voice/docs/appflare.md) and the retained logs under ignored `.cache/` for limitations.

Read-only Cloudflare review on 2026-10-16 found account subdomain `crimson-dust-553b`, no proposed `canopy-m2` Workers/D1s/custom-domain attachments, and the existing staging API still returning `not_installed` for Voice. That does not prove no unrelated/orphan resources exist. No new Cloudflare resource, paid inference, phone call, deployment or catalog publication occurred.

The concrete [live verification plan](docs/milestone-deployment.md) proposes fresh `canopy-m2` core, Voice, an independent Appflare manager and Cut in account `2b7a9be82bb64187230703b024e25157`. It names resource/origin/secret requirements, recovery, retention and cleanup. Existing authorization covers established core staging only. **Obtain any still-needed new-resource/paid-inference authorization after completing local work; this handoff adds none.**

Remaining acceptance requires actual fresh core with zero installed products, pinned operator and configured API origin; unauthorized signup/provision/open denial; real request/runner install and interruption recovery; persisted verified readiness; one useful real authorized Voice action; logout/revocation/user isolation; supported Appflare admin installation followed by registration/reload/open and a useful Cut action; and keyboard/four-viewport verification on deployed hosts. Record exact source/deployed versions, resource IDs and private recovery inventory separately from fixtures. Real carrier/provider checks are required only for explicitly configured and authorized providers. Never mark this milestone complete from a seeded row, local pack or build.

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
  zero SHA; the manifest generator requires a clean committed pin. Local packing is verified separately; no new
  monorepo pin has been published or installed remotely. Appflare source reviewed
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

Historical review verification at `604eb12` on **2026-10-16**: type checks, `npm test`
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
