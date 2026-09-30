import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { VisitListScreen } from '../../src/renderer/src/features/clinical/VisitListScreen'
import { TreatmentCatalogScreen } from '../../src/renderer/src/features/clinical/TreatmentCatalogScreen'
import { DentalChartScreen } from '../../src/renderer/src/features/clinical/DentalChartScreen'
import { PrescriptionScreen } from '../../src/renderer/src/features/clinical/PrescriptionScreen'
import { VisitScreen } from '../../src/renderer/src/features/clinical/VisitScreen'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { ChannelInput, ChannelOutput } from '@shared/contracts'
import type { PatientSummary, Prescription, Treatment, VisitSummary } from '../../src/renderer/src/lib/types'
import type { SessionSummary } from '../../src/renderer/src/lib/types'

const CLINICAL_PERMISSIONS = [
  'patients.view',
  'clinical.view',
  'clinical.create',
  'clinical.edit',
  'clinical.delete',
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.edit',
  'prescriptions.delete',
  'prescriptions.export',
  'prescriptions.templates'
]

function sessionWith(permissions: string[]): SessionSummary {
  return {
    id: 'session-test',
    userId: 1,
    username: 'dentist',
    fullName: 'Dr Test Dentist',
    roleCode: 'dentist',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
}

function signIn(permissions: string[] = CLINICAL_PERMISSIONS): void {
  useAppStore.setState({ session: sessionWith(permissions), clinic: null, settings: {}, stage: 'ready', locked: false })
}

const PATIENT_ID = 7
const VISIT_AT = Date.UTC(2026, 8, 20, 5, 30)

function visitFixture(overrides: Partial<VisitSummary> = {}): VisitSummary {
  return {
    id: 41,
    visitNo: 'V-2609-0001',
    patientId: PATIENT_ID,
    patientCode: 'DP-2609-0001',
    patientName: 'Rakib Hasan',
    patientNameBn: 'রাকিব হাসান',
    patientAgeYears: 34,
    patientGender: 'male',
    patientPhone: '01712345678',
    dentistId: 3,
    dentistName: 'Dr Ayesha Rahman',
    dentistDesignations: ['Consultant Dental Surgeon'],
    visitAt: VISIT_AT,
    status: 'final',
    chiefComplaint: 'Pain in lower right molar',
    history: null,
    examination: 'Deep caries 46',
    diagnosis: 'Irreversible pulpitis 46',
    findingsSummary: 'Caries on 46',
    advice: 'Soft diet, warm saline rinse',
    treatmentPlan: 'Root canal treatment 46',
    nextAppointmentAt: null,
    notes: null,
    createdAt: VISIT_AT,
    updatedAt: VISIT_AT,
    treatments: [
      {
        id: 91,
        treatmentId: 12,
        treatmentName: 'Root canal treatment (single canal)',
        toothCodes: ['46'],
        quantity: 1,
        unitPriceMicro: 45_000_000,
        discountMicro: 0,
        totalMicro: 45_000_000,
        status: 'completed',
        notes: null
      }
    ],
    findings: [
      { id: 51, findingId: 4, findingCode: 'caries', findingName: 'Caries', toothCode: '46', severity: 'deep', notes: null }
    ],
    chart: [
      {
        id: 71,
        toothCode: '46',
        dentition: 'adult',
        conditionCode: 'caries',
        conditionName: 'Caries',
        status: 'active',
        note: null,
        recordedAt: VISIT_AT
      }
    ],
    totals: { subtotalMicro: 45_000_000, discountMicro: 0, totalMicro: 45_000_000, treatmentCount: 1 },
    invoices: [],
    prescriptions: [],
    ...overrides
  }
}

const TREATMENTS: Treatment[] = [
  {
    id: 12,
    code: 'ENDO-0001',
    name: 'Root canal treatment (single canal)',
    nameBn: 'রুট ক্যানেল চিকিৎসা',
    category: 'endodontic',
    description: null,
    defaultPriceMicro: 45_000_000,
    durationMin: 60,
    isActive: true,
    notes: null,
    usageCount: 18,
    updatedAt: VISIT_AT
  },
  {
    id: 20,
    code: 'REST-0004',
    name: 'Composite filling (one surface)',
    nameBn: null,
    category: 'restorative',
    description: null,
    defaultPriceMicro: 15_000_000,
    durationMin: 30,
    isActive: true,
    notes: null,
    usageCount: 42,
    updatedAt: VISIT_AT
  }
]

function chartFixture(entries: Array<{ toothCode: string, conditionCode: string, conditionName: string }>): ChannelOutput<'chart.get'> {
  const byTooth: ChannelOutput<'chart.get'>['byTooth'] = {}
  for (const entry of entries) {
    byTooth[entry.toothCode] = {
      id: 71,
      patientId: PATIENT_ID,
      visitId: null,
      toothCode: entry.toothCode,
      dentition: 'adult',
      conditionCode: entry.conditionCode,
      conditionName: entry.conditionName,
      conditionCategory: 'finding',
      conditionColor: 'chart-caries',
      treatmentCode: null,
      status: 'active',
      note: null,
      recordedAt: VISIT_AT,
      recordedByName: 'Dr Test Dentist',
      resolvedAt: null
    }
  }
  return {
    patientId: PATIENT_ID,
    entries: Object.values(byTooth),
    byTooth,
    counts: entries.map((entry) => ({ conditionCode: entry.conditionCode, conditionName: entry.conditionName, count: 1 })),
    conditions: [
      {
        code: 'caries',
        name: 'Caries',
        nameBn: 'দন্তক্ষয়',
        category: 'finding',
        color: 'chart-caries',
        appliesTooth: true,
        isActive: true,
        sortOrder: 10
      },
      {
        code: 'filled',
        name: 'Filled',
        nameBn: null,
        category: 'state',
        color: 'chart-filled',
        appliesTooth: true,
        isActive: true,
        sortOrder: 40
      }
    ],
    summaryText: ''
  }
}

function patientSummaryFixture(): PatientSummary {
  return {
    patient: {
      id: PATIENT_ID,
      code: 'DP-2609-0001',
      fullName: 'রাকিব হাসান',
      fullNameBn: 'রাকিব হাসান',
      dob: '1992-04-11',
      ageYears: 34,
      gender: 'male',
      bloodGroup: 'B+',
      phone: '01712345678',
      altPhone: null,
      emergencyPhone: null,
      address: 'College Road, Tangail',
      addressBn: 'কলেজ রোড, টাঙ্গাইল',
      city: 'Tangail',
      occupation: null,
      maritalStatus: null,
      chiefComplaint: 'Pain in lower right molar',
      pastHistory: null,
      allergies: 'Penicillin',
      medicalHistory: 'Controlled hypertension',
      dentalHistory: null,
      currentMedications: 'Amlodipine 5 mg',
      notes: null,
      tags: [],
      status: 'active',
      registrationDate: '2026-09-01',
      ageLabel: '34 years',
      ageAtRegistration: 34,
      dueMicro: 0,
      invoicedMicro: 45_000_000,
      paidMicro: 45_000_000,
      lastVisitAt: VISIT_AT,
      visitCount: 1,
      createdAt: VISIT_AT,
      updatedAt: VISIT_AT
    },
    financials: {
      invoicedMicro: 45_000_000,
      paidMicro: 45_000_000,
      dueMicro: 0,
      refundedMicro: 0,
      invoiceCount: 1,
      lastPaymentAt: VISIT_AT,
      aging: { current: 0, days30: 0, days60: 0, days90: 0, older: 0 }
    },
    lastVisit: { id: 41, visitNo: 'V-2609-0001', at: VISIT_AT, diagnosis: 'Irreversible pulpitis 46', dentistName: 'Dr Ayesha Rahman' },
    allergies: 'Penicillin',
    medicalHistory: 'Controlled hypertension',
    activeChartFindings: [{ toothCode: '46', conditionCode: 'caries', note: null }]
  }
}

/** Contract-valid prescription used as the return value of `prescriptions.save`. */
function prescriptionFixture(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: 88,
    rxNo: 'Rx-2609-0001',
    patientId: PATIENT_ID,
    dentistId: 3,
    visitId: null,
    prescriptionAt: VISIT_AT,
    diagnosis: 'Irreversible pulpitis 46',
    ccText: null,
    oeText: null,
    reText: null,
    advice: null,
    followUpDate: null,
    notes: null,
    medicines: [],
    patientCode: 'DP-2609-0001',
    patientName: 'রাকিব হাসান',
    patientNameBn: 'রাকিব হাসান',
    patientAgeYears: 34,
    patientGender: 'male',
    patientPhone: '01712345678',
    dentistName: 'Dr Ayesha Rahman',
    dentistNameBn: null,
    dentistDesignations: ['Consultant Dental Surgeon'],
    dentistRegistrationNo: 'BMDC-12345',
    dentistSignatureLabel: null,
    printedCount: 0,
    lastPrintedAt: null,
    createdAt: VISIT_AT,
    updatedAt: VISIT_AT,
    ...overrides
  }
}

