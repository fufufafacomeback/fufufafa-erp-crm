## What

Executes the first slice of `doc/PRD-refactor-rbac.md` per `doc/SPRINT-PLAN-rbac.md`:
the test foundation and the session/audit core of **Sprint 1**.

## Why

Two things made progress impossible:

1. **The app could not start on Node 26.** `jsonwebtoken@9.0.2` → `jws@3` → `jwa@1` → `buffer-equal-constant-time`, which calls `require('buffer').SlowBuffer` — removed in Node 26. `node src/server.js` died with `Cannot read properties of undefined (reading 'prototype')`.
2. **No tests existed.** No `test` script, no framework. Every PRD exit criterion says "verified by test", so this had to come first.

## Changes

**Test harness (S0-1, S0-8)**
- `backend/test/helpers/server.js` — boots the real app on an ephemeral port against a throwaway DB, drops it on teardown
- `backend/test/helpers/auth.js` — seeds `Admin`/`AdminPassword` pairs, logs in
- `backend/test/smoke.test.js` — 401 without token, login, authenticated request, 404 for unknown route
- `npm test` → `node --test` with a glob. **Zero new test dependencies** (`node:test` + `assert` + `fetch`)

**Sessions (S1-5)** — replaces `AdminPassword.loggedSessions`, which stored raw JWTs in an unbounded array and never expired:
- `Session` collection stores only a **sha256 hash** of the token
- TTL index on `expiresAt`
- logout deletes the row → revocation is immediate, not at token expiry
- `isValidAuthToken` requires a live session, not just a valid signature

**Audit (S1-7)** — append-only `AuditLog` recording `login`, `login_failed`, `logout` with actor, IP, user-agent. Fire-and-forget: a logging failure never breaks the request.

**Password policy (S1-1)** — `src/auth/passwordPolicy.js`, one validator, min 10 chars. *Not yet wired into entry points.*

## Verification

```
$ npm test
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

CI (3 jobs: backend smoke, frontend build, no-secrets) must be green before merge.

## Not done in this PR

Sprint 1 is partially complete. Remaining: S1-2 rate limiting, S1-3 CORS allowlist, S1-4 helmet, S1-6 `updatePassword` authorization, S1-8 signed download links, and wiring the password policy in.

Sprint 0 is **not** complete either — see #1. The exploitable items (mass assignment, dynamic query keys, error stack leaks, cross-tenant IDOR) are still open.

## Known caveats

- `npm run setup` is not idempotent — re-running duplicates admins. CI is unaffected (fresh DB per run).
- Frontend lint is not gated: 153 pre-existing errors.
- Login now creates a Session row. Existing tokens in the old `loggedSessions` array are invalidated — **everyone must log in again**. Expected.

Closes nothing yet. Tracks #1 and #2.
