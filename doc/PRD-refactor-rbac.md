# PRD — Refactor: RBAC, Customer↔Admin Relations, Data Security

**Project:** idurar-erp-crm (v4.1.0, self-hosted)
**Status:** Draft
**Owner:** TBD
**Scope:** Backend `backend/src`, Frontend `frontend/src`

---

## 1. Problem

The application has **no authorization model**. Every authenticated user is an `Admin`
with `role: 'owner'` — the only value the enum allows. There is one shared login, and any
token can read or modify every record in the database.

Three concrete consequences, verified against the current code:

1. **No multi-user support.** You cannot add a second person (accountant, sales rep,
   viewer) without giving them full owner access.
2. **No data scoping.** Every list/read/update/delete query is global. A user who should
   only see their own invoices sees everyone's.
3. **Customers are inert rows.** `Client` has no credentials and no portal. A customer
   can never log in to see their own invoices — and if we naively added that, the current
   query layer would expose all other customers' data.

This PRD defines the refactor to introduce RBAC, a durable Customer↔Admin relation, and
the security hardening required before any of it is safe to ship.

---

## 2. Current State Audit

Findings from reading the code, not assumptions. These are the things the refactor must
address; several are exploitable **today**.

### 2.1 Critical — exploitable now

| # | Issue | Location | Impact |
|---|---|---|---|
| C1 | `.env` is committed to git, including `JWT_SECRET` | `backend/.env`, tracked in git | Anyone with repo access can forge admin tokens for any deployment using that secret |
| C2 | Generic `update` does raw mass assignment of `req.body` | `createCRUDController/update.js` | Caller can set `removed`, `createdBy`, `role`, `_id`, `enabled` on any record |
| C3 | `update` forces `req.body.removed = false` | `createCRUDController/update.js` | Any soft-deleted record can be resurrected by any authenticated user |
| C4 | `read` / `update` / `remove` have zero ownership scoping | `createCRUDController/{read,update,remove}.js` | Any token can read/modify/delete any document by ID — cross-tenant IDOR |
| C5 | `remove` doesn't filter `removed: false` | `createCRUDController/remove.js` | Repeated deletes on already-deleted docs succeed |
| C6 | Any authenticated admin can change **any** admin's password by ID | `createUserController/updatePassword.js` | Privilege takeover: attacker sets the owner's password, then logs in as owner |
| C7 | `/download/*` mounted without auth | `app.js:42`, `coreDownloadRouter.js` | Every invoice/payment PDF is publicly readable by anyone with the URL |
| C8 | Dynamic query key injection: `{ [filter]: equal }` | `invoiceController/paginatedList.js:26`, `paymentController/*` | `filter=createdBy&equal=...` style probing; the generic controller was patched but these copies were not |
| C9 | Error handlers return the full error object + stack | `handlers/errorHandlers.js` | Leaks schema internals, file paths, Mongo error text to clients |
| C10 | No unique index on `Admin.email` | `coreModels/Admin.js` | Duplicate accounts; `findOne` returns an arbitrary match. Observed in practice: 7 duplicate admins accumulated |

### 2.2 High — weak defaults

| # | Issue | Location |
|---|---|---|
| H1 | No rate limiting anywhere. `express-rate-limit` is in `package.json` but never imported | — |
| H2 | CORS `origin: true` + `credentials: true` reflects any origin | `app.js:21-26` |
| H3 | No `helmet`, no security headers | — |
| H4 | `loggedSessions` stores raw JWTs in an unbounded array; no revocation by device/expiry cleanup | `AdminPassword.js:30`, `authUser.js` |
| H5 | Demo-password protection is a hardcoded email string compare (`'admin@admin.com'`) | `updatePassword.js` |
| H6 | Default seed password `admin123`, no strength check at setup | `setup/setup.js` |
| H7 | Password min-length checked only in `updatePassword`, not at create/reset | `updatePassword.js` |
| H8 | JWT `remember` → 365-day token; no rotation, no refresh | `authUser.js` |