describe('clinical screens', () => {
  it('lists visits with their treatments and asks the main process for the filtered register', async () => {
    signIn()
    mockChannels({
      'visits.list': () => ({ items: [visitFixture()], total: 1, limit: 25, offset: 0 }),
      'dentists.list': () => [{ id: 3, fullName: 'Dr Ayesha Rahman' }] as unknown as ChannelOutput<'dentists.list'>
    })

    render(
      <MemoryRouter>
        <VisitListScreen />
      </MemoryRouter>
    )

    expect(await screen.findByText('V-2609-0001')).toBeInTheDocument()
    expect(screen.getByText('রাকিব হাসান')).toBeInTheDocument()
    expect(screen.getByText('Root canal treatment (single canal)')).toBeInTheDocument()
    expect(screen.getByText('1 visit(s) · page 1 of 1')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'cancelled' } })
    await waitFor(() => {
      const last = callLog.filter((entry) => entry.channel === 'visits.list').at(-1)
      expect(last?.payload).toMatchObject({ status: 'cancelled' })
    })
  })

  it('renders a saved visit with its treatment lines, chart and findings', async () => {
    signIn()
    mockChannels({
      'visits.get': () => visitFixture(),
      'chart.get': () => chartFixture([{ toothCode: '46', conditionCode: 'caries', conditionName: 'Caries' }]),
      'chart.setEntry': () => chartFixture([]),
      'dentists.list': () => [{ id: 3, fullName: 'Dr Ayesha Rahman' }] as unknown as ChannelOutput<'dentists.list'>,
      'chart.conditions': () => chartFixture([]).conditions
    })

    render(
      <MemoryRouter initialEntries={['/visits/41']}>
        <Routes>
          <Route path="/visits/:visitId" element={<VisitScreen />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('V-2609-0001')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Diagnosis')).toHaveValue('Irreversible pulpitis 46'))
    expect(screen.getAllByText('Root canal treatment (single canal)').length).toBeGreaterThan(0)
    expect(screen.getByText(/Teeth 46/)).toBeInTheDocument()
    expect(screen.getAllByText('Caries').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Reopen as draft/ })).toBeInTheDocument()
  })

  it('shows the treatment catalogue and filters it by category through the contract', async () => {
    signIn()
    mockChannels({
      'treatments.list': () => TREATMENTS,
      'treatments.categories': () => [
        { category: 'endodontic', count: 1 },
        { category: 'restorative', count: 1 }
      ],
      'treatments.export': () => ({ path: null, rowCount: 0 })
    })

    render(
      <MemoryRouter>
        <TreatmentCatalogScreen />
      </MemoryRouter>
    )

    expect(await screen.findByText('Root canal treatment (single canal)')).toBeInTheDocument()
    expect(screen.getByText(/৳\s?4,500\.00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Endodontic · 1/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Restorative · 1/ }))
    await waitFor(() => {
      const last = callLog.filter((entry) => entry.channel === 'treatments.list').at(-1)
      expect(last?.payload).toMatchObject({ category: 'restorative' })
    })
  })

  it('records a condition against an FDI tooth on the dental chart', async () => {
    signIn()
    mockChannels({
      'chart.get': () => chartFixture([{ toothCode: '36', conditionCode: 'caries', conditionName: 'Caries' }]),
      'chart.history': () => [],
      'chart.setEntry': () => chartFixture([{ toothCode: '36', conditionCode: 'caries', conditionName: 'Caries' }]),
      'patients.summary': () => patientSummaryFixture()
    })

    render(
      <MemoryRouter initialEntries={[`/chart/${PATIENT_ID}`]}>
        <Routes>
          <Route path="/chart/:patientId" element={<DentalChartScreen />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText(/Dental chart — রাকিব হাসান/)).toBeInTheDocument()
    expect(screen.getByTitle(/^36 · .* — Caries$/)).toBeInTheDocument()
    expect(screen.getByText('Caries · 1')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByLabelText('Condition')).toHaveValue('caries'))
    fireEvent.click(screen.getByTitle(/^27 · /))
    await waitFor(() => {
      expect(callLog.some((entry) => entry.channel === 'chart.setEntry')).toBe(true)
    })
    const setEntry = callLog.find((entry) => entry.channel === 'chart.setEntry')
    expect(setEntry?.payload).toMatchObject({ patientId: PATIENT_ID, toothCode: '27', conditionCode: 'caries', status: 'active' })
  })

  it('writes a prescription and offers the medicine history through the contract', async () => {
    signIn()
    const save = vi.fn((input: ChannelInput<'prescriptions.save'>) =>
      prescriptionFixture({
        visitId: input.visitId ?? null,
        diagnosis: input.diagnosis ?? null,
        ccText: input.ccText ?? null,
        oeText: input.oeText ?? null,
        reText: input.reText ?? null,
        advice: input.advice ?? null,
        followUpDate: input.followUpDate ?? null,
        notes: input.notes ?? null,
        medicines: (input.medicines ?? []).map((medicine, index) => ({
          ...medicine,
          sortOrder: medicine.sortOrder ?? index,
          form: medicine.form ?? 'tablet',
          strength: medicine.strength ?? null,
          unit: medicine.unit ?? null,
          doseMorning: medicine.doseMorning ?? null,
          doseAfternoon: medicine.doseAfternoon ?? null,
          doseNight: medicine.doseNight ?? null,
          timing: medicine.timing ?? 'after_meal',
          frequency: medicine.frequency ?? null,
          durationDays: medicine.durationDays ?? null,
          durationText: medicine.durationText ?? null,
          quantity: medicine.quantity ?? null,
          isPrn: medicine.isPrn ?? false,
          instructions: medicine.instructions ?? null,
          id: 500 + index,
          prescriptionId: 88
        }))
      })
    )

    mockChannels({
      'dentists.list': () => [{ id: 3, fullName: 'Dr Ayesha Rahman' }] as unknown as ChannelOutput<'dentists.list'>,
      'patients.list': () => ({
        items: [patientSummaryFixture().patient],
        total: 1,
        limit: 25,
        offset: 0
      }),
      'prescriptions.medicines': () => [
        { medicineName: 'Amoxicillin', form: 'capsule', strength: '500 mg', lastUsedAt: VISIT_AT, useCount: 12 }
      ],
      'prescriptions.adviceLibrary': () => ['Warm saline rinse twice daily'],
      'prescriptions.templates.list': () => [],
      'prescriptions.save': save
    })

    render(
      <MemoryRouter initialEntries={['/prescriptions/new?patientId=7&dentistId=3']}>
        <Routes>
          <Route path="/prescriptions/new" element={<PrescriptionScreen />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.change(await screen.findByLabelText('Medicine 1'), { target: { value: 'Amoxicillin' } })
    fireEvent.click(screen.getByRole('button', { name: 'History for medicine 1' }))
    expect(await screen.findByRole('button', { name: /Amoxicillin 500 mg · 12×/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Save prescription/ }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      patientId: PATIENT_ID,
      dentistId: 3,
      medicines: [{ medicineName: 'Amoxicillin', form: 'tablet', durationDays: 5, timing: 'after_meal' }]
    })
  })
})
