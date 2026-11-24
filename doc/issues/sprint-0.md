Tracking issue for **Sprint 0 — Security triage & foundations**, from `doc/SPRINT-PLAN-rbac.md`.

Blocking gate: no Sprint 1+ work merges until this is done.

## Tasks

- [x] **S0-1** Test harness — `node:test` runner, server/auth helpers, `npm test`, CI step
- [ ] **S0-2** Unique index on `Admin.email`; dedupe existing admins
- [ ] **S0-3** Field allowlist on generic `update` — reject `removed`, `createdBy`, `organizationId`, `role`, `_id`, `__v`
- [ ] **S0-4** Stop forcing `req.body.removed = false` in `update` (resurrection bug)
- [ ] **S0-5** Kill dynamic query keys — allowlist `sortBy`, `filter`, `fields` per entity
- [ ] **S0-6** Error responses: message only unless `NODE_ENV !== 'production'`
- [ ] **S0-7** Nullable indexed `organizationId` on Admin, Client, Invoice, Payment, Taxes, PaymentMode
- [x] **S0-8** `test` script in `backend/package.json`

## Acceptance

`npm test` green in CI; no mass assignment; no dynamic query keys; no stack leaks.

## Notes

`jsonwebtoken` had to go to `^9.0.3` — 9.0.2 pulls `jws@3` → `jwa@1` → `buffer-equal-constant-time`, which calls `require('buffer').SlowBuffer`, removed in Node 26. The app could not start at all on Node 26. Done in `d9e60e0c`.
