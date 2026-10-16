# Migration status and production cutover

The code migration is implemented on `codex/monorepo-migration`. Production ownership
has not changed. Do not set `CANOPY_DEPLOYS_ENABLED=true` until the external steps
below have been completed. That variable gates both manual production workflows.

## Imported source baseline

| App | Source repository | Branch | Imported commit |
| --- | --- | --- | --- |
| Backend | `mainbrella/backend` | `main` | `0bc20dec148c1a78b40aa252a76735103d1dbe1f` |
| Web | `mainbrella/web` | `main` | `64a088549157141daaaec00c1746290b83c2e9aa` |
| Raindrop | `mainbrella/raindrop` | `main` | `be89935ae248cb3f5ccd9ceb5585e1bba097a7ba` |

Canopy started at `e1d0b15` on its existing `main` with
`git@github.com:mainbrella/canopy.git` as origin. All source worktrees were clean.
Each source remains untouched; full source histories, licenses, backend AGENTS.md,
SDK layout, migration files, and application layout are retained. Only committed
tracked content was imported. No environment files or ignored state were copied.
There was no `.wrangler/security-service-credentials.json` in the source checkout;
none was generated. Any other operator with that file must securely transfer the
original file to the ignored `apps/backend/.wrangler/` path with mode 0600 before
security provisioning. Never regenerate an existing data encryption key.

`imports.json` retains original lock fingerprints and every resolved package
version. The combined root lock preserves those versions. Backend dependencies
are hoisted; differing frontend dependency trees remain nested where needed.
Node 22.22.2 / npm 10.9.7 is the verified development pair. No dependencies or
runtime upgrades were introduced by the migration.

## Verification

App-local `npm ci` passed before consolidation. Backend tests, OpenAPI tests,
type-check, syntax checks, service/API bundle boundaries, and documentation
generation passed at the imported paths. Web documentation checks, tests, and both
site and builder builds passed. Raindrop typecheck/build passed.

After consolidation, the backend checks pass under Node 22 and Node 24. SDK 0.2.0
JavaScript, Python wheel, and Python source archives were locally qualified with
the root lock; installed-artifact tests pass. macOS qualification requires GNU
coreutils, findutils, and sed on PATH; the first baseline attempt stopped at BSD
`stat`, then qualification passed with the documented tools. No SDK was published.
The historical release workflow intentionally remains pinned to an already
published 0.1.0 candidate; see `apps/backend/docs/sdk-release.md`.

Raindrop's route checker and local Wrangler smoke checks passed for `/`, `users`,
`users/detail`, `ledger`, `acquisition`, `email`, `email-all`, and `email-custom`,
including trailing-slash redirects and unknown-route 404s. Its local/production API
defaults, Vite public overrides, auth code, and credentialed requests are unchanged.
Production OAuth, cookies, and CORS still require post-deployment smoke checks.

Root tests cover target selection, moves/deletions/missing Git history, guarded
deploy dispatch, correct working directories/configs, failed prerequisites, and
one selected publisher. All publication is stubbed in tests. Workflow lint passes.
API preflight tests use injected Cloudflare version/deployment metadata and
read-only D1/secret metadata fixtures. Remote deployment preflights were not run.

`node scripts/check-bundle.mjs containers` strips container image configuration
only from a temporary bundling config, so offline checks do not build Docker images
or read the live custom image manifest. Actual publication retains the original
guarded digest selection, image deployment lease, and runtime configuration.

## Integration inventory (read-only, October 16, 2026)

