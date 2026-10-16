# Milestone live verification plan — authorization pending

Prepared 2026-10-16. No commands in this plan have provisioned or deployed live resources. Existing authorization covers dedicated core staging only; this plan proposes additional resources in the same operator account. Local fixtures, a packed artifact and a plan are not a real install record.

## Dedicated targets

Proposed Cloudflare account: `2b7a9be82bb64187230703b024e25157`. Public configuration: [`config/milestone.json`](../config/milestone.json). Select the owner account ID after creating the fresh account; the checked-in empty value grants nobody operator access. The `canopy-m2` prefix and origins are distinct from established core staging and production.

| Resource | Proposed name / address | Ownership |
| --- | --- | --- |
| Accounts Worker + D1 | `canopy-m2-accounts`, `api-m2-stg.mainbrella.com` | Fresh core only |
| Console Worker | `canopy-m2-console`, `m2-stg.mainbrella.com` | Fresh core only |
| Rate namespaces | `3101`, `3102` | Separate email/Google limits; Google disabled |
| Voice Worker + D1 | `canopy-m2-voice`, `voice-m2-stg.mainbrella.com` | One connected Voice installation |
| Voice SQLite DO | `ReceptionistCall`, migration `v1` | Product-local namespace; record allocated ID |
| Voice assets / daily cron | Same Voice Worker | Existing product configuration |
| Appflare Worker + D1 | `canopy-m2-appflare` | Independent Appflare manager |
| Appflare KV / Workflow / cron | `canopy-m2-appflare-kv`, `canopy-m2-appflare-jobs`, every 30 minutes | Appflare manager resources |
| Appflare address | `canopy-m2-appflare.crimson-dust-553b.workers.dev` | Account subdomain read from Cloudflare |
| Cut Worker + KV | Request `canopy-m2-cut`; record Appflare's actual generated IDs/names | Owned by Appflare, separate admin password |

Read-only checks on 2026-10-16 found none of the five proposed Worker names, three proposed D1 names or three custom-domain attachments. This is a point-in-time inventory, not a reservation or proof that there are no unrelated DNS records/KV/workflows. Each installer must recheck ownership before creation. The existing staging API still returns `not_installed` for Voice. Existing staging and production resources will not be repurposed.

## Credentials, cost and source

Require Cloudflare permissions for the selected account's Workers, assets, D1, Durable Objects, Workers AI, KV, Workflows, custom domains/DNS and rate limits as needed. Appflare's supported installer verifies its release signatures. Install a dedicated manager through `create-appflare` with `--name canopy-m2-appflare`, choose a concrete released manager version at execution and record its signature/artifact digest. Its admin setup needs an operator-owned Cloudflare connection and independent admin credentials. Those secrets never go into Canopy browser code or this document.

Connected Voice creates a paired random auth secret stored privately and in the two Workers. Owner-funded policy is explicit. Initially authorize one small real Workers AI **text** conversation using the native default model. Keep the instance at 20 starts/rolling day and 2 concurrent calls; save the exact prompt, model, outcome and measured usage if available. No paid external speech provider, real phone number or carrier traffic is proposed. Twilio/Telnyx live checks require a separately supplied authorized provider configuration. Signed carrier fixtures remain a separate evidence category.

Pin the tested source snapshot/release commit and Voice fingerprint before execution. Publish any commit used by a remote Appflare catalog install first. A local snapshot SHA cannot be fetched from GitHub. The independently packed standalone artifact proves packaging; it does not claim the connected install was remotely performed through Appflare.

## Execution after approval

1. Recheck account/name/domain ownership and record the baseline. Deploy fresh core with `npm run setup:core -- --config config/milestone.json --deploy`. Verify zero rows in its product inventory, no product Workers running, correct API origin and empty/not-installed states after reload.
2. Create a dedicated owner account, record its Account ID in the private execution config, and redeploy core with that pin. Verify a second public signup cannot provision or open Voice. Keep that second account for grant/revoke checks.
3. Start `npm run operator:run -- --config .cache/core-installs/2b7a9be82bb64187230703b024e25157-canopy-m2/voice.json --watch`, use **Install Voice**, and retain the request ID. The runner executes the same leased Voice installer. Interrupt once after a recorded resource creation and resume with the same private state/source, demonstrating recovery. Do not manufacture an unrelated collision in existing resources. For ambiguous lost responses, review evidence and use explicit recovery, never name-based adoption.
4. Reload, verify installation ID/source/runtime version and `ready`; open through the one-time handoff; save a receptionist and complete the authorized real text turn. Verify history, two granted workspaces, denial of cross-user calls, logout and grant revocation. Record actual deployed versions, D1/DO IDs and errors/recovery evidence. Do not claim microphone or carrier success from the text result.
5. Install the dedicated Appflare manager through its supported signed installer and finish its owner setup. Use **Continue in Appflare**, review Cut's source/version and costs, confirm installation there, and retain its generated admin password privately. Configure `config/appflare.json` with the actual manager D1 and install ID; run `register:appflare`. Reload Canopy, verify both products appear, and open Cut to its own authentication. Create a test short link through Cut and verify its redirect. No Appflare runtime/table writes come from Canopy's reconciler.
6. Verify keyboard and 390×844, 768×1024, 1280×800, 1440×900 behavior on the deployed console. Record runtime unavailability/readiness mismatch as separate evidence. Retain the inventory and private recovery state; mark this milestone complete only after the live acceptance results are recorded.

## Retention, recovery and cleanup

Retain the fresh core/Voice/Appflare/Cut resources and private state for review until the operator chooses cleanup. Voice transcript retention defaults to 30 days. Do not delete or recreate a D1 to repair an install. Back up required data and stop incoming activity before removal. Product removal never deletes core identity. Use Appflare's supported removal controls for its app resources, with explicit retention choices. Remove only the named dedicated core resources after separate cleanup authorization. Established staging, production, sibling deployments, provider accounts and customer data remain outside this plan.

## Actual live result

**Pending authorization and execution.** No allocated D1/DO/KV/Workflow IDs, deployed version IDs, real AI response, or remote installation record exist for these targets yet. Replace this paragraph with measured results and inventory links after the authorized run; do not infer success from local tests.
