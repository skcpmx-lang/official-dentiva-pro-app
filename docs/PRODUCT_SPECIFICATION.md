# Dentiva Pro — Product Specification

**Product:** Dentiva Pro — Offline Dental Clinic / Dental Practice Management Software
**Version:** 1.0.0 (Final commercial build)
**Market:** Bangladesh · Currency BDT (৳) · Primary UI language: professional English with full Bengali Unicode support
**Vendor / Author:** Shohan Khan · helloiamshohan@gmail.com
**Platform:** Windows 10 (1903+) / Windows 11, x64, fully offline after installation

---

## 1. Product summary

Dentiva Pro is a single-machine, offline Windows desktop application for dental clinics.
It covers the complete clinic business cycle: patient registration, appointments, queue,
clinical visits, dental charting, treatments, prescriptions, invoicing, payments,
inventory, suppliers, accounting, reporting, staff/users/permissions, audit,
backup/restore and paper-aware printing (A4/A5/thermal/custom) including PDF.

Everything runs locally on SQLite. No internet connection, cloud service, CDN, telemetry
or paid API is used at any point of the clinical or business workflow.

## 2. Users and roles

| Persona | Primary workflows |
|---|---|
| Dentist | patient search → profile → visit → dental chart → treatment → prescription → print |
| Receptionist | appointment → arrival → queue → invoice → payment |
| Accountant | payments, expenses, income, reports, dues |
| Inventory manager | stock in/out, adjustments, expiry, suppliers |
| Clinic owner | dashboard, revenue/expense, staff, users, backups |
| Administrator | users, roles, permissions, settings, backup/restore, audit, destructive ops |

Roles are data-driven (Owner, Administrator, Dentist, Receptionist, Dental Assistant,
Accountant, Inventory Manager + unlimited custom roles) with granular permissions.

## 3. Scope — mandatory modules

1. **Installation / Activation / Setup Wizard** — first-run gate before the main UI.
2. **Authentication** — login, logout, auto-lock, password hashing, audit of attempts.
3. **Shell** — header (branding, clinic, clock, notifications, profile, lock), 272 px sidebar
   with collapse to 72 px, four sections (Practice / Clinical / Billing / Administration).
4. **Dashboard** — permission-aware KPI cards, queue, recent patients, upcoming appointments,
   revenue trend, payment-method split, treatment summary, outstanding invoices, low stock,
   notifications.
5. **Patients** — unlimited records, date-range presets (today/7/30/90/1 year/all/custom),
   structured demographics + clinical history, unique patient code, tags, status, archive.
6. **Patient profile** — Overview / Clinical / Appointments / Financial / Activity tabs,
   quick actions (new visit, appointment, prescription, invoice, payment, attachment,
   referral, dental chart, print summary, timeline).
7. **Clinical timeline** — chronological merged event stream with filters.
8. **Visits** — unlimited independent historical records, clinical exam, findings, teeth,
   treatment performed, plan, advice, referral, next appointment, attachments, billing link.
9. **Dental chart** — adult (FDI 18–48) and pediatric (FDI 55–85) data-driven chart with
   per-tooth condition marking and visit association.
10. **Treatment catalog** — categories, codes, default prices (editable), duration, active flag.
11. **Prescriptions** — unlimited medicines per prescription, dosage/schedule/instructions,
    structured C/C, O/E, R/E, advice + free text, dentist-specific header, print history.
12. **Appointments** — day/week/month views, statuses (scheduled → confirmed → arrived →
    in queue → in progress → completed / cancelled / no-show / rescheduled).
13. **Queue** — waiting list, call next, start, complete, skip, requeue.
14. **Invoices** — header, line items, discount, subtotal/total/paid/due, statuses,
    paper-aware printing, void with reason (no destructive deletion of financial history).
15. **Payments** — allocation to invoice, methods (Cash, Bank, Card, bKash, Nagad, Rocket,
    Upay, other wallet, Other), reference, receiver, refunds (negative allocation), history.
16. **Inventory** — items, categories, suppliers, batches, expiry, reorder thresholds,
    stock movement ledger (in, out, adjustment, damaged, expired, returned, consumed),
    low-stock/expiry alerts.
17. **Suppliers** — details + purchase history.
18. **Accounting** — income & expense entries with categories, payment methods, references;
    reports (daily/monthly income & expense, net position, method breakdown, category
    breakdown, outstanding dues, treatment revenue, purchase expenditure) with CSV/PDF export.
19. **Staff & Users** — staff records, user accounts, role assignment, activation state.
20. **Roles & permissions** — granular matrix editor + custom roles.
21. **Audit log** — immutable append-only trail, permission-protected, filterable, exportable.
22. **Backup & restore** — native folder picker, checksummed `.dentivabackup` packages,
    predefined packages (full / quick), retention, automatic schedule, pre-restore backup,
    rollback on failure, multi-file sequential restore.
23. **Notifications** — actionable, deduplicated, permission-filtered.
24. **Global search** — patients, invoices, prescriptions, appointments, treatments,
    payments, staff, suppliers, inventory, accounting.
25. **Settings** — clinic, dentists, users & security, printing, prescription, invoice,
    inventory, backup, data (export/import/archive/maintenance).