| Integration | Observed state | Required cutover action |
| --- | --- | --- |
| Repository visibility | Canopy, backend, web, and Raindrop are public | Keep user-source image builds in a separate private build repository; never enable private-only build jobs in a public repository |
| Canopy Actions | Enabled; default token is read-only | Validate the migration branch CI and manual target workflow before enabling publishing |
| Actions secret names | Backend has `CLOUDFLARE_API_TOKEN`, `IMAGE_BUILD_SECRET`; Canopy/web/Raindrop have none | Install least-required existing values in Canopy's production environment; GitHub secret values cannot be read back or copied through the API |
| Actions environments | None in these four repositories | Configure Canopy `production`, access/review policy, and release variables |
| Frontend build variables | Existing app defaults remain intact | Preserve any configured `VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_GA_MEASUREMENT_ID` values as public production environment variables |
| Branch protection | No `main` branch protection in these four repositories | Intentionally configure required `test` status if desired |
| Repository webhooks | None in these four repositories | Confirm any account-level or Cloudflare-managed connections separately |
| GitHub App installation | `chatgpt-codex-connector`, all repositories | Audit deployed import/build app grants and credentials separately; the org installation listing does not establish their deployed configuration |
| Backend workflows | CI, terminal image, custom image, and SDK staging are active in the old repository | Retire duplicate CI/writers deliberately; preserve external image asset publishing until its successor works |
| Scheduled work | Old terminal image workflow: Monday 04:23 UTC; old custom image reconcile: hourly at :17 | Assign one owner; old runtime reconciliation must stop before Canopy backend publishing is enabled |
| Release assets | `mainbrella/backend`: `terminal-image` has terminal/catalog manifests; `sdk-v0.1.0-candidate` has the pinned npm archive | Keep that repository accessible; source import does not move assets or release permissions |
| Image build dispatch | `IMAGE_BUILD_GITHUB_REPOSITORY` is an explicit deployed API setting | Verify its current private owner, GitHub App grant, callback secrets, and untrusted/trusted job isolation before changing it |
| Cloudflare Workers Builds, domains, OAuth origins | Not modified or fully inventoried here | Inspect account-side build connections and retire duplicate automatic publishing; preserve all existing domains, resource IDs, bindings, OAuth origins, CORS, and cookies |
| npm/PyPI trusted publishing | Existing SDK provenance is separate from Git history | Configure a new qualified version and publisher identity in a separate SDK release change |

## Cutover sequence

1. Review and merge the migration branch after Canopy CI passes from a clean
   checkout. Keep the source repositories available for rollback.
2. Configure Canopy's production environment, required secrets, app grants, and
   any Cloudflare connections. Check each token's access to its existing resources.
   Do not add a staging flag to production-pinned backend configurations.
3. Preserve terminal/catalog release assets at `mainbrella/backend`, or migrate
   them and every consumer deliberately. Source-history import alone is insufficient.
   Confirm the separate private image builder remains operational and its untrusted
   build jobs do not receive trusted publish credentials.
4. Disable old production writers and runtime reconciliation schedules before
   enabling Canopy production publishing. GitHub concurrency groups are scoped to
   one repository; the Canopy backend lock cannot serialize an old backend workflow.
   Retain the old configuration, secrets, and rollback evidence.
5. Set `CANOPY_DEPLOYS_ENABLED=true` only after ownership is established. Dispatch
   one target at a time at an explicit full SHA already on Canopy `main`. Local
   root commands use the same workflow and lock. Check health, bindings, production
   OAuth/API login behavior, and static routing after each frontend release.
6. Retain each release artifact: source SHA, target, validated artifact SHA-256,
   worker version, and deployment ID. For container releases the validated bundle
   hash covers worker code; the guarded publisher's logs and deployed worker version
   identify the actual published digest map. Keep those logs with the evidence.
7. Archive a source repository only after histories, artifacts, integrations,
   production ownership, and rollback have all been verified.

## Coordinated changes and rollback

Normal deploy commands publish exactly one target. The **Coordinated backend
operation** workflow is opt-in and shares the targeted backend concurrency group.
It retains the original aggregate order and `deploy:bootstrap-activity` order.
Use bootstrap only when the API lacks AccountActivity: containers without activity,
admin and marketing, API exports, normal containers, previews. An API-only preflight
refuses unpublished runtime prerequisites instead of publishing other workers.

Shared D1 migrations belong to the API configuration only. API and preview migration
operations remain separate from ordinary deployment. Use expand/contract changes
and review each SQL migration with its data recovery plan before execution.

Roll back a single Worker to its recorded prior version using that app's Wrangler
configuration, or release a pinned last-good Canopy commit through the target
workflow. Backend rollback operations must also use the backend deployment lock.
A code rollback does not revert D1 changes, restore deleted data, revert Durable
Object migrations, or restore an old container image map. Preserve the currently
compatible schema and published digests, and follow `apps/backend/docs/deployment.md`
for runtime/bootstrap constraints. Security provisioning remains the separate
operator-controlled `apps/backend/scripts/deploy-security-services.mjs` operation;
its `--api-account` mode publishes qualification flags and is not a normal target.
