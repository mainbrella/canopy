# Canopy

Canopy is the planned source monorepo for Mainbrella's hosted platform and its independently installable products. The goal is to share code where it has real consumers while keeping each product buildable, releasable, and usable on its own.

This repository currently contains its license and this plan. It does not yet contain the applications, package workspaces, deployment commands, or migrations described below. The layout and workflows are targets for gradual migration, not claims about what is already implemented.

Canopy is one repository for these products; it is not every repository in the Mainbrella organization. A normal user installing Voice, Compute, or Builder should only need that product's supported build and runtime requirements, not a clone of the whole repository or every service in it.

## Repository shape

The proposed layout gives product code clear ownership and makes shared platform services explicit. It does not require one directory to become one Worker: a product may deploy several Workers and other Cloudflare resources.

```text
products/
  voice/                 Voice application, Worker entry point, standalone auth,
                         D1/DO migrations, build and deploy configuration
  compute/               Container runtime and API, images, execution, terminals,
                         files, workspaces, lifecycle, UI and configuration
  builder/               Builder UI and agent orchestration; calls Compute APIs
platform/
  accounts/              Mainbrella identity, sessions, access and API keys,
                         shared project identity
  billing/               Stripe integration, wallet, reservations, settlement,
                         and usage receipts
  console/               Hosted customer account, project and product UI
  admin/                 Raindrop and operator UI
packages/
  contracts/             Shared request/response schemas and validators
  voice-engine/          Voice behavior shared by hosted and standalone Voice,
                         if the convergence creates a genuine package boundary
  compute-engine/        Reusable Compute source, only if real consumers need it
  platform-client/       Optional shared client for hosted platform APIs
```

Other hosted entry points, ingress, and marketing code can be placed according to their actual owners as they move. Root scripts, tests, and documentation should be added when implemented.

A **product** is a complete application that can be built, installed, and released independently. It may contain UI, a Worker entry point, migrations, and product-specific adapters. A **package** is reusable source code used by products or services; it is not a separately deployed application. A **platform module** is a shared service or UI used by the managed Mainbrella edition. A directory, workspace, package, deployable, and Git repository are distinct things. A package need not be published to npm, and a product need not live in its own Git repository.

Keep code in its product until there is a real second consumer or a clear shared contract. In particular, `compute-engine` should remain an idea until more than one consumer needs the same Compute implementation. Shared packages should expose focused interfaces rather than becoming a place for every common helper.

## Installation targets

The product boundary should support these planned installation shapes:

| Install | Includes | Does not require |
| --- | --- | --- |
| Voice | Voice UI and runtime, its Cloudflare resources, local owner authentication; optional Twilio or Telnyx integration | Mainbrella hosted auth, Stripe, Raindrop, or Compute containers |
| Compute | Compute API/runtime and the Cloudflare resources it needs, with owner authentication | Voice, Builder, hosted billing, or admin UI |
| Builder + Compute | Builder, required Compute, source storage, and configured models | Voice or unrelated hosted admin and billing services |
| Hosted Mainbrella | The products and shared account, wallet, permissions, and audit services that the hosted edition uses | — |

These are product goals, not working installers today. Bundle composition should not accidentally install a second Compute runtime or copy Compute internals into Builder. Builder should call a supported Compute API or client. Sharing and upgrading components independently requires explicit ownership and compatible APIs.

## Product and package boundaries

### Voice

Maintain one Voice engine for hosted and standalone use. The engine should own shared speech, conversation, and telephony behavior. Adapters should supply the differences:

- The hosted adapter connects Mainbrella identity, permissions, and billing.
- The standalone adapter uses local owner/password authentication and the owner's Cloudflare and carrier accounts.

Today, `ai-receptionist` is a modified standalone extraction while hosted Voice lives in `backend` and `web`. Those implementations need to converge; the shared engine is not already present. Keep the standalone repository until there is a supported way to consume and release the shared implementation. Avoid creating another maintained copy during migration.

Keep Compute's sandbox and production runtime together where they share execution behavior. Give them distinct lifecycle, restart, persistence, and hosting policies. A reusable Compute package is justified only when a real consumer needs that shared implementation; otherwise its code belongs in `products/compute`.

