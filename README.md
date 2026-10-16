# Canopy

Canopy is the source monorepo being built for Mainbrella's hosted platform and its independently installable products. It should also serve as an example of running Mainbrella in your own Cloudflare account, choosing which products to run, and using Appflare for other apps. The goal is to share code where it has real consumers while keeping each product buildable, releasable, and usable on its own.

The working account slice supports local email/password and optional Google browser sign-in: an accounts Worker, a small console, and shared auth contracts/client in npm workspaces. Isolated hosted staging is available at **https://stg.mainbrella.com**, with its API at **https://api-stg.mainbrella.com**; staging currently uses email/password only. See [STAGING.md](STAGING.md) for resources, deployment, verification, and teardown. The broader product layout and releases described later are still a migration plan. Sibling repositories remain read-only references and continue to own their production services.

Canopy is one repository for these products; it is not every repository in the Mainbrella organization. A normal user installing Voice, Compute, or Builder should only need that product's supported build and runtime requirements, not a clone of the whole repository or every service in it.

## Run the account milestone

Use Node 22.13 or newer (Node 22 is used in CI) and npm 10 or newer. From this repository:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5175** for the product home, then choose **Sign in** to create a local account. Continue with an email and password, inspect account details, reload to check the session, and sign out through the upper-right **Account** menu. An existing email signs in instead of creating a second account. New passwords need 8–128 characters, matching the current backend. These are new local accounts; existing Mainbrella accounts and customer data have not been imported.

`npm run dev` checks that ports 5175 and 8789 are free, applies the three local identity migrations, and starts Vite plus the accounts Worker. The console proxies `/auth/*` to `127.0.0.1:8789`. Ctrl-C stops both. Local D1 data persists in `platform/accounts/.wrangler/`; caches and Wrangler logs stay in `.cache/`. Email sign-in needs no Cloudflare login, sibling checkout, Docker, secrets, or external service. This uses Wrangler's [local resource simulation](https://developers.cloudflare.com/workers/local-development/local-data/).

```sh
npm run check          # TypeScript, auth regressions, Worker dry-run and console build
npm run test:browser   # Browser integration, error states, keyboard and responsive checks
```

For the browser suite, install Chromium once with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npx playwright install chromium`, then run `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser`. Alternatively set `CANOPY_CHROMIUM_PATH` to an existing Chromium/Chrome executable. CI installs its browser automatically. The browser tests start their own local stack, refuse occupied ports, and create disposable accounts in the local development database. Screenshots go in ignored `test-results/`.

The browser command runs two stacks sequentially: the existing email suite with Google disabled, then the Google UI suite with an explicit fake client ID and stubbed Google script/API responses. These settings override local console configuration during tests. Worker tests use locally generated RSA keys and stubbed Google key responses with real signature verification and SQLite. No automated test signs into Google or uses a production OAuth client.

The local build produces `platform/accounts/dist/` and `platform/console/dist/`. `npm run build:staging` produces separate `dist-staging/` outputs and checks both staging Wrangler configurations without deploying. `npm run deploy:staging` checks, builds, migrates the dedicated staging D1, and deploys the two staging Workers. The staging console calls the staging API directly; Vite's development proxy is not part of that build. Canopy has no production deployment configuration.

For fast frontend-only updates, run `npm run deploy:staging:site`. It builds the staging console once and deploys only `stg.mainbrella.com`, skipping checks, tests, API deployment, and database migrations. Use the full deployment command for changes that also need backend updates.

### Console configuration

The dark console has a product home, shared header/footer, and an account dropdown. Compute, Builder, and Voice each have a **Not installed** placeholder page. There are no product APIs, install actions, or resource provisioning in this slice. The Appflare link opens its external catalog; Canopy does not read or manage Appflare installs.

Edit [console-config.ts](platform/console/src/console-config.ts) to rename your instance, reorder products, or set an entry's `visible` to `false`. The home list and detail routes use the same configuration; an unlisted product has no detail page. An empty catalog is supported. Vite reloads the configuration during development; rebuild before deploying changes.

This configuration is public and controls console discovery only. It does not grant permissions, enable a runtime, stop a Worker, or uninstall resources. Keep secrets out of it. Product availability must come from verified deployment state when runtimes are added. Real product enable/disable operations, dependencies, authorization, and Appflare integration remain future slices.

Views use fragment URLs (`/#/`, `/#/account`, `/#/products/compute`), so bookmarks and reloads work with the existing static Worker configuration. Account remains the only authenticated feature; product descriptions are public. Billing, API keys, and production account links are omitted.

