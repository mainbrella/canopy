# Raindrop

Mainbrella user administration. `/` shows the login form, then the users table
for the authenticated account `oneone@gmail.com`. Both the UI and backend
enforce the email restriction. Users are listed by `created_at DESC, id DESC`.
The Plan column shows None, Builder, Pro, or Scale from the backend's last synced
active subscription or an unexpired trial. It is an administrative snapshot;
paid access is still verified separately with Stripe.

Each user row opens `/users/detail?id=<user-id>`. The detail page shows the
user's profile, total/available/reserved wallet balance, and funding history,
newest first with 50 entries per page. Credit and revoked amounts reflect the
wallet's current refund/dispute state; dates are purchase times in UTC. This
uses the admin-only `GET /admin/users/{userId}` endpoint and does not contact
Stripe. Legacy subscription invoices are not included in prepaid funding history.

The Google and email/password authentication client is copied from `../web`.
Sign-in uses the backend's HttpOnly session cookie; this admin app does not load
the public site's advertising scripts or cookie consent UI.

```sh
npm ci
npm run dev       # Vite development server at http://localhost:5174
npm run typecheck # Check browser and Vite configuration TypeScript
npm run build     # Build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
```

Run `npm run dev` in `../backend` for local authentication, `GET /admin/users`,
and the accounting ledger, acquisition, and email endpoints.
The backend must have its database migrations and auth configuration in place.
Local requests default to `http://localhost:8787`; production requests default
to `https://api.mainbrella.com`.

Override these defaults with `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID` if needed.
The authenticated navigation includes Users at `/users`, Ledger at `/ledger`,
Acquisition Review at `/acquisition`, Email at `/email`, Email All at
`/email-all`, and EmailCustom at `/email-custom`. All paths can be loaded
directly, including in the static production build. The ledger shows entries
by creation time (`recorded_at` descending, then sequence descending), 100 entries
per page, using a fixed `throughSequence` snapshot across pages; Refresh starts a
new snapshot. The backend must have applied migration `020_accounting_ledger.sql`
before the ledger endpoint is available.

Acquisition Review uses `GET /admin/acquisition/leads` and
`GET /admin/acquisition/events`. Leads show repository submissions, captured
contacts, account linkage, and first-touch attribution, newest first. View events
from a lead to review its activity, or switch to Events to review all activity
in ascending sequence order. Filter by user ID, lead ID, and event type;
pagination shows up to 100 rows per page. Refresh returns to the first page with
the applied filters. Expand View data for full attribution and event payloads,
including signed paid-compute corrections. The backend must have migrations
`021_acquisition.sql` and `022_acquisition_sources.sql` applied and
`ACQUISITION_ENABLED=true`.

Email provides From, To, Subject, and plain-text Message fields and sends
`POST /api/send-marketing-email` with `{ from, to, subj, message }` using the admin
session cookie. From accepts a bare address or `Name <address>` from a domain
onboarded to Cloudflare Email Sending. The backend adds its Mainbrella header
and footer. A successful response confirms acceptance for sending, not inbox
delivery. Failed sends preserve the draft; successful sends keep From and clear
the other fields. The backend needs its `MARKETING_EMAIL` binding; local Wrangler
development simulates sending.

Email All loads the first 25 eligible marketing users from
`GET /api/get-marketing-users` and displays them with checked checkboxes. The
endpoint excludes users who opted out. From, Subject, and Message work like
Email; Send emails sends a separate `POST /api/send-marketing-email` for each
checked address, one at a time. Users without an email address cannot be selected.
Accepted recipients are unchecked, and any failures preserve the draft and
remaining selections. Sending stops if the admin session expires or access is
lost. The send endpoint also checks the recipient's current email preferences;
addresses that opted out are silently unchecked. Navigation preserves the draft
and selections; Refresh reloads recipients.

EmailCustom accepts one JSON object per line at `/email-custom`, for example
`{"email":"foo@bar.com","name":"John Smith","first":"John"}`. Each
nonblank line needs a nonempty string `email`; optional `name` and `first` fields
must be strings when present. Blank lines are ignored, and all addresses are
validated before sending. Email is sent sequentially to each bare address through
`POST /api/send-marketing-email`. Use `{{name}}` or `{{first}}` in the subject or
message to insert the matching value; omitted fields become empty strings.
Confirmed or opted-out recipients are removed silently, while failed and
unattempted original rows stay for review or retry. A full success clears the
rows, subject, and message. If the backend cannot check preferences, it fails
closed and reports that no email was sent.

The backend needs migration `033` for address-level email preferences and
unsubscribe support. Every send checks both account and address preferences,
including for recipients who do not have an account.

Google sign-in also requires the admin origin (`https://raindrop.mainbrella.com`,
or `http://localhost:5174` for development) in the existing Google OAuth client's
authorized JavaScript origins. The backend allows credentialed requests from
these origins. When changing the admin domain, update both the Google OAuth
client's authorized JavaScript origins and `AUTH_ORIGINS` in
`../backend/worker/app/auth-core.ts`, then deploy the backend. This app uses
Google's popup callback flow, so no OAuth redirect URI change is required.

Application code and Vite configuration use TypeScript. Add new source modules
as `.ts` files; `npm run build` runs the typecheck before creating the site.
