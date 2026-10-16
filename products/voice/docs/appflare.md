# Appflare distribution from Canopy

The product's `appflare.jsonc` is a monorepo packaging template for `mainbrella/canopy`. It builds only the Voice client and selects `products/voice/wrangler.jsonc`. It keeps the original Voice slug, generated operator password, same-Worker Durable Object, D1 migrations, Workers AI integration, and signed-carrier Access bypass paths.

The all-zero source SHA is an intentional sentinel. From a clean committed Canopy checkout, run:

```sh
npm run catalog:manifest --workspace @canopy/voice
# Or select a tag pointing to HEAD:
npm run catalog:manifest --workspace @canopy/voice -- --ref voice-v0.1.0
```

The generator refuses a dirty tree or a ref that differs from HEAD, and writes `products/voice/dist/catalog/apps/mainbrella-voice/appflare.jsonc`. Publish the pinned Canopy commit before proposing that file in an Appflare catalog PR. No catalog entry, sibling checkout, or deployed install is changed by these commands. The standalone source export uses direct Wrangler installation; the catalog manifest targets the Canopy repository.

The [Appflare submission guide](https://appflare.dev/catalog/submit/) was checked on 2026-10-16. It supports monorepo Wrangler paths, a root-level build command, product-local Durable Objects, D1, Workers AI and static assets. Local Appflare source at `ccafe08b4958d8e2f80299ee310b99a7f5d00eca` agrees. This is packaging compatibility evidence, not a successful pack or live install of this new monorepo pin.

The local catalog currently points to the older `mainbrella/ai-receptionist` source at `0254e19a11e2194833dc0f6a203f28845d905570`. That release remains untouched. Before updating it, validate and pack the new pinned manifest using the catalog's supported toolchain, then perform a real install into explicitly authorized dedicated resources. Record its source version, resource inventory, useful text/voice action, enabled carrier tests, and cleanup procedure. Canopy's external Appflare link does not yet constitute installer integration.
