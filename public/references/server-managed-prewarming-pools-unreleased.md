<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Server-managed prewarming pools (unreleased)

Check `pools.managed` from `/capabilities`. Server pools persist account-owned
inventory across client/coordinator restarts and replenish it through alarms.
They use the normal account start, concurrency, compute, idle and hard-deadline
limits. Waiting machines are billed; replacement after idle expiry consumes
another start. There is no reset/reuse of previously acquired machines.

| Method | Route | Request / response |
| --- | --- | --- |
| GET | `/pools` | `{pools: [...]}` for the authenticated account. |
| POST | `/pools` | `{name, targetSize, ttlSeconds, catalogId?\|imageId?, size?, internet?, networkPolicy?, secretBindings?}` → 201 `{pool}`. Required `Idempotency-Key`. |
| GET | `/pools/{poolId}` | `{pool}` with ready/starting inventory counts. |
| PATCH | `/pools/{poolId}` | `{name?, targetSize?}` → `{pool}`. Selection and expiry are immutable. |
| DELETE | `/pools/{poolId}` | Drain unclaimed inventory; `{deleted: true}` after cleanup. |
| POST | `/pools/{poolId}/acquire` | Empty JSON body and required `Idempotency-Key` → `{poolId, container}`. |

Pool IDs use `pool_<uuid>`. Pool records include `id`, `name`, `targetSize`,
`ready`, `starting`, `status`, immutable `selection`, ISO `createdAt`, `updatedAt`
and `expiresAt`, and optional `lastError`. Status is `active`, `paused`,
`degraded`, `expired`, or `deleting`. Required TTL is 60–86400 seconds. Each
account may retain eight pools with target sizes 0–20, bounded by plan capacity.
A zero target drains and pauses. Delete expired pools to free the pool quota.

Creation and acquisition receipts last 24 hours. Persist keys before requesting
and reuse the same key/body after uncertainty. Acquisition removes one ready
generation from inventory atomically; a retry returns the same running generation
or `acquisition_no_longer_running` (409). It never silently allocates a replacement.
`pool_empty` (409) can be retried with the same acquisition key after replenishment.
Expired pools return 410 for acquisition/update. Exact-generation fencing keeps
drain/deletion from touching acquired or subsequently replaced machines.

Expiry/deletion stops only unclaimed inventory. Acquired machines retain their
original remaining deadlines and must be deleted by the caller. A cleanup
failure returns `pool_cleanup_pending` (503); retry DELETE until confirmed. GET
and DELETE remain available with the feature disabled. Ordinary account auth and
trusted-Origin checks for cookie mutations apply; user identity is never a body
parameter. JS/Python use `client.pools`; `client.pool()` remains the separate
process-local, explicitly refilled helper.
