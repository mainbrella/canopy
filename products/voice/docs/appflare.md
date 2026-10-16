# Appflare distribution from Canopy

The product's `appflare.jsonc` is a monorepo packaging template for `mainbrella/canopy`. It builds only the Voice client and selects `products/voice/wrangler.jsonc`. It keeps the original Voice slug, generated operator password, same-Worker Durable Object, D1 migrations, Workers AI integration, and signed-carrier Access bypass paths.

The all-zero source SHA is an intentional sentinel. From a clean committed Canopy checkout, run:

```sh
npm run catalog:manifest --workspace @canopy/voice
# Or select a tag pointing to HEAD:
npm run catalog:manifest --workspace @canopy/voice -- --ref voice-v0.1.0
```

The generator refuses a dirty tree or a ref that differs from HEAD, and writes `products/voice/dist/catalog/apps/mainbrella-voice/appflare.jsonc`. Publish the pinned Canopy commit before proposing that file in an Appflare catalog PR. No catalog entry, sibling checkout, or deployed install is changed by these commands. The standalone source export uses direct Wrangler installation; the catalog manifest targets the Canopy repository.

The [Appflare submission guide](https://appflare.dev/catalog/submit/) was checked on 2026-10-16. It supports monorepo Wrangler paths, a root-level build command, product-local Durable Objects, D1, Workers AI and static assets. Local Appflare source at `ccafe08b4958d8e2f80299ee310b99a7f5d00eca` agrees. That inspection established compatibility. The local pack and independent export verification are now recorded in [milestone verification](../../../docs/milestone-verification.md); a live install remains pending.

The local catalog currently points to the older `mainbrella/ai-receptionist` source at `0254e19a11e2194833dc0f6a203f28845d905570`. That release remains untouched. The new snapshot has now been locally packed using the supported toolchain. Before updating the catalog, publish the intended source commit, then perform a real install into explicitly authorized dedicated resources. Record its source version, resource inventory, useful text/voice action, enabled carrier tests, and cleanup procedure. Canopy now uses Appflare’s supported `/install/cut` admin review link and a credentialed read-only inventory adapter to register one non-Voice app. See [operator installation](../../../docs/operator-installation.md). This is a real adapter implementation, but its browser fixtures are not evidence of a remote Cut install.

## Local toolchain verification

A clean source snapshot can be packed using Appflare at `ccafe08b4958d8e2f80299ee310b99a7f5d00eca` without changing the sibling checkout: archive that revision into Canopy’s ignored `.cache/appflare-toolchain`, install its locked dependencies there with pnpm 10.34.5, and build `@appflare/pack` and its workspace dependencies there. Do not link runtime dependencies back to a sibling. The supported pack command is:

```sh
node .cache/appflare-toolchain/packages/pack/dist/cli.js CLEAN_CANOPY_CHECKOUT \
  --manifest CLEAN_CANOPY_CHECKOUT/products/voice/dist/catalog/apps/mainbrella-voice/appflare.jsonc \
  --out .cache/voice-appflare-artifact
node .cache/appflare-toolchain/packages/pack/dist/cli.js verify \
  .cache/voice-appflare-artifact --hashes-only --check-upload
```

Generate the manifest inside the clean checkout first. Preserve its exact SHA and the artifact’s hashes. An unsigned local artifact verifies dependency/binding/migration/asset packaging; it is not a signed catalog release, a publication, or a remote install. Connected Voice uses Canopy’s explicit handoff/access adapter; the Appflare package defaults to the independent owner-password mode.
