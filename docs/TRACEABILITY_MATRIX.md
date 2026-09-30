# Dentiva Pro — Requirement Traceability Matrix

Status legend: ✅ implemented & tested · ⏳ in progress · ❌ not satisfied.
"Spec §" refers to the master production build specification sections.
Source paths are relative to the repository root; test paths are relative to `tests/`.
Status column is finalised during the release audit (`docs/COMPLETION_STATUS.md`).

## A. Foundation

| Req ID | Spec § | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| REQ-001 | §8,§9 | Desktop shell technology selection & rationale | Architecture | `docs/ARCHITECTURE.md`, `electron.vite.config.ts`, electron 44 | build in CI | ⏳ |
| REQ-002 | §6,§7,§89 | 100 % offline; no paid/external service | All | no HTTP client in `src/**`; CSP + request blocking in `src/main/index.ts`; audit script `scripts/audit-offline.mjs` | `tests/unit/offline-audit.test.ts` | ⏳ |
| REQ-003 | §10,§11 | SQLite schema, FKs, indexes, migrations, integrity | DB | `src/main/db/schema.ts`, `src/main/db/migrate.ts` | `tests/integration/migrations.test.ts` | ⏳ |
| REQ-004 | §125 | Exact money arithmetic (BDT) | Shared | `src/shared/money.ts` | `tests/unit/money.test.ts` | ⏳ |
| REQ-005 | §126,§127 | Date/time handling, ranges, age derivation | Shared | `src/shared/datetime.ts` | `tests/unit/datetime.test.ts` | ⏳ |
| REQ-006 | §5,§19 | Bengali Unicode end-to-end (NFC, search fold, bundled font) | Shared/UI/Print | `src/shared/bengali.ts`, `@fontsource/noto-sans-bengali` | `tests/unit/bengali.test.ts`, E2E-03 | ⏳ |
| REQ-007 | §12,§13..§134 | Full entity model per specification | DB | `src/main/db/schema.ts` | `tests/integration/schema.test.ts` | ⏳ |
| REQ-008 | §150,§151 | Project memory + checkpoints | Docs | `ARENA.md`, `docs/COMPLETION_STATUS.md` | review | ⏳ |

## B. Security & access

| Req ID | Spec § | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| REQ-010 | §14,§120 | Offline activation (no plaintext code, derived verifier, tamper check) | Activation | `src/main/activation/verifier.ts`, `service.ts` | `tests/unit/activation.test.ts`, `tests/integration/activation.test.ts` | ⏳ |
| REQ-011 | §13 | First-run setup wizard (5 steps, multi-designation dentists, admin creation) | Setup | `src/main/modules/setup/service.ts`, `src/renderer/src/features/setup/**` | E2E-01 | ⏳ |
| REQ-012 | §58 | Secure login/logout, scrypt hashing, failure throttling | Auth | `src/main/auth/password.ts`, `session/sessionManager.ts` | `tests/integration/auth.test.ts` | ⏳ |
| REQ-013 | §57 | Auto-lock (5/10/15/30/off) with IPC lockdown | Session | `src/main/session/sessionManager.ts` | `tests/integration/lock.test.ts` | ⏳ |
| REQ-014 | §54,§55 | Granular RBAC enforced in business logic | Auth/All | `src/shared/permissions.ts`, `src/main/auth/guard.ts` | `tests/integration/rbac.test.ts`, E2E-08 | ⏳ |
| REQ-015 | §56 | Append-only audit trail | Audit | `src/main/modules/audit/*`, DB triggers | `tests/integration/audit.test.ts` | ⏳ |
| REQ-016 | §71,§132,§133,§134 | Destructive-action safeguards & typed confirmations | Admin/Settings | `src/main/modules/settings/service.ts` | `tests/integration/destructive.test.ts` | ⏳ |
| REQ-017 | §84,§86 | Rotating logs without secrets/PII | Logging | `src/main/logging/logger.ts` | `tests/unit/logger.test.ts` | ⏳ |
| REQ-018 | §70 | Attachment security (allowlist, safe names, traversal block) | Files | `src/main/files/attachmentService.ts` | `tests/integration/attachments.test.ts` | ⏳ |

## C. Core practice

