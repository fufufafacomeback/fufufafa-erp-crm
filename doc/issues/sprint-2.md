Tracking issue for **Sprint 2 — RBAC core**, from `doc/SPRINT-PLAN-rbac.md`.

This is the long sprint. It touches every controller and the role matrix has to be right.

## Tasks

- [ ] **S2-1** Extend `Admin.role` enum: `owner`, `admin`, `accountant`, `sales`, `viewer`
- [ ] **S2-2** `src/auth/permissions.js` — static role→entity→action map
- [ ] **S2-3** `src/auth/authorize.js` — returns the Mongo filter, denies 403 on missing permission
- [ ] **S2-4** Route **every** controller through `authorize()`
- [ ] **S2-5** Delete duplicated paginated-list implementations; keep one
- [ ] **S2-6** Deny-by-default entity registry (glob-discovered models must not auto-route)
- [ ] **S2-7** **Role × entity × action test matrix**
- [ ] **S2-8** Seed one user per role for QA (behind `SEED_DEMO_USERS=true`)

## Acceptance

The matrix passes in CI:

- `sales` cannot see another `sales` user's records
- `viewer` cannot write
- `accountant` cannot delete

Proven by test, not by clicking.

## Decisions (from sprint plan §Decisions)

- Single-tenant, with nullable indexed `organizationId` reserved (S0-7)
- `accountant`: all invoices, read + payment create, no delete
- `owner` is the only role that may manage admins
