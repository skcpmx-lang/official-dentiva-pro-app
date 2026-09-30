# Dentiva Pro — Completion Status

> Living document. Updated at every checkpoint. Last update: invoices, payments and refunds.
> Checkpoints are marked ✅ only when their acceptance criteria in
> `docs/ACCEPTANCE_CRITERIA.md` pass.

## Checkpoints

| # | Checkpoint | Status | Evidence |
|---|---|---|---|
| 0 | Repository & environment inspection | ✅ | empty repo (initial commit), Node 22, npm registry reachable, `gh` authenticated, Linux sandbox (no Wine/makensis → Windows artifacts come from CI) |
| 1 | Architecture Complete | ✅ | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |
| 2 | Specification & traceability plan | ✅ | `docs/PRODUCT_SPECIFICATION.md`, `docs/TRACEABILITY_MATRIX.md` |
| 3 | Database Complete | ✅ | `src/main/db/{schema,migrate,connection,seed,counters}.ts` — SCHEMA_VERSION 1, ~48 tables + `patient_financials`/`inventory_current` views, audit triggers, `*_fold` search columns; `tests/integration/database.test.ts` (4) |
| 4 | Design System Complete | ✅ | `src/renderer/src/design/{tokens,base,components}.css` (~1 970 lines): tokens, shell, tables, forms, overlays, wizard, permission matrix, clinical components |
| 5 | Core Shell Complete | ✅ | `App.tsx` hash router + bootstrap/session gates, `AppShell`, `CommandPalette` (Ctrl+K/Ctrl+L), typed IPC bridge (`src/preload`, `src/shared/ipc.ts`); `tests/unit/channels.test.ts`, `tests/renderer/rbac-ui.test.tsx` |
| 6 | Security/Activation/RBAC Complete | ✅ | scrypt password hashing, 8-fragment derived activation verifier, `session/sessionManager.ts` auto-lock with locked-channel allowlist, 67 permission codes enforced in services and in `ipc/router.ts`; `tests/renderer/activation.test.tsx`, `tests/integration/patients.test.ts` (business-layer denial) |
| 7 | Patient Complete | ✅ | `modules/patients/service.ts` + `features/patients/**`: register, archive/restore, timeline, attachments, referrals, financial roll-ups, CSV export; `tests/integration/patients.test.ts` (7) |
| 8 | Clinical Complete | ✅ | `modules/clinical/{treatments,visits,chart,prescriptions}.ts` + `ipc/handlers/clinical.ts` (32 channels) + `features/clinical/**` screens; `tests/integration/clinical.test.ts` (15), `tests/renderer/clinical-ui.test.tsx` (5) |
| 9 | Appointments & Queue Complete | ✅ | `src/main/modules/scheduling/{appointments,queue}.ts` + `ipc/handlers/scheduling.ts` (13 channels) + `features/scheduling/**` screens: day book, slot grid, status workflow with reasons, daily queue numbers, queue board with timers; `tests/integration/scheduling.test.ts` (11), `tests/renderer/scheduling-ui.test.tsx` (4) |
| 10 | Prescription Complete | ⏳ | editor, templates, medicine history and advice library are implemented and tested; print/PDF output is delivered with the printing module |
| 11 | Billing Complete | ✅ | `src/main/modules/billing/{invoices,payments}.ts` + `ipc/handlers/billing.ts` (13 channels) + `features/billing/**`: invoice register with live totals, invoice editor with bill-from-visit lines, role-limited discounts, partial payments, refunds, receipt voiding with linked reversals, typed-phrase confirmation for void/delete, dues filter; `tests/integration/billing.test.ts` (9), `tests/renderer/billing-ui.test.tsx` (6) |
| 12 | Inventory Complete | ⏳ | |
| 13 | Accounting Complete | ⏳ | |
| 14 | Administration Complete | ⏳ | |
| 15 | Backup/Restore Complete | ⏳ | |
| 16 | Printing/PDF Complete | ⏳ | |
| 17 | Notifications/Search/Reports Complete | ⏳ | |
| 18 | Security audit | ⏳ | |
| 19 | UI/UX visual audit | ⏳ | |
| 20 | Performance/stress testing | ⏳ | |
| 21 | Full regression | ⏳ | |
| 22 | Installer/clean-machine testing | ⏳ | Windows CI + manual record |
| 23 | CI/CD release build | ⏳ | |
| 24 | Final release audit | ⏳ | |

## Test results

| Suite | Total | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| Unit | 3 | 3 | 0 | 0 | `tests/unit/channels.test.ts` (registry ↔ handler parity, channel naming, clinical + scheduling + billing namespaces) |
| Integration | 46 | 46 | 0 | 0 | `database.test.ts` (4), `patients.test.ts` (7), `clinical.test.ts` (15), `scheduling.test.ts` (11), `billing.test.ts` (9) |
| Renderer | 23 | 23 | 0 | 0 | `activation.test.tsx` (4), `rbac-ui.test.tsx` (4), `clinical-ui.test.tsx` (5), `scheduling-ui.test.tsx` (4), `billing-ui.test.tsx` (6) |
| E2E | – | – | – | – | Playwright workflows run against the packaged Windows build in CI |
| Stress | – | – | – | – | dataset generators scheduled with checkpoint 20 |

## Audit log

| Audit | Date | Result |
|---|---|---|
| Dependency/license audit | – | pending |
| Security checklist | – | pending |
| No-placeholder scan | – | pending |
| Dead-code review | – | pending |
| Database relationship review | – | pending |

## Open issues

| ID | Severity | Description | Status |
|---|---|---|---|
| – | – | none yet | – |

## Next actions

1. Inventory: items, batches, movements, suppliers, low-stock and expiry alerts (next module).
2. Accounting (income/expense, day close) and reports.
3. Printing engine: paper-aware templates (A4/A5/thermal/custom), preview, printer enumeration, offline PDF — including prescription, invoice and report output.
4. Backup/restore, notifications, global search, settings/printer profiles, then the audits and the Windows release build from CI.
5. Remaining test layers: unit suites for money/datetime/Bengali/activation, the 10 named E2E workflows, negative tests and stress datasets.
