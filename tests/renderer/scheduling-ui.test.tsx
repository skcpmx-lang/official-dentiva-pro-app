import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppointmentsScreen } from '../../src/renderer/src/features/scheduling/AppointmentsScreen'
import { QueueScreen } from '../../src/renderer/src/features/scheduling/QueueScreen'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import { fromLocalDate } from '@shared/datetime'
import type { ChannelOutput } from '@shared/contracts'
import type { Appointment, QueueEntry, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Scheduling screens.
 *
 * These tests drive the appointment book and the queue the way the front desk does — confirm a booking,
 * cancel with a reason, call the next patient — and assert on the channel calls the screens make. A
 * control wired to nothing would fail here, which is exactly what §90 requires.
 */

const PERMISSIONS = ['patients.view', 'appointments.view', 'appointments.create', 'appointments.edit', 'appointments.cancel', 'appointments.delete', 'queue.view', 'queue.manage']

function signIn(permissions: string[] = PERMISSIONS): void {
  const session: SessionSummary = {
    id: 'session-test',
    userId: 1,
    username: 'frontdesk',
    fullName: 'Front Desk',
    roleCode: 'receptionist',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

const TODAY = '2026-10-01'
const AT = fromLocalDate(TODAY) + 10 * 3_600_000

function appointmentFixture(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 5,
    patientId: 7,
    dentistId: 3,
    patientCode: 'DP-2609-0001',
    patientName: 'Rakib Hasan',
    patientNameBn: 'রাকিব হাসান',
    patientPhone: '01712345678',
    dentistName: 'Dr Ayesha Rahman',
    scheduledAt: AT,
    scheduledDate: TODAY,
    durationMin: 30,
    reason: 'Toothache',
    notes: null,
    status: 'scheduled',
    cancelledReason: null,
    rescheduledFrom: null,
    visitId: null,
    createdAt: AT,
    updatedAt: AT,
    queueEntryId: null,
    queueNo: null,
    queueStatus: null,
    ...overrides
  }
}

function queueEntryFixture(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 11,
    queueNo: 1,
    patientId: 7,
    patientCode: 'DP-2609-0001',
    patientName: 'Rakib Hasan',
    patientNameBn: 'রাকিব হাসান',
    patientPhone: '01712345678',
    dentistId: 3,
    dentistName: 'Dr Ayesha Rahman',
    appointmentId: null,
    visitId: null,
    status: 'waiting',
    priority: 0,
    joinedAt: Date.now() - 10 * 60_000,
    calledAt: null,
    startedAt: null,
    completedAt: null,
    note: null,
    waitingMinutes: 10,
    ...overrides
  }
}

describe('appointment book', () => {
  it('shows the day, the load per dentist and moves an appointment forward through its statuses', async () => {
    signIn()
    let current = appointmentFixture()
    mockChannels({
      'appointments.day': () => ({
        date: TODAY,
        load: [{ dentistId: 3, dentistName: 'Dr Ayesha Rahman', minutes: 30, appointments: 1 }],
        items: [current]
      }),
      'appointments.list': () => ({ items: [current], total: 1, limit: 100, offset: 0 }),
      'dentists.list': () => [{ id: 3, fullName: 'Dr Ayesha Rahman' }] as unknown as ChannelOutput<'dentists.list'>,
      'appointments.setStatus': (payload) => {
        current = appointmentFixture({ status: payload.status, cancelledReason: payload.reason ?? null })
        return current
      }
    })

    render(
      <MemoryRouter initialEntries={['/appointments']}>
        <Routes>
          <Route path="/appointments" element={<AppointmentsScreen />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('Rakib Hasan')).toBeInTheDocument()
    expect(screen.getByText('10:00')).toBeInTheDocument()
    expect(screen.getByText(/1 booking\(s\) · 0.5 h/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      const call = callLog.find((entry) => entry.channel === 'appointments.setStatus')
      expect(call?.payload).toMatchObject({ id: 5, status: 'confirmed' })
    })
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
  })

  it('asks for a reason before cancelling and sends it to the service', async () => {
    signIn()
    mockChannels({
      'appointments.day': () => ({ date: TODAY, load: [], items: [appointmentFixture()] }),
      'appointments.list': () => ({ items: [appointmentFixture()], total: 1, limit: 100, offset: 0 }),
      'dentists.list': () => [] as unknown as ChannelOutput<'dentists.list'>,
      'appointments.setStatus': () => appointmentFixture({ status: 'cancelled', cancelledReason: 'Patient called to cancel' })
    })

    render(
      <MemoryRouter initialEntries={['/appointments']}>
        <Routes>
          <Route path="/appointments" element={<AppointmentsScreen />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    const confirmButton = await screen.findByRole('button', { name: 'Cancel appointment' })
    expect(confirmButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Patient called to cancel' } })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() => {
      const call = callLog.find((entry) => entry.channel === 'appointments.setStatus')
      expect(call?.payload).toMatchObject({ id: 5, status: 'cancelled', reason: 'Patient called to cancel' })
    })
  })
})

describe('waiting queue', () => {
  it('renders the board and calls the next patient', async () => {
    signIn()
    let entries = [queueEntryFixture(), queueEntryFixture({ id: 12, queueNo: 2, patientName: 'Nabila Akter', patientCode: 'DP-2609-0002', status: 'called', calledAt: Date.now(), waitingMinutes: 4 })]
    mockChannels({
      'queue.board': () => ({
        date: TODAY,
        items: entries,
        counters: {
          waiting: entries.filter((entry) => entry.status === 'waiting').length,
          called: entries.filter((entry) => entry.status === 'called').length,
          inProgress: 0,
          completedToday: 0,
          skipped: 0,
          averageWaitMinutes: 12
        }
      }),
      'queue.setStatus': (payload) => {
        entries = entries.map((entry) => (entry.id === payload.id ? { ...entry, status: payload.status, calledAt: Date.now() } : entry))
        return entries.find((entry) => entry.id === payload.id) as QueueEntry
      }
    })

    render(
      <MemoryRouter initialEntries={['/queue']}>
        <Routes>
          <Route path="/queue" element={<QueueScreen />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
    expect(screen.getByText('12 min')).toBeInTheDocument()
    expect(screen.getByText('Rakib Hasan')).toBeInTheDocument()
    expect(screen.getByText(/waiting 10 min · Dr Ayesha Rahman/)).toBeInTheDocument()
    expect(screen.getByText(/waiting 4 min · Dr Ayesha Rahman/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    await waitFor(() => {
      const call = callLog.find((entry) => entry.channel === 'queue.setStatus')
      expect(call?.payload).toMatchObject({ id: 11, status: 'called' })
    })
  })

  it('hides queue controls from a role that may only watch', async () => {
    signIn(['queue.view'])
    mockChannels({
      'queue.board': () => ({
        date: TODAY,
        items: [queueEntryFixture()],
        counters: { waiting: 1, called: 0, inProgress: 0, completedToday: 0, skipped: 0, averageWaitMinutes: null }
      })
    })

    render(
      <MemoryRouter initialEntries={['/queue']}>
        <Routes>
          <Route path="/queue" element={<QueueScreen />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('#1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Call' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add to queue/ })).not.toBeInTheDocument()
  })
})
