# Portable installation verification — 2026-10-16

Local implementation and distribution evidence. The live milestone remains open; [new-resource authorization and execution](milestone-deployment.md) are still pending. No new Cloudflare resource, deployment, catalog publication, real inference or phone call was performed.

## Local checks

| Check | Result | Evidence / limits |
| --- | --- | --- |
| `npm run check` | 109 tests pass: 31 accounts/client, 10 operator/installer, 68 Voice; type checks and builds/dry runs pass | `.cache/final-check.log`; final focused reruns in `.cache/final-{typecheck,operator-tests,product-tests}.log` |
| Core browser suites | 13 email/console + 8 Google UI fixtures pass | `.cache/core-browser.log`; real Google remains unverified |
| Standalone Voice browsers | 6 pass | `.cache/voice-browser.log`; simulated AI/providers |
| Connected installation browsers | 7 pass | `.cache/installation-browser.log`; request/reload/runner simulation, grants, isolated workspaces, text turn, logout, Cut registration/open fixtures, keyboard and four target viewport sizes |
| Own-account build | Pass, configured `https://accounts.example.com`; staging API absent from emitted bundle | `.cache/operator-build.log`; custom accounts/console configs also pass dry runs |
| Dedicated staging build | Pass | `.cache/staging-build.log`; no deployment |
| Independent Voice source export | Fresh `npm ci --ignore-scripts`, type checks, 68 tests and build pass | `.cache/export-{install,typecheck,tests,build}.log`; no imports/dependency links into sibling or platform code |
| Source/format checks | `git diff --check` passes | Original identity/Voice migrations remain intact; new schema is additive |

The installer tests exercise actual SQL against migrated SQLite, including a racing losing checkout, expiry and stale lease writes, preserved old inventory, explicit ambiguous-database recovery, and full mocked provisioning interrupted at Voice deployment, readiness and console deployment. A resumed installation creates one database, records matching readiness and namespace, and verifies a successful repeat without redeploying. Operator runner tests reject another user's request, resume expired work and preserve newer retries. Cloudflare transports/deployments in these tests are simulated.

Voice uses local D1/DO/WebSockets and deterministic model responses. New tests cover atomic instance limits across different users, unavailable/denied/managed usage authorization, and actual signed Twilio/Telnyx requests against the assigned Canopy workspace with replay rejection. The existing standalone signature/media/hangup suite passes independently. No real carrier traffic is represented by these results.

Core tests preserve the public auth contract and check that public signup cannot provision, grant itself access or receive a paid handoff; owner grants/revocations affect private session validation and usage authorization. Managed billing is unavailable and denied. Catalog selection remains independent of server permissions.

Cut tests validate source SHA, artifact digest, deployed version, resources/origin and idempotent registration. Browser tests simulate an Appflare review page and separate Cut password page; these are not a real manager/app deployment. The supported `/install/cut` admin review path was rechecked against [Appflare documentation](https://appflare.dev/guides/install-links/) and its [Cut listing](https://appflare.dev/apps/cut/).

## Immutable Voice artifact

A detached clean verification worktree was created under `.cache/distribution-checkout` using a temporary Git index. The working branch and real index were not committed/staged by this operation. Snapshot commit **`6b29523a4aa9f9d218f6e4cd219557b669e1e8cb`** is retained at `refs/canopy/verification/portable-installation`. It is a local source pin, not a published release. Voice runtime/client/migrations/package and the workspace dependency lock match the current working source; subsequent core/operator/documentation changes are outside this product artifact.

The strict generator wrote the manifest from that clean committed snapshot. Appflare source **`ccafe08b4958d8e2f80299ee310b99a7f5d00eca`** was archived into `.cache/appflare-toolchain`; its locked dependencies were installed with pnpm **10.34.5**, and schema/CF API/pack were built there. No sibling install/build command or sibling runtime dependency was used. `@appflare/pack` **0.4.1** packed the actual Voice source and verified hashes plus upload limits.

| Artifact | Value |
| --- | --- |
| Version | `0.0.0-20261016.6b29523` (packer-derived date and source SHA) |
| Catalog manifest | `.cache/distribution-checkout/products/voice/dist/catalog/apps/mainbrella-voice/appflare.jsonc` |
| Artifact manifest | `.cache/voice-appflare-artifact/manifest.json` |
| Manifest SHA-256 | `d700475e1760908fd850b68d496ebc12a2e294679048c25a01bcdd2db760fa9b` |
| ZIP | `.cache/voice-appflare-artifact/mainbrella-voice-0.0.0-20261016.6b29523.zip` |
| ZIP SHA-256 | `7b144f9045c641c4c0931a3b9e71a34c8dbe02c2545d46dbd4c50bf9761aeb2b` |
| ZIP bytes | 2,703,176 |
| Contents | 1 Worker module, 11 assets, 4 D1 migrations; 16 files verified |
| Worker upload | 1 range, 2.46 MiB; upload check passes |
| Signature | Unsigned local verification artifact; `--hashes-only` explicitly skips signatures |
| Pack/verify logs | `.cache/voice-appflare-{pack,verify}.log` |

The independently exported source at `.cache/distribution-checkout/products/voice/dist/source` records that same clean pin in `SOURCE.json`. Its new install/build/tests establish distribution independence. Neither artifact nor source pin has been published, submitted to a catalog, or installed remotely. Publish an intended release source before proposing a catalog update; do not claim this local snapshot is fetchable from GitHub.

## Read-only live observations

The established staging API still reports `{"product":"voice","state":"not_installed","version":null,"origin":null}`. Cloudflare reads identified account subdomain `crimson-dust-553b` and found none of the proposed `canopy-m2` Worker/D1 names or custom-domain attachments. These observations are not name reservations and do not establish the absence of unrelated resources. Exact actual deployed IDs, useful real actions and partial-install recovery evidence belong in the live record after approval.
