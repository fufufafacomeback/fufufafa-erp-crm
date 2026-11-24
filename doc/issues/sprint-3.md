Tracking issue for **Sprint 3 — Customer ↔ Admin relation**, from `doc/SPRINT-PLAN-rbac.md`.

## Tasks

- [ ] **S3-1** `Client.createdBy` required, server-stamped (ignore client input)
- [ ] **S3-2** Rename `assigned` → `assignedTo` (indexed)
- [ ] **S3-3** Backfill `createdBy` on existing clients
- [ ] **S3-4** `assignedTo` select on the customer form
- [ ] **S3-5** `sales` scope filters by `createdBy` / `assignedTo`

## Acceptance

No `Client` with null `createdBy`; `sales` scope proven by test.

## Data note

The dev database currently has **6 clients with no `createdBy`** (verified via mongosh). `createdBy` exists in the schema but `clientController` never populates it — the relation is decorative today. S3-3 has real work to do.
