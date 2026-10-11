<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Filesystem Stop, Resume and Fork

These endpoints are implemented in the current checkout and require deployment qualification before issuance. Discover `persistence.filesystemAfterStop` for Stop/Resume and `persistence.filesystemFork` for Fork. All three require paid access, `{id,createdAt}` for an owned generation, and a persisted `Idempotency-Key`. Retry an uncertain response with the same body and key; never substitute a fresh key to resolve an ambiguous operation.

| Endpoint | Behavior |
| --- | --- |
| `POST /containers/stop` | Captures the filesystem before stopping compute. A failed capture leaves the source running. Returns account status with a retained `stopped` container, `workspaceId` and `persistenceExpiresAt` (Unix milliseconds). |
| `POST /containers/resume` | Restores that stopped slot with a fresh `createdAt` and one normal paid start. Returns account status and a `creation` receipt, as creation does. |
| `POST /containers/fork` | Captures a running source and boots a separate machine. Optional `name` labels the fork. Source continues running. Returns account status and a `creation` receipt. |
| `DELETE /containers?id=...&createdAt=...` | Permanently deletes the selected machine or suspended slot. Does not create a snapshot. Remains available during billing outages. |

A stopped machine reserves its logical slot but no running compute or concurrency. Snapshot storage, retention and capture budgets are the same as saved workspaces. Expired, archived, deleted and image-incompatible snapshots fail closed; resume never silently boots an empty image. Expired stopped records remain visible until explicitly deleted. Restore/Fork inherit the saved image, size, internet policy, allow/deny rules and secret IDs. Revoked secrets prevent a new restricted launch. Forks start as Ad Hoc machines, including forks of Production sources.

Filesystem captures do not preserve RAM, running processes or mounted volumes. Quiesce databases and other writers before capture for application consistency. Old generation credentials and connections do not transfer to an explicit resume or fork. Automatic idle/session shutdown and an unexpected provider crash do not capture new state. A Production machine resumed from a checkpoint recovers from that checkpoint on later runtime interruption; writes after it remain vulnerable. This is not a mounted durable disk or a database durability guarantee.
