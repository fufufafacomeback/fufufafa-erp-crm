# Sprint Plan — Execute PRD: RBAC, Customer Relation, Data Security

**Companion to:** `doc/PRD-refactor-rbac.md`
**Baseline commit:** `09fa8da7` (branch `setup/test`)
**Cadence:** 1-week sprints, each independently shippable
**Total:** 5 sprints (~5 weeks calendar, solo dev)

---

## Decisions taken (PRD §9 open questions)

These blocked Phase 2. Resolved here so work can start:

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Single or multi-tenant? | **Single-tenant** now. Add nullable, indexed `organizationId` to all collections in Sprint 0. | Every query gets the field from day one; going multi-tenant later is a backfill, not a rewrite. |
| 2 | `accountant` scope | **All invoices, read + payment create.** No delete. | Finance needs the full ledger; scoping them by owner breaks reconciliation. |
| 3 | PDF sharing | **Signed expiring links** (7 days) via a token-issuing endpoint. `/download` requires auth. | Customers must be able to open a link without an account, but URLs must not be permanent. |
| 4 | How many admins? | Assume **2–5**. Sprint 4 (admin UI) stays in scope. | If it turns out to be 1, Sprint 4 can be dropped and Sprint 2 reduced to `owner` + `viewer`. |

---

## Prerequisite: test harness (part of Sprint 0)

**There is no test framework in this repo.** `backend/package.json` has no `test` script and
no jest/mocha/vitest/supertest installed. Every PRD exit criterion says "verified by test",
so this must land first.

**Use Node's built-in runner** (`node:test` + `node:assert`) and the global `fetch` in Node 20.
Zero new dependencies. Do **not** add jest or supertest.

```
backend/test/
  helpers/server.js     // boot app on an ephemeral port against a throwaway DB, return base URL
  helpers/auth.js       // seed a user per role, log in, return token
  smoke.test.js
```

`npm test` → `node --test "test/**/*.test.js"`. CI gets an `npm test` step after setup.

> **Node 26 note:** `node --test test/` (a bare directory) throws `MODULE_NOT_FOUND` on
> Node 26. Use the glob form above, or bare `node --test`, which auto-discovers. Verified
> on the local Node 26.7.0; CI runs Node 20 where the directory form also works — the glob
> form is correct on both.

Test DB is dropped on teardown. Never point tests at the `test` database used by the dev app.

---

## Sprint 0 — Security triage & foundations

**Goal:** close the exploitable issues and make the codebase testable.
**Blocking:** everything. Do not start Sprint 1 until this is merged.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| S0-1 | Test harness: `node:test` runner, server helper, `npm test`, CI step | `backend/test/**`, `package.json`, `.github/workflows/ci.yml` | `npm test` runs in CI and fails on a deliberately broken assert |
| S0-2 | Unique index on `Admin.email`; dedupe existing admins | `models/coreModels/Admin.js` | Inserting a duplicate email throws `E11000`; dev DB has 1 admin |
| S0-3 | Field allowlist on generic `update` — reject `removed`, `createdBy`, `organizationId`, `role`, `_id`, `__v` | `createCRUDController/update.js` | Test: PATCH with `{role:'owner'}` leaves role unchanged |
| S0-4 | Stop forcing `req.body.removed = false` in `update` | `createCRUDController/update.js` | Test: updating a soft-deleted doc returns 404, does not resurrect |
| S0-5 | Kill dynamic query keys — allowlist `sortBy`, `filter`, `fields` per entity | `createCRUDController/paginatedList.js`, `invoiceController/paginatedList.js`, `paymentController/paginatedList.js` | Test: `?filter=password&equal=x` returns 400, not a query |
| S0-6 | Error responses: message only unless `NODE_ENV !== 'production'` | `handlers/errorHandlers.js`, all controllers returning `error: error` | Test: 500 body has no `error` object or stack in production mode |
| S0-7 | Add nullable `organizationId` (indexed) to Admin, Client, Invoice, Payment, Taxes, PaymentMode | all `models/**` | Existing docs still load; index exists in `db.collection.getIndexes()` |
| S0-8 | Add `test` and `lint:backend` scripts | `backend/package.json` | `npm test` and syntax check both runnable |

**Exit:** `npm test` green in CI; no mass assignment; no dynamic query keys; no stack leaks.

**Note on S2 (rotate JWT_SECRET):** the PRD flagged this as blocking. Audit showed the
committed value was the upstream placeholder `"your_private_jwt_secret_key"`, and no real
key exists anywhere in git history. **No rotation needed.** If you have ever deployed this
with the placeholder, rotate it now — that value is public.

---

## Sprint 1 — Auth hardening

**Goal:** make the session and login surface defensible.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| S1-1 | `src/auth/passwordPolicy.js` — one validator, min 10 chars | new | Used by setup, create, reset, update; test each entry point |
| S1-2 | Rate limit `/api/login`, `/forgetpassword`, `/resetpassword` per IP + per email | `app.js`, new `middlewares/rateLimit.js` | 6th attempt in a minute returns 429 |
| S1-3 | CORS allowlist from `CORS_ORIGINS` env | `app.js` | Disallowed origin gets no CORS headers |
| S1-4 | `helmet()` + CSP | `app.js` | Response has `X-Content-Type-Options`, CSP header |
| S1-5 | Session model: store **token hash**, TTL index, revoke on logout | new `models/coreModels/Session.js`, `authUser.js`, `isValidAuthToken.js`, `logout.js` | Logout invalidates the token immediately; raw JWT not stored |
| S1-6 | `updatePassword` authorization — self, or `owner` on others. Drop the hardcoded `admin@admin.com` check | `createUserController/updatePassword.js` | Test: non-owner PATCH on another admin → 403 |
| S1-7 | Audit log for auth + destructive events | new `models/coreModels/AuditLog.js`, `src/auth/audit.js` | Login, logout, failed login, delete all produce a row |
| S1-8 | Signed expiring `/download` links | `coreDownloadRouter.js`, new token endpoint | Unsigned/expired link → 403; valid → 200 PDF |

