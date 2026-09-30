/**
 * Scenario data for the end-to-end workflows, in one place.
 *
 * The workflows and `tests/integration/e2e-scenarios.test.ts` use exactly the same payloads: the
 * integration test pushes them through the real IPC router against a real database, so a payload the
 * contracts would reject is caught by `npm test` in seconds instead of after a Windows run of the
 * packaged application. Nothing here touches Playwright or Electron — it is plain data plus builders.
 */

export const E2E_ACTIVATION_CODE = '0000-0000-0000-0001'

export const CLINIC = {
  name: 'Tangail Dental Care',
  nameBn: 'টাঙ্গাইল ডেন্টাল কেয়ার',
  address: 'Victoria Road, Tangail',
  phone: '01711000000',
  openingTime: '09:00',
  closingTime: '20:00'
} as const

export const ADMIN = {
  fullName: 'Shohan Khan',
  username: 'admin.dentiva',
  // Deliberately not the product name: the password policy rejects 'Dentiva…' as a common word.
  password: 'Tangail#2026'
} as const

export const DENTIST = {
  fullName: 'Dr. Ayesha Rahman',
  fullNameBn: 'ডা. আয়েশা রহমান',
  registrationNo: 'BMDC-12345',
  signatureLabel: 'Consultant Dental Surgeon'
} as const

export const ITEM = { name: 'Glass ionomer cement', unit: 'box', category: 'restorative' } as const

export const FRONT_DESK = { username: 'frontdesk.rita', password: 'Desk#2026', fullName: 'Rita Das' } as const

export const CHANGED_PATIENT_NAME = 'Zarina Sultana (renamed)'

/* ------------------------------------------------------------------ setup wizard */

export function clinicStepPayload(): Record<string, unknown> {
  return {
    name: CLINIC.name,
    nameBn: CLINIC.nameBn,
    logoPath: null,
    address: CLINIC.address,
    addressBn: null,
    phone: CLINIC.phone,
    altPhone: null,
    email: null,
    website: null,
    openingTime: CLINIC.openingTime,
    closingTime: CLINIC.closingTime,
    weeklyClosedDays: [5],
    footerMessage: null,
    invoiceFooter: null,
    prescriptionFooter: null,
    emergencyInstruction: null
  }
}

export function dentistStepPayload(): Record<string, unknown> {
  return {
    dentists: [
      {
        fullName: DENTIST.fullName,
        fullNameBn: DENTIST.fullNameBn,
        phone: null,
        email: null,
        registrationNo: DENTIST.registrationNo,
        signatureLabel: DENTIST.signatureLabel,
        color: null,
        isActive: true,
        sortOrder: 1,
        designations: ['BDS', 'MDS (Orthodontics)'],
        qualifications: [],
        schedules: []
      }
    ]
  }
}

export function administratorStepPayload(): Record<string, unknown> {
  return {
    fullName: ADMIN.fullName,
    username: ADMIN.username,
    password: ADMIN.password,
    confirmPassword: ADMIN.password,
    dentistId: null
  }
}

/**
 * The wizard's preferences step, with the values its form starts from. Every key is a real entry in
 * the settings catalogue and is written the moment the operator presses *Save and review*; the
 * service drops unknown keys silently, so a step that invented its own names would save nothing.
 */
export function preferencesStepPayload(overrides: Record<string, string> = {}): Record<string, unknown> {
  return {
    values: {
      'practice.currency': 'BDT',
      'practice.appointmentDuration': '30',
      'practice.autoLockMinutes': '10',
      'print.defaultPaperClass': 'a4',
      'ui.density': 'comfortable',
      'ui.landingPage': 'dashboard',
      'backup.frequencyDays': '7',
      'backup.retention': '10',
      ...overrides
    }
  }
}

/**
 * Finishing setup is confirmed by typing the clinic name, so the payload is the name the operator has
 * just entered — the same value the wizard asks her to retype in the dialog.
 */
export function setupCompletePayload(): Record<string, unknown> {
  return { confirmation: CLINIC.name }
}

export function loginPayload(credentials: { username: string, password: string } = ADMIN): Record<string, unknown> {
  return { username: credentials.username, password: credentials.password }
}

/* ------------------------------------------------------------------ clinic work */

export function patientPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Rakib Hasan',
    fullNameBn: 'রাকিব হাসান',
    dob: null,
    ageYears: 34,
    gender: 'male',
    bloodGroup: null,
    phone: '01712345678',
    altPhone: null,
    emergencyPhone: null,
    address: 'House 12, Victoria Road',
    addressBn: 'বাড়ি ১২, ভিক্টোরিয়া রোড',
    city: 'Tangail',
    occupation: null,
    maritalStatus: null,
    chiefComplaint: null,
    pastHistory: null,
    allergies: null,
    medicalHistory: null,
    dentalHistory: null,
    currentMedications: null,
    notes: null,
    tags: [],
    status: 'active',
    ...overrides
  }
}

