# Canopy

Canopy contains the MainBrella backend, website and builder, and Raindrop admin UI.
The apps share an npm install and Git history, while retaining separate builds and
release targets.

| Workspace | Source | Purpose |
| --- | --- | --- |
| `@canopy/backend` | [apps/backend](apps/backend) | API, private services, containers, previews, SDKs, migrations |
| `@canopy/web` | [apps/web](apps/web) | Public website and application, builder, `www` redirect |
| `@canopy/raindrop` | [apps/raindrop](apps/raindrop) | Raindrop admin frontend and operations scripts |

All three source histories were imported with `git subtree add` without squashing.
[The import manifest](migration/imports.json) records exact origins, source commits,
licenses, dependency versions, and worker configuration fingerprints. Canopy's
original history and `origin` are preserved. The migration is merged into `main`;
production cutover remains pending.

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
npm run stg:check                 # Test and bundle all targets without publishing
npm run stg:bootstrap             # First installation, through GitHub Actions
npm run stg:deploy -- api         # Subsequent release of one staging target
```

The homepage command can bring up the static website before the staging backend
exists; sign-in and application features need the backend deployment afterward.
It publishes only `mainbrella-web-stg` at `stg.mainbrella.com`.

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
