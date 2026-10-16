# Voice installation boundary

The selected first product is Voice, using the existing single-owner standalone adapter. This extraction packages that product; it does not yet connect a console install/status API or provision a test deployment.

## Source and release identity

Package: `@canopy/voice`, version `0.1.0`. Runtime/API/migration baseline: `mainbrella/ai-receptionist` at `7d3e023318f36f7a45e5d155c46d96e3896f9502`. Compared against hosted `backend` at `0bc20dec148c1a78b40aa252a76735103d1dbe1f` and `web` at `3dcea8975e2936ec26da95395b5df3f9042fa5f0`. The provenance manifest records exact per-file origins and intentional changes.

Canopy is the maintained source for this extracted product. Its standalone export and monorepo Appflare template are distribution paths for the same implementation. No shared engine package is introduced before it has another real consumer. Hosted wallet/identity convergence remains deferred; this change does not replace the hosted services or retire the sibling repository.

## Ownership and authorization

No target account, resource IDs, domain, or provisioning credentials are selected by this extraction. An operator must explicitly choose a target and authorize its installation. A Canopy self-service account grants no provisioning authority. Keep Cloudflare credentials server-side or in the operator's CLI; never send them to the Voice UI.

| Resource | Owner and purpose |
| --- | --- |
| Worker and static assets | Dedicated Voice installation; same-origin UI and `/auth/*`, `/voice/*`, `/health` routes |
| D1 `DB` | Voice receptionist, calls, token hashes, login/search counters; no platform identity or wallet tables |
| `RECEPTIONIST_CALL` | Product-local `ReceptionistCall` SQLite Durable Objects; temporary per-call state and expiry/hangup retries |
| Workers AI | Operator account; inference usage billed by Cloudflare |
| Daily cron | Redacts expired Voice transcripts and configuration, expires session/rate-limit rows |
| Twilio/Telnyx | Optional operator-owned credentials, phone numbers, and carrier charges |
| AI Gateway/Deepgram/Cartesia | Optional operator-owned speech providers; not provisioned by this product |

`ADMIN_PASSWORD` (at least 16 characters) protects a single owner workspace. Sessions last eight hours, store hashed tokens, and are invalidated by password rotation. HTTPS uses the host-only Secure/HttpOnly/SameSite=Strict `__Host-canopy_voice_session` cookie. The local cookie is separate from Canopy accounts. There is no cross-host cookie assumption or shared-account login handoff.

## Direct Wrangler installation

Requirements: Workers Paid (the configuration requests 30,000 ms CPU), D1, SQLite Durable Objects, and Workers AI. Build and test before selecting resources. These are **operator-run instructions**, not actions performed during extraction.

From `products/voice` in either a standalone export or the monorepo:

1. Copy `wrangler.jsonc` to ignored `wrangler.install.jsonc`. Set a new, dedicated Worker `name`, the explicitly chosen `account_id`, and a dedicated `database_name`. Keep the class name and `v1` migration for `ReceptionistCall`.
2. Authenticate Wrangler to the chosen account. Create only the new installation database and put the returned UUID in the install config:

   ```sh
   npx wrangler d1 create YOUR_VOICE_DATABASE --config wrangler.install.jsonc
   ```

3. Set `VOICE_PUBLIC_ORIGIN` to the installation's exact HTTPS origin (no trailing slash), `VOICE_ENABLED` to `"true"`, and set the password secret:

   ```sh
   npx wrangler secret put ADMIN_PASSWORD --config wrangler.install.jsonc
   npm run build:client
   npx wrangler d1 migrations apply DB --remote --config wrangler.install.jsonc
   npx wrangler deploy --config wrangler.install.jsonc
   ```

4. Add optional provider settings/secrets using the same explicit install config. Use the [carrier guide](telephony.md); credentials stay out of browser bundles. The UI's “Configured” indicator means settings are present, not that a live carrier call has passed.
5. Record the actual source SHA, Worker version, account, database ID, Durable Object namespace, origin, and enabled providers in a deployment record. Verify sign-in, save/reload, a real text and microphone turn, history/logout, and signed incoming calls for each enabled provider. `/health` is a liveness check only, not proof that credentials, migrations, or live inference work.

For an existing standalone installation, preserve its Worker name, D1 ID, Durable Object class/migration history, origin, and resources. Back up data first, apply pending migrations, and deploy intentionally. The cookie rename requires a new sign-in. There is no production hosted-data migration in this package.

## Retention and partial installation cleanup

Before creating resources, record their intended names and ownership. If installation stops partway through, inspect and reuse only those dedicated resources; do not blindly create another database or overwrite an existing Worker. A provisioning adapter will need a persisted install identity and idempotent retries before console installation is exposed.

For an abandoned test install, first stop incoming carrier traffic and disable calling, allow active calls/hangup retries to finish, and export any required Voice data. Delete only the recorded installation's Worker/namespace and D1 after explicit cleanup authorization. Never delete platform identity, shared accounts, other products, or unrelated carrier numbers. Keeping the D1 retains transcripts and provider tombstones; deleting it is irreversible. No uninstall control is exposed by this extraction.

No real Cloudflare or carrier installation was performed. Local fixtures and dry runs are recorded separately in the Canopy handoff; they are not deployment evidence.
