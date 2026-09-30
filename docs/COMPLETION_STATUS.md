# Dentiva Pro — Completion Status

> Living document. Updated at every checkpoint. Last update: notifications, global search and the remaining settings screens (checkpoint 17).
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
| 10 | Prescription Complete | ✅ | Editor, templates, medicine history and advice library in `modules/clinical/prescriptions.ts` + `features/clinical/{PrescriptionListScreen,PrescriptionScreen}.tsx`; the Rx sheet is rendered by the printing engine (C / C-O / E-R / E header, dentist identity with designations and registration number, medicine table with written doses, advice) and printed from the prescription screen; `tests/integration/clinical.test.ts` (15), `tests/renderer/clinical-ui.test.tsx` (5), `tests/integration/printing.test.ts` |
| 11 | Billing Complete | ✅ | `src/main/modules/billing/{invoices,payments}.ts` + `ipc/handlers/billing.ts` (13 channels) + `features/billing/**`: invoice register with live totals, invoice editor with bill-from-visit lines, role-limited discounts, partial payments, refunds, receipt voiding with linked reversals, typed-phrase confirmation for void/delete, dues filter; `tests/integration/billing.test.ts` (9), `tests/renderer/billing-ui.test.tsx` (6) |
| 12 | Inventory Complete | ✅ | `src/main/modules/inventory/{items,movements,purchases,suppliers}.ts` + `ipc/handlers/inventory.ts` (20 channels) + `features/inventory/**`: append-only stock ledger with reversals, batch/expiry tracking with first-expiry-first-out issuing, low-stock and expiry alerts, suppliers with purchase history and dues, purchase receipts that write batches and movements in one transaction, CSV exports; `tests/integration/inventory.test.ts` (11), `tests/renderer/inventory-ui.test.tsx` (5) |
| 13 | Accounting Complete | ✅ | `src/main/modules/accounting/{entries,reports}.ts` + `ipc/handlers/accounting.ts` (16 channels) + `features/accounting/AccountingScreen.tsx`, `features/reports/ReportsScreen.tsx`: categorised ledger (system categories protected, duplicates rejected case-insensitively), income/expense entries with void-and-reason, daily close recorded against the counted drawer with variance and reopen-with-reason (a closed day refuses entry changes), 10 report keys returning raw typed rows with matching CSV export; `tests/integration/accounting.test.ts` (6), `tests/renderer/accounting-ui.test.tsx` (9) |
| 14 | Administration Complete | ✅ | `src/main/modules/{staff,users,roles}/service.ts` + `ipc/handlers/practice.ts` (staff 5, users 7, roles 4 channels) + `features/settings/{StaffScreen,UsersScreen,RolesScreen}.tsx`: employment register with photo and archive-with-reason (archiving is refused while a login is linked), account creation with scrypt hashes and the clinic password policy, reset/unlock/login history, last-active-owner protection, self-deactivation guard, typed-username deletion, custom roles with the full permission matrix (built-in identifiers frozen, in-use roles protected); `tests/integration/{staff,users,roles}.test.ts` (22), `tests/renderer/staff-ui.test.tsx` (4) |
| 15 | Backup/Restore Complete | ✅ | `src/main/backup/{package,service}.ts` + `ipc/handlers/backup.ts` (13 channels) + `features/settings/BackupScreen.tsx`: `.dentivabackup` zip packages with a manifest, per-payload SHA-256 and a combined attachment hash; creation through SQLite `VACUUM INTO` so the clinic keeps working; quick (database only) / full (with attachments) / scheduled / pre-restore / pre-migration kinds; retention that prunes only automatic packages; a restore that validates the package, verifies the schema version and the staged database (quick_check, relationships, row counts), takes a mandatory pre-restore safety copy, replaces the database and the attachment archive, reopens, re-verifies and rolls back to the previous data when anything fails; interrupted restores are closed out on the next start; the safety copy is re-registered in the restored database so it stays visible; `tests/integration/backup.test.ts` (9), `tests/renderer/backup-ui.test.tsx` (3) |
| 16 | Printing/PDF Complete | ✅ | `src/main/printing/{fonts,templates,documents,profiles,jobs}.ts` + `ipc/handlers/printing.ts` (13 channels) + `features/printing/{PrintDialog,PrintHistoryScreen}.tsx`, `features/settings/PrintingScreen.tsx`: one HTML engine for preview/print/PDF with the bundled Inter + Noto Sans Bengali faces embedded (paper-aware a4/a5/thermal 58|80/mini/custom layouts), printer enumeration and test page, profiles with a single default per document type, every attempt in the print history, and a refused printer never loses the document (payload kept under `dataDir/print-jobs`, retention 40, retry or Save-as-PDF); print surfaces on the prescription, invoice, payment receipt, appointment slip, patient profile and reports screens; `docs/PRINTING_VERIFICATION.md` separates what is verified here from what the Windows runner must verify; `tests/integration/printing.test.ts` (4), `tests/renderer/{printing-ui,printing-settings,printing-surfaces}.test.tsx` (7) |
| 17 | Notifications/Search/Reports Complete | ✅ | `src/main/modules/notifications/service.ts` (six derived alert types — low/expiring/expired stock, overdue invoices, missed appointments, backup due — deduplicated on a stable `dedupe_key` so read and dismissed state survives a rebuild, retired when the condition clears, and filtered by the permission each alert requires), `src/main/search/service.ts` (one `search.global` call fanning out to eleven module queries, each skipped when the operator lacks it and failing independently), `ipc/handlers/notifications.ts` (6 channels) + `shared/contracts/{notifications,search}.ts`, and the renderer: `components/shell/NotificationBell.tsx` (unread badge, minute poll and `notifications:changed` push), `features/notifications/NotificationsScreen.tsx` (live/unread/needs-attention/dismissed views, restore, mark all read) and a `CommandPalette` that offers actions for an empty box and runs the clinic-wide search once something is typed, grouped per module and keyboard navigable; deep links land on filtered screens through `?date=` and `?search=`; `tests/integration/notifications.test.ts` (5), `tests/integration/search.test.ts` (3), `tests/renderer/{notifications-ui,search-ui}.test.tsx` (6) |
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
| Unit | 3 | 3 | 0 | 0 | `tests/unit/channels.test.ts` (registry ↔ handler parity, channel naming, clinical + scheduling + billing + inventory namespaces) |
| Integration | 106 | 106 | 0 | 0 | `database.test.ts` (4), `patients.test.ts` (7), `clinical.test.ts` (15), `scheduling.test.ts` (11), `billing.test.ts` (9), `inventory.test.ts` (11), `accounting.test.ts` (6), `staff.test.ts` (6), `users.test.ts` (9), `roles.test.ts` (7), `printing.test.ts` (4), `backup.test.ts` (9), `notifications.test.ts` (5), `search.test.ts` (3) |
| Renderer | 57 | 57 | 0 | 0 | `activation.test.tsx` (4), `rbac-ui.test.tsx` (4), `clinical-ui.test.tsx` (5), `scheduling-ui.test.tsx` (4), `billing-ui.test.tsx` (6), `inventory-ui.test.tsx` (5), `accounting-ui.test.tsx` (9), `staff-ui.test.tsx` (4), `printing-ui.test.tsx` (2), `printing-settings.test.tsx` (2), `printing-surfaces.test.tsx` (3), `backup-ui.test.tsx` (3), `notifications-ui.test.tsx` (3), `search-ui.test.tsx` (3) |
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
| ISSUE-001 | Low | `resolveProfileFor(…, profileId)` loads the profile through `getPrintProfile`, which requires `printing.configure`; a print-only user who explicitly picks a profile could be refused. The print dialog only sends `profileId` when the operator chooses one, so default printing is unaffected. | open — decide whether to relax the lookup to `printing.print` with a read-only helper |

## Next actions

1. Remaining settings screens and notification preferences polish (checkpoint 17 leftovers), the Recovery Mode channel in `shared/contracts/system.ts` and a scheduler guard test for `SYSTEM_ACTOR`.
2. Remaining test layers: unit suites for money/datetime/Bengali/activation, the 10 named E2E workflows, negative tests and stress datasets.
3. Repository infrastructure that package.json already references but that does not exist yet: `.github/workflows` (CI, Windows E2E, release), `electron-builder.yml`, `scripts/**` (icons, audits, stress seed, checksums) and `LICENSE.txt`.
4. Audits and the Windows release build from CI (checkpoints 18-24).
