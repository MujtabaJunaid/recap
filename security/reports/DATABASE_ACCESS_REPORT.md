# Database Access Security Report

## Status: N/A

## Findings

There is no database in this system, and no database client of any kind.

Searched the whole repository for `SELECT`, `INSERT`, `UPDATE ... SET`, `DELETE FROM`,
`sqlite`, `postgres`, `mysql`, `mongoose`, `knex`, `prisma`, `sequelize`, `supabase`,
`firebase`, and `.query(`. No matches in `src/` or `server/`.

Storage inventory, exhaustively:

| Store | What lives there | Scope |
| --- | --- | --- |
| JS bundle | Seed meetings, people, shared clips — public fixture content | Public |
| `localStorage` | Completed action ids, locally created clips, work style, session token | That browser only |
| Heroku config vars | `GROQ_API_KEY`, `AUTH_SECRET`, `PASSWORD_HASH` | Server process only |
| Proxy memory | Per-IP rate-limit buckets, evicted after 10 minutes idle | Single dyno, transient |

The proxy stores nothing. It has no disk writes, no cache, and no persistence of request
or response content.

## What's at risk

Nothing from this category. There is no RLS to misconfigure, no anon key to over-scope,
and no table to leave unprotected.

## What's already secure

`localStorage` is per-origin and per-browser. It never leaves the device and is never
sent to the proxy. The only thing in it that has any authority is the session token,
which is signed server-side, expires in 12 hours, and cannot be extended by the client.

## Recommendations

When a database is introduced, the properties this build already relies on should be
carried into it rather than rediscovered:

1. Row-level security on every table from the first migration, not retrofitted.
2. Policies scoped to the authenticated subject, never `USING (true)`.
3. Share links resolve by opaque token server-side, returning only the clip — the
   surrounding meeting must never be sent to an unauthenticated viewer.
4. Action-item keys stay qualified as `meetingId:actionId`. Action ids are only unique
   within a meeting, which has already caused one cross-write bug in this codebase.
