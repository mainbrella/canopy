# Canopy

Canopy contains the MainBrella platform and its products. The apps share an npm
install and Git history. A source workspace identifies product ownership; it does
not necessarily require a separate deployment.

| Workspace | Source | Purpose |
| --- | --- | --- |
| `@canopy/backend` | [apps/backend](apps/backend) | Shared platform and API/deployment composition |
| `@canopy/web` | [apps/web](apps/web) | Public website, account shell, and route/build composition |
| `@canopy/raindrop` | [apps/raindrop](apps/raindrop) | Raindrop admin frontend and operations scripts |
| `@canopy/platform` | [packages/platform](packages/platform) | Shared wallet, product usage charging, and billing client |
| `@canopy/vibe` | [apps/vibe](apps/vibe) | Builder API, agent/workflow, source/history, and browser behavior |
| `@canopy/linux` | [apps/linux](apps/linux) | Compute API, runtime, images, workspaces, SDKs, and browser behavior |
| `@canopy/bff` | [apps/bff](apps/bff) | BFF marketing homepage, styles, and browser interactions |
| `@canopy/voice` | [apps/voice](apps/voice) | Voice API, receptionist runtime, providers, usage meters, and browser behavior |
| `@canopy/example-message-board` | [examples/message-board](examples/message-board) | Independent React example consuming the BFF HTTP API |

The three original source histories were imported with `git subtree add` without squashing.
[The import manifest](migration/imports.json) records exact origins, source commits,
licenses, dependency versions, and worker configuration fingerprints. Canopy's
original history and `origin` are preserved. The migration is merged into `main`;
production cutover remains pending.

## Product boundaries

