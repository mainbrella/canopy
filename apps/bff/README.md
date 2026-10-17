# BFF v0.0.1

An owner-managed SQLite backend with isolated JavaScript functions. The workspace
at `/bff/app/` starts with zero projects, tables, rows, migrations, functions, and
executions. Nothing is seeded. Data persists after reload. The landing page’s
broader SDK examples remain illustrative.

The first release includes project creation, dedicated D1 provisioning, table and
schema inspection, a SQL editor, ordered migrations, immutable function versions,
function invocation, execution metadata, daily budgets, and project pause/resume.
Existing navigation stays in place; authentication for application users, row
policies, storage, realtime, automations, notifications, search, payments,
templates, backup management, client SDKs, staging environments,
and project deletion are deferred. Their screens have empty states and no
simulated actions. Management APIs accept the project owner’s Mainbrella session
or existing account API key from `/api-keys/`, using the same authentication as Linux.
External browser apps can use scoped project keys for table CRUD and explicitly
published function versions through the Data API.

## Setup

1. Apply the backend’s pending migrations, including `050_bff.sql`,
   `051_bff_api_keys.sql`, and `052_bff_shared_api_keys.sql`, using the normal migration
   command (`npm run db:migrate:local -w @canopy/backend` for local control data).
2. Configure `BFF_CLOUDFLARE_ACCOUNT_ID` and `BFF_CLOUDFLARE_API_TOKEN` on the API
   Worker. Create a dedicated API token with **Account → D1 → Edit** permission
   scoped to the account hosting customer databases. Use Wrangler secrets
   for production and the backend’s ignored `.dev.vars` for local development.
   Prefer a separate Cloudflare account for customer databases; it can differ
   from the account hosting the API Worker.
3. The API config declares `worker_loaders: [{ "binding": "BFF_LOADER" }]` and
   `BFF_ENABLED=true`. Staging defaults to disabled and needs its own credentials
   and explicit enablement. Missing credentials or loader fail closed.
4. Run `npm run dev:backend` and `npm run dev:web`, sign in, and open `/bff/app/`.
   Create a project, apply a migration, insert rows or run SQL, then save and run
   a function. Local provisioning creates **real remote D1 databases** using the
   configured account; there is no in-memory development substitute in the app.

Configure your Wrangler login and BFF secrets once from the repository root:

```sh
npm exec -w @canopy/backend -- wrangler login
npm exec -w @canopy/backend -- wrangler secret put BFF_CLOUDFLARE_ACCOUNT_ID
npm exec -w @canopy/backend -- wrangler secret put BFF_CLOUDFLARE_API_TOKEN
```

The account ID is the 32-character Cloudflare account ID where customer databases
will be created. The token must cover that same account. Wrangler login authorizes
deployment; it does not configure these runtime credentials. Secret commands prompt
for values and deploy them immediately, so refresh `/bff/app/` after both succeed.
See Cloudflare's [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Then deploy directly from `apps/bff`:

```sh
npm run deploy
```

This applies pending account D1 migrations, runs API preflight, deploys the API,
then builds and deploys the website. BFF uses the existing shared API and website
Workers; both hosts are published from the current checkout. Each step waits for
the preceding step to succeed, using your local Cloudflare authentication. No
GitHub workflow, push, or extra flag is needed. The secret commands prompt for
values; they are not repeated by deployment.

With BFF enabled, API preflight checks both credential bindings and the isolation
loader before publishing. Missing credentials stop deployment with the exact local
setup commands, rather than leaving the workspace unavailable. This checks binding
presence; project provisioning verifies the token's actual account access.

Use `npm run deploy -- --check` to check and bundle both hosts without credentials,
migrations, or publication. A site failure leaves the successful API release record
available in `artifacts/releases/`; rerunning deploy reapplies only pending
migrations and republishes the hosts. For an API-only release, `npm run deploy`
from `apps/backend` remains available.

No infrastructure is provisioned just by opening the workspace. Project creation
first persists a pending control record, then the UI requests provisioning. Failed
provisioning can be retried from the workspace. A deterministic database name and
a provisioning lease recover lost create responses without allocating another
database. Existing project names are idempotent per owner. The control plane keeps
the database UUID; it is never accepted from the browser or customer code.

