<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Image build cache and private bases (unreleased)

`POST /images` accepts optional multipart fields `cacheFrom` (owned ready image
UUID) and `baseImage` (JSON `{image, username?, password?}`). `image` is a
digest-pinned `ghcr.io/<namespace>/<repo>@sha256:...` or
`docker.io/<namespace>/<repo>@sha256:...` reference. Both credentials must be
present together or both omitted. The Dockerfile still uses
`FROM mainbrella:base`, which the isolated build maps to the selected base.
Runtime compatibility and image-size checks remain mandatory.

Cache references resolve to an immutable digest at admission and remain
account-scoped. Cache metadata is exported by new builds; older images may
produce no cache hits. Metadata returns `baseImage` (reference only) and
`cacheFrom`; registry credentials never appear in image metadata or build source
artifacts. Authenticated imports require `privateRegistriesEnabled` in
`GET /images`; encrypted one-use credentials are consumed by trusted preparation.

Builds require a configured private build repository and verified private
visibility before dispatch. This protects build source and image-layer artifacts
from the public backend repository. Cache/private-base support requires migration
`040_image_build_inputs.sql`, operator configuration and live qualification;
neither tags nor SDK installation enables it.