### 2.3 Structural

- `role` enum is `['owner']` — a role system must be introduced from scratch.
- `Client.createdBy` / `assigned` exist in the schema but are **never populated** by
  `clientController` (only `invoice`/`payment` set `createdBy`). The relation is
  decorative today.
- `models/utils/index.js` derives entities from filenames by glob — any new model
  auto-becomes a routed entity. This is convenient and also means **adding a model
  automatically exposes CRUD routes**, which interacts badly with RBAC. Must be
  addressed.
- Two duplicate paginated-list implementations (generic + per-entity) already diverged
  in security (see C8).

---

## 3. Goals

1. **RBAC**: multiple admin users, each with a role that gates which entities and which
   actions they may perform.
2. **Customer↔Admin relation**: a durable, queryable link — which admin owns/created a
   customer, which admin is assigned to them, and (future) which customer can log in.
3. **Data security**: no cross-tenant read/write; secrets out of the repo; every
   authorization decision enforced server-side at a single choke point.
4. **Non-goals**: no rewrite of the UI, no framework migration, no new database.

---

## 4. Target Design

### 4.1 Tenancy model — decide first

Everything downstream depends on this. Two options:

**Option A — Single-tenant, role-scoped (recommended for this phase)**
All admins belong to one organization. RBAC gates *actions*; scoping gates *records by
ownership* (`createdBy`). Simple, ships fast, matches the current single-company usage.

**Option B — Multi-tenant with `organizationId`**
Every document carries `organizationId`; every query is filtered by it. Correct for SaaS,
but it's a data migration across all collections and every query in the codebase.

**Recommendation:** Ship A now, but add `organizationId` as a nullable field with an
index from day one and filter on it in the choke point (below). That makes B a
backfill, not a rewrite. **Do not** ship customer login before A is enforced — see §7.

### 4.2 Role model

Roles are static and few. Resist a dynamic permission editor — it is the classic
over-build here.

| Role | Intent | Typical actions |
|---|---|---|
| `owner` | Full control, one per org | Everything, incl. manage admins & roles |
| `admin` | Operational manager | CRUD invoices/customers/payments; no admin management |
| `accountant` | Finance only | Read all invoices, create/update payments, no delete |
| `sales` | Own pipeline only | CRUD **own** customers/invoices, no payments |
| `viewer` | Read-only | Read all, write nothing |
| `customer` | Portal user (future) | Read **own** invoices/payments only |

Store as `Admin.role` (enum extended) plus a `Customer.role = 'customer'` if the portal
ships. Permissions are a **code-level map**, not DB rows:

```js
// src/auth/permissions.js  (new)
const PERMISSIONS = {
  owner:      { '*': ['create','read','update','delete','list'] },
  admin:      { invoice: [...], client: [...], payment: [...], /* no admin */ },
  accountant: { invoice: ['read','list'], payment: ['create','read','list'], ... },
  sales:      { client: [...], invoice: [...], scope: 'own' },
  viewer:     { '*': ['read','list'] },
};
```

### 4.3 The single choke point (the core of this refactor)

Today authorization is absent and the query layer is duplicated. Replace with **one**
function every controller must go through:

```js
// src/auth/authorize.js  (new)
// authorize({ req, action, entity, query }) -> { filter, allowed }
//
// 1. resolve role from req.admin (already loaded by isValidAuthToken)
// 2. look up action permission -> deny 403 if absent
// 3. merge mandatory scope into the Mongo filter:
//      { removed: false, organizationId: req.admin.organizationId }
//    plus, when role.scope === 'own':  { createdBy: req.admin._id }
// 4. return the filter; controller MUST use it and MUST NOT build its own
```

Rules:
- Controllers never construct a raw filter. They call `authorize()` and pass the result.
- `create` stamps `createdBy` and `organizationId` **server-side**, ignoring any
  client-supplied values.
