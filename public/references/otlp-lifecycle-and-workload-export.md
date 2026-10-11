<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## OTLP lifecycle and workload export

`GET /containers/telemetry/logs?id=…&createdAt=…` returns an OTLP/HTTP JSON
`ExportLogsServiceRequest` body, ready to forward to a collector's `/v1/logs`.
It uses the same account authentication, exact-generation checks, seven-day
retention and `cursor`/`limit` pagination as lifecycle history. Response headers
`Mainbrella-Next-Cursor`, `Mainbrella-Has-More`, and
`Mainbrella-History-Truncated` carry pagination metadata; all are exposed to
allowed browser origins. Deduplicate on the `event.id` log attribute. Advance a
stored cursor only after the collector acknowledges the batch.

`GET /containers/telemetry/metrics?id=…&createdAt=…&from=…&to=…` returns an
OTLP/HTTP JSON `ExportMetricsServiceRequest` for `/v1/metrics`. CPU seconds are
sampled delta sums; peak memory bytes are gauges. Export non-overlapping time
ranges to avoid duplicate CPU sums. Missing measurements remain absent, including
an entirely unobserved interval. Disk values with unqualified units are omitted.
`Mainbrella-Metrics-State` is `observed` or `unobserved`. The metrics endpoint
retains the existing provider qualification gate and generation/range limits.

Check `observability.otlp` and, for metrics, `observability.metrics`. These are
pull exports: the API never sends data or credentials to a caller-supplied URL,
and exports do not renew compute. Errors and authentication match the underlying
`/containers/events` and `/containers/metrics` endpoints. This addition does not
enable webhook delivery or qualify a provider metrics deployment.