The shell adapts the brand and disclosure behavior from `../web` without importing its marketing page, billing requests, analytics, or session redirects. The source revisions and hashes are recorded in [migration-sources.json](migration-sources.json). Appflare's local catalog documentation was inspected at `ccafe08b4958d8e2f80299ee310b99a7f5d00eca`; no Appflare runtime or manifest was copied.

### Optional Google browser sign-in

Google is disabled by default. To try a real login, use a separate **test Web application OAuth client** with `http://localhost` and `http://localhost:5175` authorized, following [Google's local setup instructions](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Do not reuse or modify the existing production client. Put the same test client ID in these two ignored local files:

```dotenv
# platform/accounts/.dev.vars
GOOGLE_CLIENT_ID=your-test-client.apps.googleusercontent.com
```

```dotenv
# platform/console/.env.local
VITE_GOOGLE_CLIENT_ID=your-test-client.apps.googleusercontent.com
```

Restart `npm run dev` and open **http://localhost:5175** for the Google smoke test. The configured origin must match the browser address; localhost and 127.0.0.1 have separate cookies. The Vite development server supplies Google's recommended localhost referrer policy. This is the popup/callback flow, so no client secret or redirect endpoint is needed. The console client ID is public and embedded at build time; the Worker independently verifies the token audience against its own configuration. Both settings must match.

With no console client ID, the Google control is absent and its script is never requested. With no Worker client ID, `/auth/google` fails closed with `google_unavailable` (503). A blocked or stalled Google script offers a retry while email stays usable. Google logout uses the same session revocation as email and disables automatic account selection.

The verifier retains Google's RS256 signature, issuer, audience, expiry and verified-email checks, plus the source's issued-at tolerance. It rejects malformed numeric claims, unsupported critical headers, future `nbf` claims and invalid email shapes. The public key request uses Google's fixed HTTPS endpoint with a five-second timeout; no test key endpoint or token bypass is exposed in runtime configuration. [Google's verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) describes the underlying checks.

Accounts are identified by the stable Google subject. A Google credential cannot claim a password account or a different Google subject with the same normalized email; the API returns `identity_conflict` (409). Concurrent creation/linking rechecks the saved identity before issuing a session. Legacy rows without either credential may be linked, as in the source. A changed Google email does not rewrite the existing account profile.

The real Google smoke test remains separate from automated verification: use the configured test client to create an account, reload, sign out, sign back in, and check that a password account with the same email is rejected by Google sign-in. **No real Google smoke test has been run for this handoff**, because no test OAuth client was supplied. Native sign-in remains outside this slice. Hosted staging was deployed and verified separately with Google disabled.

## What has moved

| Canopy location | Working responsibility | Source |
| --- | --- | --- |
| `platform/accounts/` | Email/password and Google browser signup/sign-in, session lookup/revocation, local D1 | Browser subset of `backend/worker/app/auth*.ts` |
| `platform/console/` | Optional Google control, email form and read-only account details | Minimal TypeScript/Vite UI; Google loader adapted from Raindrop |
| `packages/contracts/` | Public user/session types and runtime response guards | Backend's public user fields and Raindrop's validation pattern |
| `packages/platform-client/` | Credentialed email/Google/session client without UI globals | `web/src/auth.ts` and `raindrop/src/auth.ts` |

[migration-sources.json](migration-sources.json) records exact source commits, file hashes, destination paths, and adaptations. These are deliberate subset copies with provenance, not a Git history merge. Canopy's builds and tests resolve everything from this checkout and its root lockfile; nothing imports a sibling repo.

