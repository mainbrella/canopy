<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Code interpreter contexts

The source API and SDKs implement stateful Python execution. These additions
require matching API/runtime deployment and a new SDK release; check
`codeInterpreter.supported`. The image must include `python3` and GNU `timeout`.
Every endpoint below requires the exact owned `id` and `createdAt` query values:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/containers/code-contexts` | Create a context with `{"language":"python"}`; returns 201 with its `id`, generation and `expiresAt`. |
| GET | `/containers/code-contexts` | List live contexts for that generation. |
| POST | `/containers/code-contexts/{contextId}/execute` | Run `{"code":"values = [2, 3, 5]","timeoutMs":30000}` with persistent globals and imports. |
| DELETE | `/containers/code-contexts/{contextId}` | Close the interpreter and release its operation slot. |

Execution returns `stdout`, `stderr`, `results`, `error`, and `outputTruncated`.
The final expression produces text and, when serializable, JSON MIME results;
objects can additionally return HTML or base64 PNG. MIME data is always a string.
Sanitize untrusted HTML before rendering. Python exceptions return structured
`name`, `message`, and `traceback` fields with HTTP 200 and preserve the context.
Native/subprocess output is combined in `stderr`; blocking stdin receives EOF.

Code is limited to 16 KiB UTF-8; execution defaults to 30 seconds and caps at
60 seconds. Returned stdout, stderr (including native output), MIME types/data,
and error fields share a 256 KiB UTF-8 limit with truncation reported. JSON
escaping and field names are excluded; the encoded response is bounded at
2 MiB. At most four MIME results are returned; oversized JSON/HTML/PNG values
are omitted whole. Native output ingestion also has a separate 1 MiB hard cap.
Contexts last at most 15 minutes or
the remaining sandbox lease, hold one of the four shared operation slots, and
accept one execution at a time (`code_context_busy` on overlap). Active execution
renews idle activity; an idle interpreter does not keep compute alive.

Stop, timeout, cancellation, expiration and runtime recovery discard the context;
RAM is never snapshotted or restored. Cleanup falls back to stopping the generation
if process-group termination cannot be confirmed. List and close remain available
to the owner during billing outages. Execution is never automatically retried;
reconcile side effects after a lost response before submitting code again.

JavaScript: `const ctx = await sandbox.code.create(); await ctx.run('x = 41');
const result = await ctx.run('x + 1'); await ctx.close();`. Python supports
`with sandbox.code.create() as ctx:`, followed by `ctx.run(code)` calls.
See [interpreter lifecycle and limits](docs/code-interpreter.md).
