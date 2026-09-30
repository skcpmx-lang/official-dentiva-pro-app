import type { ServiceContext } from '../context'
import { formatBDT } from '@shared/money'
import { toLocalDate } from '@shared/datetime'
import { listPatients } from '../modules/patients/service'
import { listAppointments } from '../modules/scheduling/appointments'
import { listInvoices } from '../modules/billing/invoices'
import { listPayments } from '../modules/billing/payments'
import { listPrescriptions } from '../modules/clinical/prescriptions'
import { listVisits } from '../modules/clinical/visits'
import { listTreatments } from '../modules/clinical/treatments'
import { listItems } from '../modules/inventory/items'
import { listSuppliers } from '../modules/inventory/suppliers'
import { listStaff } from '../modules/staff/service'
import { listEntries } from '../modules/accounting/entries'

/**
 * Global search.
 *
 * The fan-out reuses the module services rather than raw SQL, so a result can never disagree with the
 * list screen it opens — the same filters, the same folding rules for Bengali and Latin text, and the
 * same permission checks. A group whose permission the operator does not hold is skipped before any
 * query runs, and a failing group is reported to the log instead of breaking the whole search.
 */

export interface SearchResultItem {
  id: number
  title: string
  subtitle: string | null
  meta: string | null
  route: string
}

export interface SearchGroupResult {
  key: string
  label: string
  items: SearchResultItem[]
  total: number
}

export interface SearchInput {
  query: string
  limitPerGroup: number
}

const date = (ms: number | null | undefined): string | null => (ms === null || ms === undefined ? null : toLocalDate(ms))

