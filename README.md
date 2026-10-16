# Canopy monorepo migration plan

> **Plan only.** This document describes a proposed migration. The imports, workspace configuration, scripts,
> workflows, and deployment commands below have not been implemented. Do not treat examples as runnable commands
> until their phase is complete.

Canopy will bring the current `backend`, `web`, and `raindrop` repositories into one Git repository while
keeping their code and deployment targets distinct. The move should preserve source history and make
cross-project changes easier to review. A monorepo checkout does not make the applications one release unit:
API, backend services, public site, builder, redirect, and Raindrop admin UI remain separately built and
deployed.

## Goals and boundaries

- Keep the existing Canopy repository, its `main` branch, and its remote. Import the three source repositories
  into this repository; do not replace its Git history or rewrite the source repositories.
- Preserve each source repository's committed history, license files, and application layout. Record each
  imported origin and source commit.
- Keep API, admin service, marketing email service, containers, previews, public site, builder, `www` redirect,
  and Raindrop admin UI as explicit targets. Keep security provisioning as a separate coordinated operation.
- Retain current worker names, domains, bindings, resource IDs, Durable Object classes and migration tags,
  schedules, secrets, and database ownership.
- Consolidate install and CI ownership only after each app works from its imported path. Keep app-specific SDKs,
  containers, migrations, and scripts under `apps/backend` at first.
- Use npm workspaces, with no Nx/Turbo adoption and no package-manager change.
- Keep `packages/` for code that is actually reused and `tools/` for an operational tool that is demonstrably
  useful across apps. Do not extract speculative shared abstractions as part of the move.

## Proposed repository layout

```text
canopy/
  apps/
    backend/       # API and backend workers, SDKs, migrations, containers
    web/           # main site, builder, www redirect
    raindrop/      # Raindrop admin frontend and its operational scripts
  scripts/         # small root deploy-target dispatcher and path helpers
  .github/
    workflows/     # CI and explicit deployment workflows
  package.json     # private root package and workspace commands
  package-lock.json
  README.md
```

The app directories retain their internal structure unless a later change has a clear reason to move a file. In
particular, keep `apps/backend/sdk`, its container build context, migration files, and app-local scripts intact
during the initial import. Keeping the three app roots as siblings preserves existing web documentation
helpers that refer to `../backend` and `../../backend`; verify those references without renaming the siblings.

The root package will be private and declare only these workspaces:

```json
{
  "private": true,
  "workspaces": ["apps/backend", "apps/web", "apps/raindrop"]
}
```

Use unique package names: `@canopy/backend`, `@canopy/web`, and `@canopy/raindrop`. The current web and Raindrop
manifests both use `foo-web`; resolve that collision as part of workspace setup. First confirm each app's
existing lockfile and install baseline. Then generate one root lock file and remove app-local locks only when
root `npm ci` reliably installs all three apps from a clean checkout. npm supports running scripts in a selected
workspace; root aliases should use that explicit scope ([npm workspaces
documentation](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)).

## Deployable targets

The names and paths below describe existing deployment boundaries. Root command aliases are proposed and are not
implemented by this plan. Unprefixed backend configurations below live in `apps/backend/`.

| Product or service | Existing configuration and worker | Intended release scope |
| --- | --- | --- |
| Backend API | `apps/backend/wrangler.jsonc`; `mainbrella-api`; `api.mainbrella.com` | API only, after compatibility preflight; database migrations are separate |
| Admin service | `wrangler.admin.jsonc`; `mainbrella-admin` | Admin service only; retains private `ADMIN_API` binding |
| Marketing email service | `wrangler.marketing.jsonc`; `mainbrella-marketing` | Email service only; retains private `MARKETING_API` binding |
| Containers | `wrangler.containers.jsonc`; `mainbrella-containers` | Guarded runtime release using published image digests and API Durable Object references |
| Previews | `wrangler.previews.jsonc`; `mainbrella-previews`; `mainbrella.dev` and wildcard | Preview worker only, retaining API and container references |
| Security services | `wrangler.security-ack.jsonc` and `wrangler.egress-relay.jsonc`; `mainbrella-security-ack` and `mainbrella-egress-relay` | Existing coordinated provisioning operation for both services and API secrets |
| Public website | `apps/web/wrangler.jsonc`; `mainbrella-web`; `mainbrella.com` | `apps/web/dist/` only |
| Builder | `apps/web/wrangler.builder.jsonc`; `mainbrella-builder`; `/build/*` | `apps/web/dist-builder/` only, preserving `/build` routing and asset isolation |
| `www` redirect | `apps/web/wrangler.redirect.jsonc`; `mainbrella-www-redirect` | Redirect worker only |
| Raindrop admin UI | `apps/raindrop/wrangler.jsonc`; `mainbrella-raindrop`; `raindrop.mainbrella.com` | `apps/raindrop/dist/` only |

