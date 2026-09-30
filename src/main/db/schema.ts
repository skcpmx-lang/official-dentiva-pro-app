/**
 * Schema v1 — full DDL for the Dentiva Pro database.
 *
 * Conventions (see docs/DATABASE_SCHEMA.md):
 *  · money is stored as INTEGER micro-Taka (1 ৳ = 10 000 µ)
 *  · timestamps are INTEGER epoch milliseconds; local working dates are TEXT `YYYY-MM-DD`
 *  · business/clinical/financial entities are soft deleted (`is_deleted`), ledgers are append-only
 *  · every searchable text column has a `*_fold` companion produced by `foldForSearch()`
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_V1_SQL = /* sql */ `
------------------------------------------------------------------------------
-- System / configuration
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,
  description  TEXT    NOT NULL,
  applied_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  INTEGER
);

CREATE TABLE IF NOT EXISTS clinic (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  name                  TEXT NOT NULL,
  name_bn               TEXT,
  logo_path             TEXT,
  address               TEXT,
  address_bn            TEXT,
  phone                 TEXT,
  alt_phone             TEXT,
  email                 TEXT,
  website               TEXT,
  opening_time          TEXT,
  closing_time          TEXT,
  weekly_closed_days    TEXT DEFAULT '[]',
  footer_message        TEXT,
  invoice_footer        TEXT,
  prescription_footer   TEXT,
  emergency_instruction TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS license_state (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  activated_at         INTEGER,
  verifier_fingerprint TEXT,
  machine_id           TEXT,
  activated_by         TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_attempt_at      INTEGER,
  is_valid             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS counters (
  name    TEXT NOT NULL,
  scope   TEXT NOT NULL,
  value   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, scope)
);

CREATE TABLE IF NOT EXISTS print_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  document_type    TEXT NOT NULL,
  printer_name     TEXT,
  paper_class      TEXT NOT NULL DEFAULT 'a4',
  custom_width_mm  INTEGER,
  custom_height_mm INTEGER,
  orientation      TEXT NOT NULL DEFAULT 'portrait',
  margin_top_mm    REAL NOT NULL DEFAULT 12,
  margin_right_mm  REAL NOT NULL DEFAULT 12,
  margin_bottom_mm REAL NOT NULL DEFAULT 12,
  margin_left_mm   REAL NOT NULL DEFAULT 12,
  scale_bp         INTEGER NOT NULL DEFAULT 10000,
  copies           INTEGER NOT NULL DEFAULT 1,
  thermal_width_mm INTEGER DEFAULT 80,
  is_default       INTEGER NOT NULL DEFAULT 0,
  is_active        INTEGER NOT NULL DEFAULT 1,
  is_deleted       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_print_profiles_doc ON print_profiles(document_type, is_default, is_active);

------------------------------------------------------------------------------
-- People & access control
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dentists (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name        TEXT NOT NULL,
  full_name_bn     TEXT,
  photo_path       TEXT,
  phone            TEXT,
  email            TEXT,
  registration_no  TEXT,
  signature_label  TEXT,
  color            TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_deleted       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dentist_designations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id  INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dentist_designations ON dentist_designations(dentist_id, sort_order);

CREATE TABLE IF NOT EXISTS dentist_qualifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id  INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title       TEXT NOT NULL,
  institution TEXT,
  year        INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dentist_qualifications ON dentist_qualifications(dentist_id, sort_order);

CREATE TABLE IF NOT EXISTS dentist_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dentist_id   INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE ON UPDATE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 20,
  is_active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (dentist_id, weekday, start_time)
);

CREATE TABLE IF NOT EXISTS staff (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name         TEXT NOT NULL,
  full_name_bn      TEXT,
  dob               TEXT,
  gender            TEXT,
  address           TEXT,
  phone             TEXT,
  emergency_contact TEXT,
  blood_group       TEXT,
  national_id       TEXT,
  photo_path        TEXT,
  designation       TEXT,
  department        TEXT,
  salary_micro      INTEGER,
  joining_date      TEXT,
  employment_status TEXT NOT NULL DEFAULT 'active',
  notes             TEXT,
  is_deleted        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(employment_status, is_deleted);

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  max_discount_bp INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  password_algo        TEXT NOT NULL DEFAULT 'scrypt',
  password_updated_at  INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  staff_id             INTEGER REFERENCES staff(id) ON DELETE SET NULL ON UPDATE CASCADE,
  dentist_id           INTEGER REFERENCES dentists(id) ON DELETE SET NULL ON UPDATE CASCADE,
  role_id              INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  last_login_at        INTEGER,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  is_deleted           INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id, is_active);

CREATE TABLE IF NOT EXISTS login_attempts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL,
  at        INTEGER NOT NULL,
  success   INTEGER NOT NULL,
  reason    TEXT,
  machine   TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(username, at);

------------------------------------------------------------------------------
-- Patients
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  full_name           TEXT NOT NULL,
  full_name_fold      TEXT NOT NULL,
  full_name_bn        TEXT,
  dob                 TEXT,
  age_years           INTEGER,
  gender              TEXT NOT NULL DEFAULT 'unspecified',
  blood_group         TEXT,
  phone               TEXT,
  phone_fold          TEXT,
  alt_phone           TEXT,
  emergency_phone     TEXT,
  address             TEXT,
  address_bn          TEXT,
  city                TEXT,
  occupation          TEXT,
  marital_status      TEXT,
  chief_complaint     TEXT,
  past_history        TEXT,
  allergies           TEXT,
  medical_history     TEXT,
  dental_history      TEXT,
  current_medications TEXT,
  notes               TEXT,
  tags                TEXT DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'active',
  registration_date   TEXT NOT NULL,
  created_by          INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  is_deleted          INTEGER NOT NULL DEFAULT 0,
  deleted_at          INTEGER,
  deleted_by          INTEGER,
  deleted_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_patients_name  ON patients(full_name_fold, id);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone_fold);
CREATE INDEX IF NOT EXISTS idx_patients_reg   ON patients(registration_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_patients_state ON patients(status, is_deleted);

CREATE TABLE IF NOT EXISTS patient_attachments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  visit_id        INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  file_name       TEXT NOT NULL,
  stored_path     TEXT NOT NULL,
  mime            TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'document',
  description     TEXT,
  attachment_date TEXT NOT NULL,
  sha256          TEXT NOT NULL,
  uploaded_by     INTEGER,
  created_at      INTEGER NOT NULL,
  is_deleted      INTEGER NOT NULL DEFAULT 0,
  deleted_at      INTEGER,
  deleted_by      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attachments_patient ON patient_attachments(patient_id, is_deleted);

------------------------------------------------------------------------------
-- Scheduling
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  dentist_id        INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  scheduled_at      INTEGER NOT NULL,
  scheduled_date    TEXT NOT NULL,
  duration_min      INTEGER NOT NULL DEFAULT 20,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled',
  notes             TEXT,
  rescheduled_from  INTEGER,
  cancelled_reason  TEXT,
  visit_id          INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_by        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  is_deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_appointments_time    ON appointments(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_date    ON appointments(scheduled_date, status);

CREATE TABLE IF NOT EXISTS appointment_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE ON UPDATE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  at             INTEGER NOT NULL,
  by_user_id     INTEGER,
  note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointment_events ON appointment_events(appointment_id, at);

CREATE TABLE IF NOT EXISTS queue_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  dentist_id     INTEGER REFERENCES dentists(id) ON DELETE SET NULL ON UPDATE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  visit_id       INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  queue_no       INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'waiting',
  priority       INTEGER NOT NULL DEFAULT 0,
  joined_at      INTEGER NOT NULL,
  called_at      INTEGER,
  started_at     INTEGER,
  completed_at   INTEGER,
  note           TEXT,
  created_by     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_entries(status, joined_at);
CREATE INDEX IF NOT EXISTS idx_queue_date   ON queue_entries(joined_at DESC);

------------------------------------------------------------------------------
-- Clinical
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visits (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_no           TEXT NOT NULL UNIQUE,
  patient_id         INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  dentist_id         INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  appointment_id     INTEGER REFERENCES appointments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  visit_at           INTEGER NOT NULL,
  visit_date         TEXT NOT NULL,
  chief_complaint    TEXT,
  history            TEXT,
  examination        TEXT,
  diagnosis          TEXT,
  findings_summary   TEXT,
  advice             TEXT,
  treatment_plan     TEXT,
  next_appointment_at INTEGER,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'completed',
  created_by         INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  updated_by         INTEGER,
  is_deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_visits_patient ON visits(patient_id, visit_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_date    ON visits(visit_date, dentist_id);
CREATE INDEX IF NOT EXISTS idx_visits_dentist ON visits(dentist_id, visit_at DESC);

CREATE TABLE IF NOT EXISTS clinical_findings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  name_bn      TEXT,
  category     TEXT NOT NULL DEFAULT 'finding',
  applies_tooth INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  is_system    INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_findings_category ON clinical_findings(category, is_active, sort_order);

CREATE TABLE IF NOT EXISTS visit_findings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id    INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE ON UPDATE CASCADE,
  finding_id  INTEGER REFERENCES clinical_findings(id) ON DELETE SET NULL ON UPDATE CASCADE,
  finding_code TEXT,
  tooth_code  TEXT,
  notes       TEXT,
  severity    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visit_findings ON visit_findings(visit_id);

CREATE TABLE IF NOT EXISTS dental_chart_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  visit_id       INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  tooth_code     TEXT NOT NULL,
  dentition      TEXT NOT NULL DEFAULT 'adult',
  condition_code TEXT NOT NULL,
  treatment_code TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  note           TEXT,
  recorded_at    INTEGER NOT NULL,
  recorded_by    INTEGER,
  resolved_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chart_patient ON dental_chart_entries(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_chart_visit   ON dental_chart_entries(visit_id);
CREATE INDEX IF NOT EXISTS idx_chart_tooth   ON dental_chart_entries(patient_id, tooth_code);

CREATE TABLE IF NOT EXISTS treatments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  name_bn            TEXT,
  category           TEXT NOT NULL DEFAULT 'general',
  description        TEXT,
  default_price_micro INTEGER NOT NULL DEFAULT 0,
  duration_min       INTEGER,
  is_active          INTEGER NOT NULL DEFAULT 1,
  is_deleted         INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_treatments_cat ON treatments(category, is_active);

CREATE TABLE IF NOT EXISTS visit_treatments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id       INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE ON UPDATE CASCADE,
  treatment_id   INTEGER REFERENCES treatments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  treatment_name TEXT NOT NULL,
  tooth_codes    TEXT DEFAULT '[]',
  quantity       REAL NOT NULL DEFAULT 1,
  unit_price_micro INTEGER NOT NULL DEFAULT 0,
  discount_micro INTEGER NOT NULL DEFAULT 0,
  total_micro    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'performed',
  notes          TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visit_treatments ON visit_treatments(visit_id);

CREATE TABLE IF NOT EXISTS prescriptions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  rx_no             TEXT NOT NULL UNIQUE,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  dentist_id        INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  visit_id          INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  prescription_at   INTEGER NOT NULL,
  prescription_date TEXT NOT NULL,
  age_snapshot      TEXT,
  diagnosis         TEXT,
  cc_text           TEXT,
  oe_text           TEXT,
  re_text           TEXT,
  advice            TEXT,
  follow_up_date    TEXT,
  notes             TEXT,
  printed_count     INTEGER NOT NULL DEFAULT 0,
  last_printed_at   INTEGER,
  created_by        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  updated_by        INTEGER,
  is_deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id, prescription_at DESC);
CREATE INDEX IF NOT EXISTS idx_rx_date    ON prescriptions(prescription_date);
CREATE INDEX IF NOT EXISTS idx_rx_dentist ON prescriptions(dentist_id, prescription_at DESC);

CREATE TABLE IF NOT EXISTS prescription_medicines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id  INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  medicine_name    TEXT NOT NULL,
  form             TEXT,
  strength         TEXT,
  unit             TEXT,
  dose_morning     TEXT,
  dose_afternoon   TEXT,
  dose_night       TEXT,
  timing           TEXT,
  frequency        TEXT,
  duration_days    INTEGER,
  duration_text    TEXT,
  quantity         TEXT,
  is_prn           INTEGER NOT NULL DEFAULT 0,
  instructions     TEXT
);
CREATE INDEX IF NOT EXISTS idx_rx_medicines ON prescription_medicines(prescription_id, sort_order);

CREATE TABLE IF NOT EXISTS prescription_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  dentist_id INTEGER REFERENCES dentists(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_by INTEGER,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prescription_template_medicines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id     INTEGER NOT NULL REFERENCES prescription_templates(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  medicine_name   TEXT NOT NULL,
  form            TEXT,
  strength        TEXT,
  unit            TEXT,
  dose_morning    TEXT,
  dose_afternoon  TEXT,
  dose_night      TEXT,
  timing          TEXT,
  frequency       TEXT,
  duration_days   INTEGER,
  duration_text   TEXT,
  quantity        TEXT,
  is_prn          INTEGER NOT NULL DEFAULT 0,
  instructions    TEXT
);

CREATE TABLE IF NOT EXISTS referrals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id            INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  visit_id              INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  referred_by_dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL ON UPDATE CASCADE,
  external_doctor       TEXT,
  specialty             TEXT,
  organization          TEXT,
  address               TEXT,
  phone                 TEXT,
  reason                TEXT,
  notes                 TEXT,
  referral_date         TEXT NOT NULL,
  follow_up_status      TEXT NOT NULL DEFAULT 'pending',
  follow_up_date        TEXT,
  created_by            INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  is_deleted            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_referrals_patient ON referrals(patient_id, referral_date DESC);
CREATE INDEX IF NOT EXISTS idx_referrals_follow  ON referrals(follow_up_status, follow_up_date);

------------------------------------------------------------------------------
-- Billing & finance
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no         TEXT NOT NULL UNIQUE,
  patient_id         INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  visit_id           INTEGER REFERENCES visits(id) ON DELETE SET NULL ON UPDATE CASCADE,
  appointment_id     INTEGER REFERENCES appointments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  issue_at           INTEGER NOT NULL,
  issue_date         TEXT NOT NULL,
  due_date           TEXT,
  status             TEXT NOT NULL DEFAULT 'unpaid',
  subtotal_micro     INTEGER NOT NULL DEFAULT 0,
  discount_micro     INTEGER NOT NULL DEFAULT 0,
  discount_bp        INTEGER NOT NULL DEFAULT 0,
  total_micro        INTEGER NOT NULL DEFAULT 0,
  paid_micro         INTEGER NOT NULL DEFAULT 0,
  due_micro          INTEGER NOT NULL DEFAULT 0,
  refunded_micro     INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  void_reason        TEXT,
  voided_at          INTEGER,
  voided_by          INTEGER,
  printed_count      INTEGER NOT NULL DEFAULT 0,
  last_printed_at    INTEGER,
  created_by         INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  updated_by         INTEGER,
  is_deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id, issue_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices(status, due_micro);
CREATE INDEX IF NOT EXISTS idx_invoices_date    ON invoices(issue_date, status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  treatment_id    INTEGER REFERENCES treatments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  visit_treatment_id INTEGER REFERENCES visit_treatments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  description     TEXT NOT NULL,
  tooth_codes     TEXT DEFAULT '[]',
  quantity        REAL NOT NULL DEFAULT 1,
  unit_price_micro INTEGER NOT NULL DEFAULT 0,
  discount_micro  INTEGER NOT NULL DEFAULT 0,
  line_total_micro INTEGER NOT NULL DEFAULT 0,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines ON invoice_lines(invoice_id, sort_order);

CREATE TABLE IF NOT EXISTS payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no          TEXT NOT NULL UNIQUE,
  patient_id          INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE ON UPDATE CASCADE,
  invoice_id          INTEGER REFERENCES invoices(id) ON DELETE SET NULL ON UPDATE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'payment',
  amount_micro        INTEGER NOT NULL,
  method              TEXT NOT NULL DEFAULT 'cash',
  reference           TEXT,
  paid_at             INTEGER NOT NULL,
  paid_date           TEXT NOT NULL,
  received_by_user_id INTEGER,
  notes               TEXT,
  reverses_payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL ON UPDATE CASCADE,
  status              TEXT NOT NULL DEFAULT 'active',
  void_reason         TEXT,
  voided_at           INTEGER,
  voided_by           INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments(patient_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_date    ON payments(paid_date, status);
CREATE INDEX IF NOT EXISTS idx_payments_method  ON payments(method, paid_date);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  name_fold      TEXT NOT NULL,
  contact_person TEXT,
  phone          TEXT,
  alt_phone      TEXT,
  email          TEXT,
  address        TEXT,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  is_deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name_fold);

CREATE TABLE IF NOT EXISTS inventory_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_fold         TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'general',
  unit              TEXT NOT NULL DEFAULT 'pcs',
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  purchase_price_micro INTEGER NOT NULL DEFAULT 0,
  selling_price_micro  INTEGER NOT NULL DEFAULT 0,
  reorder_level     REAL NOT NULL DEFAULT 0,
  expiry_tracking   INTEGER NOT NULL DEFAULT 0,
  location          TEXT,
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  is_deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inventory_name  ON inventory_items(name_fold);
CREATE INDEX IF NOT EXISTS idx_inventory_cat   ON inventory_items(category, is_deleted);

CREATE TABLE IF NOT EXISTS inventory_batches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  batch_no        TEXT,
  expiry_date     TEXT,
  quantity        REAL NOT NULL DEFAULT 0,
  unit_cost_micro INTEGER NOT NULL DEFAULT 0,
  supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  received_at     INTEGER NOT NULL,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_item   ON inventory_batches(item_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON inventory_batches(expiry_date);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id         INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE ON UPDATE CASCADE,
  batch_id        INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL ON UPDATE CASCADE,
  movement_type   TEXT NOT NULL,
  quantity        REAL NOT NULL,
  unit_cost_micro INTEGER NOT NULL DEFAULT 0,
  reason          TEXT,
  reference       TEXT,
  supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  at              INTEGER NOT NULL,
  movement_date   TEXT NOT NULL,
  by_user_id      INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_item ON inventory_movements(item_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(movement_date, movement_type);

CREATE TABLE IF NOT EXISTS purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no   TEXT NOT NULL UNIQUE,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  invoice_ref   TEXT,
  purchase_date TEXT NOT NULL,
  purchase_at   INTEGER NOT NULL,
  total_micro   INTEGER NOT NULL DEFAULT 0,
  paid_micro    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'received',
  notes         TEXT,
  created_by    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id     INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE ON UPDATE CASCADE,
  item_id         INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  batch_no        TEXT,
  expiry_date     TEXT,
  quantity        REAL NOT NULL,
  unit_cost_micro INTEGER NOT NULL,
  line_total_micro INTEGER NOT NULL,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchase_lines ON purchase_lines(purchase_id);

CREATE TABLE IF NOT EXISTS expense_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  kind      TEXT NOT NULL DEFAULT 'expense',
  is_system INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounting_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no       TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,
  category_id    INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL ON UPDATE CASCADE,
  category_name  TEXT NOT NULL,
  entry_date     TEXT NOT NULL,
  entry_at       INTEGER NOT NULL,
  amount_micro   INTEGER NOT NULL,
  method         TEXT NOT NULL DEFAULT 'cash',
  reference      TEXT,
  party          TEXT,
  description    TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  void_reason    TEXT,
  voided_at      INTEGER,
  voided_by      INTEGER,
  created_by     INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounting_date ON accounting_entries(entry_date, kind, status);
CREATE INDEX IF NOT EXISTS idx_accounting_cat  ON accounting_entries(category_id, entry_date);

------------------------------------------------------------------------------
-- Operations: notifications, audit, print history, backups
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key          TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL,
  severity            TEXT NOT NULL DEFAULT 'info',
  title               TEXT NOT NULL,
  message             TEXT NOT NULL,
  entity_type         TEXT,
  entity_id           INTEGER,
  action_route        TEXT,
  requires_permission TEXT,
  created_at          INTEGER NOT NULL,
  is_read             INTEGER NOT NULL DEFAULT 0,
  read_at             INTEGER,
  is_dismissed        INTEGER NOT NULL DEFAULT 0,
  dismissed_at        INTEGER,
  expires_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_state ON notifications(is_dismissed, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  user_id     INTEGER,
  username    TEXT,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  summary     TEXT NOT NULL,
  detail_json TEXT,
  result      TEXT NOT NULL DEFAULT 'success',
  session_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at     ON audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_log(user_id, at DESC);

-- The audit trail is append-only: updates and deletions are refused by the database itself.
CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TABLE IF NOT EXISTS system_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  source      TEXT NOT NULL,
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_system_events ON system_events(at DESC, level);

CREATE TABLE IF NOT EXISTS print_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL,
  record_id     INTEGER,
  record_no     TEXT,
  patient_id    INTEGER,
  user_id       INTEGER,
  username      TEXT,
  printer_name  TEXT,
  paper_class   TEXT,
  copies        INTEGER NOT NULL DEFAULT 1,
  result        TEXT NOT NULL,
  error         TEXT,
  printed_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_print_history ON print_history(printed_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_history_doc ON print_history(document_type, record_id);

CREATE TABLE IF NOT EXISTS backups (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name           TEXT NOT NULL,
  file_path           TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'manual',
  size_bytes          INTEGER NOT NULL DEFAULT 0,
  checksum            TEXT,
  schema_version      INTEGER NOT NULL,
  app_version         TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  created_by          INTEGER,
  verified            INTEGER NOT NULL DEFAULT 0,
  includes_attachments INTEGER NOT NULL DEFAULT 1,
  patient_count       INTEGER,
  note                TEXT
);

CREATE TABLE IF NOT EXISTS restore_history (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name             TEXT NOT NULL,
  started_at            INTEGER NOT NULL,
  finished_at           INTEGER,
  result                TEXT NOT NULL,
  message               TEXT,
  pre_restore_backup_id INTEGER REFERENCES backups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  module     TEXT NOT NULL,
  name       TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

------------------------------------------------------------------------------
-- Views
------------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS patient_financials AS
SELECT p.id AS patient_id,
       COALESCE(SUM(CASE WHEN i.status <> 'void' AND i.is_deleted = 0 THEN i.total_micro END), 0) AS invoiced_micro,
       COALESCE(SUM(CASE WHEN i.status <> 'void' AND i.is_deleted = 0 THEN i.paid_micro + i.refunded_micro END), 0) AS paid_micro,
       COALESCE(SUM(CASE WHEN i.status <> 'void' AND i.is_deleted = 0 THEN i.due_micro END), 0) AS due_micro,
       COALESCE(SUM(CASE WHEN i.status <> 'void' AND i.is_deleted = 0 THEN i.refunded_micro END), 0) AS refunded_micro,
       COUNT(CASE WHEN i.status <> 'void' AND i.is_deleted = 0 THEN 1 END) AS invoice_count
FROM patients p
LEFT JOIN invoices i ON i.patient_id = p.id AND i.is_deleted = 0
GROUP BY p.id;

CREATE VIEW IF NOT EXISTS inventory_current AS
SELECT i.id AS item_id,
       i.code,
       i.name,
       i.category,
       i.unit,
       i.reorder_level,
       i.purchase_price_micro,
       i.selling_price_micro,
       i.is_active,
       COALESCE(SUM(m.quantity), 0) AS quantity_on_hand,
       CAST(COALESCE(SUM(m.quantity), 0) * i.purchase_price_micro AS INTEGER) AS stock_value_micro
FROM inventory_items i
LEFT JOIN inventory_movements m ON m.item_id = i.id
WHERE i.is_deleted = 0
GROUP BY i.id;
`

/**
 * Statements applied after the base DDL to make an existing v1 database consistent with the current
 * build (idempotent repairs); kept separate so migrations stay explicit.
 */
export const SCHEMA_V1_POST_SQL = /* sql */ `
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status, visit_date);
CREATE INDEX IF NOT EXISTS idx_invoices_void ON invoices(voided_at);
`
