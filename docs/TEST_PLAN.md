# Dentiva Pro — Test Plan

## 1. Layers

| Layer | Runner | Scope | Location |
|---|---|---|---|
| Unit | Vitest (node) | money math, date ranges, permission evaluation, identifiers, validation schemas, activation verifier, backup manifest checksums, inventory math, reorder/expiry logic, Bengali folding | `tests/unit/**` |
| Integration | Vitest (node, real SQLite in temp dir) | repositories + services against a real database: patients, visits, chart, prescriptions, invoices/payments, inventory ledger, accounting, RBAC enforcement, audit, backup/restore round-trip, migrations | `tests/integration/**` |
| Renderer | Vitest + jsdom + Testing Library | primitives, formatters, guards, key screens' logic (validation, permission gating, empty/error states) | `tests/renderer/**` |
| E2E | Playwright `_electron` | real packaged-app workflows against a temp data dir (`DENTIVA_DATA_DIR`) | `tests/e2e/**` |
| Stress | Node script | synthetic 10k patients / 100k visits / 100k appointments / 100k invoices / 100k payments / 5k inventory rows; measures startup, list, search, dashboard, report latency | `scripts/stress-seed.ts` |

All layers run in CI; Windows runners run integration + E2E + installer validation.

## 2. Mandatory E2E workflows (§107)

1. Fresh install → activation → setup → login → dashboard.
2. Create patient → search → profile → restart app → patient persists.
3. Patient → visit → dental chart → treatment → prescription → preview → PDF.
4. Patient → invoice → partial payment → due → second payment → fully paid.
5. Appointment → arrival → queue → consultation → completed.
6. Inventory → purchase → stock in → adjustment → low-stock notification.
7. Accounting → income → expense → report.
8. User + role with restricted financial permission → access denial (IPC and route).
9. Backup → modify data → restore → original state verified.
10. Reinstall/uninstall behaviour (documented; installer-level on Windows CI).

## 3. Negative testing (§108)

invalid/duplicate patient data · duplicate patient code · invalid phone · empty required fields ·
invalid dates · negative or excessive money · payment exceeding balance · refund exceeding paid ·
invalid/negative inventory adjustment · expired stock handling · unauthorised user · wrong password ·
repeated failed logins → lockout · corrupted/invalid/wrong-version backup · missing & deleted attachment ·
printer unavailable · PDF generation failure path · locked application rejects IPC · database busy/locked ·
migration failure path → recovery mode. Each case asserts the user-facing message and that data is unchanged.

## 4. Coverage targets

Business-logic statements ≥ 80 % (services), shared math/date/permission helpers ≥ 95 %,
every IPC channel has at least one success and one failure test, every service method has a
permission test, every migration has a migration test, every template/paper combination has a
generation test. Coverage is reported in CI; thresholds enforced for `src/shared` and `src/main/modules`.

## 5. Definition of done for a module

Feature workflow works end-to-end · validation (client + service + DB constraints) · permission enforced
in service · audit events written · persisted and visible after restart · appears in search and reports ·
included in backup and restores correctly · printable where applicable · empty/loading/error states ·
tests (unit + integration + E2E where applicable) · visual review recorded.

## 6. Regression policy on failure

1. reproduce · 2. root-cause · 3. fix cause (never the assertion) · 4. add regression test ·
5. re-run affected suite · 6. re-run full suite · 7. re-audit related UI. Skipped tests require a written
justification in `docs/COMPLETION_STATUS.md` and are never used to paper over a defect.

## 7. Manual verification matrix (recorded in `docs/COMPLETION_STATUS.md`)

Responsive layouts at 6 resolutions × 5 Windows scaling factors · every screen's visual QA list ·
print output on A4/A5/thermal (including Bengali), PDF fidelity · clean-machine install/uninstall ·
high-DPI icon rendering · keyboard-only navigation pass · screen-reader label spot-check.

## 8. Performance budget

| Operation | Target (stress dataset) |
|---|---|
| Cold start to login | < 5 s |
| Patient list page (50 rows) | < 300 ms |
| Patient search (debounced) | < 400 ms |
| Dashboard aggregate load | < 900 ms |
| Save clinical record | < 250 ms |
| Invoice save + total recompute | < 300 ms |
| Report over 100k rows (paginated) | < 1.5 s |
| Backup of 100k-record database | < 60 s |

Results are recorded in `docs/COMPLETION_STATUS.md` with the measurement environment.