The backend `deploy` command currently aggregates several backend releases. The web `deploy` command currently
builds and publishes the builder and site. Neither aggregate should become the root default. Backend also has
guarded scripts for containers, previews, security services, and service preflights; preserve those controls.
`ingress/compose.yaml` is a separate host infrastructure operation, not part of a normal app deploy.

The backend marketing target sends email; it is not the public marketing website. The existing website artifact
combines public marketing pages and the authenticated application. Keep that artifact intact during the
migration; a later split into separate websites is a product change with its own rollout.

## Deployment command contract

The proposed root interface is explicit:

| Root command | Workspace | Existing publish script to invoke after validation |
| --- | --- | --- |
| `npm run deploy:api` | `@canopy/backend` | `deploy:api` |
| `npm run deploy:admin` | `@canopy/backend` | `deploy:admin` (private admin service) |
| `npm run deploy:marketing` | `@canopy/backend` | `deploy:marketing` (email service) |
| `npm run deploy:containers` | `@canopy/backend` | `deploy:containers` |
| `npm run deploy:previews` | `@canopy/backend` | `deploy:previews` |
| `npm run deploy:site` | `@canopy/web` | `deploy:site` |
| `npm run deploy:builder` | `@canopy/web` | `deploy:builder` |
| `npm run deploy:redirect` | `@canopy/web` | `deploy:redirect` |
| `npm run deploy:raindrop` | `@canopy/raindrop` | `deploy` (admin frontend only) |

For example, the site publisher invokes `npm run deploy:site -w @canopy/web`. An optional
`deploy:admin-ui` alias can point to Raindrop; `deploy:admin` always means the backend service.

These commands do not exist yet. A future `npm run deploy` without a target must fail with usage help; it must
never publish every worker. Implement a small explicit dispatcher and allowlisted target registry in root
`scripts/`. Each entry should name the workspace, working directory, config, validation, preflight, and publish
command. Invoke the selected app's existing scoped script and preserve its working directory for relative
configs, assets, and Docker contexts. Do not use an app aggregate deploy from a root alias.

Each target must validate and preflight before publishing only that target. The API currently has a bare
`wrangler deploy --config wrangler.jsonc`; add a narrow API preflight for configuration, bindings, secrets, and
schema compatibility. Reuse existing checks. An API-only deploy must not silently build or roll out container
images. Containers must retain image lock/digest and guarded preflight behavior. The backend security workers
must continue to use the guarded `apps/backend/scripts/deploy-security-services.mjs` provisioning operation.
That script provisions both workers and writes API secrets; it is a coordinated operation, not an alias for
either single-worker target. Its `--api-account` mode also publishes API qualification flags; keep it outside
ordinary deploy aliases. Container image building and SDK publishing likewise remain explicit release workflows.

Independent releases still depend on compatible runtime resources. The admin service uses the API's
ContainerAccount Durable Object, containers and API reference one another, and admin/marketing share D1 with the
API. Required bindings, service secrets, and resource versions must exist before a targeted publish. Existing
services retain their secrets; new environments must provision them before publishing API bindings. Provide a separate, opt-in
coordinated backend release for changes that require several targets. Preserve current bootstrap behavior for
the API/containers cycle; there is no universal order that fits every backend change.

When the API is missing the `AccountActivity` export, retain the existing bootstrap sequence: containers with
`--without-activity`, admin and marketing, API exports, normal containers, then previews. Reuse
`deploy:bootstrap-activity` for that case. The API preflight must refuse a release that needs unpublished
runtime bindings or exports rather than silently publishing other targets. `/capabilities` alone does not
establish runtime health.

Keep API and preview migration operations explicit and separate from ordinary worker deployment. Use
expand/contract schema changes so old and new code can coexist during rollout. A code rollback does not undo a
database or Durable Object migration; document rollback constraints per migration.

## Runtime and product behavior to preserve

