# Dentiva Pro — Database Schema (SQLite, schema v1)

Engine: SQLite 3 (bundled with Electron via `better-sqlite3`).
Pragmas: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `temp_store=MEMORY`.

Conventions
* `id INTEGER PRIMARY KEY AUTOINCREMENT` unless noted; FKs declared with explicit `ON DELETE`/`ON UPDATE`.
* Money: **integer micro-units** (`µ`), 1 ৳ = 10 000 µ. Percentages: integer basis points (bp).
* Timestamps: `INTEGER` epoch **milliseconds** (UTC) for ordering + `TEXT` `YYYY-MM-DD` local date
  columns where grouping/filtering by local day is required (`entry_date`, `visit_date`, `issue_date`…).
* Soft delete: `is_deleted INTEGER DEFAULT 0`, `deleted_at`, `deleted_by` on historical/business entities.
* Bilingual text stored NFC-normalised with `*_fold` (lower-cased, zero-width stripped) search columns.
* Ledger-like tables (`payments`, `inventory_movements`, `accounting_entries`, `audit_log`) are append-only;
  corrections are voids/reversals, never destructive updates of historical values.
* `PRAGMA user_version` mirrors `SCHEMA_VERSION`; `schema_migrations(version, applied_at, description)` is the
  authoritative migration log.

## Tables

### Configuration
| Table | Key columns | Notes |
|---|---|---|
| `settings` | `key PK, value TEXT, updated_at` | typed access through `settingsService` |
| `clinic` | single row `id=1`: name, name_bn, logo_path, address, address_bn, phone, alt_phone, email, website, opening_time, closing_time, weekly_closed_days(json), footer_message, invoice_footer, prescription_footer, emergency_instruction | setup wizard writes here |
| `license_state` | `id=1`: activated_at, verifier_fingerprint, machine_id, attempts, last_attempt_at, activated_by | activation gate |
| `counters` | `name, scope, value` PK(name,scope) | patient/invoice/rx/receipt/visit/purchase/entry numbers |
| `print_profiles` | id, name, document_type, printer_name, paper_class(a4/a5/thermal/custom), custom_width_mm, custom_height_mm, orientation, margin_top/right/bottom/left_mm, scale_bp, copies, thermal_width_mm, is_default, is_active | one default per document type |

### People & access
| Table | Key columns | Notes |
|---|---|---|
| `dentists` | id, full_name, full_name_bn, photo_path, phone, email, registration_no, signature_label, color, is_active, sort_order, is_deleted | |
| `dentist_designations` / `dentist_qualifications` | id, dentist_id FK CASCADE, title, sort_order | **multi-entry** by design |
| `dentist_schedules` | id, dentist_id FK CASCADE, weekday(0-6), start_time, end_time, slot_minutes, is_active, UNIQUE(dentist_id,weekday) | appointment slots |
| `staff` | id, full_name, dob, gender, address, phone, emergency_contact, blood_group, national_id, photo_path, designation, department, salary_micro, joining_date, employment_status, notes, is_deleted | sensitive fields not listed in tables |
| `roles` | id, name UNIQUE, code UNIQUE, description, is_system, is_active | custom roles supported |
| `permissions` | code PK, module, label, description | catalog seeded from code |
| `role_permissions` | role_id FK CASCADE, permission_code FK CASCADE, PK(role_id, permission_code) | |
| `users` | id, username UNIQUE, password_hash, password_algo, password_updated_at, must_change_password, staff_id FK SET NULL, role_id FK RESTRICT, full_name, is_active, last_login_at, failed_attempts, locked_until | scrypt hash, never plaintext |

