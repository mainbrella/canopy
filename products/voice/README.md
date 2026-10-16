# Mainbrella Voice

Voice is a self-contained Cloudflare Worker: a password-protected receptionist workspace, browser and text conversations, incoming Twilio/Telnyx calls, speech settings, number search, and retained transcripts. Its Worker, UI, migrations, and tests are maintained here in Canopy. Cloudflare and carrier usage belongs to the operator's accounts.

This is the existing standalone extraction brought into Canopy after comparison with the hosted backend and web sources. The current adapter owns one receptionist and uses an operator password. Canopy accounts, hosted Mainbrella billing, Compute, and Builder are not prerequisites. The console installer and cross-host account handoff are separate, unfinished work.

## Local development

Use Node 22.13+ and npm 10+. From the Canopy root:

```sh
npm ci
cp products/voice/.dev.vars.example products/voice/.dev.vars
# Replace ADMIN_PASSWORD with a random password of at least 16 characters.
npm run db:migrate:local --workspace @canopy/voice
npm run dev:voice
```

Open **http://127.0.0.1:8791** and sign in with that password. Save a receptionist, reload, and inspect its settings and history. Local D1 state lives in `products/voice/.wrangler/`; preserve it between runs. Stop with Ctrl-C. Restart to rebuild client changes; Wrangler watches Worker source.

The local command disables remote bindings and calling defaults to off. It needs no Cloudflare login and makes no model calls. Real conversations need Workers AI in a configured deployment; see [installation](docs/installation.md). The product uses its own `canopy_voice_session` cookie, separate from Canopy accounts and the older standalone app.

## Verification

From the Canopy root:

```sh
npm run type-check --workspace @canopy/voice
npm run test:voice
npm run build:voice
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright" npm run test:browser:voice
```

The unit/runtime suite uses real local D1, Durable Objects, WebSockets, and the installed Voice SDK with deterministic model/carrier fixtures. The browser suite builds the actual UI and runs the call runtime on port 8792 with an in-memory database and simulated AI. Its server blocks external requests. Neither suite establishes live provider compatibility, account provisioning, or real phone audio.

`npm run check` includes Voice type checks, tests, and builds alongside the account regressions. `build:voice` produces `dist/client` and a dry-run Worker in `dist/worker`; it does not deploy. Staging commands still deploy only the console/accounts services.

## Standalone distribution

From a clean committed Canopy checkout, `npm run export:voice` writes `products/voice/dist/source`. That directory contains only this product, its license/provenance, `SOURCE.json`, and a product-only lockfile derived from the root lockfile. It preserves the `products/voice` subpath in a one-product workspace so dependency and peer resolution remain identical. Move the directory to an independent location and run at its root:

```sh
npm ci --ignore-scripts
npm run type-check
npm test
npm run build
cp products/voice/.dev.vars.example products/voice/.dev.vars
# Set a private ADMIN_PASSWORD, then:
npm run db:migrate:local
npm run dev
```

`npm run export:voice -- --allow-dirty` permits local verification of uncommitted work and marks it **not a release**. Release exports require a clean source commit. The standalone export is the distribution boundary for consuming this implementation without a second maintained engine or the rest of Canopy. Existing sibling deployments keep their current sources until deliberately updated.

For a direct Cloudflare installation, follow [installation](docs/installation.md). For a future catalog update, see `docs/appflare.md` in the Canopy source. The catalog template points at the monorepo and requires a published immutable source pin; no new catalog release or live installation is recorded for this extraction.

## Operation

Each install owns one Worker with static assets, one D1 database, the SQLite-backed `ReceptionistCall` Durable Object namespace, and a daily retention cron. Configure `ADMIN_PASSWORD` as a secret. Browser/text calls require Workers AI and `VOICE_ENABLED=true`; phone calls additionally need carrier credentials and an exact HTTPS public origin. See [phone connections](docs/telephony.md) and [speech models](docs/voice-languages.md).

Calls retain the standalone limits: three active calls, 100 starts in a rolling 24 hours, 15 minutes per call, and 60 turns. Each call uses a snapshot of the saved receptionist settings. Transcripts default to 30-day retention (`TRANSCRIPT_RETENTION_DAYS`, 1–365). Deletion redacts completed-call transcripts and configuration, purges temporary call state, and retains provider tombstones for replay protection and quota accounting. Audio is not recorded. Outbound calls, scheduling, transfers, CRM updates, and account lookups are not connected.

The three SQL migrations retain their standalone names and bytes. They apply to a new Voice database or an existing compatible standalone Voice installation; never apply them to the platform identity database or production `delta`. Source revisions, hashes, and adaptations are recorded in Canopy's `migration-sources.json` and included in standalone exports. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
