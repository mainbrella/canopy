# Canopy

Canopy contains the MainBrella platform and its products. The apps share an npm
install and Git history. A source workspace identifies product ownership; it does
not necessarily require a separate deployment.

| Workspace | Source | Purpose |
| --- | --- | --- |
| `@canopy/backend` | [apps/backend](apps/backend) | Shared platform and API composition; Linux and Vibe code pending extraction |
| `@canopy/web` | [apps/web](apps/web) | Public website, account shell, and route/build composition; Linux and Vibe UI pending extraction |
| `@canopy/raindrop` | [apps/raindrop](apps/raindrop) | Raindrop admin frontend and operations scripts |
| `@canopy/voice` | [apps/voice](apps/voice) | Voice API, receptionist runtime, providers, usage meters, and browser behavior |

The three original source histories were imported with `git subtree add` without squashing.
[The import manifest](migration/imports.json) records exact origins, source commits,
licenses, dependency versions, and worker configuration fingerprints. Canopy's
original history and `origin` are preserved. The migration is merged into `main`;
production cutover remains pending.

## Product boundaries

The [homepage](apps/web/index.html) and
[many businesses article](https://mainbrella.com/blog/many-businesses-in-a-box-under-this-brella/)
describe independently useful products sharing one account and balance. Organize
the source around those products. This is the intended destination, not a claim
that Linux and Vibe have already moved:

```text
apps/
  backend/    # platform services and API/deployment composition
  web/        # public site, shared account UI, route/build composition
  raindrop/   # platform administration
  voice/      # worker/ and web/ owned by Voice
  vibe/       # next: builder API, agent/workflow, source/history, builder UI
  linux/      # then: compute API, runtime, images, files, terminals, workspaces
```

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

The first milestone extracts Voice's worker/browser logic, schemas, fixtures, and
tests. Its HTML and CSS still live in web, and its backend still runs inside the
API Worker. Its six allowed imports from backend are explicit transitional seams:
authentication, wallet access, inference pricing, deployment origin, OpenAPI
helpers, and a bounded-body reader currently housed in the container contract.
Worker types still use the API host's `Env` and generated Cloudflare bindings.
`npm run check:boundaries` prevents new product coupling and host imports of Voice
internals. Integration tests may still use backend fixtures and migration files.

Before adding a fourth product:

1. Review this Voice extraction, then move Voice's page templates/styles and
   define the small browser/platform and environment interfaces the next product needs.
2. Extract Vibe using the same `worker/` and `web/` structure, keeping its current
   builder release target. Extract Linux's API, runtime, and SDK ownership next.
   Promote generic helpers such as the bounded-body reader out of Linux first.
3. Once those boundaries are real, move the shared platform interfaces into a
   focused package under `packages/` so products no longer reach into backend.
   Keep backend and web as composition hosts. Do not create an unowned utilities
   dumping ground or copy shared services into each app.
4. Add `apps/email` or `apps/jobs` with its own routes, schemas, product tables,
   meters, browser module, and tests, consuming the same account/project/wallet
   interfaces. Platform welcome and marketing email remain platform concerns;
   customer transactional email is a product. Vibe's workflow implementation
   likewise remains Vibe code until a general jobs product provides a reusable API.

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
remain under `apps/backend/sdk` and are not npm workspaces.

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
runs that target's checks, bundle validation, and preflight before invoking its
existing publisher. Release evidence records the source SHA, target, validated
artifact hash, and deployed worker version. Backend releases share one concurrency
lock; each frontend target has its own lock. Bare `npm run deploy` fails with usage
help and publishes nothing.

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
or Durable Object migration.

Security provisioning, image building, and SDK publishing remain explicit
operations. The imported image/SDK release workflows are retained under
`apps/backend/.github/workflows` as historical configuration; GitHub does not
execute nested workflows. Image release assets and their owner remain
`mainbrella/backend` until deliberately migrated. The historical SDK workflow
stays pinned to 0.1.0; the current 0.2.0 source was qualified locally, not published.

The [original migration plan](migration/PLAN.md) is retained for the complete design
and acceptance criteria.