This milestone preserves scrypt password parameters, normalized email lookup, concurrent-signup checks, SHA-256 session-token storage, 30-day sessions, and the existing public user fields. The copied SQL migrations `001_initial.sql`, `002_auth_sessions.sql`, and `012_email_password.sql` are unchanged, including their names. They initialize **fresh local or isolated staging identity databases only**, not the complete migration stream for the live `delta` database. Never apply this subset to an existing production or imported database.

Intentional adaptations include explicit environment bindings, a configurable origin allowlist, streamed JSON size limits, local development, and the Google validation/race safeguards described above. The development cookie is `canopy_session`, HttpOnly and SameSite=Lax, so it does not overwrite sibling apps' `mainbrella_session` cookie. That exception requires both the local flag and a loopback request; other hosts retain the original Secure/SameSite=None cookie behavior. Missing database or rate-limit bindings fail closed. The local Wrangler configuration names only a local database placeholder and contains no production resource bindings or routes.

### Account API in this milestone

| Method and path | Request | Success |
| --- | --- | --- |
| `POST /auth/email` | JSON `{ email, password }` | `{ user, created }` and an HttpOnly session cookie |
| `POST /auth/google` | JSON `{ credential }` containing a Google ID token | `{ user, created }` and the same HttpOnly session cookie |
| `GET /auth/me` | Optional session cookie | `{ user }`, or `{ user: null }` when anonymous or expired |
| `POST /auth/logout` | Optional session cookie | `{ ok: true }`, revoking that session and expiring its cookie |

`user` contains only `id`, `email`, `name`, `dob`, and `created_at`. JSON responses are not cached. Error bodies use `{ error }`: invalid input/weak new passwords (400), invalid email or Google credentials (401), rejected origins (403), missing routes (404), wrong methods (405), identity conflicts (409), rate limiting (429 with `Retry-After: 60`), or unavailable infrastructure/provider (503). Google errors use `invalid_google_credential`, `identity_conflict`, and `google_unavailable`; infrastructure failures use `auth_unavailable`. The email endpoint retains its 20-attempts/minute/IP limiter; Google has a separate limiter with the same limit. Allowed browser origins can preflight with `OPTIONS`. This is the browser auth subset of the existing API, not its native/OpenAPI surface.

Native sign-in, password recovery, welcome email, analytics/consent integrations, profile editing, API keys, billing, projects, Raindrop screens, and product runtimes have not moved. No account data, production database, wallet, Worker, public URL, or deployment has changed. Before using hosted accounts, review required side effects and the complete migration history, and verify the existing session/API contracts against an isolated hosted environment.

## Source inventory — 2026-10-16

| Sibling | Inspected state and boundary | Decision for this pass |
| --- | --- | --- |
| `backend` at `0bc20dec148c` | Main API owns auth plus Compute/Builder/Voice orchestration; separate admin, marketing, container, preview, egress-relay and security-ack configs. `delta` identity data and the `CONTAINER_ACCOUNT` wallet are still authoritative there. | Extract local browser email/Google/session code. |
| `web` at `3dcea8975e29` | Plain TypeScript/Vite, with separate site and Builder builds. Auth currently also invokes cookie-consent and acquisition/analytics code. | Reuse the auth transport conventions without importing site/product screens. |
| `raindrop` at `be89935ae248` | Separate Vite admin UI and deployment; its copied auth client already validates responses. | Reuse validation/client and Google loader behavior. Admin authorization and screens stay there. |
| `ai-receptionist` | Independently packaged Voice with its own Cloudflare setup and owner auth. | Leave standalone Voice and engine convergence for a later milestone. |
| `ssh-gateway`, `ios`, upstream forks and other sibling tools | Separate entry points and release concerns. | Remain outside this first extraction. |

The inspected `web` and `raindrop` worktrees were clean. `backend` had an untracked `docs/source-ownership.md`; it describes a broader source reorganization that is absent from the actual tree (implementation is still in `worker/app`, `worker/lib`, and `web/src`). It was left untouched and is not treated as evidence that those moves occurred. Existing source, Wrangler configs, package scripts, and tracked migration files determined this inventory.

The next checkpoint is a real Google smoke test with an explicit test client, then a separately scoped isolated staging milestone with its own database and routing. This does not authorize changing production resources. The product migration plan below remains the longer-term direction.

## Repository shape