- `update` uses a **field allowlist per entity** (kills C2, C3). `removed`, `createdBy`,
  `organizationId`, `role` are never client-writable.
- `delete`/`read`/`update` include the scope filter in the `findOneAndUpdate`/`findOne`
  predicate, so an out-of-scope ID returns 404 — not 403 — to avoid confirming existence.

**Acceptance test for the choke point:** a test that, for every role × every entity ×
every action, asserts a request against another admin's record returns 404 and leaves the
DB unchanged. This is the one test that must exist.

### 4.4 Customer↔Admin relation

Schema changes to `Client`:

```js
createdBy:     { type: ObjectId, ref: 'Admin', required: true, index: true },
assignedTo:    { type: ObjectId, ref: 'Admin', index: true },   // rename from `assigned`
organizationId:{ type: ObjectId, index: true },                 // nullable now, §4.1
userId:        { type: ObjectId, ref: 'CustomerUser' },         // future portal, nullable
```

- `createdBy` becomes **required** and is stamped server-side (currently decorative).
- `assignedTo` is the "account manager" relation — drives `sales`-scope visibility.
- `userId` is reserved for the future customer portal so the migration doesn't need a
  second pass.
- Backfill: set `createdBy` to the org owner for all existing clients lacking it.

For the future portal, the login identity must be a **separate model**, not `Client`
itself — customers shouldn't carry auth columns and the auth factory already expects a
`<Model>Password` sibling:

```
CustomerUser      { _id, email (unique), name, enabled, removed, organizationId }
CustomerUserPassword { user, password, salt, emailVerified, loggedSessions, ... }
Client.userId -> CustomerUser._id
```

This mirrors `Admin`/`AdminPassword` so `createAuthMiddleware('CustomerUser')` works
unchanged. **Do not** reuse `AdminPassword` for customers.

### 4.5 Security requirements (blocking — must land with or before RBAC)

| Req | Change | Rationale |
|---|---|---|
| S1 | Remove `backend/.env` from git; add to `.gitignore`; ship `.env.example` with placeholders | C1 |
| S2 | **Rotate `JWT_SECRET`** and any keys that were committed | C1 — removing the file is not enough, the old secret is in history |
| S3 | Unique index on `Admin.email` (and `CustomerUser.email`); handle the existing duplicates | C10 |
| S4 | Rate-limit `POST /api/login` (and reset/forget) per IP + per email | H1 |
| S5 | CORS: explicit allowlist from env, not `origin: true` | H2 |
| S6 | `helmet()` + explicit `Content-Security-Policy` for the SPA | H3 |
| S7 | Error responses: message only, no `error` object, no stack, unless `NODE_ENV !== 'production'` | C9 |
| S8 | `updatePassword`: authorize — self, or `owner` acting on others. Remove the hardcoded demo-email check in favour of a real role check | C6, H5 |
| S9 | `/download`: require auth **or** issue a signed, expiring token in the shareable URL | C7 |
| S10 | Session table with `{ userId, tokenHash, createdAt, expiresAt, ip, userAgent }`; store **hash** not raw JWT; delete on logout; TTL index | H4 |
| S11 | Password policy: min 10 chars, checked at create + reset + update, in one shared validator | H6, H7 |
| S12 | Audit log for auth events and destructive actions (who, what, when, from where) | Forensics; required to investigate an incident |
| S13 | Explicit field allowlist on every `update` | C2 |
| S14 | Kill dynamic query keys — allowlist `sortBy`, `filter`, `fields` per entity | C8 |

**S1 + S2 are prerequisites to everything else.** If the secret stays in git history,
no amount of RBAC matters.

---

## 5. Implementation Plan

Ordered so that each phase leaves the app working and testable.

### Phase 0 — Security triage (blocking, ~1 day)
- S1, S2, S3, S7, S13, S14
- Deduplicate existing admins; add unique indexes
- **Exit:** no secrets in repo; no mass assignment; no dynamic query keys; error bodies clean

