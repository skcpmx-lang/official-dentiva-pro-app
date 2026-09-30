import type { Db } from './connection'
import { PERMISSIONS, DEFAULT_ROLES, expandRolePermissions } from '@shared/permissions'
import { DEFAULT_TOOTH_CONDITIONS } from '@shared/dental'
import { SETTING_DEFS } from '../modules/settings/defaults'
import { foldForSearch } from '@shared/bengali'

/**
 * Seeds reference data. Safe to run on every start: every statement is an upsert of catalog data that
 * the clinic may extend but that must always exist (permissions, roles, clinical vocabulary,
 * default settings, print profiles). User-authored rows are never overwritten except where the
 * specification requires the catalog to stay authoritative (permission labels).
 */
export function seedDatabase(db: Db, now: number): void {
  const run = db.transaction(() => {
    seedSettings(db, now)
    seedClinicPlaceholder(db, now)
    seedLicenseState(db)
    seedPermissions(db)
    seedRoles(db, now)
    seedClinicalVocabulary(db)
    seedExpenseCategories(db)
    seedTreatmentCatalog(db, now)
    seedPrintProfiles(db, now)
  })
  run()
}

function seedSettings(db: Db, now: number): void {
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
  for (const def of SETTING_DEFS) insert.run(def.key, def.default, now)
}

