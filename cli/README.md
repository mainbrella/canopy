# Canopy CLI

Install from this directory with `cargo install --path .`. Set
`MAINBRELLA_API_KEY` to an account API key, then use `canopy --whoami` to check
the account. Requests use `https://api.mainbrella.com`.

Run `canopy --migrate` from an application's root directory. That directory must
contain a `canopy.json` with its BFF project ID and a `migrations` directory:

```json
{
  "projectId": "90da3093-84b6-4cd7-a39a-a8afc39403b8"
}
```

Name migrations `<sequence>_<name>.sql`, for example `001_init.sql` and
`002_boards.sql`. Sequences are positive integers. Names start with a letter,
contain only letters, digits, and underscores, and are at most 63 characters.
Each SQL file must contain 1–32,768 bytes; the BFF permits up to 50 statements per
migration. Non-SQL files and subdirectories are ignored.

The CLI reads the latest applied sequence through
`GET /bff/projects/{projectId}/migrations`, backed by `_bff_migrations`. It skips
files at or below that sequence and applies all remaining files in numeric
order with `POST` to the same endpoint. Pending sequences must be consecutive;
duplicate sequences or names are rejected. Local validation finishes before
any migration is submitted.

Each migration commits atomically with its ledger entry. If a migration fails,
the CLI stops; earlier successful migrations remain applied. Rerun the command
after fixing the failure to resume. Matching concurrent retries are accepted by
the API. Applied files are skipped by sequence and are not rechecked for edits.

The message-board example already includes its project configuration. From this
directory, after installing the CLI and exporting the account key:

```sh
cd ../../mb
canopy --migrate
```

The account key must own that project. A provisioned message-board starter
already has sequence 1, so the CLI starts with `002_boards.sql` when it is
pending. Keep the account key in the environment, outside `canopy.json`.

To give a migrated table **Read: Everyone**, run from the same application
directory:

```sh
canopy --read-everyone boards
```

This uses the project in `canopy.json` and your `MAINBRELLA_API_KEY`. The CLI
reads the current table policy, then sets public reads through
`PUT /bff/projects/{projectId}/policies/{table}`. Existing write permissions and
the ownership column are preserved; new policies deny inserts, updates, and
deletes. The table must already exist. Refresh the BFF Permissions screen to see
its row with **Everyone** in the Read column.

Public reads expose all rows and columns through browser keys with a `select`
grant for that table. Browser access requires both that grant and the public
read policy. Table names start with a letter, contain only letters, digits, and
underscores, and are at most 63 characters; the `sqlite_` prefix is reserved.