### Phase 1 — Auth hardening (~2 days)
- S4, S5, S6, S8, S10, S11, S12
- Introduce `src/auth/` module: `permissions.js`, `authorize.js`, `passwordPolicy.js`, `audit.js`
- **Exit:** login rate-limited; sessions revocable + hashed; password policy enforced

### Phase 2 — RBAC core (~4 days)
- Extend `Admin.role` enum; add `organizationId`
- Route every controller through `authorize()`; delete the duplicated paginated-list
  implementations in favour of the single generic one
- Add the role × entity × action test matrix (§4.3)
- Seed one user per role for manual QA
- **Exit:** `sales` cannot see another `sales` user's customers; `viewer` cannot write;
  `accountant` cannot delete. Verified by test, not by clicking.

### Phase 3 — Customer relation (~2 days)
- `Client.createdBy` required + server-stamped; rename `assigned` → `assignedTo`
- Backfill `createdBy` for existing clients
- Expose `assignedTo` in the UI (account-manager select on the customer form)
- **Exit:** every client has an owner; `sales` scope filters by it

### Phase 4 — Admin management UI (~2 days)
- Admins list/create/deactivate, role assignment — `owner` only
- Guard the frontend: hide nav items and actions the role can't perform.
  **Frontend gating is UX only — the server is the enforcement point.**
- **Exit:** owner can add an accountant who can log in and is correctly restricted

### Phase 5 — Customer portal (future, separate PRD)
- `CustomerUser` + `CustomerUserPassword`, `createAuthMiddleware('CustomerUser')`
- Portal route tree; queries scoped to `userId`
- **Blocked by:** Phase 2 choke point being proven by tests

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Mass-assignment fix breaks existing update flows that rely on sending whole objects | Field allowlist per entity derived from the Mongoose schema minus protected paths; integration test each update endpoint |
| `models/utils` glob auto-exposes new models as routes | Add an explicit deny-by-default entity registry; RBAC check rejects unknown entities |
| Customer portal exposes other customers' data | Never ship Phase 5 before the Phase 2 test matrix passes |
| Rotating `JWT_SECRET` logs everyone out | Expected and acceptable; announce it |
| Removing `.env` from git doesn't purge history | `git filter-repo` or accept that the secret is burned → rotate (S2) |
| `sales`-scope filtering hides data users expect to see | Seed QA users per role; document the matrix in the UI |

---

## 7. Explicitly out of scope

- Multi-tenancy billing, org provisioning, SSO/OIDC
- Field-level permissions (e.g. hide `price` from `viewer`)
- A dynamic/admin-editable permission UI
- Rewriting the React app or replacing Mongoose
- Email delivery (currently stubbed with an upgrade prompt)

---

## 8. Definition of done

1. No secrets in git history reachable from `HEAD`; `JWT_SECRET` rotated.
2. `authorize()` is the only place a query filter is constructed; grep for
   `Model.find(` in controllers returns only calls that consume an authorized filter.
3. The role × entity × action test matrix passes in CI.
4. Every `Client` has a non-null `createdBy`.
5. Login is rate-limited; sessions are hashed, expiring, and revocable.
6. A second admin user can be created, logged in, and is provably restricted.
7. `/download` is no longer anonymously readable.

---

## 9. Open questions

1. **Single-tenant or multi-tenant?** (§4.1) — blocks Phase 2. Recommended: single-tenant
   with a nullable `organizationId` reserved.
2. **Should `accountant` see all invoices or only assigned ones?** Affects the scope map.
3. **PDF sharing**: authenticated-only, or signed expiring links? Signed links are friendlier
   for sending to customers but need a token-issuing endpoint.
4. **How many real admins will there be?** If it stays at one, Phase 4 can be deferred and
   Phase 2 simplified to `owner` + `viewer`.
