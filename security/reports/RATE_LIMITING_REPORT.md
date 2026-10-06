# Rate Limiting Security Report

## Status: MEDIUM — present and effective per dyno; bypassable by IP spoofing behind a trusting proxy

## Findings

**Implementation.** Per-IP token bucket in `server/index.js`, applied to every request
before any handler, including login. Defaults: 0.5 requests/second sustained, burst 5,
tunable via `RATE_LIMIT_PER_SEC` and `RATE_LIMIT_BURST`.

**Coverage.** Both endpoints. There is no registration or password-reset endpoint to
cover. Login is the sensitive one and it is limited.

**Verified live** against the deployed proxy: 12 concurrent requests produced 7 × 429.
A sequential run of 8 produced none, which is correct — the bucket refills between
calls — and is worth noting because it initially looked like a failure.

**429 responses** carry both a `retryAfterMs` body field and a `Retry-After` header. The
client honours the server's figure over its own backoff curve.

**Memory.** Buckets are evicted after 10 minutes idle by an `unref`'d interval, so the
map cannot grow without bound. An unbounded map in a long-lived process is the usual way
this control becomes its own denial of service.

### The real weakness

The client IP is taken from `x-forwarded-for`:

```js
const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress
```

Heroku's router overwrites this header, so on this deployment a client cannot forge it.
But the code trusts the leftmost value unconditionally, which would be wrong behind a
proxy that appends rather than replaces. An attacker could then rotate a spoofed value
per request and never be limited.

Additionally the bucket is in process memory, so the limit is **per dyno**. At one dyno
that is the whole app; scaling to two doubles the effective limit.

## What's at risk

Online password guessing against the single demo password, if the limiter were bypassed.
At 0.5/s an attacker gets ~43k attempts/day per IP, which is already more than ideal for
a password of this strength. Cost amplification against the Groq key is the other risk,
bounded by the same limiter.

## What's already secure

- The limiter runs before the handler, so a shed request costs no scrypt work and no
  provider call.
- Bucket eviction prevents unbounded growth.
- scrypt verification is itself a rate limiter of sorts: each attempt costs ~50-100ms of
  CPU, so guessing is expensive even if the bucket were bypassed.

## Recommendations

1. Take the client IP from the rightmost untrusted hop, or from a platform-specific
   header, rather than the leftmost `x-forwarded-for` value. On Heroku, prefer
   `x-forwarded-for`'s last entry.
2. Add a separate, stricter counter for failed logins specifically — the brief's
   suggestion of 10 per 15 minutes is a reasonable target, and is much tighter than the
   general 0.5/s.
3. Move to shared state (Redis) before running more than one dyno.
