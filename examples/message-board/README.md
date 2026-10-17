# Message board

A React and TypeScript application using BFF's public HTTP API. This example has
its own Vite development server, build, tests, and dependencies. It does not
import the platform's service or account UI implementations.

Run from the repository root:

```sh
npm ci
npm run dev:message-board
npm run test:message-board
npm run build:message-board
```

Open the URL printed by Vite. Choose Alice or Bob to log in, read and search
messages, create a post, and edit a post. **Create** opens a full-screen composer
with boards loaded from the `boards` table and labeled `board/:slug`. Title and
plain-text body are required; only the selected `board_id`, session's `user_id`,
and trimmed body are inserted into `messages`. Titles are not persisted yet.
The backend enforces ownership; editing another
user's post shows its denial and preserves the draft. Sessions stay in memory,
and logging out revokes the current session.

The public project, browser key, table, and API origin are in `src/config.ts`.
These are deliberately public browser values. Backend allowlists and session
issuance remain in `apps/bff/worker`; this example is an API consumer. Changes to
the fixed public demo project or users must also match that backend allowlist.

The composer requires `migrations/002_boards.sql` to be applied to the project.
Its browser key needs `boards: ['select']` and
`messages: ['select', 'insert', 'update']` table grants. The `boards` policy must
allow public selects; the `messages` policy must allow public selects and
own-row inserts/updates with `user_id` as the owner column. These permissions
must be configured on the backend; the composer never changes permissions.
Board-load errors offer retry, and failed posts preserve the title and body.

During development, Vite proxies `/message-board-api/*` to the live API with the
demo's permitted Mainbrella origin. Local edits therefore use the real demo
database. Production builds call the configured API origin directly, and a
separate deployment must have its exact origin allowed on the browser key.

`npm run build:message-board` produces `examples/message-board/dist/`. To preview
it, run `npm run preview -w @canopy/example-message-board`; the built app uses the
production origin rules above.

The Mainbrella site also composes this application's HTML and React entry through
the workspace's `/page` and `/web` exports. `npm run dev:web` serves the same app
at `/bff/demo/`, and `npm run build:web` includes it in the existing site
deployment with the site's cookie preferences. The standalone example does not
include the site's account shell, analytics, or cookie controls.