The proposed layout gives product code clear ownership and makes shared platform services explicit. It does not require one directory to become one Worker: a product may deploy several Workers and other Cloudflare resources.

```text
products/
  voice/                 Voice application, Worker entry point, standalone auth,
                         D1/DO migrations, build and deploy configuration
  compute/               Container runtime and API, images, execution, terminals,
                         files, workspaces, lifecycle, UI and configuration
  builder/               Builder UI and agent orchestration; calls Compute APIs
platform/
  accounts/              Mainbrella identity, sessions, access and API keys,
                         shared project identity
  billing/               Stripe integration, wallet, reservations, settlement,
                         and usage receipts
  console/               Hosted customer account, project and product UI
  admin/                 Raindrop and operator UI
packages/
  contracts/             Shared request/response schemas and validators
  voice-engine/          Voice behavior shared by hosted and standalone Voice,
                         if the convergence creates a genuine package boundary
  compute-engine/        Reusable Compute source, only if real consumers need it
  platform-client/       Optional shared client for hosted platform APIs
```

Other hosted entry points, ingress, and marketing code can be placed according to their actual owners as they move. Root scripts, tests, and documentation should be added when implemented.

A **product** is a complete application that can be built, installed, and released independently. It may contain UI, a Worker entry point, migrations, and product-specific adapters. A **package** is reusable source code used by products or services; it is not a separately deployed application. A **platform module** is a shared service or UI used by the managed Mainbrella edition. A directory, workspace, package, deployable, and Git repository are distinct things. A package need not be published to npm, and a product need not live in its own Git repository.

Keep code in its product until there is a real second consumer or a clear shared contract. In particular, `compute-engine` should remain an idea until more than one consumer needs the same Compute implementation. Shared packages should expose focused interfaces rather than becoming a place for every common helper.

## Installation targets

The product boundary should support these planned installation shapes:

| Install | Includes | Does not require |
| --- | --- | --- |
| Voice | Voice UI and runtime, its Cloudflare resources, local owner authentication; optional Twilio or Telnyx integration | Mainbrella hosted auth, Stripe, Raindrop, or Compute containers |
| Compute | Compute API/runtime and the Cloudflare resources it needs, with owner authentication | Voice, Builder, hosted billing, or admin UI |
| Builder + Compute | Builder, required Compute, source storage, and configured models | Voice or unrelated hosted admin and billing services |
| Hosted Mainbrella | The products and shared account, wallet, permissions, and audit services that the hosted edition uses | — |

These are product goals, not working installers today. Bundle composition should not accidentally install a second Compute runtime or copy Compute internals into Builder. Builder should call a supported Compute API or client. Sharing and upgrading components independently requires explicit ownership and compatible APIs.

## Product and package boundaries

### Voice

Maintain one Voice engine for hosted and standalone use. The engine should own shared speech, conversation, and telephony behavior. Adapters should supply the differences:

- The hosted adapter connects Mainbrella identity, permissions, and billing.
- The standalone adapter uses local owner/password authentication and the owner's Cloudflare and carrier accounts.

Today, `ai-receptionist` is a modified standalone extraction while hosted Voice lives in `backend` and `web`. Those implementations need to converge; the shared engine is not already present. Keep the standalone repository until there is a supported way to consume and release the shared implementation. Avoid creating another maintained copy during migration.

### Compute

Keep Compute's sandbox and production runtime together where they share execution behavior. Give them distinct lifecycle, restart, persistence, and hosting policies. A reusable Compute package is justified only when a real consumer needs that shared implementation; otherwise its code belongs in `products/compute`.

### Contracts

`packages/contracts` can hold shared request and response schemas, runtime validators, and explicit public or internal interfaces. TypeScript types alone do not validate data at runtime. Contracts must not contain secrets or become a shortcut for unrelated cross-module database queries.

### Identity, billing, and audit

Hosted products can share Mainbrella accounts, sessions, project identity, permissions, and API keys through `platform/accounts`. A service must verify caller identity and permissions at its boundary; a request naming an account does not prove that the caller may act for it.

