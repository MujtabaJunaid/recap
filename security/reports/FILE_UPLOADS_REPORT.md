# File Uploads Security Report

## Status: N/A

## Findings

There is no file upload anywhere in this system.

- No `<input type="file">` in any component.
- No `FormData`, no `multipart/form-data`, no `multer`, `busboy` or `formidable`.
- The proxy accepts `application/json` only and caps the body at 16KB.
- No filesystem write path exists in the proxy. It has no disk persistence at all.
- GitHub Pages serves a fixed build artefact; nothing can be written to it at runtime.

The only user-supplied content that reaches the server is JSON text fields, each
length-checked before use: `actionText` ≤ 500, `meetingTitle` ≤ 200,
`transcriptExcerpt` ≤ 4000, `style` from a fixed set, `due` matched against
`^\d{4}-\d{2}-\d{2}$`, `email` ≤ 200.

## What's at risk

Nothing.

## What's already secure

- Oversized bodies are rejected with 413 after draining the stream, rather than by
  destroying the socket — the earlier behaviour surfaced as a misleading 503 from the
  router, which is how it was found.
- Content type is not negotiated: the server only ever parses JSON.

## Recommendations

If recording upload is ever implemented, the capture layer is the thing currently
stubbed, so this becomes live. At that point: validate type by magic bytes rather than
extension or client-declared MIME, rename to a UUID server-side, store in a separate
bucket on a different origin so a stored file can never execute in the app's origin,
enforce size limits server-side, and scan before serving.
