# Return to separate repositories

The split exports Canopy commit `e9cd53f` into the existing sibling `web`,
`backend`, and `raindrop` repositories. Their Git histories and remotes are
preserved. The changes are left uncommitted for review. Nothing was deployed,
pushed, or applied to a remote database.

Server implementations previously extracted into Voice, Vibe, Linux, BFF, and
Platform now live under backend's normal `worker`, `containers`, and `sdk`
directories. Browser implementations live under web's `src`; BFF pages live in
`bff` and its React example in `examples/message-board`. Package exports are
replaced by relative imports. Every repository has its own lockfile and install.
The Rust CLI remains here. Test fixtures for frontend staging configuration and
message-board migrations keep backend tests independent of sibling checkouts.
The explicit `docs:check` command still compares the backend/public contract;
publish matching backend and web changes together for that CI check.

All 59 account migration files, including BFF 050–056, retain their exact bytes
and ordering. Worker names, resource IDs, public API paths, Durable Object
bindings, and persisted account identities are preserved. Deployment helpers
run in the owning repository; optional coordinated staging commands in backend
also use sibling web and Raindrop checkouts. Manual production workflows use
`PRODUCTION_DEPLOYS_ENABLED`; staging uses `STAGING_DEPLOYS_ENABLED`.
Existing account/API deployment preflights remain in place.

`split-map.json` records the source commit, original repository heads, file
mapping, removed workspace wrappers, and source and destination SHA-256 values.
Run the acceptance check from this directory's parent:

```sh
node migration/verify-split.mjs
```

The destination checksums describe the completed split snapshot. Later intentional
edits will change those checksums. This check is for migration acceptance rather
than ongoing application CI.

Canopy's old working files, including ignored local configuration, remain in the
ignored `artifacts/split-source` backup. The original full Git history also stays
in this repository. The earlier monorepo plans are archived under `monorepo`.
Current local backend state was copied using SQLite's backup API for 19 databases
to `../backend/.wrangler/state`; the previous backend state remains in
`../backend/.wrangler/state-before-canopy-split`. Neither backup is tracked.

See `split-validation.json` for the final verification results. Frontend builds
retain Vite's existing large-chunk advisories. Tests retain their explicit
platform-dependent skips. Remote Cloudflare and GitHub release configuration
still needs to be configured in the owning repositories before publication.