The [homepage](apps/web/index.html) and
[many businesses article](https://mainbrella.com/blog/many-businesses-in-a-box-under-this-brella/)
describe independently useful products sharing one account and balance. Organize
the source around those products. Voice, Vibe, and Linux have their own worker/browser source workspaces:

```text
apps/
  backend/    # platform services and API/deployment composition
  web/        # public site, shared account UI, route/build composition
  raindrop/   # platform administration
  bff/        # backend-for-frontend marketing page and browser interactions
  voice/      # worker/ and web/ owned by Voice
  vibe/       # builder API, agent/workflow, source/history, builder UI
  linux/      # compute API, runtime, images, files, terminals, workspaces
packages/
  platform/   # shared wallet implementation and typed product charging API
examples/
  message-board/ # standalone React frontend consuming BFF over HTTP
```

Examples are complete applications built with the platform. They own their
frontend dependencies, development servers, tests, and builds. Keep their API
clients independent of service internals. The message board also supplies its
HTML and browser entry to the existing site at `/bff/demo/`.

Backend owns accounts, sessions, API keys, shared project identity and ownership,
the wallet, funding, payment integrations, ledger, and common storage accounting.
Products own their resources, authorization at their resource boundary, provider
integrations, usage receipts, product prices, and interfaces. Core inference token
cost arithmetic lives in `worker/lib/inference-pricing.ts`; Builder keeps its
existing error adapter and image pricing. Voice owns its audio/phone prices and
settles charges through the existing account wallet.

The API entry point composes product routes, OpenAPI registrations, scheduled
reconciliation, and Durable Object exports. Start with explicit imports. A
workspace alone does not justify a plugin framework, HTTP hop, new database, or
new Worker. Vibe should eventually use Linux's supported compute interface;
shared use of a capability does not make the capability platform core. Products
must not import another product's implementation or the web shell.

Web owns the homepage, blog, documentation, global navigation, sign-in, profile,
balance, and shared account UI. Product browser code belongs beside its worker
code. Web route entry points supply session policy and configuration, then start
the product module. Move product-specific HTML, CSS, and assets alongside each
product as route composition is extracted; avoid building a second account shell
or duplicating sign-in and billing per product. Existing `/voice/`, `/build/`, and
Linux URLs can stay stable regardless of source location.

Backend composes each product's supported package exports. Linux supplies compute
policy to the shared wallet; its account Durable Object retains the existing
`CONTAINER_ACCOUNT` binding, `account:<userId>` identity, and persisted state.
Vibe owns project source-workspace SQL and prepares its own retention statements
for the platform's atomic expiration batch. Shared storage uses explicit product
key prefixes; Vibe orphan cleanup scans only its legacy `build-git/` namespace.
Product HTML/CSS remain inputs to web's existing site and builder deployments.
Their location does not require another deployment or account shell.

Before adding `apps/email`:

1. Use `@canopy/platform/billing` for `reserveUsage`, `settleUsage`, and
   `releaseUsage`. Email owns its prices, provider requests, durable send receipts,
   and reconciliation. Funding, Stripe, spending caps, and accounting stay shared.
   See [the product billing contract](packages/platform/README.md).
2. Register the workspace, its backend/web exports, boundary rules, and checks for
   the hosts that actually deploy it. Keep ordered product migrations in backend.
3. Give Email storage an explicit `product: 'email'` owner and a
   `products/email/<userId>/<resourceId>/` key prefix. Add Email's own retention
   statements to the host's expiration composition when storing retained data.
4. Keep platform welcome and marketing emails in backend. Customer transactional
   email belongs in Email. Do not duplicate account or checkout implementations.

Shared auth, OpenAPI, inference pricing, and storage imports remain explicitly
listed transitional backend seams. New shared interfaces belong in the focused
platform package. `npm run check:boundaries` rejects sibling internals, browser
imports of wallet services, and platform dependencies on product implementations.
Integration fixtures may exercise the real hosts and ordered migrations.

Keep the existing ordered D1 migration history in backend while these products
share a database; identify each new table's product owner and avoid rewriting or
replaying old migrations. Shared tables have one owner. Separate deployments and
data stores can follow when isolation, scaling, or release cadence warrants them.
Before the fourth app, each product should have a tested public entry point, no
imports of sibling internals, and checks selected for its actual deployment hosts.

## Development

Use Node **22.22.2** and npm **10.9.7** for the verified development baseline:

```sh
nvm use
npm ci
npm run dev:backend
```

Start `npm run dev:web` and `npm run dev:raindrop` in separate terminals as needed.
Workspace commands also work directly, for example `npm run dev -w @canopy/backend`.
Run installs from this root; there is one `package-lock.json`. The SDK packages
remain under `apps/linux/sdk` and are not npm workspaces.

Keep local configuration in each app's ignored environment files. See
[web's environment example](apps/web/.env.example) and the app READMEs. Browser
`VITE_*` inputs are public configuration. Local backend orchestration and its
one-time local migrations remain in `apps/backend/scripts/dev.mjs`.

## Checks

```sh
npm test
npm run test:backend
npm run test:web
npm run test:voice
npm run test:vibe
npm run test:linux
npm run test:platform
npm run check:boundaries
npm run docs:check
npm run build:web
npm run build:raindrop
npm run check:routes -w @canopy/raindrop
node scripts/verify-migration.mjs
```

CI selects checks conservatively from both sides of Git diffs, uses the same
checkout for backend/web documentation, and always reports the required `test`
status. Backend CI uses Node 24; web, Raindrop, and SDK checks use Node 22. SDK and
backend Python checks retain their Python 3.10 and 3.12 environments.

`node scripts/verify-migration.mjs --baseline` additionally verifies that worker
configuration and resolved dependency versions still match the original import.
This is a migration acceptance check; ordinary CI permits intentional future
configuration and dependency changes.
The Voice extraction intentionally prunes obsolete web dependency paths, so the
historical `--baseline` dependency-path check no longer passes. Ordinary migration
verification still checks ancestry, licenses, workspace links, and tracked files.

## Releases

Production cutover is **pending**. [The cutover checklist](migration/CUTOVER.md)
records repository integrations, external release owners, and remaining rollout
work. No infrastructure or production publishing was performed by this migration.

### Staging

Staging uses `stg.mainbrella.com`, `api-stg.mainbrella.com`, and
`raindrop-stg.mainbrella.com`, with separate workers, databases, storage, sessions,
and deployment controls. Production hosts and resource bindings stay unchanged.
See [the staging setup and release guide](STAGING.md) for the one-time GitHub,
Cloudflare, preview DNS/TLS, and Google sign-in setup.

```sh
npm run stg:plan                  # Show reserved hosts and resources
npm run stg:homepage -- --check   # Validate just the static staging website
npm run stg:homepage -- --publish # Publish the website with local Wrangler login
npm run stg:backend -- --publish  # Install the API and its private staging services
npm run stg:check                 # Test and bundle all targets without publishing
npm run stg:bootstrap             # First installation, through GitHub Actions
npm run stg:deploy -- api         # Subsequent release of one staging target
```

The homepage command can bring up the static website before the staging backend
exists; sign-in and application features need the backend deployment afterward.
It publishes only `mainbrella-web-stg` at `stg.mainbrella.com`.

`stg:backend` uses local Wrangler authentication to create the staging databases
and bucket, apply migrations, and publish the API with its private services.
It leaves preview hosting and the remaining frontend releases for later. Use
`npm run stg:backend -- --check` for validation without provider access.

The full staging workflow has its own `CANOPY_STAGING_DEPLOYS_ENABLED` gate and never
enables the production release workflow. Staging starts with empty data and
external purchases and email delivery disabled.

### Production

After cutover, select exactly one target:

```sh
npm run deploy:api
npm run deploy:admin
npm run deploy:marketing
npm run deploy:containers
npm run deploy:previews
npm run deploy:site
npm run deploy:builder
npm run deploy:redirect
npm run deploy:raindrop
```

These commands dispatch the manual production workflow at the clean, committed
checkout's SHA, which must already be merged into Canopy `main`. The workflow
runs that target's preflight and publisher without tests or dry runs. Frontend
publishers build their assets once. Release evidence records the source SHA,
target, published artifact hash, and deployed worker version. Backend releases share one concurrency
lock; each frontend target has its own lock. Bare `npm run deploy` fails with usage
help and publishes nothing.

To deploy directly from your Mac, add `--local`:

```sh
npm exec -w @canopy/backend -- wrangler login
npm run deploy:api -- --local
npm run deploy:site -- --local
```

From `apps/web`, `npm run deploy` publishes the builder and then the site using
your local Wrangler login, and writes local release evidence. Run
`npm run deploy -- --check` there to validate and bundle both without
publishing. The equivalent commands from the repository root are:

```sh
npm run deploy -w @canopy/web
npm run deploy -w @canopy/web -- --check
npm run deploy -w @canopy/web -- --help
```

You can also run `npm run deploy` from `apps/backend`. That command applies
pending account D1 migrations and deploys the API directly using Wrangler login.
The full backend rollout is available there as `npm run deploy:all`.
Running `npm run deploy` from `apps/bff` applies account D1 migrations and deploys
both the shared API and website in order, using your local Wrangler login.

Each local command waits for its deployment to finish. It uses the current
checkout, including uncommitted changes, and keeps the target’s preflight and
publisher. It reuses Wrangler login or `CLOUDFLARE_API_TOKEN`; credentials stay in
memory. Local release records under `artifacts/releases/` include the source SHA,
whether the checkout was dirty, artifact hash, and deployed version. No GitHub
login or push is required. Local deployments do not share GitHub’s concurrency
lock, so run them separately from workflow releases of the same Workers.

For the first BFF release, configure `BFF_CLOUDFLARE_ACCOUNT_ID` and
`BFF_CLOUDFLARE_API_TOKEN` on the API Worker, then apply
`npm run db:migrate:remote -w @canopy/backend` before deploying API and site.
See [BFF setup](apps/bff/README.md#setup).

For local validation without publication or remote deployment preflights:

```sh
npm run deploy:site -- --check
node scripts/check-bundle.mjs containers
npm run api:preflight -w @canopy/backend -- --local
```

`deploy:admin` means the private backend admin service. `deploy:marketing` means
the email service. Raindrop is the admin frontend. Site and builder outputs remain
separate (`dist/` and `dist-builder/`).

Coordinated backend releases, activity bootstrap, and explicit API/preview database
migrations use the separate **Coordinated backend operation** manual workflow,
with the same backend lock. See [backend deployment guidance](apps/backend/docs/deployment.md)
for ordering and rollback constraints. A worker rollback does not undo a database
or Durable Object migration. Coordinated releases record source SHAs and published
worker versions without separate validation bundles. Run tests and bundle checks
in CI or with the explicit local validation commands above.

Security provisioning, image building, and SDK publishing remain explicit
operations. The imported image/SDK release workflows are retained under
`apps/backend/.github/workflows` as historical configuration; GitHub does not
execute nested workflows. Image release assets and their owner remain
`mainbrella/backend` until deliberately migrated. The historical SDK workflow
stays pinned to 0.1.0; the current 0.2.0 source was qualified locally, not published.

The [original migration plan](migration/PLAN.md) is retained for the complete design
and acceptance criteria.