function seedClinicPlaceholder(db: Db, now: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO clinic (id, name, weekly_closed_days, created_at, updated_at)
     VALUES (1, '', '[]', ?, ?)`
  ).run(now, now)
}

function seedLicenseState(db: Db): void {
  db.prepare(
    `INSERT OR IGNORE INTO license_state (id, attempts, is_valid) VALUES (1, 0, 0)`
  ).run()
}

function seedPermissions(db: Db): void {
  const upsert = db.prepare(
    `INSERT INTO permissions (code, module, label, description) VALUES (@code, @module, @label, @description)
     ON CONFLICT(code) DO UPDATE SET module = excluded.module, label = excluded.label, description = excluded.description`
  )
  for (const permission of PERMISSIONS) upsert.run(permission)
}

function seedRoles(db: Db, now: number): void {
  const insertRole = db.prepare(
    `INSERT INTO roles (code, name, description, is_system, is_active, max_discount_bp, created_at, updated_at)
     VALUES (@code, @name, @description, 1, 1, @maxDiscount, @now, @now)
     ON CONFLICT(code) DO NOTHING`
  )
  const findRole = db.prepare('SELECT id FROM roles WHERE code = ?')
  const link = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
  const countLinks = db.prepare('SELECT COUNT(*) AS count FROM role_permissions WHERE role_id = ?')

  for (const role of DEFAULT_ROLES) {
    insertRole.run({
      code: role.code,
      name: role.name,
      description: role.description,
      maxDiscount: role.maxDiscountBasisPoints ?? null,
      now
    })
    const row = findRole.get(role.code) as { id: number } | undefined
    if (!row) continue
    // Only seed the permission set the first time the role appears; afterwards the clinic owns it.
    const existing = countLinks.get(row.id) as { count: number }
    if (existing.count === 0) {
      for (const code of expandRolePermissions(role)) link.run(row.id, code)
    }
  }
}

function seedClinicalVocabulary(db: Db): void {
  const insert = db.prepare(
    `INSERT INTO clinical_findings (code, name, name_bn, category, applies_tooth, is_active, is_system, sort_order)
     VALUES (@code, @name, @nameBn, @category, @appliesTooth, 1, 1, @sortOrder)
     ON CONFLICT(code) DO NOTHING`
  )

  const cc: Array<[string, string, string | null]> = [
    ['cc_pain', 'Pain', 'ব্যথা'],
    ['cc_generalized_caries', 'Generalized caries', 'সাধারণ দন্তক্ষয়'],
    ['cc_swelling', 'Swelling', 'ফোলা'],
    ['cc_gum_bleeding', 'Gum bleeding', 'মাড়ি থেকে রক্তক্ষরণ'],
    ['cc_bad_breath', 'Bad breath (halitosis)', 'মুখের দুর্গন্ধ'],
    ['cc_sensitivity', 'Sensitivity to hot / cold / sweet', 'সংবেদনশীলতা'],
    ['cc_mobility', 'Tooth mobility', 'দাঁত নড়া'],
    ['cc_food_impaction', 'Food impaction', 'খাবার আটকে থাকা'],
    ['cc_discoloration', 'Discoloration / staining', 'রঙ পরিবর্তন'],
    ['cc_trauma', 'Dental trauma', 'দন্ত আঘাত'],
    ['cc_difficulty_chewing', 'Difficulty chewing', 'চিবাতে অসুবিধা'],
    ['cc_ulcer', 'Mouth ulcer', 'মুখের ঘা'],
    ['cc_jaw_pain', 'Jaw pain / clicking', 'চোয়ালে ব্যথা'],
    ['cc_bleeding_after_extraction', 'Bleeding after extraction', 'দাঁত তোলার পর রক্তক্ষরণ'],
    ['cc_routine_checkup', 'Routine check-up', 'নিয়মিত পরীক্ষা'],
    ['cc_orthodontic_counselling', 'Orthodontic consultation', 'অর্থোডন্টিক পরামর্শ']
  ]
  const oe: Array<[string, string, string | null]> = [
    ['oe_caries', 'Caries', 'দন্তক্ষয়'],
    ['oe_generalized_caries', 'Generalized caries', 'ব্যপক দন্তক্ষয়'],
    ['oe_gingivitis', 'Gingivitis', 'মাড়ির প্রদাহ'],
    ['oe_periodontal_pocket', 'Periodontal pocket', 'পেরিওডন্টাল পকেট'],
    ['oe_periodontitis', 'Periodontitis', 'পেরিওডন্টাইটিস'],
    ['oe_pulpitis', 'Pulpitis', 'পালপাইটিস'],
    ['oe_impacted_tooth', 'Impacted tooth', 'আটকে থাকা দাঁত'],
    ['oe_dry_socket', 'Dry socket', 'ড্রাই সকেট'],
    ['oe_attrition', 'Attrition', 'ঘর্ষণ'],
    ['oe_abrasion', 'Abrasion', 'ক্ষয়'],
    ['oe_erosion', 'Erosion', 'ক্ষয়ীভবন'],
    ['oe_missing_tooth', 'Missing tooth', 'অনুপস্থিত দাঁত'],
    ['oe_fractured_tooth', 'Fractured tooth', 'ভাঙা দাঁত'],
    ['oe_restoration', 'Restoration present', 'পূরণ উপস্থিত'],
    ['oe_calculus', 'Calculus / plaque deposits', 'ক্যালকুলাস'],
    ['oe_mobility_grade_1', 'Mobility grade I', 'মোবিলিটি গ্রেড ১'],
    ['oe_mobility_grade_2', 'Mobility grade II', 'মোবিলিটি গ্রেড ২'],
    ['oe_mobility_grade_3', 'Mobility grade III', 'মোবিলিটি গ্রেড ৩'],
    ['oe_bdr', 'BDR / tenderness on percussion', 'পারকাশনে ব্যথা'],
    ['oe_bdc', 'BDC / tenderness on palpation', 'স্পর্শে ব্যথা'],
    ['oe_swelling_present', 'Extra-oral / intra-oral swelling', 'ফোলা উপস্থিত'],
    ['oe_tmj_tenderness', 'TMJ tenderness', 'টিএমজে সংবেদনশীলতা'],
    ['oe_oral_hygiene_poor', 'Poor oral hygiene', 'দাঁতের পরিচ্ছন্নতা অপর্যাপ্ত']
  ]
  const advice: Array<[string, string, string | null]> = [
    ['adv_warm_saline', 'Warm saline rinse 3–4 times daily', 'কুসুম গরম লবণ পানিতে কুলকুচি করুন'],
    ['adv_avoid_hot_cold', 'Avoid very hot and cold food', 'অতি গরম ও ঠান্ডা খাবার এড়িয়ে চলুন'],
    ['adv_take_medicines', 'Take medicines as prescribed', 'নির্দেশনা অনুযায়ী ঔষধ সেবন করুন'],
    ['adv_oral_hygiene', 'Brush twice daily (morning and before bed)', 'দিনে দুইবার ব্রাশ করুন'],
    ['adv_soft_brush', 'Use a soft-bristled toothbrush', 'নরম ব্রাশ ব্যবহার করুন'],
    ['adv_avoid_hard_food', 'Avoid hard and sticky food', 'শক্ত ও আঠালো খাবার এড়িয়ে চলুন'],
    ['adv_follow_up', 'Follow-up in 7 days', '৭ দিন পর ফলোআপ করুন'],
    ['adv_complete_antibiotics', 'Complete the full antibiotic course', 'সম্পূর্ণ অ্যান্টিবায়োটিক কোর্স শেষ করুন'],
    ['adv_no_smoking', 'Stop smoking / tobacco use', 'ধূমপান/তামাক বর্জন করুন'],
    ['adv_flossing', 'Use dental floss daily', 'প্রতিদিন ডেন্টাল ফ্লস ব্যবহার করুন'],
    ['adv_mouthwash', 'Use prescribed mouthwash', 'নির্দেশিত মাউথওয়াশ ব্যবহার করুন'],
    ['adv_no_spitting_extraction', "Do not spit or rinse for 24 hours after extraction", 'দাঁত তোলার ২৪ ঘণ্টা কুলকুচি করবেন না'],
    ['adv_avoid_chewing_side', 'Chew on the opposite side for 24 hours', '২৪ ঘণ্টা অপর পাশে চিবিয়ে খান'],
    ['adv_ortho_maintenance', 'Maintain orthodontic appliance hygiene and review monthly', 'অর্থোডন্টিক অ্যাপ্লায়েন্সের পরিচ্ছন্নতা রক্ষা করুন']
  ]

  cc.forEach(([code, name, nameBn], index) =>
    insert.run({ code, name, nameBn, category: 'cc', appliesTooth: 0, sortOrder: index })
  )
  oe.forEach(([code, name, nameBn], index) =>
    insert.run({ code, name, nameBn, category: 'oe', appliesTooth: 0, sortOrder: index })
  )
  advice.forEach(([code, name, nameBn], index) =>
    insert.run({ code, name, nameBn, category: 'advice', appliesTooth: 0, sortOrder: index })
  )
  DEFAULT_TOOTH_CONDITIONS.forEach((condition, index) =>
    insert.run({
      code: condition.code,
      name: condition.label,
      nameBn: null,
      category: 'tooth_condition',
      appliesTooth: 1,
      sortOrder: index
    })
  )
}

function seedExpenseCategories(db: Db): void {
  const insert = db.prepare(
    `INSERT INTO expense_categories (name, kind, is_system, is_active, sort_order)
     VALUES (?, ?, 1, 1, ?) ON CONFLICT(name) DO NOTHING`
  )
  const expenses = [
    'Clinic rent',
    'Electricity',
    'Water',
    'Internet & telephone',
    'Equipment purchase',
    'Equipment maintenance',
    'Dental accessories',
    'Clinical consumables',
    'Staff salary',
    'Staff bonus & incentive',
    'Transport',
    'Marketing & signage',
    'Licence & registration',
    'Cleaning & waste disposal',
    'Bank charges',
    'Miscellaneous'
  ]
  const income = ['Consultation income', 'Treatment income', 'Product sales', 'Other income']
  expenses.forEach((name, index) => insert.run(name, 'expense', index))
  income.forEach((name, index) => insert.run(name, 'income', index))
}

/**
 * Starter treatment catalog. Prices are intentionally seeded at ৳ 0 because Dentiva Pro must never
 * invent clinic-specific pricing — the dashboard raises a "review treatment prices" task instead.
 */
function seedTreatmentCatalog(db: Db, now: number): void {
  const insert = db.prepare(
    `INSERT INTO treatments (code, name, name_fold, name_bn, category, description, default_price_micro, duration_min, is_active, notes, created_at, updated_at)
     VALUES (@code, @name, @nameFold, @nameBn, @category, @description, 0, @duration, 1, NULL, @now, @now)
     ON CONFLICT(code) DO NOTHING`
  )
  const rows: Array<{ code: string; name: string; nameBn: string | null; category: string; description: string | null; duration: number | null }> = [
    { code: 'CONS', name: 'Consultation', nameBn: 'পরামর্শ', category: 'diagnostic', description: 'Clinical examination and diagnosis', duration: 15 },
    { code: 'IOPA', name: 'Intra-oral periapical X-ray (IOPA)', nameBn: 'আইওপিএ এক্স-রে', category: 'diagnostic', description: null, duration: 10 },
    { code: 'OPG', name: 'Panoramic X-ray (OPG)', nameBn: 'ওপিজি এক্স-রে', category: 'diagnostic', description: null, duration: 15 },
    { code: 'SCAL', name: 'Scaling (full mouth)', nameBn: 'স্কেলিং', category: 'preventive', description: 'Ultrasonic scaling and oral prophylaxis', duration: 30 },
    { code: 'POL', name: 'Polishing', nameBn: 'পলিশিং', category: 'preventive', description: null, duration: 15 },
    { code: 'FLUO', name: 'Topical fluoride application', nameBn: 'ফ্লোরাইড প্রয়োগ', category: 'preventive', description: null, duration: 15 },
    { code: 'SEAL', name: 'Pit and fissure sealant (per tooth)', nameBn: 'সিল্যান্ট', category: 'preventive', description: null, duration: 15 },
    { code: 'GIC', name: 'GIC filling (per tooth)', nameBn: 'জিআইসি ফিলিং', category: 'restorative', description: null, duration: 30 },
    { code: 'COMP', name: 'Composite filling (per tooth)', nameBn: 'কম্পোজিট ফিলিং', category: 'restorative', description: null, duration: 40 },
    { code: 'TEMPR', name: 'Temporary restoration', nameBn: 'সাময়িক পূরণ', category: 'restorative', description: null, duration: 20 },
    { code: 'PULP', name: 'Pulpotomy / pulpectomy', nameBn: 'পালপেক্টমি', category: 'endodontic', description: null, duration: 45 },
    { code: 'RCT_ANT', name: 'Root canal treatment — anterior', nameBn: 'রুট ক্যানাল (সামনের দাঁত)', category: 'endodontic', description: 'Includes obturation', duration: 60 },
    { code: 'RCT_POST', name: 'Root canal treatment — posterior', nameBn: 'রুট ক্যানাল (পিছনের দাঁত)', category: 'endodontic', description: 'Includes obturation', duration: 90 },
    { code: 'POSTCORE', name: 'Post and core (fibre post)', nameBn: 'পোস্ট ও কোর', category: 'endodontic', description: null, duration: 45 },
    { code: 'EXT_SIMPLE', name: 'Extraction — simple', nameBn: 'দাঁত তোলা (সাধারণ)', category: 'surgical', description: null, duration: 30 },
    { code: 'EXT_SURG', name: 'Extraction — surgical / impacted', nameBn: 'সার্জিক্যাল এক্সট্রাকশন', category: 'surgical', description: null, duration: 60 },
    { code: 'GINGIV', name: 'Gingivectomy (per quadrant)', nameBn: 'জিঞ্জিভেক্টমি', category: 'surgical', description: null, duration: 45 },
    { code: 'RPLAN', name: 'Root planing / deep curettage (per quadrant)', nameBn: 'রুট প্লানিং', category: 'surgical', description: null, duration: 45 },
    { code: 'CROWN_PFM', name: 'Crown — porcelain fused to metal', nameBn: 'ক্রাউন (পিএফএম)', category: 'prosthetic', description: null, duration: 60 },
    { code: 'CROWN_ZR', name: 'Crown — zirconia', nameBn: 'ক্রাউন (জিরকোনিয়া)', category: 'prosthetic', description: null, duration: 60 },
    { code: 'BRIDGE', name: 'Bridge (per unit)', nameBn: 'ব্রিজ (প্রতি ইউনিট)', category: 'prosthetic', description: null, duration: 60 },
    { code: 'DENT_CD_UP', name: 'Complete denture — upper', nameBn: 'সম্পূর্ণ ডেনচার (উপর)', category: 'prosthetic', description: null, duration: 90 },
    { code: 'DENT_CD_LO', name: 'Complete denture — lower', nameBn: 'সম্পূর্ণ ডেনচার (নিচ)', category: 'prosthetic', description: null, duration: 90 },
    { code: 'DENT_PD', name: 'Partial denture (acrylic)', nameBn: 'আংশিক ডেনচার', category: 'prosthetic', description: null, duration: 60 },
    { code: 'RPD_FLEX', name: 'Flexible partial denture', nameBn: 'ফ্লেক্সিবল ডেনচার', category: 'prosthetic', description: null, duration: 60 },
    { code: 'ORTHO_FIXED', name: 'Fixed orthodontic treatment (braces)', nameBn: 'ফিক্সড অর্থোডন্টিক চিকিৎসা', category: 'orthodontic', description: 'Full treatment package', duration: 60 },
    { code: 'ORTHO_REM', name: 'Removable orthodontic appliance', nameBn: 'রিমুভেবল অ্যাপ্লায়েন্স', category: 'orthodontic', description: null, duration: 45 },
    { code: 'ORTHO_REVIEW', name: 'Orthodontic review / adjustment', nameBn: 'অর্থোডন্টিক রিভিউ', category: 'orthodontic', description: null, duration: 20 },
    { code: 'WHITE', name: 'In-office tooth whitening', nameBn: 'দাঁত সাদা করা', category: 'cosmetic', description: null, duration: 60 },
    { code: 'VENEER', name: 'Veneer (per tooth)', nameBn: 'ভিনিয়ার', category: 'cosmetic', description: null, duration: 60 },
    { code: 'IMP', name: 'Dental implant (per implant)', nameBn: 'ইমপ্ল্যান্ট', category: 'surgical', description: null, duration: 90 },
    { code: 'NIGHTGUARD', name: 'Night guard / occlusal splint', nameBn: 'নাইট গার্ড', category: 'prosthetic', description: null, duration: 45 },
    { code: 'OTHER', name: 'Other procedure', nameBn: 'অন্যান্য', category: 'general', description: 'Use when the procedure is not listed in the catalog', duration: null }
  ]
  for (const row of rows) insert.run({ ...row, nameFold: foldForSearch(row.name), now })
}

function seedPrintProfiles(db: Db, now: number): void {
  const insert = db.prepare(
    `INSERT INTO print_profiles (name, document_type, paper_class, orientation, margin_top_mm, margin_right_mm,
       margin_bottom_mm, margin_left_mm, scale_bp, copies, thermal_width_mm, is_default, is_active, created_at, updated_at)
     SELECT @name, @documentType, @paperClass, 'portrait', 12, 12, 12, 12, 10000, 1, 80, @isDefault, 1, @now, @now
     WHERE NOT EXISTS (SELECT 1 FROM print_profiles WHERE document_type = @documentType AND paper_class = @paperClass AND is_deleted = 0)`
  )
  const combos: Array<{ documentType: string; paperClass: string; name: string; isDefault: number }> = [
    { documentType: 'prescription', paperClass: 'a4', name: 'Prescription — A4', isDefault: 1 },
    { documentType: 'prescription', paperClass: 'a5', name: 'Prescription — A5', isDefault: 0 },
    { documentType: 'prescription', paperClass: 'thermal', name: 'Prescription — thermal', isDefault: 0 },
    { documentType: 'invoice', paperClass: 'a4', name: 'Invoice — A4', isDefault: 1 },
    { documentType: 'invoice', paperClass: 'a5', name: 'Invoice — A5', isDefault: 0 },
    { documentType: 'invoice', paperClass: 'thermal', name: 'Invoice — thermal receipt', isDefault: 0 },
    { documentType: 'invoice', paperClass: 'mini', name: 'Invoice — mini printer', isDefault: 0 },
    { documentType: 'patient_summary', paperClass: 'a4', name: 'Patient summary — A4', isDefault: 1 },
    { documentType: 'report', paperClass: 'a4', name: 'Reports — A4', isDefault: 1 },
    { documentType: 'appointment_slip', paperClass: 'a5', name: 'Appointment slip — A5', isDefault: 1 },
    { documentType: 'payment_receipt', paperClass: 'a5', name: 'Payment receipt — A5', isDefault: 1 },
    { documentType: 'payment_receipt', paperClass: 'thermal', name: 'Payment receipt — thermal', isDefault: 0 }
  ]
  const now2 = now
  for (const combo of combos) insert.run({ ...combo, now: now2 })
}
