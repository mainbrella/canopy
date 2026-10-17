# BFF

The marketing homepage and sample workspace for Mainbrella’s planned
backend-for-frontend product. This workspace owns page HTML, styles, and browser
interactions. It contains no provisioning, data API, or executable SDK.

`@canopy/web` serves the `@canopy/bff/page` export at `/bff/` and loads
`@canopy/bff/landing` through its route entry. Navigation, account controls,
consent, and deployment remain with the shared web host.

The host also serves `@canopy/bff/app-page` at `/bff/app/` and initializes
`@canopy/bff/web` with the shared session reader. The workspace requires an
existing Mainbrella session. All project data is fictional and held in memory;
reloading resets edits. Production and staging have separate sample tables.
Provisioning, imports, SQL, function execution, notifications, payments, and
destructive actions only show previews. Exports contain sample data only.

From the repository root, run `npm run dev:web` and open `/bff/` or `/bff/app/`.
Validate with `npm run build:site -w @canopy/web` and
`npm run check:boundaries`. The SDK examples are illustrative and early-access
requests use the existing support email address.
