# BFF

The marketing homepage for Mainbrella’s planned backend-for-frontend product.
This workspace owns the page HTML, styles, and progressive browser interactions.
It contains no provisioning, authentication, data API, or executable SDK.

`@canopy/web` serves the `@canopy/bff/page` export at `/bff/` and loads
`@canopy/bff/landing` through its route entry. Navigation, account controls,
consent, and deployment remain with the shared web host.

From the repository root, run `npm run dev:web` and open `/bff/`.
Validate with `npm run build:site -w @canopy/web` and
`npm run check:boundaries`. The SDK examples are illustrative and early-access
requests use the existing support email address.
