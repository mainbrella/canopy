<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## MCP agent integration

The source JavaScript SDK includes the dependency-free `mainbrella-mcp` stdio
server (Node 22+). This is an unreleased source addition; the published 0.1.0
artifact does not yet include it. Run a reviewed checkout directly:

```sh
# MAINBRELLA_API_KEY comes from your environment/secret manager.
node /absolute/path/to/backend/sdk/javascript/mcp.mjs
```

Configure an MCP-compatible IDE or agent with that executable and an inherited
`MAINBRELLA_API_KEY`. `MAINBRELLA_API_URL` optionally selects an HTTPS API or a
loopback development server. The process keeps JSON-RPC on stdout and diagnostic
codes on stderr. It negotiates MCP 2025-11-25, 2025-06-18 or 2024-11-05.

Tools cover capabilities, container listing/creation, commands, text files,
directory listings, lifecycle events, workspace save, stop/resume, filesystem
fork and deletion. Mutations require the exact `id` and `createdAt`; creation,
save, stop, resume and fork require an explicit `idempotencyKey` so callers can
reconcile ambiguous responses. Tool annotations distinguish reads and destructive
actions. Container creation and prewarming consume normal account allowance.
Guest output remains untrusted data. Existing command/file API limits apply;
use the streaming SDK for larger or binary transfers.

The stdio server processes requests serially. It does not implement protocol
cancellation; command timeouts still apply. Disconnecting the MCP client does
not delete its sandboxes. Reconcile pending creation keys and explicitly delete
owned generations when finished.