| Req ID | Spec § | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| REQ-020 | §15,§16,§142 | App shell: header, 272/72 px sidebar, sections, collapse animation | Shell | `src/renderer/src/components/shell/**` | `tests/renderer/shell.test.tsx` | ⏳ |
| REQ-021 | §17,§18,§19 | Design tokens, typography, premium visual system | Design | `src/renderer/src/design/**` | visual audit | ⏳ |
| REQ-022 | §20,§21,§110 | Responsive 1280→2560, states for every component | UI | all screens | `docs/COMPLETION_STATUS.md` visual audit | ⏳ |
| REQ-023 | §22,§75 | Permission-aware dashboard widgets | Dashboard | `src/main/modules/dashboard/service.ts`, `features/dashboard/**` | `tests/integration/dashboard.test.ts` | ⏳ |
| REQ-024 | §23,§24 | Patient CRUD, date-range presets, unique patient code | Patients | `src/main/modules/patients/**` | E2E-02, `tests/integration/patients.test.ts` | ⏳ |
| REQ-025 | §25,§26 | Rich patient profile with tabs + working quick actions | Patients | `features/patients/PatientProfile*.tsx` | E2E-02/03 | ⏳ |
| REQ-026 | §27,§28 | Unlimited history + clinical timeline with filters | Clinical | `src/main/modules/timeline/**`, `features/patients/Timeline.tsx` | `tests/integration/timeline.test.ts` | ⏳ |
| REQ-027 | §29,§30 | Data-driven dental chart (FDI adult + primary), configurable conditions | Clinical | `src/shared/dental.ts`, `modules/chart/**`, `features/chart/**` | E2E-03, `tests/integration/chart.test.ts` | ⏳ |
| REQ-028 | §31 | Visit module (all clinical fields, billing-independent) | Clinical | `src/main/modules/visits/**` | `tests/integration/visits.test.ts` | ⏳ |
| REQ-029 | §32 | Treatment catalog with editable prices | Clinical | `src/main/modules/treatments/**` | `tests/integration/treatments.test.ts` | ⏳ |
| REQ-030 | §33,§34,§35,§36,§37,§38 | Prescriptions: unlimited medicines, C/C-O/E-R/E, dentist header, layout | Prescriptions | `src/main/modules/prescriptions/**`, `printing/templates/prescription.ts` | E2E-03, `tests/unit/prescription-template.test.ts` | ⏳ |
| REQ-031 | §66,§67 | Appointments (statuses, views) and queue management | Scheduling | `src/main/modules/appointments/**`, `queue/**` | E2E-05 | ⏳ |
| REQ-032 | §68 | Referrals with follow-up tracking | Clinical | `src/main/modules/referrals/**` | `tests/integration/referrals.test.ts` | ⏳ |
| REQ-033 | §69 | Attachments (upload, preview, open, export, archive) | Files | `src/main/files/**`, `features/patients/Attachments.tsx` | `tests/integration/attachments.test.ts` | ⏳ |

## D. Billing, inventory, accounting

| Req ID | Spec § | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| REQ-040 | §43,§44 | Invoices (lines, discount, statuses, paper-aware printing) | Billing | `src/main/modules/invoices/**` | E2E-04, `tests/integration/invoices.test.ts` | ⏳ |
| REQ-041 | §45 | Payments with methods, allocation, references | Billing | `src/main/modules/payments/**` | E2E-04, `tests/integration/payments.test.ts` | ⏳ |
| REQ-042 | §46,§75 | Payment reporting & filters with RBAC | Billing | `src/main/modules/reports/**` | `tests/integration/reports.test.ts` | ⏳ |
| REQ-043 | §94 | Void/reversal instead of destructive financial edits | Billing | `invoices/service.ts` (void), `payments/service.ts` (void/refund) | `tests/integration/void.test.ts` | ⏳ |
| REQ-044 | §47,§48 | Inventory items, batches, ledger movements, alerts | Inventory | `src/main/modules/inventory/**` | E2E-06, `tests/integration/inventory.test.ts` | ⏳ |
| REQ-045 | §49 | Suppliers with purchase history | Inventory | `src/main/modules/suppliers/**` | `tests/integration/suppliers.test.ts` | ⏳ |
| REQ-046 | §50,§51 | Accounting income/expense + reports + exports | Accounting | `src/main/modules/accounting/**`, `reports/**` | E2E-07 | ⏳ |
| REQ-047 | §52,§53 | Staff records & user accounts | Admin | `src/main/modules/staff/**`, `users/**` | `tests/integration/users.test.ts` | ⏳ |
| REQ-048 | §54 | Roles & permission matrix incl. custom roles | Admin | `src/main/modules/roles/**`, `features/admin/RolesScreen.tsx` | `tests/integration/roles.test.ts` | ⏳ |

## E. Printing, search, notifications, backup

| Req ID | Spec § | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| REQ-050 | §39,§40,§41 | Printing engine: enumeration, paper classes, preview, reflow | Printing | `src/main/printing/**` | `tests/unit/print-templates.test.ts` | ⏳ |
| REQ-051 | §42 | Offline PDF with Unicode/Bengali fidelity | Printing | `printing/pdf.ts` | Windows E2E print test | ⏳ |
| REQ-052 | §95 | Printer profiles CRUD + test print | Printing | `printing/profiles.ts`, `features/settings/PrintingSettings.tsx` | `tests/integration/printProfiles.test.ts` | ⏳ |
| REQ-053 | §128,§129 | Print history and printer-failure recovery | Printing | `printing/history.ts` | `tests/integration/printHistory.test.ts` | ⏳ |
| REQ-054 | §64,§117 | Global search across all modules with permissions | Search | `src/main/search/**`, `features/search/CommandPalette.tsx` | E2E + `tests/integration/search.test.ts` | ⏳ |
| REQ-055 | §65,§118 | Actionable, deduplicated notification centre | Notifications | `src/main/modules/notifications/**` | `tests/integration/notifications.test.ts` | ⏳ |
| REQ-056 | §59,§60,§61,§62,§63,§130,§131 | Backup/restore: packages, validation, pre-restore backup, rollback, scheduling, multi-file | Backup | `src/main/backup/**` | E2E-09, `tests/integration/backup.test.ts` | ⏳ |
| REQ-057 | §73,§74 | Data export per module; robust CSV import with preview | Data | `src/main/modules/data/**` | `tests/integration/importExport.test.ts` | ⏳ |
| REQ-058 | §79 | Generated application icon set (16→256 px, .ico, taskbar, installer) | Branding | `scripts/generate-icons.mjs`, `build/icon.ico` | icon validation script | ⏳ |
| REQ-059 | §87,§88 | About screen + third-party notices | Admin | `features/admin/AboutScreen.tsx`, `THIRD_PARTY_NOTICES.md` | review | ⏳ |