- API remains the authentication and request-routing authority. It owns the OpenAPI schemas, including schemas
  for admin and marketing service routes. A public admin/marketing endpoint schema change therefore also needs
  API documentation and publication as an explicit compatible multi-target release.
- API alone remains the authority for shared D1 migrations. Do not allow the admin or marketing worker configs
  to apply shared migrations.
- Keep all existing worker names, Cloudflare bindings and resource IDs, Durable Object classes and migration
  tags, domains, schedules, and secrets. A repository move is not an infrastructure rename.
- Keep the web builder's independent build output and `/build` route behavior. Keep builder assets separated
  from the site output.
- Preserve Raindrop deep links. Vite currently copies the `users`, `users/detail`, `ledger`, `acquisition`,
  `email`, `email-all`, and `email-custom` paths. Do not add a blanket SPA fallback that changes those routes.
- Preserve the Raindrop API defaults and environment inputs: local API `localhost:8787`, production
  `api.mainbrella.com`, `VITE_API_URL`, and `VITE_GOOGLE_CLIENT_ID`. Preserve web's `VITE_GA_MEASUREMENT_ID`,
  OAuth origins, CORS rules, and cookie behavior.
- Treat Raindrop's Google Ads operational scripts, Python requirements, and Node test files as operations
  tooling, not as app publication triggers.
- Keep `backend/scripts/dev.mjs`'s local orchestration and one-time local migration behavior. The intended local
  workflow is `npm run dev -w @canopy/backend`, with `npm run dev -w @canopy/web` and
  `npm run dev -w @canopy/raindrop` in separate terminals as needed. Keep per-app environment examples;
  browser `VITE_*` values are public configuration and must not contain backend secrets.

## Staged migration

### 1. Record a reproducible baseline

- Confirm the current Canopy `main` and remote, and confirm all three source repositories are clean. Start a
  migration branch in Canopy.
- Record each source repository URL, branch, and exact source SHA in a checked in import manifest. Preserve
  license and notice files.
- Run and record each source app's current install, checks, builds, and deploy preflights as applicable. Capture
  current worker/config names and resource bindings before changing paths.
- Inventory repository integrations: Actions secrets and environments, GitHub App grants, webhooks, Cloudflare
  build connections, SDK publishing, schedules, branch protection, and release asset locations.

### 2. Import history into app directories

- Use `git subtree add` without `--squash` to import the backend, web, and Raindrop histories into
  `apps/backend`, `apps/web`, and `apps/raindrop` on the Canopy migration branch. Keep each source repo
  untouched.
- Add the source URL and imported SHA beside the import manifest entry. Verify representative old commits remain
  reachable in Canopy history.
- Import committed tracked content only. Exclude environment files, secrets, `.wrangler`, `node_modules`,
  `dist`, generated state, and other ignored local artifacts. Do not carry build output into Git.
- Preserve the backend's existing `AGENTS.md` and API schema contract files.

### 3. Make each app work at its new path

- Initially preserve app-local package manifests and locks so the migration does not combine path changes with
  dependency resolution changes.
- Keep scripts running from the app directory when they depend on local configs, assets, fixtures, or container
  context. Update workflow action path inputs explicitly; `defaults.run.working-directory` does not change paths
  supplied to Actions `uses` steps.
- Fix scripts that hardcode app-local `node_modules/wrangler`, TypeScript, `tsx`, or `.bin` paths, including `deploy-preflight`,
  `deploy-services-preflight`, `deploy-containers`, `deploy-security-services`, `publish-catalog-images`,
  `deploy-previews-preflight`, and `qualify-sdk-artifacts`. Cover Wrangler, TypeScript, and `tsx` resolution
  with fixtures and a clean checkout before root-level hoisting. Update Wrangler `$schema` references that
  assume a local `node_modules` path.
- Web's `scripts/sync-agent-docs.mjs` defaults to `../backend`, and onboarding tests refer to `../../backend`.
  Verify these sibling paths in the final app layout. Keep the backend as canonical docs source, preserve
  generated public paths and archives, and use the same commit for cross-repo docs.
- Update any GitHub workflows and change classifiers that assume the Git root is the app root. A moved app's Git
  root is now Canopy; path filters must account for `apps/backend` or `apps/web` prefixes.
