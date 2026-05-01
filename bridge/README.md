# Legacy Bridge

`server.mjs` is kept only for the old browser/iCUE widget path and compatibility testing.

The current shipped app is the native host in `app/`, which serves the dashboard and APIs directly without requiring Node.js.

If you are publishing, installing, or testing the current app, use the native host and treat this folder as legacy-only.
