# File Uploads Fix Plan

## Changes

None. No upload surface exists.

## New files

None.

## Verification goals

- [x] No file input, multipart parser, or upload endpoint anywhere
- [x] Proxy accepts JSON only, capped at 16KB
- [x] Oversized bodies return 413 rather than dropping the connection
- [x] Every accepted field is length- or pattern-checked
- [x] The server performs no filesystem writes

## Manual verification (for the human)

None applicable until recording capture is built.