- Backend deploy helpers hardcode `mainbrella/backend` for `terminal-image` release assets. Deliberately
  move release assets and permissions or keep a documented external repository. Git import does not move release
  assets, repository settings, or secrets. Keep the image build repo private if `IMAGE_BUILD_GITHUB_REPOSITORY`
  dispatches `custom-image.yml` there. Repoint that setting and its GitHub App permissions deliberately if the
  build repository changes. Preserve a separate private build repository if Canopy's visibility is incompatible.
- Preserve and securely transfer the existing `.wrangler/security-service-credentials.json` for installations
  that use those credentials. Do not regenerate it during the move; its encryption key may protect existing
  data. Keep the file outside Git.
- Preserve the SDK's intentional qualification and release version. The current qualification candidate refers
  to SDK `0.1.0` while the current SDK is `0.2.0`; inspect this discrepancy and do not republish blindly.
- Keep untrusted image build work separate from trusted jobs that hold publish secrets. Give scheduled work one
  owner so old and new repositories cannot run duplicate schedules.
- Optional web operations tools refer to an external `repo-rodeo` checkout. Make that location configurable;
  do not make unrelated external checkouts a prerequisite for normal Canopy builds.

### 4. Consolidate npm installation

- Resolve workspace package names and install baseline while app locks still exist. Add the private root package
  and explicit workspaces above.
- Migrate to one root lockfile; pin one verified Node/npm development pair after compatibility is established.
  Compare resolved dependency versions against the three baselines and avoid incidental upgrades.
- Update each CI workflow to use the root install only after every app's clean-checkout build and path-sensitive
  scripts pass.

### 5. Establish root CI and deploy ownership

- Move operational workflows to `.github/workflows` and set app working directories explicitly. Retire nested
  legacy workflows only after their Canopy replacements pass and can deploy the intended target.
- Install required Canopy repository secrets, environments, GitHub App grants, webhooks, SDK provenance
  settings, and Cloudflare connections before cutover. If Cloudflare Workers Builds are enabled, inventory them
  and disable duplicate automatic publishing or scope them to one explicit target. Keep GitHub Actions as the
  common CI and deployment owner. Cloudflare documents monorepo build configuration and root directories
  ([Workers CI/CD](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)).
- Initially permit manual `workflow_dispatch` deploys for an explicit target and production environment. Do not
  invent a staging environment flag: backend preflights currently pin production resources. A staging target
  needs separate resource configs and revised guards first.
- A deploy workflow must validate and build its selected target at the exact selected commit, even if that
  target's checks were skipped by an earlier PR affected-path run. Track deployed source SHA and version
  independently for each target; releases do not need to share one SHA.
- Use per-target, per-environment concurrency for frontend releases. Use a common backend deployment lock
  across targeted backend releases, coordinated rollouts, shared migrations, and scheduled runtime
  reconciliation; separate target groups alone do not prevent conflicts. Local production releases must use
  the same release path or lock. Retain the existing container deployment lease as well. Do not cancel an
  in-progress deployment automatically.
- Record source SHA, target, artifact hash, and deployed worker version for every release. Roll back a single
  worker to its prior version or rebuild a pinned last-good commit; handle state and data migrations under their
  own rollback plan.

### 6. Cut over and retire old writers

- Validate Canopy CI and target-specific packaging from a clean checkout. Once release checks pass, disable
  old production writers and duplicate schedules before enabling Canopy's production publishing. Retain the
  old configuration for rollback. Deploy one selected target at a time and check health and bindings.
- Archive the source repositories only after history, artifacts, settings, and deployment ownership are
  verified. Keep the source repositories untouched during import and validation.

## CI and affected-target selection

After workspace consolidation, each Canopy CI job installs from the root lockfile and runs relevant checks. Preserve
current Node 22 web and SDK checks and Node 24 backend checks, plus the Python 3.10/3.12 matrix where currently
used. After validation, select one verified development Node/npm version; do not upgrade runtimes during the
migration.

Do not use `deploy:containers -- --dry-run` as an offline CI check: it may read the live manifest and expire
overdue build records. Use mocked image selection tests and Wrangler bundle checks in CI instead.

Reuse backend `service-changes.mjs` and web `affected-targets.mjs` after teaching them the new root prefixes.
The classifier must handle added, modified, deleted, and moved paths with `git diff --no-renames --name-only -z`
on both sides of a comparison. Unknown paths select broad checks for their owning app; unknown root paths,
missing history, or classifier failures select all checks. Keep the current conservative service allowlists.

