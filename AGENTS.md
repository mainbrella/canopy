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
commit `94f620c` (`first brella under`). The worktree was clean before adding this
file. The [README](README.md) contains setup instructions, the inspected source
inventory, and the broader migration plan; distinguish that plan from working code.

Implemented:

| Location | Responsibility |
| --- | --- |
| `platform/accounts/` | Local Cloudflare Worker, email/password signup and sign-in, browser sessions, logout, and identity SQL migrations |
| `platform/console/` | Small Vite/TypeScript sign-in form and read-only account details |
| `packages/contracts/` | Public user/session types and runtime response validation |
| `packages/platform-client/` | Shared credentialed auth client with injectable fetch and no browser globals |
| `scripts/` | Local stack startup/cleanup and a Wrangler wrapper for local commands and dry-run builds |
| `.github/workflows/ci.yml` | Clean install, type checks, auth tests, builds, and browser checks; no deployment |

Current API: `POST /auth/email`, `GET /auth/me`, and `POST /auth/logout`.
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
- Google/native sign-in, password recovery, welcome email, analytics/consent
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

- Fresh `npm ci`, all TypeScript checks, Worker dry-run build, and console build.
- 12 auth/client tests, including password hashing, signup races, session expiry
  and revocation, rejected origins, rate limits, and unavailable infrastructure.
- 6 browser tests covering real local D1 signup/sign-in/reload/logout, failure
  recovery, keyboard controls, and all four viewport sizes. Screenshots were
  visually inspected.
- Source hashes matched the provenance manifest; all three migration copies
  were unchanged; sibling Git statuses were unchanged.
- Browser teardown released both ports. The first teardown attempt left child
  processes running; process-group cleanup and Playwright graceful shutdown
  fixed it. Preserve that behavior when changing the development runner.

These are local results from the implementation handoff, not evidence of a live
deployment or a completed remote CI run.

## Next milestone — recommended: Google browser sign-in

Complete the other existing browser sign-in method while keeping the same small
console and isolated local accounts. This is the proposed next implementation
slice, not work already completed or authorization to deploy.

1. Reinspect `../backend/worker/app/auth-core.ts` and `auth-login.ts`, plus
   `../web/src/auth.ts` and `../raindrop/src/auth.ts`/`login.ts`. Extract only the
   browser Google verification/login behavior; leave native tokens, review-account
   shortcuts, welcome email, and product dependencies outside Canopy.
2. Add `POST /auth/google`, its shared client method, and an optional Google
   sign-in control. Configure the client ID explicitly; with no configuration,
   email sign-in must remain fully usable and the Google control should be absent.
   Do not hard-code the production client or change its authorized origins.
3. Preserve token signature/issuer/audience/expiry checks and verified-email
   requirements. Preserve the identity-conflict rule: a Google credential must
   not silently claim an existing password account. Both providers should use
   the same session lookup and logout behavior.
4. Test with local signing keys and stubbed Google key responses: valid and
   invalid tokens, account creation/repeat login, identity conflicts, and
   provider failures. Cover the optional UI states and rerun the existing email
   and browser regressions. A real Google smoke test needs an explicitly
   configured test client; report it separately from mocked verification.
5. Update README API/setup notes and source provenance. Stop after this slice;
   do not bundle Raindrop, billing, product migrations, or hosted deployment.

After browser auth is proven, consider a separate isolated staging milestone
with its own database and routing before moving another platform feature. The
existing production resources and sibling repositories remain unchanged.
