<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Saved workspaces and portable export

Discover `capabilities.persistence.snapshots` before issuing saves or restores. Saved-workspace issuance is enabled in the qualified production deployment; other deployments may disable it. For automatic capture on an explicit stop, separately require `persistence.filesystemAfterStop` and use `POST /containers/stop`. DELETE remains destructive.

`POST /workspaces` accepts `{id, createdAt, name, stop?, launch?}` and requires an `Idempotency-Key`. The source identity must match a running generation owned by the authenticated account. Save captures the writable root filesystem, commits its private provider handle, and optionally stops that exact generation. Persist the request body and key before sending: repeat the identical request after a lost response. Recovery receipts last 24 hours. A capture whose provider result cannot be recovered fails closed rather than silently taking another snapshot.

`GET /workspaces` lists account-owned metadata, limits and reserved usage. `GET /workspaces/{uuid}` reads one; `PATCH` renames it or sets `{archived:true|false}`; `DELETE` releases customer quota and revokes future restores. Archive retains quota. Reads, archive and deletion remain available during subscription outages or disabled issuance. Provider handles never appear in public responses. Deletion does not erase provider-held bytes immediately and does not terminate a restore already admitted.

Restore with `POST /containers` and `{workspaceId}` using a new persisted creation key. A restore consumes one normal start and compute allowance and creates a fresh generation. It retains the saved machine size and internet policy, requires the same deployed image digest, and fails before admission if expired, archived or incompatible. A provider restore failure never falls back to an empty filesystem. RAM and running processes are not restored. Existing previews and generation-bound commands do not transfer.

When `persistence.restoreLaunch` is true, an optional immutable `launch` recipe
starts the application once in each restored generation:

```json
{
  "command": "node server.mjs",
  "cwd": "/workspace/app",
  "readiness": { "port": 3000, "path": "/health", "timeoutMs": 30000 }
}
```

The recipe runs a user-authored shell command; review it before saving. Working
directory defaults to `/workspace`, health path to `/`, and readiness timeout to
30 seconds (allowed range 1–60 seconds). Readiness checks use a local application
port (1024–65535), require HTTP 2xx, and do not follow redirects. Existing outbound
policy and vault bindings keep their normal behavior; the recipe does not accept
raw environment secrets. Saving the recipe does not run it in the source.

The container and creation response include `readiness.status` (`starting`,
`ready`, or `failed`) separately from the machine's lifecycle `status`. A running
container alone is not application readiness. Poll `GET /containers` for the
exact generation. Failed startup leaves the restored machine accessible, with
`readiness.error`, `logPath`, and an optional bounded `logTail` for inspection.
Status polling and same-key creation recovery never rerun the launch command.
This is a fresh process and does not preserve the source's memory or nonce.

| Plan | Saved workspaces | Reserved capacity | Retention | Saves/month | Capture capacity/month | Retained capture capacity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Usage | 20 | 160 GB | 14 days | 100 | 400 GB | 400 GB |
| Builder (legacy) | 3 | 8 GB | 7 days | 10 | 20 GB | 20 GB |
| Pro | 20 | 160 GB | 14 days | 100 | 400 GB | 400 GB |
| Scale | 100 | 1,000 GB | 29 days | 500 | 2,000 GB | 2,000 GB |

Each new save reserves the full source disk capacity against both capture budgets before contacting the provider, even if the resulting snapshot is smaller. Failed or uncertain saves keep their reservations; identical keyed retries do not charge again. Monthly counts/bytes reset at UTC calendar month boundaries. Retained capture capacity stays charged for at least 60 days, covering customer retention plus the provider's 30-day TTL after the last restore; daily buckets may retain earlier captures for up to one extra day. Archive, deletion, expiry and subscription changes do not refund these capture budgets. Deletion releases only live workspace count/capacity. Existing workspaces keep their original expiry. Legacy usage is migrated conservatively: saves whose records are unavailable reserve the maximum supported disk capacity.

`GET /workspaces` includes `maxCaptureBytesPerMonth` and `maxRetainedCaptureBytes` in `limits`, and `savesThisMonth`, `captureBytesThisMonth`, and `retainedCaptureBytes` in `usage`. New saves return HTTP 429 with `workspace_quota_exceeded`, `workspace_save_limit`, `workspace_capture_budget_exceeded`, or `workspace_retained_budget_exceeded` when the corresponding limit is reached. Reads, restores of otherwise eligible workspaces, archive and deletion remain available when a save budget is exhausted.

Each workspace reports runtime-measured snapshot `bytes` (null until known) and
its separate live `reservedBytes`. Usage includes `captureBudgetResetsAt` (the
next UTC month boundary), `nextRetainedCaptureReleaseAt` (the earliest retained
accounting release, or null), and `nextRetainedCaptureReleaseBytes` (the amount
released then). Times are Unix milliseconds. Later captures in the same daily
bucket can move its release time later. These fields describe accounting, not a
provider physical-deletion deadline; the next release may free only part of the
retained budget.

Reservation uses the source machine's full disk capacity, even when the snapshot is smaller. Expiry releases quota and removes usable handles; the provider controls physical retention. Backup to your own storage with `GET /containers/export?id=…&createdAt=…`: this returns a gzip tar archive of `/workspace`, limited to 16 MiB compressed and 60 seconds. Export a restored saved workspace to download it. Export excludes other root paths, mounted volumes and process memory, and fails if the archive exceeds the limit or files change during capture. It shares the four-operation limit with other filesystem operations.