export function globalSearch(ctx: ServiceContext, input: SearchInput): { query: string, groups: SearchGroupResult[], total: number } {
  const query = input.query.trim()
  const limit = input.limitPerGroup
  const can = (permission: string): boolean => ctx.actor.permissions.has(permission)
  const groups: SearchGroupResult[] = []

  /** Runs one group; a group that throws is logged and skipped so the palette still answers. */
  const collect = (key: string, label: string, build: () => SearchGroupResult): void => {
    try {
      const group = build()
      if (group.total > 0) groups.push(group)
    } catch (error) {
      ctx.host.logger.warn('A global search group failed', { key, query, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (can('patients.view')) {
    collect('patients', 'Patients', () => {
      const page = listPatients(ctx, { search: query, status: 'all', limit, offset: 0 })
      return {
        key: 'patients',
        label: 'Patients',
        total: page.total,
        items: page.items.map((patient) => ({
          id: patient.id,
          title: patient.fullNameBn ? `${patient.fullName} · ${patient.fullNameBn}` : patient.fullName,
          subtitle: [patient.code, patient.phone, patient.ageLabel].filter((part): part is string => Boolean(part)).join(' · '),
          meta: formatBDT(patient.dueMicro ?? 0, { symbol: false }) === '0.00' ? null : `Due ${formatBDT(patient.dueMicro ?? 0)}`,
          route: `/patients/${patient.id}`
        }))
      }
    })
  }

  if (can('appointments.view')) {
    collect('appointments', 'Appointments', () => {
      const page = listAppointments(ctx, { search: query, activeOnly: false, range: { preset: 'all' }, limit, offset: 0 })
      return {
        key: 'appointments',
        label: 'Appointments',
        total: page.total,
        items: page.items.map((appointment) => ({
          id: appointment.id,
          title: appointment.patientName,
          subtitle: [appointment.reason, appointment.dentistName].filter((part): part is string => Boolean(part)).join(' · '),
          meta: appointment.scheduledDate,
          route: `/appointments?date=${appointment.scheduledDate}`
        }))
      }
    })
  }

  if (can('billing.view')) {
    collect('invoices', 'Invoices', () => {
      const page = listInvoices(ctx, { search: query, limit, offset: 0 })
      return {
        key: 'invoices',
        label: 'Invoices',
        total: page.total,
        items: page.items.map((invoice) => ({
          id: invoice.id,
          title: invoice.invoiceNo,
          subtitle: invoice.patientName,
          meta: formatBDT(invoice.totalMicro),
          route: `/invoices/${invoice.id}`
        }))
      }
    })
  }

  if (can('payments.view')) {
    collect('payments', 'Payments', () => {
      const page = listPayments(ctx, { search: query, limit, offset: 0 })
      return {
        key: 'payments',
        label: 'Payments',
        total: page.total,
        items: page.items.map((payment) => ({
          id: payment.id,
          title: payment.receiptNo,
          subtitle: `${payment.patientName}${payment.invoiceNo ? ` · ${payment.invoiceNo}` : ''}`,
          meta: formatBDT(payment.amountMicro),
          route: payment.invoiceId ? `/invoices/${payment.invoiceId}` : `/patients/${payment.patientId}`
        }))
      }
    })
  }

  if (can('prescriptions.view')) {
    collect('prescriptions', 'Prescriptions', () => {
      const page = listPrescriptions(ctx, { search: query, limit, offset: 0 })
      return {
        key: 'prescriptions',
        label: 'Prescriptions',
        total: page.total,
        items: page.items.map((prescription) => ({
          id: prescription.id,
          title: prescription.rxNo,
          subtitle: prescription.patientName,
          meta: date(prescription.prescriptionAt),
          route: `/prescriptions/${prescription.id}`
        }))
      }
    })
  }

  if (can('clinical.view')) {
    collect('visits', 'Visits', () => {
      const page = listVisits(ctx, { search: query, limit, offset: 0 })
      return {
        key: 'visits',
        label: 'Visits',
        total: page.total,
        items: page.items.map((visit) => ({
          id: visit.id,
          title: visit.visitNo,
          subtitle: [visit.patientName, visit.diagnosis].filter((part): part is string => Boolean(part)).join(' · '),
          meta: date(visit.visitAt),
          route: `/visits/${visit.id}`
        }))
      }
    })

    collect('treatments', 'Treatments', () => {
      const rows = listTreatments(ctx, { search: query })
      return {
        key: 'treatments',
        label: 'Treatments',
        total: rows.length,
        items: rows.slice(0, limit).map((treatment) => ({
          id: treatment.id,
          title: treatment.nameBn ? `${treatment.name} · ${treatment.nameBn}` : treatment.name,
          subtitle: treatment.category ?? 'Uncategorised',
          meta: `${treatment.code} · ${formatBDT(treatment.defaultPriceMicro)}`,
          route: `/treatments?search=${encodeURIComponent(treatment.name)}`
        }))
      }
    })
  }

  if (can('inventory.view')) {
    collect('inventory', 'Inventory', () => {
      const page = listItems(ctx, { search: query, includeInactive: false, sort: 'name', limit, offset: 0 })
      return {
        key: 'inventory',
        label: 'Inventory',
        total: page.total,
        items: page.items.map((item) => ({
          id: item.id,
          title: item.name,
          subtitle: [item.code, item.category].filter((part): part is string => Boolean(part)).join(' · '),
          meta: `${item.quantityOnHand} ${item.unit}`,
          route: `/inventory/${item.id}`
        }))
      }
    })
  }

  if (can('suppliers.view')) {
    collect('suppliers', 'Suppliers', () => {
      const rows = listSuppliers(ctx, { search: query, includeInactive: false })
      return {
        key: 'suppliers',
        label: 'Suppliers',
        total: rows.length,
        items: rows.slice(0, limit).map((supplier) => ({
          id: supplier.id,
          title: supplier.name,
          subtitle: [supplier.contactPerson, supplier.phone].filter((part): part is string => Boolean(part)).join(' · ') || null,
          meta: supplier.dueMicro > 0 ? `Owed ${formatBDT(supplier.dueMicro)}` : null,
          route: `/inventory/suppliers?search=${encodeURIComponent(supplier.name)}`
        }))
      }
    })
  }

  if (can('staff.view')) {
    collect('staff', 'Staff', () => {
      const page = listStaff(ctx, { search: query, limit, offset: 0 })
      return {
        key: 'staff',
        label: 'Staff',
        total: page.total,
        items: page.items.map((member) => ({
          id: member.id,
          title: member.fullNameBn ? `${member.fullName} · ${member.fullNameBn}` : member.fullName,
          subtitle: [member.designation, member.department].filter((part): part is string => Boolean(part)).join(' · ') || null,
          meta: member.phone,
          route: '/settings/staff'
        }))
      }
    })
  }

  if (can('accounting.view')) {
    collect('accounting', 'Accounting', () => {
      const page = listEntries(ctx, { search: query, includeVoid: false, limit, offset: 0 })
      return {
        key: 'accounting',
        label: 'Accounting',
        total: page.total,
        items: page.items.map((entry) => ({
          id: entry.id,
          title: `${entry.entryNo} · ${entry.categoryName ?? 'Uncategorised'}`,
          subtitle: [entry.party, entry.description].filter((part): part is string => Boolean(part)).join(' · ') || null,
          meta: `${entry.kind === 'income' ? '+' : '−'}${formatBDT(Math.abs(entry.amountMicro))}`,
          route: `/accounting?search=${encodeURIComponent(entry.entryNo)}`
        }))
      }
    })
  }

  return { query, groups, total: groups.reduce((sum, group) => sum + group.total, 0) }
}
