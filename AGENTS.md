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

Last implementation handoff: **2026-10-16**. The first account milestone is in
commit `94f620c` (`first brella under`). The Google browser sign-in milestone is
implemented in the current working tree. The tree was clean at the start of this
slice. The [README](README.md) contains setup instructions, the inspected source
inventory, and the broader migration plan; distinguish that plan from working code.

Implemented:

| Location | Responsibility |
| --- | --- |
| `platform/accounts/` | Local Cloudflare Worker, email/password and Google browser signup/sign-in, shared sessions/logout, and identity SQL migrations |
| `platform/console/` | Small Vite/TypeScript email form, optional Google control with loading/retry, and read-only account details |
| `packages/contracts/` | Public user/session types and runtime response validation |
| `packages/platform-client/` | Shared credentialed auth client with injectable fetch and no browser globals |
| `scripts/` | Local stack startup/cleanup and a Wrangler wrapper for local commands and dry-run builds |
| `.github/workflows/ci.yml` | Clean install, type checks, auth tests, builds, and browser checks; no deployment |

Current API: `POST /auth/email`, `POST /auth/google`, `GET /auth/me`, and
`POST /auth/logout`.
An unused email creates a new local account; an existing email authenticates it.
Session responses retain the backend's `id`, `email`, `name`, `dob`, and
`created_at` fields. Preserve the existing scrypt parameters, password checks,
concurrent-signup behavior, hashed session tokens, and 30-day lifetime.

Important boundaries and implementation notes:

- Local accounts are separate from hosted Mainbrella accounts. No customer data
  or production bindings were imported and nothing was deployed.
- The three identity migrations (`001`, `002`, `012`) are byte-identical source
  copies for a fresh local database. They are **not** the complete `delta`
  migration stream. Do not renumber them or apply this subset to hosted data.
- Loopback requests with `LOCAL_DEVELOPMENT=true` use `canopy_session` with
  HttpOnly/SameSite=Lax. This avoids overwriting sibling localhost sessions.
  Other hosts retain the original Secure/SameSite=None behavior. Do not broaden
  the development exception or origin allowlist to bypass authentication issues.
- Worker bindings use explicit types imported from
  `@cloudflare/workers-types/index.ts`. Loading its global declarations alongside
  Node types caused a `Buffer` collision; keep the module-based approach.
- Vite's `/auth` proxy is development-only. A future hosted console needs explicit
  routing; building the static files alone does not provide an API.
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
  Compute, Builder, and Voice are outside the completed milestone.
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

Last implementation verification passed:

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

These are local results from the implementation handoff, not evidence of a live
deployment or a completed remote CI run. Google browser tests do not authenticate
with Google; Worker tests stub Google's key response. A real Google smoke test
was **not run** because no explicit test OAuth client was supplied.

## Next checkpoint — real Google smoke test, then isolated staging

The local Google browser slice is implemented. Its sources were reinspected at
the same revisions recorded in `migration-sources.json`; copied identity
migrations and sibling repositories remain unchanged. Stop this slice here.

1. With an explicitly supplied separate test Web OAuth client, follow the README
   configuration and use `http://localhost:5175`. Test Google creation, repeat
   login, reload, logout, and password-account conflicts. Report actual Google
   behavior separately from the stubbed tests. Do not change production OAuth
   origins or use the sibling production client as a fallback.
2. Separately scope an isolated staging milestone with its own database and
   explicit console/API routing. Review hosting, HTTPS cookies, origin policy,
   provider configuration, key caching and the full migration stream before any
   deployment. This recommendation is not authorization to create hosted resources.
