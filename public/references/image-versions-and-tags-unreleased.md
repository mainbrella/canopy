<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Image versions and tags (unreleased)

Every build has an immutable image ID; published image metadata includes its
`sha256:` digest. Tags are movable account-scoped aliases for ready images:

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/images/tags` | List `{ tags: [{ tag, imageId, updatedAt }] }`. |
| GET | `/images/tags/{tag}` | Resolve `{ tag, image }` with immutable ID and digest. |
| PUT | `/images/tags/{tag}` | Set or move a tag with `{ "imageId": "<uuid>" }`. |
| DELETE | `/images/tags/{tag}` | Idempotently remove this account's alias. |

Tags match `[a-z0-9][a-z0-9._-]{0,63}` and are limited to 30 per account,
advertised in `images.limits.maxTags`. Only owned ready images can be tagged.
Invalid bodies return 400, unknown images/tags 404, unfinished builds 409, and
new tags exceeding the limit 429. Cookie mutations require a trusted Origin;
API-key requests use the existing bearer authentication. Deleting an image
removes its tags, and deleting a tag does not delete its image.

Resolve a tag once and pass its image ID to `POST /containers`; keep that same
ID and idempotency key when retrying an uncertain creation. Moving a tag never
changes an existing container. Apply `039_image_tags.sql` before deployment.
These routes and SDK helpers do not enable gated builds, private registries or
cross-build caching. See [custom image rollout](docs/custom-images.md).
