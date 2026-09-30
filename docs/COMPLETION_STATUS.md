# Dentiva Pro — Completion Status

> Living document. Updated at every checkpoint. Last update: clinical module (visits, chart, treatments, prescriptions).
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
| 9 | Appointments & Queue Complete | ⏳ | dashboard queue counters implemented; appointments module not started |
| 10 | Prescription Complete | ⏳ | editor, templates, medicine history and advice library are implemented and tested; print/PDF output is delivered with the printing module |
| 11 | Billing Complete | ⏳ | |
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
| Unit | 3 | 3 | 0 | 0 | `tests/unit/channels.test.ts` (registry ↔ handler parity, channel naming, clinical namespaces) |
| Integration | 26 | 26 | 0 | 0 | `database.test.ts` (4), `patients.test.ts` (7), `clinical.test.ts` (15) |
| Renderer | 13 | 13 | 0 | 0 | `activation.test.tsx` (4), `rbac-ui.test.tsx` (4), `clinical-ui.test.tsx` (5) |
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

1. Appointments and queue management (services, channels, screens), then billing (invoices, payments, refunds, dues).
2. Inventory/suppliers/expiry, accounting and reports.
3. Printing engine: paper-aware templates (A4/A5/thermal/custom), preview, printer enumeration, offline PDF — including prescription, invoice and report output.
4. Backup/restore, notifications, global search, settings/printer profiles, then the audits and the Windows release build from CI.
5. Remaining test layers: unit suites for money/datetime/Bengali/activation, the 10 named E2E workflows, negative tests and stress datasets.