### Contracts

`packages/contracts` can hold shared request and response schemas, runtime validators, and explicit public or internal interfaces. TypeScript types alone do not validate data at runtime. Contracts must not contain secrets or become a shortcut for unrelated cross-module database queries.

### Identity, billing, and audit

Hosted products can share Mainbrella accounts, sessions, project identity, permissions, and API keys through `platform/accounts`. A service must verify caller identity and permissions at its boundary; a request naming an account does not prove that the caller may act for it.

Mainbrella billing currently sits behind `CONTAINER_ACCOUNT` in `backend/worker/lib/prepaid-billing.ts`, and Voice imports `build-pricing`. Put product-neutral interfaces around the existing authoritative wallet before considering any durable money-state move. Keep one hosted balance with product-specific metering. Preserve idempotency, reserve/settle/release behavior, and reconciliation for unknown usage. Do not start with a broad wallet or Durable Object migration.

Audit events can record actor, account, project, resource, action, and outcome for console and operator needs. Keep execution logs and transcripts owned by their product, and keep the financial ledger separate from audit history. Add event infrastructure only for a concrete use.

## Repository workflow and releases

Commit product code, shared package code, tests, package metadata, and documentation in this repository like any other source. Create a package when code is genuinely shared; keep a product-only feature inside its product. If an interface change affects both a producer and a consumer, update them together in the same commit or pull request.

For example, a Telnyx audio fix belongs in `voice-engine` if that package owns the shared audio behavior. Add a focused test there, update either wrapper if the interface changed, and verify the hosted and standalone Voice builds before releasing the affected product.

Commit root workspace lockfile changes when dependencies change. Do not commit secrets or `node_modules`; generated `dist` output should only be committed if a deliberate artifact policy requires it. Workspace links resolve local package source, so ordinary monorepo development does not require copying files or publishing every package. If consumers move outside this repository, give them a versioned package or artifact, or pin source to an immutable revision; do not rely on an unversioned relative sibling import.

A Git commit is not a deployment. CI should check changed products and their transitive shared-package consumers. Release and deploy only the products that changed and are ready. Each product build should bundle or otherwise include the libraries it needs; a CI job may fetch the repository or install root workspace dependencies without deploying unrelated apps. Keep product release artifacts and versions independently identifiable, and record the source commit and relevant package revisions used to build them. Deploy selectively while keeping interfaces compatible with currently running consumers.

This repository has no established package manager, workspace configuration, or build/deploy commands yet. Add concrete commands with the implementation; examples in this plan are not executable instructions.

## Data, resources, and ownership

Code can move before data does. A folder move does not relocate a database, Durable Object state, object key, public URL, or deployed resource. Preserve existing public URLs, session contracts, resource identities, D1 migrations, Durable Object class names and state, R2 keys, data, and release histories through restructuring. Keep existing independent deployments working as ownership changes.

Assign each product or platform module ownership of its tables, migrations, bindings, permissions, and API. It is reasonable to keep a database while code ownership becomes clear. Avoid routine SQL access to another module's tables and avoid splitting every database as an architectural exercise. Deployables should have explicit bindings and least-needed permissions, with versioned APIs between services. Cloudflare service bindings can connect internal Workers without making them a single deployable; see [Cloudflare Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

