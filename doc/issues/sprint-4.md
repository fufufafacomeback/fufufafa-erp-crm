Tracking issue for **Sprint 4 — Admin management UI**, from `doc/SPRINT-PLAN-rbac.md`.

## Tasks

- [ ] **S4-1** Admin list/create/deactivate endpoints — `owner` only
- [ ] **S4-2** Admin management page
- [ ] **S4-3** Frontend permission gating — hide nav + actions per role
- [ ] **S4-4** Document the role matrix in the UI (help text)

## Acceptance

Owner adds an accountant; that user logs in and is provably restricted.

## Warning

Frontend gating is **UX only**. The server remains the enforcement point — hiding a button is not authorization.