Mainbrella billing currently sits behind `CONTAINER_ACCOUNT` in `backend/worker/lib/prepaid-billing.ts`, and Voice imports `build-pricing`. Put product-neutral interfaces around the existing authoritative wallet before considering any durable money-state move. Keep one hosted balance with product-specific metering. Preserve idempotency, reserve/settle/release behavior, and reconciliation for unknown usage. Do not start with a broad wallet or Durable Object migration.

Audit events can record actor, account, project, resource, action, and outcome for console and operator needs. Keep execution logs and transcripts owned by their product, and keep the financial ledger separate from audit history. Add event infrastructure only for a concrete use.

## Repository workflow and releases

Commit product code, shared package code, tests, package metadata, and documentation in this repository like any other source. Create a package when code is genuinely shared; keep a product-only feature inside its product. If an interface change affects both a producer and a consumer, update them together in the same commit or pull request.

For example, once extracted, a shared engine package could contain:

```text
packages/voice-engine/
  package.json           Package name, exports, and dependencies
  src/                   Maintained implementation
  test/                  Tests of shared behavior
  README.md              Supported interface and usage
```

These files are ordinary tracked source in Canopy. They do not need a second Git repository or an npm release before another workspace can use them.

A Telnyx audio fix belongs in `voice-engine` if that package owns the shared audio behavior. Add a focused test there, update either wrapper if the interface changed, and verify the hosted and standalone Voice builds before releasing the affected product.

Commit root workspace lockfile changes when dependencies change. Do not commit secrets or `node_modules`; generated `dist` output should only be committed if a deliberate artifact policy requires it. Workspace links resolve local package source, so ordinary monorepo development does not require copying files or publishing every package. If consumers move outside this repository, give them a versioned package or artifact, or pin source to an immutable revision; do not rely on an unversioned relative sibling import.

A Git commit is not a deployment. CI should check changed products and their transitive shared-package consumers. Release and deploy affected products when they are ready, including products affected by a shared-package change. Each product build should bundle or otherwise include the libraries it needs; a CI job may fetch the repository or install root workspace dependencies without deploying unrelated apps. Keep product release artifacts and versions independently identifiable, and record the source commit and relevant package revisions used to build them. Deploy selectively while keeping interfaces compatible with currently running consumers.

The first milestone uses npm workspaces, one root lockfile, and the local commands documented above. CI checks only this checkout. Broader product build/release selection and deployment commands remain unimplemented; examples in the rest of this plan are not executable instructions.

## Data, resources, and ownership

Code can move before data does. A folder move does not relocate a database, Durable Object state, object key, public URL, or deployed resource. Preserve existing public URLs, session contracts, resource identities, D1 migrations, Durable Object class names and state, R2 keys, data, and release histories through restructuring. Keep existing independent deployments working as ownership changes.

Assign each product or platform module ownership of its tables, migrations, bindings, permissions, and API. It is reasonable to keep a database while code ownership becomes clear. Avoid routine SQL access to another module's tables and avoid splitting every database as an architectural exercise. Deployables should have explicit bindings and least-needed permissions, with versioned APIs between services. Cloudflare service bindings can connect internal Workers without making them a single deployable; see [Cloudflare Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

