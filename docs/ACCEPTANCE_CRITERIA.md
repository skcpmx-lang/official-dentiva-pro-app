# Dentiva Pro — Acceptance Criteria & Release Gate

## A. Module acceptance criteria (each must hold before the module is "complete")

### A1 Activation
Plaintext code absent from repo/bundle · correct code activates · wrong code rejected with a professional
message after attempt throttling · state survives restart · tampered `license_state` returns to activation ·
all activation events audited.

### A2 Setup wizard
Five steps with per-step validation · at least one dentist with multiple designations/qualifications ·
administrator created with hashed password (scrypt) and cannot be blank/weak · practice defaults persisted ·
final confirmation required · wizard cannot be skipped by restarting or by deep-linking · login screen
appears only after successful setup.

### A3 Auth/session
Login with correct credentials · wrong password denied and audited · account lockout after repeated failures ·
logout clears session · auto-lock after configured idle period · locked app rejects every IPC channel except
unlock/logout/state · unsaved form state preserved through lock (in-memory) · password change and
forced change on reset.

### A4 RBAC & financial security
Every service method asserts a permission (unit-tested exhaustively) · a Receptionist cannot read
accounting data even by invoking IPC directly · dashboard/reports/notifications/search/exports filter by
permission · custom roles with arbitrary permission subsets work · role/permission changes take effect
without restart.

### A5 Patients
Create → validate → unique code → persist → list → profile → search → survives restart → included in backup ·
date-range presets and custom ranges correct at midnight/month/year boundaries · duplicate phone warning ·
archive preserves clinical/financial history · unlimited records and history per patient.

### A6 Clinical (visits, chart, treatments)
Multiple visits per patient never overwrite each other · each visit stores complaint/history/exam/findings/
diagnosis/teeth/treatment plan/advice/next appointment · dental chart persists per tooth with visit linkage
for both adult (FDI 11–48) and primary (51–85) dentition · treatment catalog prices editable and applied to
new lines without altering historical totals · clinical records independent from financial records.

### A7 Prescriptions
Create from profile/visit/section · unlimited medicines with all dose/timing/duration/instruction fields ·
structured C/C, O/E, R/E + free text combined · correct dentist header (never another dentist) with all
designations/qualifications · age snapshot preserved · print/preview/PDF on A4/A5/thermal · printed count and
history tracked · no overwrite of previous prescriptions.

### A8 Appointments & queue
Status lifecycle enforced with events · day/week/month views correct · reschedule keeps history · queue
ordering and transitions (waiting→called→in progress→completed/skipped) never orphan appointments/visits ·
waiting durations accurate.

### A9 Billing & payments
Invoice totals exact (integer micro-units) with line discounts and invoice discount within role limits ·
statuses derived (unpaid/partial/paid) · payments allocate to invoices in a transaction · overpayment blocked ·
partial → full payment flow verified · refunds recorded as negative allocations with reason · void preserves
history and recomputes balances · receipts/receipt numbers unique · financial reports reconcile to the ledger.

### A10 Inventory
Item CRUD · purchase/stock-in creates batch + movement · out/adjustment/damage/expiry/return/consume movements ·
on-hand derived from the ledger (no drift) · low stock and expiry alerts fire at configured thresholds ·
suppliers with purchase history · stock valuation report ties to movements.

### A11 Accounting
Income/expense entries with category/method/reference/party · categories configurable · void instead of delete ·
daily/monthly reports, net position, method breakdown, category breakdown, outstanding dues, treatment revenue,
purchase expenditure · export CSV/PDF · permissions enforced.

### A12 Admin
Staff CRUD with sensitive fields masked · users CRUD with role assignment and password reset · permission
matrix editor with custom roles · audit log immutable, filterable, exportable · notification centre actionable ·
settings persist and take effect immediately.

### A13 Backup/restore
Manual quick/full backup with manifest, counts and SHA-256 · native folder picker · automatic schedule
(7/15/30 days/off) with retention and last/next run · validation detects corrupt/invalid/wrong-version/incomplete
packages · restore performs pre-restore backup, closes and replaces the DB, verifies integrity and consistency,
rolls back on failure · multi-file selection restores sequentially · backups survive app restart and reinstall.

### A14 Printing & PDF
Preview identical to printed output · printer enumeration with unavailable printers disabled and explained ·
A4/A5/thermal/mini/custom reflow (no shrink-to-fit) · Bengali renders and prints · PDF preserves layout and
Unicode · printer failure preserves the document with retry/Save-as-PDF · print history recorded · printing never
mutates clinical data.

### A15 UX/platform
All 46 screens implemented against real data with empty/loading/error/permission-denied states · responsive
1280→2560 px and 100–200 % scaling · scrolling audit passes (no clipped content) · modals fit and scroll ·
tables never hide row actions · keyboard shortcuts work and are documented · visible focus and accessible labels ·
single coherent icon family.

### A16 Quality gates
Type checking, linting, unit, integration, renderer and E2E suites all green · no `TODO/FIXME/placeholder/
coming soon` in production paths · no dead routes/components/exports · no plaintext secrets · no external
endpoint · dependency + license audit recorded · no unresolved critical defect.

## B. Release gate (all must be TRUE)

| # | Gate | Evidence |
|---|---|---|
| 1 | `npm run verify` green (typecheck + lint + unit + integration + renderer) | CI log |
| 2 | Build succeeds on Windows runner | CI log |
| 3 | E2E workflows green on Windows | CI log |
| 4 | Installer produced by CI (not a manual zipped folder) | artifact |
| 5 | Installer installs, activates, sets up, operates on a clean machine | `docs/CLEAN_MACHINE_TEST.md` |
| 6 | Uninstall behaves as documented (data preserved unless explicitly removed) | `docs/CLEAN_MACHINE_TEST.md` |
| 7 | Backup → restore round-trip verified against the built artifact | E2E + manual log |
| 8 | Printing/PDF verified for A4/A5/thermal incl. Bengali | `docs/PRINTING_VERIFICATION.md` |
| 9 | Security audit checklist complete | `docs/SECURITY_MODEL.md` §8 |
| 10 | Dependency/license audit complete | `THIRD_PARTY_NOTICES.md` |
| 11 | Traceability matrix complete (no unassigned requirement) | `docs/TRACEABILITY_MATRIX.md` |
| 12 | Release artifacts (installer, SHA-256, release notes, metadata) published | GitHub Release / `dist/` |
| 13 | No `TODO`/placeholder in production source | audit script output |
| 14 | PR opened and left unmerged for the owner | PR link |

If any gate is FALSE → no release.