| Change | Checks to select |
| --- | --- |
| Backend admin or marketing service-only files | That service's checks and build; publish only on an explicit deploy request |
| Backend auth, shared schema, library, or migrations | Broad backend checks plus web/Raindrop consumer contract and auth checks where affected |
| Backend API schema or public admin/marketing endpoint contract | API OpenAPI generation/publication checks plus each affected service's compatibility checks |
| Container changes | Container checks, image selection tests, and Wrangler bundle checks |
| Backend previews or security service files | The matching target checks |
| Web builder-only files | Builder checks; `src/build-route.ts` and its test belong to the site |
| Shared web files | Site and builder checks |
| Raindrop UI files | Raindrop typecheck/build and relevant route smoke checks |
| Raindrop operations scripts and tests | Relevant operations checks; do not trigger UI publishing by path alone |
| Root lockfile, shared workflow, or root tooling | All app checks |
| API/SDK/reference docs or generated public documentation | Same-commit `docs:check`, generation drift checks, and site build; explicit site release when published content changes |
| Repository-only documentation | Documentation checks without app deployment |

Affected selection chooses checks; it never automatically deploys every selected app. A later affected-path
continuous deployment policy can be added after manual target workflows are reliable. Keep an aggregate required
status job that always reports selected failures. GitHub warns that a workflow skipped by path filters can leave
a required check pending; use an always-running aggregate status rather than making a path-skipped workflow the
required check ([workflow syntax
documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). The
existing backend required status is named `test`; preserve or intentionally update branch protection when
replacing that workflow.

## Verification and acceptance

Carry the existing checks into CI. These are scripts in the source repos; use `npm run <script> -w <workspace>`
after workspace setup. Run the full baseline once during migration, then select the relevant checks per change.

| Scope | Required verification |
| --- | --- |
| Backend baseline | `test`, `test:openapi`, `type-check`, `check:containers`, `docs:generate`, `check:services`, `check:api`, `sdk:qualify`, and workflow lint |
| API | `test:api`, `test:openapi`, `type-check`, `check:api`; update Chanfana/Zod schemas and run `docs:generate` for endpoint changes |
| Admin service | `test:admin`, `type-check`, `check:admin` |
| Marketing email | `test:marketing`, `type-check`, `check:marketing` |
| Containers / previews | Relevant container/API tests and `check:containers` / `check:previews`; retain deployment-time compatibility gates |
| Web | `docs:check`, `test`, `build:site`, `build:builder`; retain artifact isolation checks |
| Raindrop | `typecheck`, `build`, direct-link and login/API smoke checks; run Node/Python operations tests when that tooling changes |

Regenerate OpenAPI and synchronized public references, then fail CI on unexpected generated-file drift.
Add focused dispatcher tests that stub publishing and prove each alias invokes exactly one intended worker,
uses the correct working directory/config, runs its checks, and refuses unmet release prerequisites. Test
affected-path selection with renames, deletions, shared files, and missing history. These tests must not publish.

The migration is ready for cutover only when all of these conditions hold:

- Canopy retains its existing history and remote; all three imports retain source history, licenses, origin
  URLs, and source SHAs.
- A clean Canopy checkout installs with the root lockfile and builds each app from its app directory. No secret,
  ignored state, or generated build output entered Git.
- API, admin, marketing email, containers, previews, site, builder, redirect, and Raindrop each have an explicit
  target command. Security provisioning stays a separate coordinated operation. Calling deploy without a
  target publishes nothing.
- Target checks and preflights run before that target's publish command. API-only publishing does not deploy
  containers, images, or unrelated services. Existing protected deployment paths remain protected.
- Backend shared migrations can only be applied through the API migration authority. Coordinated service changes
  document compatibility, deployment order, and data/runtime rollback limits.
- Web site and builder outputs remain isolated; `/build` routes and assets work. Raindrop's deep links,
  credentialed API calls, OAuth, CORS, and cookies work at its production origin.
- Root CI checks the correct targets for changes, handles moves/deletions and missing history, and produces an
  always-reported required status.
- Canopy owns production workflow secrets and deployment triggers. Old production writers and duplicate
  schedules are disabled only after the Canopy path has been validated.
- Release evidence identifies source SHA, target, artifact hash, and deployed worker version. A worker rollback
  path and migration rollback constraints are documented.

No runtime test, build, deployment, import, or production configuration change is performed by this plan
document. Those checks belong to the staged migration when implementation is authorized.