## Data and migrations

`050_bff.sql` adds only control-plane tables to the host’s `DB`: projects, function
source versions, daily usage, execution metadata, and a database deletion outbox. Every project has a separate
D1 database. Its sole initial table is the hidden `_bff_migrations` ledger; there
are no application tables or data. The trusted gateway accesses customer D1 via
Cloudflare’s account API, so it can provision databases without redeploying static
bindings. Account credentials remain in the gateway.

The SQL editor accepts one SELECT, INSERT, UPDATE, or DELETE statement, with
optional bound scalar parameters. Schema changes use migrations:

```json
{
  "sequence": 1,
  "name": "create_notes",
  "sql": "CREATE TABLE notes(id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);"
}
```

Each migration has the next sequential number, a unique name, exact source SQL,
SHA-256 checksum, and applied timestamp. The ledger insert and all statements go
in one transactional D1 batch. A constraint rejects out-of-order sequences before
DDL executes. Identical retries are no-ops; changing a previously applied migration
or reusing its name returns 409. Failed batches roll back both schema and ledger.
Recovery from an ambiguous provider response checks the committed ledger.
Apply a new forward migration to undo a change; automated down migrations are not
provided. Keep migration SQL in source control as well.

The scanner handles SQLite quoting and comments. This release supports ordinary
tables, indexes, ALTER/DROP TABLE or INDEX, and data backfills. Triggers, views,
virtual tables, PRAGMA, ATTACH/DETACH, explicit transactions, and WITH statements
are outside the supported SQL surface. `_bff_`, `_cf_`, and `sqlite_` names are
reserved, including when quoted. These restrictions preserve migration history;
tenant isolation comes from separate databases and authorization.

## Functions and isolation

Functions are single JavaScript ES modules with a default function export. No
package installation, TypeScript compilation, ambient secrets, filesystem,
background jobs, or general service bindings are provided.

```js
export default async function(input, ctx) {
  return (await ctx.db.select('notes', { id: input.id }, 1)).results;
}
```