26. **About** — product, author, version, build, schema version, licenses, third-party notices.
27. **Printing subsystem** — printer enumeration, paper sizes (A4/A5/thermal/mini/custom),
    orientation, margins, scaling, copies, print profiles, preview, PDF, print history,
    printer-failure recovery.
28. **Reports** — financial, clinical and operational, all permission-aware and exportable.

## 4. Non-functional requirements

| Area | Requirement |
|---|---|
| Offline | 100 % of workflows work with networking disabled; no external endpoint in production code |
| Licensing | Only MIT/BSD/Apache-2.0/public-domain or equivalently permissive dependencies (see `THIRD_PARTY_NOTICES.md`) |
| Data volume | 10,000+ patients, 100,000+ visits/appointments/invoices/payments without artificial limits |
| Performance | p95 list/search response < 500 ms at stress volumes; startup < 5 s on a mid-range PC |
| Money | Exact integer micro-unit arithmetic (no float); BDT with ৳ and thousands separators |
| Bengali | NFC-normalised storage, bundled Noto Sans Bengali, correct render/print/PDF/backup |
| Responsive | 1280×720 → 2560×1440, Windows scaling 100/125/150/175/200 % |
| Accessibility | keyboard-first navigation, visible focus, labels, contrast, tooltips on icon buttons |
| Resilience | no silent failures; professional recovery-oriented error messages; rotating logs; crash-safe writes |
| Privacy | no telemetry, no external transmission, no patient data in logs/URLs/temp filenames |

## 5. Added requirements (commercial-completeness gaps identified during planning)

These were not explicitly enumerated in the brief but are required for a real clinic product.
They are implemented and traced in `docs/TRACEABILITY_MATRIX.md` under IDs `ADD-*`.

| ID | Added requirement | Why |
|---|---|---|
| ADD-01 | `docs/PATIENT_CODE_SPEC` — collision-proof patient code `DP-<YY><MM>-<seq>` with per-month counters and DB unique constraint | human-friendly, sortable, no collision |
| ADD-02 | Doctor schedule (per weekday opening/closing, slot duration) driving appointment slots | appointment duration alone is insufficient in practice |
| ADD-03 | Invoice numbering with configurable prefix/sequence and fiscal-year reset option | statutory book-keeping expectation |
| ADD-04 | Void/reversal semantics for invoices, payments, expenses | financial history must never be destroyed (also mandated by §94) |
| ADD-05 | Aged patient dues (0-30/31-60/61-90/90+) | required for real receivables management |
| ADD-06 | Treatment/category revenue report and dentist productivity | owner-level decision support |
| ADD-07 | Stock valuation + purchase expenditure report | inventory accounting tie-in |
| ADD-08 | Data export (CSV/PDF) per module honouring permissions | portability, audits, ownership |
| ADD-09 | Clinic-wide data directory design (`%APPDATA%\Dentiva Pro`) + documented uninstall behaviour | clean-machine testing requirement |
| ADD-10 | Application recovery mode (create empty DB / restore / open data folder) when DB cannot be opened | avoids dead-end crash on corruption |
| ADD-11 | Print/PDF of patient clinical summary | hospital referrals, patient handover |
| ADD-12 | Password change + password policy (length, optional expiry) and forced change on reset | session security completeness |
| ADD-13 | Idle auto-lock with configurable timeout and lock-screen clock | mandated §57/§58 |
| ADD-14 | Per-user "recently viewed" and dashboard personalisation | efficiency for high-frequency users |
| ADD-15 | Notification read/dismiss persistence with dedupe keys | avoids notification spam (§65) |
| ADD-16 | Maintenance tools: integrity check, vacuum, orphan/consistency scan | supports §119 database audit |
| ADD-17 | System event log for non-security operational events (backup ran, migration applied, restore completed) | diagnosis and supportability |
| ADD-18 | Telemetry-free crash reporting to local log + copyable diagnostic bundle | §83/§84 without privacy violation |
| ADD-19 | Timezone-safe local timestamps stored as ISO-8601 local + epoch millis | correct date filtering across DST/leap boundaries |
| ADD-20 | Attachment thumbnail/preview + safe external open via OS default handler | clinical usability and §69/§70 |
| ADD-21 | Referral follow-up tracking and referral report | §68 completeness |
| ADD-22 | Queue discipline: oldest-waiting first, no orphan queue rows on cancel | §67 data integrity |
| ADD-23 | Prescription templates (favourite medicine sets) | high-frequency clinical efficiency |
| ADD-24 | Discount policy limits per role (max discount %) enforced in service layer | fraud/abuse control in real clinics |
| ADD-25 | Multi-sheet CSV import for patients with preview + transactional commit | §74 |
| ADD-26 | Accessibility and reduced-motion support surfaced in Settings | §77/§80 |

## 6. Explicit non-goals

* No online sync, cloud backup, multi-branch replication or client-server mode.
* No automatic application update mechanism (single final build, per §104).
* No payment-gateway, SMS, email or mobile-app integration (methods are record categories only).
* No biometric login, no external identity provider.
* No merge semantics for restoring multiple independent databases (sequential restore only, §61).

## 7. Acceptance criteria

Canonical list in `docs/ACCEPTANCE_CRITERIA.md`; release gate in `docs/RELEASE_PLAN.md`.
