<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Streaming files and directory copies

`GET` and `PUT /containers/files/transfer` add bounded streaming for files up to
64 MiB. Check `capabilities.files.streamingTransfers` before use. The SDK client’s default request timeout remains 90 seconds; configure a longer client timeout for transfers that need the server’s five-minute maximum. Both directions
flow under backpressure without a file-sized Worker buffer. PUT requires the exact
byte count in `size`; short, oversized and interrupted input cannot publish a
partial destination. A clean EOF authorizes atomic replacement, so a lost response
can still hide a successful write. New files use mode 0600; replacement preserves
permission bits. Leaf symlinks and non-regular destinations are rejected.

Transfers occupy one execution slot for their lifetime, renew idle activity, and
end after five minutes or the generation deadline. Request cancellation, response
stream cancellation and machine stop end the operation. Forced interruption can
leave a hidden `.mainbrella-transfer.*` temporary file beside the destination.
Downloads provide `Content-Length`; changing files are not snapshots, and stream
errors or short bodies must cause consumers to discard their output. Transfers
have no resume protocol and mutations are never automatically retried. A Linux
guest with `/bin/sh`, GNU coreutils and `/proc` is required.

The JavaScript SDK exposes `files.upload(path, readableStream, {size, signal})`
and `files.download(path, {signal})`, returning a Web `ReadableStream`.
The Python SDK accepts binary file objects with `files.upload(path, source,
size=...)`; `files.download(path)` returns a context-managed binary reader.
Configure the client timeout above the expected transfer duration (the default
is 90 seconds).

`files.uploadDirectory(local, remote)` / `downloadDirectory(remote, local)` in
Node and `upload_directory` / `download_directory` in Python recursively copy
directories without extracting archives. Copies are bounded to 10,000 entries
and 64 directory levels, reject symlinks and special files, and replace each file
atomically. The whole directory is not atomic; existing unrelated files remain,
permission bits are not synchronized, and a failure may leave completed earlier
files. Avoid concurrent changes to either tree during a copy.

`files.watch(path)` polls paginated metadata and yields `create`, `modify` and
`remove` events after its initial baseline. This is a client-side polling helper,
not a retained native watcher: transient changes and same-size rewrites within
one second can be missed. JavaScript accepts an `AbortSignal`; Python accepts a
`threading.Event` as `stop_event`. Polls use normal filesystem operations and
renew idle activity. Neither helper deletes local or remote files to mirror a tree.