Saving creates an immutable version using an `expectedVersion` compare-and-swap
(0 for a new function). Invocations can pin any saved version. A fresh Dynamic
Worker is loaded for every invocation with `env: {}`, `globalOutbound: null`, no
inherited compatibility flags, 50 ms CPU and 11 subrequests. HTTP and TCP egress
are denied by the runtime. Customer source is never evaluated by the API Worker.
See Cloudflare’s [egress control](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
and [resource limits](https://developers.cloudflare.com/dynamic-workers/usage/limits/).

Database access defaults to `none` (`ctx.db === null`). An owner may grant `read`
or `write` when saving a version. A per-invocation RPC capability exposes only:

- `select(table, filters = {}, limit = 100)` → `{ results, meta, success }`
- `insert(table, row)` → result with inserted rows
- `update(table, filters, row)` → result with updated rows
- `remove(table, filters)` → deletion result

Filters are scalar equality tests; null uses SQLite’s `IS` semantics. Update and
remove require a nonempty filter. Values are bound, identifiers validated, and
internal tables inaccessible. The capability holds one server-selected database,
checks pause/block state on each call, allows at most 10 calls, and expires after
5 seconds. No raw SQL, migration, provisioning, cross-project ID, or credential
method crosses the RPC boundary. Read access cannot write.

The gateway enforces a 5-second response deadline and closes the capability when
the invocation ends. CPU and subrequest enforcement belongs to the Cloudflare
runtime. Database writes that already reached D1 may commit even if execution
later fails or times out. A function is not an interactive database transaction;
design side effects to tolerate retries. Results must serialize to JSON. Inputs
and outputs are limited to 64 KiB; source is limited to 32 KiB.

## External browser Data API

Existing `MAINBRELLA_API_KEY` account credentials work for BFF, including SQL,
project creation, provisioning, migrations, and function calls. From a trusted server:

```sh
curl "https://api.mainbrella.com/bff/projects/$PROJECT_ID/query" \
  -H "Authorization: Bearer $MAINBRELLA_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"sql":"SELECT * FROM notes","params":[]}'
```

The response is `{ result: { success, results: [...], meta } }`. The same account
key can call `/bff/data/{projectId}/tables/{table}` with owner access, and the data
function endpoint runs the latest saved version. Ownership, pause/block switches,
and budgets still apply. An explicit invalid Bearer credential never falls back
to a browser session. Account keys are powerful server credentials; public
browser apps should use scoped keys.

Scoped browser credentials use the same `api_keys` store, token generation,
identity lookup, usage tracking, and revocation system as account keys. BFF keeps
only its table/function/origin grants in `bff_api_key_grants`. Both key types are
listed at `https://mainbrella.com/api-keys/`, labeled Account or BFF browser, and
can be revoked there. Browser keys retain their `bff_pk_` prefix and cannot
authenticate Linux or BFF owner operations. Migration 052 preserves existing
browser tokens and grants; no key rotation is required.

Create a scoped key with the owner management API using your signed-in Mainbrella
session, or use `Authorization: Bearer <MAINBRELLA_API_KEY>` from a trusted server:

```js
const api = 'https://api.mainbrella.com';
const projectId = 'YOUR_PROJECT_ID';
const response = await fetch(`${api}/bff/projects/${projectId}/api-keys`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'My web app',
    origins: ['https://my-app.example', 'http://localhost:3000'],
    tables: { notes: ['select', 'insert', 'update', 'delete'] },
    functions: { read_notes: 1 },
  }),
});
if (!response.ok) throw new Error((await response.json()).error);
const { key, token } = await response.json();
```

Browser key-management requests require an allowed Mainbrella origin. Server
requests can omit Origin. The project must be ready;
any granted function version must already exist. The response returns the full
`bff_pk_…` token once. Only its SHA-256 hash is stored in the shared key store. `GET` on the same URL lists
key IDs, names, prefixes, origins and grants; `DELETE /bff/projects/{projectId}/api-keys/{keyId}`
revokes a key, as does the top-level API Keys page. Listing and revocation work while the project is paused or the
feature is disabled. Revocation stops new requests; it does not cancel operations
already running. There are at most 20 live keys per project.

In the external frontend, use the scoped token without Mainbrella cookies:

```js
const base = `https://api.mainbrella.com/bff/data/${projectId}`;
const headers = { apikey: 'YOUR_BFF_BROWSER_KEY' };

// Equivalent to SELECT * FROM notes LIMIT 100.
const response = await fetch(`${base}/tables/notes`, { headers });
if (!response.ok) throw new Error((await response.json()).error);
const { data, meta } = await response.json();
// data: [{ id: 'one', body: 'Hello' }], meta: provider execution metadata

// SELECT id, body FROM notes WHERE id IS ? ORDER BY id ASC LIMIT 10.
const params = new URLSearchParams({
  select: 'id,body', id: 'eq.one', order: 'id.asc', limit: '10',
});
const filtered = await fetch(`${base}/tables/notes?${params}`, { headers });

// Invoke only the function version pinned in the key's grant.
const result = await fetch(`${base}/functions/read_notes/invoke`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ input: { id: 'one' } }),
}).then(response => response.json());
// { id, version: 1, ok: true, value: [...] }
```

The key can be sent as `apikey` or `Authorization: Bearer …`. Supplying both with
different values is rejected. A key authorizes only its own project. Browser
origins must match an origin on that key exactly; wildcards and URL paths are
rejected. Preflights allow `apikey`, `authorization`, and `content-type`, without
credentialed cookies. Non-browser requests can omit Origin; CORS is a browser
control, not a substitute for the key's permissions.

| Endpoint | Required table grant | Body / query |
| --- | --- | --- |
| `GET /bff/data/{id}/tables/{table}` | `select` | Optional `select`, `limit`, `offset`, `order`, and column filters |
| `POST /bff/data/{id}/tables/{table}` | `insert` | One JSON row; no query parameters |
| `PATCH /bff/data/{id}/tables/{table}?id=eq.one` | `update` | JSON object of changed columns; at least one filter |
| `DELETE /bff/data/{id}/tables/{table}?id=eq.one` | `delete` | At least one filter |

Table responses are `{ data: [...], meta: {...} }`; insertion returns 201. Insert
and update return the affected rows. Delete returns empty `data` and an affected
row count in `meta.changes`. Filters support `column=eq.value` and `column=is.null`,
combined with AND. Equality values are strings bound through SQLite's column
affinity rules. Rows accept strings, finite numbers, and null. Reads select `*`
or comma-separated column names, with one `order=column.asc` or `.desc`, a limit
of 1–100 (default 100), and an offset of 0–1,000,000 (default 0). Choose an order
when paginating. Duplicate parameters, SQL expressions, joins, and other filter
operators are rejected. Row and function request bodies are limited to 64 KiB;
table results use the existing 2 MiB provider-response bound.

Grants are denied by default. A table grant covers **every row and column** in
that table, including rows added later. Browser keys are visible to app users;
grant only data and operations you intend those users to access. Per-user
authentication and row-level policies are not implemented. Published functions
can implement narrower operations using their saved database capability; their
inputs are untrusted and they receive no authenticated end-user identity.
Function grants pin immutable versions, so saving a new version does not change
what an existing key runs. Create a replacement key to change grants or origins.
Keys cannot use the owner SQL, schema, migration, provisioning, or function-source
APIs. Raw SQL stays in the owner SQL editor/API. This is a limited Supabase-style
REST surface, not full PostgREST or Supabase SDK compatibility.

## Budgets and operations

There are at most 5 projects per owner, 100 functions per project, and 100 versions
per function. Each project has 10,000 database statements and 1,000 attempted
invocations per UTC day, plus 3 concurrent invocations. Counters and concurrency
reservations are persisted atomically in the control database; retries/failures
consume budget. Database results are bounded to 2 MiB at the provider boundary;
function database results are limited to 64 KiB. Schema inspection covers the
first 50 tables; row browsing shows at most 100 rows. SQL remains available for
other tables. Migration and execution lists show the latest 100 records.

Owners can pause projects in Settings. Operators can set `bff_projects.blocked=1`
in the control database to disable a specific project; owners cannot clear that
flag. `BFF_ENABLED=false` stops data-plane operations globally. Neither switch
undoes completed writes or preempts a database request already in flight.
Execution records contain version, status, duration, and bounded error codes;
arguments/results are not stored. Runtime console capture and automatic log
retention are deferred. Provider errors and credentials are not returned.

Account deletion cascades enqueue database cleanup before removing project
records. The API’s scheduled handler retries up to 10 deletions per run, including
databases whose creation response was lost. Cleanup waits two minutes for in-flight
provisioning and continues even when BFF is disabled. Keep the D1 token configured
until the deletion outbox is empty. Revoked credentials retain pending cleanup
records for retry; they do not silently discard resource identifiers.

Application-user authorization, billing, automatic abuse detection, and production qualification
of account quotas are separate release work. Treat the fixed budgets as resource
limits, not billing controls.

## API and verification

`@canopy/backend` composes the BFF `routes` and `openapi` exports; the web host
composes its existing page and browser exports. Endpoints live under `/bff`:
`config`, `projects`, and `projects/{id}/{provision,schema,query,migrations,functions,executions,usage}`.
Functions add `/{name}` and `/{name}/invoke`. Project PATCH pauses/resumes it.
Projects also expose owner-managed `api-keys` and `api-keys/{keyId}`. The separate
browser Data API lives under `/bff/data/{projectId}` with `tables/{table}` and
`functions/{functionName}/invoke`. Both entry points use the same project budgets,
pause/block checks, and function runtime. The generated API document describes
request and response schemas and the cookie, account-key, and scoped-key authentication schemes.

Run `npm test -w @canopy/bff`, `npm run type-check -w @canopy/bff`,
`npm run test:openapi -w @canopy/backend`, `npm run type-check -w @canopy/backend`,
`npm run docs:generate -w @canopy/backend`, `npm run build:site -w @canopy/web`,
and `npm run check:boundaries`. The integration tests execute the shipped routes,
Worker Loader and RPC capability in workerd/Miniflare, with real control-plane D1
and a SQLite-backed mock of Cloudflare’s remote provisioning/query API. They
create no remote resources. Live Cloudflare provisioning and production CPU-limit
enforcement still require a configured staging smoke test before rollout.
