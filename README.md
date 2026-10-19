# Canopy CLI

The Rust CLI lives in [cli](cli). The website, API, and Raindrop are separate
repositories again:

- [Web](../web): all website and product browser code, including the BFF message board.
- [Backend](../backend): all API, BFF, Voice, Builder, compute, wallet, and SDK code.
- [Raindrop](../raindrop): the admin frontend.

Each repository has its own install, checks, builds, and deployment commands.
There are no `apps` or shared npm workspaces. To develop the website locally,
run `npm ci && npm run dev` in backend, and `npm ci && npm run dev:local` in web.

```sh
cargo install --path cli
cargo test --manifest-path cli/Cargo.toml --locked
```

See [CLI usage](cli/README.md) for BFF migrations, browser keys, and permissions.
The [split record](migration/README.md) documents the file map, verification,
local state backups, and preserved Canopy history.
