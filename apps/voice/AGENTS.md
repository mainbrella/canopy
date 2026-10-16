Voice runs inside the backend API Worker and web site deployment. Keep product
logic here; backend/web should compose the package's public exports. Use the
shared account, session, and wallet services rather than duplicating them.

When adding or changing a Voice endpoint, update its Chanfana/Zod schema in
`worker/app/openapi-voice*.ts` in the same change. Preserve runtime validation,
authorization, raw requests/responses, WebSockets, and execution context. Keep
registration and route coverage in backend's `worker/app/openapi.ts` and
`worker/app/openapi.test.ts` current.

Run from the repository root:

    npm test -w @canopy/voice
    npm run type-check -w @canopy/voice
    npm run test:openapi -w @canopy/backend
    npm run type-check -w @canopy/backend
    npm run docs:generate -w @canopy/backend
    npm run docs:check -w @canopy/web
    npm run check:boundaries