### Patients & clinical
| Table | Key columns | Notes |
|---|---|---|
| `patients` | id, code UNIQUE, full_name, full_name_fold, full_name_bn, dob, age_years, gender, blood_group, phone, alt_phone, emergency_phone, address, address_bn, city, occupation, marital_status, chief_complaint, past_history, allergies, medical_history, dental_history, current_medications, notes, tags, status(active/archived/deceased), registration_date, is_deleted... | unlimited rows; `age_years` is an override for unknown DOB |
| `patient_attachments` | id, patient_id FK CASCADE, file_name, stored_path(relative), mime, size_bytes, kind, description, attachment_date, sha256, uploaded_by, is_deleted | files live under `<data>/attachments/<patientId>/` |
| `appointments` | id, patient_id FK CASCADE, dentist_id FK RESTRICT, scheduled_at(ms), duration_min, reason, status, notes, rescheduled_from, cancelled_reason, is_deleted | |
| `appointment_events` | id, appointment_id FK CASCADE, from_status, to_status, at, by_user_id, note | status audit |
| `queue_entries` | id, patient_id FK CASCADE, dentist_id, appointment_id FK SET NULL, visit_id FK SET NULL, queue_no, status, priority, joined_at/called_at/started_at/completed_at, note | hard-deletable transient rows |
| `visits` | id, visit_no, patient_id FK CASCADE, dentist_id FK RESTRICT, appointment_id, visit_date, chief_complaint, history, examination, diagnosis, findings_summary, advice, treatment_plan, notes, next_appointment_at, status, is_deleted | never overwritten: one row per encounter |
| `clinical_findings` | id, code UNIQUE, name, name_bn, category(cc/oe/finding/advice), applies_tooth, is_active, sort_order, is_system | configurable vocabulary |
| `visit_findings` | id, visit_id FK CASCADE, finding_id FK SET NULL, tooth_code, notes, severity | |
| `dental_chart_entries` | id, patient_id FK CASCADE, visit_id FK SET NULL, tooth_code, dentition(adult/primary), condition_code, treatment_code, status(active/resolved/historic), note, recorded_at, recorded_by, resolved_at | data-driven chart, FDI numbering |
| `treatments` | id, code UNIQUE, name, name_bn, category, description, default_price_micro, duration_min, is_active, notes | catalog, prices editable |
| `visit_treatments` | id, visit_id FK CASCADE, treatment_id FK SET NULL, treatment_name, tooth_codes(json), quantity, unit_price_micro, discount_micro, total_micro, status(planned/performed), notes | |
| `prescriptions` | id, rx_no UNIQUE, patient_id FK CASCADE, dentist_id FK RESTRICT, visit_id FK SET NULL, prescription_date, age_snapshot, cc_text, oe_text, re_text, advice, diagnosis, follow_up_date, notes, printed_count, last_printed_at, is_deleted | `age_snapshot` preserves age at the time |
| `prescription_medicines` | id, prescription_id FK CASCADE, sort_order, medicine_name, form, strength, unit, dose_morning/afternoon/night, timing, frequency, duration_days, duration_text, quantity, prn, instructions | one row per medicine, unlimited |
| `prescription_templates` / `prescription_template_medicines` | same medicine shape | favourite sets (ADD-23) |
| `referrals` | id, patient_id FK CASCADE, visit_id FK SET NULL, referred_by_dentist_id, external_doctor, specialty, organization, address, phone, reason, notes, referral_date, follow_up_status, follow_up_date, is_deleted | |

### Billing & finance
| Table | Key columns | Notes |
|---|---|---|
| `invoices` | id, invoice_no UNIQUE, patient_id FK CASCADE, visit_id FK SET NULL, appointment_id, issue_date, due_date, status(unpaid/partial/paid/void), subtotal_micro, discount_micro, discount_percent_bp, total_micro, paid_micro, due_micro, refunded_micro, notes, void_reason, voided_at, voided_by, printed_count, last_printed_at, is_deleted | totals recomputed in transactions; void keeps history |
| `invoice_lines` | id, invoice_id FK CASCADE, sort_order, treatment_id FK SET NULL, description, tooth_codes, quantity, unit_price_micro, discount_micro, line_total_micro, notes | |
| `payments` | id, receipt_no UNIQUE, patient_id FK CASCADE, invoice_id FK SET NULL, kind(payment/refund), amount_micro, method, reference, paid_at, received_by_user_id, notes, reverses_payment_id, status(active/void), void_reason/voided_at/voided_by | allocation ledger; refunds are negative |
| `suppliers` | id, name, contact_person, phone, alt_phone, email, address, notes, is_active, is_deleted | |
| `inventory_items` | id, code UNIQUE, name, category, unit, supplier_id FK SET NULL, purchase_price_micro, selling_price_micro, reorder_level, expiry_tracking, location, notes, is_active, is_deleted | |
| `inventory_batches` | id, item_id FK CASCADE, batch_no, expiry_date, quantity, unit_cost_micro, supplier_id, received_at | expiry alerts |
| `inventory_movements` | id, item_id FK CASCADE, batch_id FK SET NULL, movement_type(purchase/in/out/adjustment/damaged/expired/returned/consumed/sale), quantity(signed), unit_cost_micro, reason, reference, at, by_user_id | append-only ledger |
| `purchases` / `purchase_lines` | purchase_no UNIQUE, supplier_id, purchase_date, total_micro, paid_micro, status / item_id, batch_no, expiry_date, quantity, unit_cost_micro, line_total_micro | stock-in source |
| `expense_categories` | id, name UNIQUE, kind(expense/income), is_system, is_active | configurable |
| `accounting_entries` | id, entry_no UNIQUE, kind(income/expense), category_id FK SET NULL, category_name, entry_date, amount_micro, method, reference, party, description, status(active/void), void_reason | manual income/expense |

`inventory_items.quantity_on_hand` is **derived** (sum of movements) and exposed via the
`inventory_current` view; no denormalised counter exists, so stock can never drift from its ledger.