## F. Engineering quality & release

| Req ID | Spec § | Requirement | Module | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| REQ-060 | §76,§77,§78 | Shortcuts, accessibility, single icon family | UI | `src/renderer/src/lib/shortcuts.ts`, shell components | `tests/renderer/shortcuts.test.tsx` | ⏳ |
| REQ-061 | §80,§81,§82,§83 | Animation restraint, performance, crash safety, error handling | Platform | `src/main/index.ts`, `lib/api.ts`, `components/states/**` | `tests/renderer/error-states.test.tsx` | ⏳ |
| REQ-062 | §90,§91 | No placeholder code, no dead code | Quality | `scripts/audit-placeholders.mjs` | CI step | ⏳ |
| REQ-063 | §97,§98,§99 | NSIS installer, uninstall behaviour, clean-machine validation | Release | `electron-builder.yml`, CI workflows | CI installer job + `docs/CLEAN_MACHINE_TEST.md` | ⏳ |
| REQ-064 | §100,§101,§102 | GitHub workflows, PR opened and left unmerged | Release | `.github/workflows/*.yml` | CI run + PR link | ⏳ |
| REQ-065 | §103,§104,§135,§136 | Release artifacts, checksums, notes, version identity | Release | `release.yml`, `dist/` | release verification | ⏳ |
| REQ-066 | §106..§109,§119 | Test strategy: unit/integration/E2E/negative/stress/DB audit | Tests | `tests/**`, `scripts/stress-seed.ts` | CI | ⏳ |
| REQ-067 | §139,§140,§141 | This matrix, master checklist, screen inventory | Docs | `docs/TRACEABILITY_MATRIX.md`, `docs/COMPLETION_STATUS.md` | review | ⏳ |

## G. Added commercial requirements (see PRODUCT_SPECIFICATION §5)

| Req ID | Requirement | Module | Status |
|---|---|---|---|
| ADD-01 | Patient code format `DP-YYMM-####` with per-month counters | Patients | ⏳ |
| ADD-02 | Dentist schedules driving appointment slots | Scheduling | ⏳ |
| ADD-03 | Configurable invoice numbering prefix/sequence | Billing | ⏳ |
| ADD-04 | Void/reversal semantics for invoices, payments, expenses | Billing/Accounting | ⏳ |
| ADD-05 | Aged receivables buckets (0-30/31-60/61-90/90+) | Reports | ⏳ |
| ADD-06 | Treatment revenue + dentist productivity report | Reports | ⏳ |
| ADD-07 | Stock valuation + purchase expenditure report | Inventory/Reports | ⏳ |
| ADD-08 | Permission-aware CSV/PDF export per module | Data | ⏳ |
| ADD-09 | Documented data directory & uninstall behaviour | Release | ⏳ |
| ADD-10 | Recovery mode on DB failure | Platform | ⏳ |
| ADD-11 | Printable patient clinical summary | Printing | ⏳ |
| ADD-12 | Password change/policy + forced change | Auth | ⏳ |
| ADD-13 | Idle auto-lock with lock screen | Session | ⏳ |
| ADD-14 | Dashboard personalisation (per user) | Dashboard | ⏳ |
| ADD-15 | Notification read/dismiss persistence | Notifications | ⏳ |
| ADD-16 | Maintenance tools (integrity check, vacuum, orphan scan) | Data | ⏳ |
| ADD-17 | System event log | Platform | ⏳ |
| ADD-18 | Local diagnostic bundle (no telemetry) | Support | ⏳ |
| ADD-19 | Timezone-safe timestamps (epoch ms + local date) | DB | ⏳ |
| ADD-20 | Attachment preview via safe OS open | Files | ⏳ |
| ADD-21 | Referral follow-up tracking | Clinical | ⏳ |
| ADD-22 | Queue discipline without orphan rows | Scheduling | ⏳ |
| ADD-23 | Prescription templates (favourite sets) | Prescriptions | ⏳ |
| ADD-24 | Role-based discount limits enforced in service | Billing | ⏳ |
| ADD-25 | Patient CSV import with preview + transaction | Data | ⏳ |
| ADD-26 | Accessibility/reduced-motion setting | UI | ⏳ |