Project and product lifecycle rules need explicit ownership. Shared projects already exist separately from Builder workspaces, but [the current project documentation](https://github.com/mainbrella/backend/blob/main/docs/projects.md) says Builder deletion also deletes the shared project. Product uninstall should remove only that product's resources and data. Explicit project deletion should coordinate dependent apps and hosting, retention or export, and any billing holds. Define these behaviors before making removal flows destructive.

## Migration plan

Migrate in small stages while preserving the current services and their state:

1. **Inventory and ownership.** Record deployables, routes, bindings, databases, durable resources, APIs, and who owns each table and lifecycle. Establish contracts before moving code.
2. **Set hosted boundaries.** Introduce shared identity and billing interfaces around current behavior. Keep the authoritative wallet and existing session contracts in place. Make shared clients such as the existing `/auth/me` client reusable only where that reduces duplication.
3. **Converge Voice.** Use hosted and standalone Voice as the first proof of a shared engine with two explicit adapters. Validate both install paths and preserve hosted identity and billing behavior.
4. **Align Builder and Compute ownership.** Move or separate backend ownership to match the Builder frontend. Make Builder use the Compute API/client. Keep sandbox and production on the common runtime with separate lifecycle policies.
5. **Define uninstall and data migration.** Assign resource and table ownership, document project deletion, product removal, retention, export, and billing interactions. Add migration steps that preserve existing state.
6. **Release products independently.** Build and test fresh Voice-only, Compute-only, and Builder-plus-Compute installs. Demonstrate targeted updates and rollback where supported, and verify hosted account and billing behavior.
7. **Expand the catalog selectively.** Add more products only after their ownership and independent install path are understood.

Existing evidence should guide the moves. The backend already deploys API, admin, marketing, containers, and ingress/previews independently. `backend/worker/shared/service-routing.ts` preserves `api.mainbrella.com` paths, and `scripts/check-worker-boundaries.mjs` prevents admin and marketing bundles from absorbing unrelated code. The web repository already has separate site and Builder static builds/deployments. Raindrop is a separate admin GUI with a copied auth client. Keep those deployment boundaries until a concrete change justifies altering them.

Hosted backend, web, and Raindrop source can move into Canopy progressively with provenance and history preserved by a deliberate migration. Keep iOS, the SSH gateway, independent Parsequerade, and upstream Appflare/catalog forks separate while their release cycles justify it. Keep `ai-receptionist` separate until the shared Voice engine has a supported distribution path. This plan does not rename or remove sibling repositories, merge histories, or rewrite deployments now.

## Appflare distribution

Appflare should receive installable **products or supported bundles**, not internal engine or contracts packages. A catalog change is a PR to [appflare/catalog](https://github.com/appflare/catalog), adding `apps/<slug>/appflare.jsonc`. The manifest should point at the public Canopy repository and an exact commit, then describe the product build, configuration, settings, and requirements. Monorepo subpaths are supported, so a product does not need its own Git repository. The product build includes the shared library code it uses in its deployable output; users do not install those libraries separately. The pin makes the submitted product reviewable and reproducible.

For Voice, the source would live in Canopy's `products/voice` and `packages/voice-engine`, while the catalog submission would be `apps/mainbrella-voice/appflare.jsonc` in `appflare/catalog`. The manifest selects Voice's build command and Wrangler configuration. The resulting install should contain Voice's frontend, Worker code, and required resources, without provisioning unrelated Mainbrella products or hosted services.

Voice is the clearest first candidate if its standalone installation is complete. The catalog entry must deploy the product's required runtime as a self-contained artifact. Service, Durable Object, or Workflow bindings cannot depend on unrelated external Mainbrella Workers; multiple Workers can be part of one catalog entry when the packaging path supports them.

There is a compatibility constraint for Compute. Appflare's standard artifact packaging currently rejects Container bindings, along with other unsupported bindings, according to its [catalog submission guide](https://appflare.dev/catalog/submit/) and [build documentation](https://appflare.dev/guides/builds/#self-deploying-apps). Therefore, Compute and Builder-plus-Compute are candidates to investigate, not products that this plan claims are currently accepted or installable through that path. Validate the actual product bindings and installer against Appflare's supported packaging, or identify a supported alternative, before submitting them. The self-deploying tier currently runs supported Alchemy installers; do not assume it accepts arbitrary setup scripts.

Managed Mainbrella and customer-owned Appflare deployments can coexist. Keep submitting independently functioning products to Appflare as a distribution path. Do not build a competing installer or store just to modularize this source. A future Mainbrella catalog could enable products inside a hosted project while sharing its identity, wallet, and data. Owning an installer or store also means owning provisioning, upgrades, rollback, backups, permissions, removal, and metering. If a second catalog is needed later, add an adapter around product definitions rather than coupling engine code to one catalog format.

## Later product candidates

Potential additions include Workers Firecrawl scraping, a Semantic Search knowledge base, Punctual booking, Cloudflarebase (now Frostbase) app backends, EmailFlare customer email, Cloudflare Playwright MCP browser automation, FormZero forms, Counterscale website analytics, and Auth Inbox agent verification. These are candidates, not commitments or current Canopy features. If prioritized, start with scraping, knowledge bases, durable jobs, and booking, and define each product's independent install and service boundaries before adding it.
