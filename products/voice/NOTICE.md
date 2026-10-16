# Source and license notices

Mainbrella Voice is distributed under **GPL-3.0-only**; see [LICENSE](LICENSE).

This Canopy product adopts the prior standalone extraction at `mainbrella/ai-receptionist` commit `7d3e023318f36f7a45e5d155c46d96e3896f9502`. Its Voice runtime and UI were compared against `mainbrella/backend` commit `0bc20dec148c1a78b40aa252a76735103d1dbe1f` and `mainbrella/web` commit `3dcea8975e2936ec26da95395b5df3f9042fa5f0`. Byte-identical speech/telephony helpers, browser transport, and number-search tests were taken directly from those hosted trees where applicable.

The standalone source's original attribution remains:

| Extracted material | Source revision |
| --- | --- |
| Worker voice, call, and provider integration | `mainbrella/backend`, `44a023a3d72a2a5b2672ae7ac79cf34b68e817d2` |
| Telnyx account discovery and diagnostics | `mainbrella/backend`, `1f7f43311d610533aacf945c52f1f3b49918077e` |
| Voice workspace frontend and styles | `mainbrella/web`, `e21c8bcba3102bd62d5441dbe7b13bbbe90f062c` |

Canopy adapts workspace/build tooling, explicit environment types, local-only defaults, a distinct session cookie, and standalone export/catalog distribution. It retains the prior standalone owner adapter, migrations, call safety limits, speech/telephony implementation and regression tests. It does not import production data, hosted wallets, or Mainbrella billing.

`migration-sources.json` at the Canopy root records exact per-file hashes and adaptations and is included in standalone source exports. Canopy is the maintained source for this extracted product; the source export is a distribution of that implementation, not a separate engine. Sibling repositories and their deployments remain untouched until an intentional release transition.