**Exit:** login rate-limited, sessions hashed + revocable, password policy enforced
everywhere, `/download` no longer anonymous.

---

## Sprint 2 — RBAC core (the choke point)

**Goal:** one authorization function; every controller goes through it.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| S2-1 | Extend `Admin.role` enum: `owner`, `admin`, `accountant`, `sales`, `viewer` | `models/coreModels/Admin.js` | Each value saves; unknown value rejected |
| S2-2 | `src/auth/permissions.js` — static role→entity→action map | new | Exported map is the single source of truth |
| S2-3 | `src/auth/authorize.js` — returns the Mongo filter, denies 403 on missing permission | new | Unit tests per role |
| S2-4 | Route **every** controller through `authorize()` | all `createCRUDController/*`, `invoiceController/*`, `paymentController/*`, `clientController/*` | `grep -rn "Model.find(" src/controllers` returns only calls consuming an authorized filter |
| S2-5 | Delete duplicated paginated-list implementations; keep one | delete `invoiceController/paginatedList.js`, `paymentController/paginatedList.js` | Invoice/payment lists still paginate and filter |
| S2-6 | Deny-by-default entity registry — glob-discovered models are not auto-routed | `models/utils/index.js`, `routes/appRoutes/appApi.js` | Adding a model without registering it does not create routes |
| S2-7 | **Role × entity × action test matrix** | `backend/test/rbac.test.js` | For every role/entity/action: cross-user access → 404, DB unchanged |
| S2-8 | Seed one user per role for QA | `setup/setup.js` (behind `SEED_DEMO_USERS=true`) | 5 users exist; each can log in |

**Exit:** the matrix passes in CI. `sales` cannot see another `sales` user's records;
`viewer` cannot write; `accountant` cannot delete. Proven by test.

---

## Sprint 3 — Customer ↔ Admin relation

**Goal:** every customer has an owner; the relation is queryable and enforced.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| S3-1 | `Client.createdBy` required, server-stamped (ignore client input) | `models/appModels/Client.js`, `clientController` | Test: POST with a forged `createdBy` is overwritten |
| S3-2 | Rename `assigned` → `assignedTo` (indexed) | `models/appModels/Client.js` | Migration script moves existing values |
| S3-3 | Backfill `createdBy` on existing clients | new `src/setup/migrations/001-client-owner.js` | Dev DB: **6 clients currently have no `createdBy`** → 0 after backfill |
| S3-4 | `assignedTo` select on the customer form (admin list) | `frontend/src/pages/Customer/config.js`, form | Admin can assign a customer to a user |
| S3-5 | `sales` scope filters by `createdBy` / `assignedTo` | `authorize.js` | Test: sales B sees 0 of sales A's customers |

**Exit:** no `Client` with null `createdBy`; `sales` scope proven by test.

---

## Sprint 4 — Admin management UI

**Goal:** owner can manage users without touching the DB.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| S4-1 | Admin list/create/deactivate endpoints — `owner` only | `coreApi.js`, new controller | Non-owner gets 403 |
| S4-2 | Admin management page | new `frontend/src/pages/Admin/**`, route | Owner creates an accountant |
| S4-3 | Frontend permission gating — hide nav + actions per role | `NavigationContainer.jsx`, `ErpPanelModule/DataTable.jsx` | Viewer sees no create/delete buttons |
| S4-4 | Document the role matrix in the UI (help text) | — | Users know what they can do |

**Exit:** owner adds an accountant; that user logs in and is provably restricted.
**Frontend gating is UX only — the server remains the enforcement point.**

---

## Sprint 5 — Customer portal (separate PRD)

Not in this plan. Blocked until the Sprint 2 matrix has been green for a full sprint.
Shipping it early leaks every customer's invoices to every other customer.

---

## Task flow

```
Sprint 0 ──► Sprint 1 ──► Sprint 2 ──► Sprint 3 ──► Sprint 4
(tests,       (sessions,   (authorize,   (client       (admin UI)
 mass-assign,  rate limit,  role matrix)  ownership)
 query keys)   downloads)
```

Sprint 0 is a hard gate. Sprint 1 and 3 are independent of each other but both depend on 0.
Sprint 4 depends on 2.

---

## Per-sprint checklist

Every sprint, before merge:

1. `npm test` green locally and in CI
2. `npm run setup` still works on a fresh DB
3. Login + create an invoice through the UI by hand
4. No new `.env` or secret in the diff
5. PRD updated if a decision changed

---

## Effort

| Sprint | Focus | Days |
|---|---|---|
| 0 | Security triage + test harness | 5 |
| 1 | Auth hardening | 5 |
| 2 | RBAC core | 7 |
| 3 | Customer relation | 4 |
| 4 | Admin UI | 4 |
| **Total** | | **25** |

Sprint 2 is the long one — it touches every controller and needs the matrix to be right.
Do not compress it.

---

## Definition of done (whole programme)

Mirrors PRD §8, plus:

8. `npm test` covers the role matrix and runs in CI on every PR.
9. Every `Client` has a non-null `createdBy`.
10. No endpoint returns a raw error object in production mode.