export function visitPayload(patientId: number, dentistId: number): Record<string, unknown> {
  return {
    patientId,
    dentistId,
    appointmentId: null,
    visitAt: Date.now(),
    chiefComplaint: 'Pain in the lower right molar',
    examination: 'Deep caries on 46, tender on percussion',
    diagnosis: 'Irreversible pulpitis',
    advice: 'Warm saline rinse',
    treatmentPlan: 'Root canal treatment',
    status: 'final'
  }
}

export function visitTreatmentPayload(visitId: number, treatmentName = 'Root canal treatment'): Record<string, unknown> {
  return {
    visitId,
    treatmentId: null,
    treatmentName,
    toothCodes: ['46'],
    quantity: 1,
    unitPriceMicro: 900_000,
    discountMicro: 0,
    status: 'completed'
  }
}

export function prescriptionPayload(patientId: number, dentistId: number, visitId: number | null = null): Record<string, unknown> {
  return {
    patientId,
    dentistId,
    visitId,
    prescriptionAt: Date.now(),
    diagnosis: 'Acute pulpitis',
    ccText: 'Pain on chewing for three days',
    oeText: 'Tender on percussion, deep caries 46',
    advice: 'Avoid cold drinks for a week',
    medicines: [
      {
        sortOrder: 1,
        medicineName: 'Amoxicillin 500 mg',
        form: 'capsule',
        strength: '500 mg',
        unit: null,
        doseMorning: '1',
        doseAfternoon: null,
        doseNight: '1',
        timing: 'after_meal',
        frequency: '1+0+1',
        durationDays: 5,
        durationText: null,
        quantity: '10',
        isPrn: false,
        instructions: null
      }
    ]
  }
}

export function chartEntryPayload(patientId: number, visitId: number | null = null): Record<string, unknown> {
  return {
    patientId,
    visitId,
    toothCode: '46',
    conditionCode: 'pulpitis',
    status: 'active',
    note: 'Tender on percussion'
  }
}

export function invoicePayload(patientId: number, unitPriceMicro = 900_000): Record<string, unknown> {
  return {
    patientId,
    visitId: null,
    appointmentId: null,
    issueAt: Date.now(),
    dueDate: null,
    discountBp: 0,
    notes: null,
    lines: [
      {
        treatmentId: null,
        visitTreatmentId: null,
        description: 'Root canal treatment',
        toothCodes: ['46'],
        quantity: 1,
        unitPriceMicro,
        discountMicro: 0
      }
    ]
  }
}

export function paymentPayload(patientId: number, invoiceId: number, amountMicro: number, method = 'cash'): Record<string, unknown> {
  return {
    patientId,
    invoiceId,
    kind: 'payment',
    amountMicro,
    method,
    reference: null,
    paidAt: Date.now(),
    notes: null
  }
}

export function appointmentPayload(patientId: number, dentistId: number, scheduledAt: number): Record<string, unknown> {
  return {
    patientId,
    dentistId,
    scheduledAt,
    durationMin: 30,
    reason: 'Toothache',
    notes: null,
    status: 'scheduled'
  }
}

export function inventoryItemPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: null,
    name: ITEM.name,
    category: ITEM.category,
    unit: ITEM.unit,
    supplierId: null,
    purchasePriceMicro: 250_000,
    sellingPriceMicro: 400_000,
    reorderLevel: 10,
    expiryTracking: false,
    location: null,
    notes: null,
    isActive: true,
    ...overrides
  }
}

export function stockMovementPayload(itemId: number, movementType: string, quantity: number, reason: string): Record<string, unknown> {
  return {
    itemId,
    movementType,
    quantity,
    unitCostMicro: 250_000,
    reason
  }
}

export function frontDeskRolePayload(): Record<string, unknown> {
  return {
    name: 'Front desk (no billing)',
    code: 'front_desk_no_billing',
    description: 'Reception duties without financial access',
    isActive: true,
    maxDiscountBasisPoints: 0,
    permissions: [
      'patients.view',
      'patients.create',
      'patients.edit',
      'appointments.view',
      'appointments.create',
      'queue.view',
      'queue.manage'
    ]
  }
}

export function frontDeskUserPayload(roleId: number): Record<string, unknown> {
  return {
    username: FRONT_DESK.username,
    fullName: FRONT_DESK.fullName,
    phone: null,
    roleId,
    staffId: null,
    dentistId: null,
    isActive: true,
    password: FRONT_DESK.password,
    requirePasswordChange: false
  }
}

export function backupCreatePayload(): Record<string, unknown> {
  return { kind: 'quick', note: 'End-to-end restore workflow' }
}

export function restorePayload(filePath: string): Record<string, unknown> {
  return { filePath, confirmation: 'RESTORE' }
}