Project and product lifecycle rules need explicit ownership. Shared projects already exist separately from Builder workspaces, but [the current project documentation](https://github.com/mainbrella/backend/blob/main/docs/projects.md) says Builder deletion also deletes the shared project. Product uninstall should remove only that product's resources and data. Explicit project deletion should coordinate dependent apps and hosting, retention or export, and any billing holds. Define these behaviors before making removal flows destructive.

## Migration plan

Migrate in small stages while preserving the current services and their state:

1. **Inventory and ownership.** Record deployables, routes, bindings, databases, durable resources, APIs, and who owns each table and lifecycle. Establish contracts before moving code.
2. **Set hosted boundaries.** Introduce shared identity and billing interfaces around current behavior. Keep the authoritative wallet and existing session contracts in place. Make shared clients such as the existing `/auth/me` client reusable only where that reduces duplication.
3. **Converge Voice.** Use hosted and standalone Voice as the first proof of a shared engine with two explicit adapters. Validate both install paths and preserve hosted identity and billing behavior.
4. **Align Builder and Compute ownership.** Move or separate backend ownership to match the Builder frontend. Make Builder use the Compute API/client. Keep sandbox and production on the common runtime with separate lifecycle policies.
5. **Define uninstall and data migration.** Assign resource and table ownership, document project deletion, product removal, retention, export, and billing interactions. Add migration steps that preserve existing state.
6. **Release products independently.** Build and test fresh Voice-only, Compute-only, and Builder-plus-Compute installs. Demonstrate targeted updates and rollback where supported, and verify hosted account and billing behavior.
7. **Expand the catalog selectively.** Add more products only after their ownership and independent install path are understood.

Existing evidence should guide the moves. The backend already deploys API, admin, marketing, containers, and ingress/previews independently. `backend/worker/shared/service-routing.ts` preserves `api.mainbrella.com` paths, and `scripts/check-worker-boundaries.mjs` prevents admin and marketing bundles from absorbing unrelated code. The web repository already has separate site and Builder static builds/deployments. Raindrop is a separate admin GUI with a copied auth client. Keep those deployment boundaries until a concrete change justifies altering them.

Hosted backend, web, and Raindrop source can move into Canopy progressively with provenance and history preserved by a deliberate migration. Keep iOS, the SSH gateway, independent Parsequerade, and upstream Appflare/catalog forks separate while their release cycles justify it. Keep `ai-receptionist` separate until the shared Voice engine has a supported distribution path. This plan does not rename or remove sibling repositories, merge histories, or rewrite deployments now.

## Appflare distribution

Appflare should receive installable **products or supported bundles**, not internal engine or contracts packages. A catalog change is a PR to [appflare/catalog](https://github.com/appflare/catalog), adding `apps/<slug>/appflare.jsonc`. The manifest should point at the public Canopy repository and an exact commit, then describe the product build, configuration, settings, and requirements. Monorepo subpaths are supported, so a product does not need its own Git repository. Shared packages remain build-time dependencies. The pin makes the submitted product reviewable and reproducible.

Voice is the clearest first candidate if its standalone installation is complete. The catalog entry must deploy the product's required runtime as a self-contained artifact. Service, Durable Object, or Workflow bindings cannot depend on unrelated external Mainbrella Workers; multiple Workers can be part of one catalog entry when the packaging path supports them.

There is a compatibility constraint for Compute. Appflare's standard artifact packaging currently rejects Container bindings, along with other unsupported bindings, according to its [catalog submission guide](https://appflare.dev/catalog/submit/) and [build documentation](https://appflare.dev/guides/builds/#self-deploying-apps). Therefore, Compute and Builder-plus-Compute are candidates to investigate, not products that this plan claims are currently accepted or installable through that path. Validate the actual product bindings and installer against Appflare's supported packaging, or identify a supported alternative, before submitting them. The self-deploying tier currently runs supported Alchemy installers; do not assume it accepts arbitrary setup scripts.

Managed Mainbrella and customer-owned Appflare deployments can coexist. Keep submitting independently functioning products to Appflare as a distribution path. Do not build a competing installer or store just to modularize this source. A future Mainbrella catalog could enable products inside a hosted project while sharing its identity, wallet, and data. Owning an installer or store also means owning provisioning, upgrades, rollback, backups, permissions, removal, and metering. If a second catalog is needed later, add an adapter around product definitions rather than coupling engine code to one catalog format.

## Later product candidates

Potential additions include Workers-based Firecrawl scraping, a Semantic Search knowledge base, Punctual booking, Cloudflarebase (now Frostbase) app backends, EmailFlare customer email, Cloudflare Playwright MCP browser automation, FormZero forms, Counterscale website analytics, and Auth Inbox agent verification. These are candidates, not commitments or current Canopy features. If prioritized, start with scraping, knowledge bases, durable jobs, and booking, and define each product's independent install and service boundaries before adding it.
