<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Desktop automation helpers (unreleased)

The source JS/Python SDKs provide `sandbox.desktop` on images with Python, Xvfb,
xdpyinfo, xdotool and ImageMagick `import`. Probe the selected image with
`desktop.probe()`, then start a session with `desktop.start()`. Helpers reuse
generation-scoped code contexts and binary file transfer. No additional API
endpoint, browser viewer or exposed display port is created.

A desktop supports bounded mouse movement/clicks, keyboard shortcuts, text,
argv-based application launches and PNG screenshots. Sessions consume an
interpreter slot and inherit its expiry and process-group cleanup. Call `close()`
when finished; stop/restart destroys the desktop. There is no RAM restoration,
VNC viewer, recording or Windows support. See the SDK references for examples.
