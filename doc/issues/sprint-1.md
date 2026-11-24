Tracking issue for **Sprint 1 — Auth hardening**, from `doc/SPRINT-PLAN-rbac.md`.

## Tasks

- [x] **S1-1** `src/auth/passwordPolicy.js` — single validator, min 10 chars
- [ ] **S1-2** Rate limit `/api/login`, `/forgetpassword`, `/resetpassword` per IP + per email
- [ ] **S1-3** CORS allowlist from `CORS_ORIGINS` env (currently `origin: true` reflects any origin)
- [ ] **S1-4** `helmet()` + CSP
- [x] **S1-5** Session model: store **token hash**, TTL index, revoke on logout
- [ ] **S1-6** `updatePassword` authorization — self, or `owner` on others. Drop the hardcoded `admin@admin.com` check
- [x] **S1-7** Audit log for auth events
- [ ] **S1-8** Signed expiring `/download` links (currently anonymous)

## Acceptance

Login rate-limited; sessions hashed + revocable; password policy enforced at every entry point; `/download` no longer anonymously readable.

## Progress notes

`S1-5` and `S1-7` landed in `babbdd2f`: Session collection with sha256 token hashes, TTL expiry, immediate revocation on logout, and an append-only AuditLog recording login / login_failed / logout.

`S1-1` added `src/auth/passwordPolicy.js` but it is not wired into the entry points yet — that is part of finishing this sprint.