### Operations
| Table | Key columns | Notes |
|---|---|---|
| `notifications` | id, dedupe_key UNIQUE, type, severity, title, message, entity_type, entity_id, action_route, requires_permission, created_at, is_read, read_at, is_dismissed, dismissed_at, expires_at | derived + persisted read state |
| `audit_log` | id, at, user_id, username, action, module, entity_type, entity_id, summary, detail_json, result(success/failure), session_id | append-only; no update/delete API |
| `system_events` | id, at, level, source, code, message, detail_json | non-security operational events |
| `print_history` | id, document_type, record_id, record_no, patient_id, user_id, printer_name, paper_class, copies, result, error, printed_at | printing never mutates clinical data |
| `backups` | id, file_name, file_path, kind(full/quick/pre_restore/auto), size_bytes, checksum, schema_version, app_version, created_at, created_by, verified, includes_attachments, patient_count, note | |
| `restore_history` | id, file_name, started_at, finished_at, result, message, pre_restore_backup_id | |
| `saved_searches` | id, user_id FK CASCADE, module, name, query_json | |
| `user_preferences` | user_id FK CASCADE, key, value, PK(user_id,key) | dashboard layout, accent, reduced motion |
| `login_attempts` | id, username, at, success, reason, machine | throttling + security audit |

## Views

```sql
CREATE VIEW patient_financials AS
SELECT p.id AS patient_id,
       COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.total_micro END),0) AS invoiced_micro,
       COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.paid_micro  END),0) AS paid_micro,
       COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.due_micro   END),0) AS due_micro
FROM patients p LEFT JOIN invoices i ON i.patient_id = p.id AND i.is_deleted = 0
GROUP BY p.id;

CREATE VIEW inventory_current AS
SELECT i.*, COALESCE(SUM(m.quantity),0) AS quantity_on_hand,
       COALESCE(SUM(m.quantity) * i.purchase_price_micro,0) AS stock_value_micro
FROM inventory_items i LEFT JOIN inventory_movements m ON m.item_id = i.id
WHERE i.is_deleted = 0 GROUP BY i.id;
```

## Indexes (hot paths)

`patients(code)` UNIQUE, `(full_name_fold)`, `(phone)`, `(registration_date, id)`, `(status, is_deleted)`,
`(dob)`; `appointments(scheduled_at, status)`, `(patient_id)`, `(dentist_id, scheduled_at)`;
`visits(patient_id, visit_date)`; `dental_chart_entries(patient_id, status)`, `(visit_id)`;
`prescriptions(patient_id, prescription_date)`, `(rx_no)`; `prescription_medicines(prescription_id)`;
`invoices(invoice_no)` UNIQUE, `(patient_id, status)`, `(issue_date)`, `(status, due_micro)`;
`invoice_lines(invoice_id)`; `payments(invoice_id)`, `(patient_id)`, `(paid_at)`, `(method, paid_at)`;
`inventory_items(code)` UNIQUE, `(name)`, `(category)`; `inventory_movements(item_id, at)`, `(at)`;
`inventory_batches(item_id, expiry_date)`; `accounting_entries(entry_date, kind)`, `(category_id)`;
`audit_log(at)`, `(module, entity_type, entity_id)`, `(user_id)`; `notifications(dedupe_key)` UNIQUE,
`(is_read, is_dismissed, severity)`.

## Referential integrity rules

* Deleting a patient is **soft** (`is_deleted=1`, `status='archived'`) and never cascades into clinical or
  financial history; children keep their FK.
* `invoice_lines`, `prescription_medicines`, `visit_treatments`, `visit_findings`, `dental_chart_entries`,
  `dentist_*` details, `role_permissions`, `appointment_events`, `purchase_lines` cascade from their parent
  because they are **owned components**, not independent records.
* `payments.invoice_id` uses `ON DELETE SET NULL`; invoices are never hard-deleted (void instead), so
  payments remain attached to live documents.
* `users.role_id` is `RESTRICT`: a role in use cannot be deleted, only deactivated.
* `treatments`, `expense_categories`, `clinical_findings`, `suppliers`, `inventory_items` referenced by
  history are never deleted; they are deactivated (`is_active=0`) or soft-deleted.
* Every business transaction runs inside `db.transaction(...)`; failures roll back atomically.

## Migration strategy

`schema_migrations(version, applied_at, description)` + `PRAGMA user_version`.
Migrations are ordered functions `[1]: (db) => DDL…`. Before applying a migration that increases the
version, an automatic pre-migration backup is written to `<data>/backups/`. Migration runs inside a
transaction; on failure the app starts in Recovery Mode with the restore path offered.

## Seed data (first run)

Permissions catalog, 7 base roles with default permission sets, clinic defaults (BDT, `dd/MM/yyyy`,
12-hour time, 20-minute appointments), expense/income categories, treatment catalog starter list
(configurable, editable prices, no region-locked prices), clinical findings/CC/OE/advice vocabulary,
print profiles (A4/A5/thermal per document type), notification thresholds.

## FDI tooth numbering (documented convention)

| Dentition | Quadrants | Codes |
|---|---|---|
| Permanent (adult) | 1 UR, 2 UL, 3 LL, 4 LR | 11–18, 21–28, 31–38, 41–48 (incl. 18/28/38/48 third molars) |
| Primary (pediatric) | 5 UR, 6 UL, 7 LL, 8 LR | 51–55, 61–65, 71–75, 81–85 |

Chart state is stored per `(patient, tooth_code)` in `dental_chart_entries` with condition code, optional
treatment code, status and visit linkage; the UI renders both arches from the same table.
