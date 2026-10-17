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
trimmed title, and trimmed body are inserted into `messages`. Apply
`migrations/004_message_titles.sql` after the existing migrations to add the
stored title column. Existing messages are titled from the first 200 characters
of their trimmed body; inserts from older clients that omit a title receive
`Untitled`.
The backend enforces ownership; editing another
user's post shows its denial and preserves the draft. Sessions stay in memory,
and logging out revokes the current session.

The public project, browser key, table, and API origin are in `src/config.ts`.
These are deliberately public browser values. Backend allowlists and session
issuance remain in `apps/bff/worker`; this example is an API consumer. Changes to
the fixed public demo project or users must also match that backend allowlist.

**+ Create new Board** below **My messages** opens a modal for a required name
(up to 80 characters) and an optional description (up to 2000 characters).
Creating a board inserts its name, description, generated unique slug, and the
signed-in user's `user_id` into `boards`. New boards appear in the message
composer the next time it opens. Failed requests preserve the form for retry.

Configure the example's schema and board permissions with the Canopy CLI. From
`examples/message-board`, with an installed `canopy` and the project owner's
account key in `MAINBRELLA_API_KEY`, run:

```sh
canopy --migrate
canopy --read-everyone boards
canopy --own-rows boards --owner-column user_id
canopy --browser-keys
canopy --grant boards select --key 673cfd0a-65b7-4029-b823-fca7733e7a96
canopy --grant boards insert --key 673cfd0a-65b7-4029-b823-fca7733e7a96
```

The key ID above belongs to this example's configured browser key. For another
deployment, use the matching key ID from `--browser-keys`. `--own-rows` configures
the table's ownership policy; `--grant` separately permits the browser key to
perform each operation. Both are required for board creation. These commands
are safe to rerun and preserve other key grants. Board schema and permission
setup belong to this example and require no BFF backend migration.

The composer requires `migrations/002_boards.sql` and
`migrations/004_message_titles.sql` to be applied to the project.
Its browser key needs `boards: ['select', 'insert']` and
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
