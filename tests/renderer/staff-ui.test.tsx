import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StaffScreen } from '../../src/renderer/src/features/settings/StaffScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { SessionSummary, Staff } from '../../src/renderer/src/lib/types'

/**
 * Staff register screen.
 *
 * The register is exercised the way an admin uses it: search, filter, add a person, correct their details
 * and archive them with a reason. Every assertion is on the payload the screen sent, so a control that
 * stops doing real work fails here (§90). Permissions are checked from the same store the shell reads.
 */

function signIn(permissions: string[] = ['staff.view', 'staff.manage']): void {
  const session: SessionSummary = {
    id: 'session-staff',
    userId: 1,
    username: 'admin',
    fullName: 'Shohan Khan',
    roleCode: 'administrator',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

function staffFixture(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 11,
    fullName: 'Rahima Begum',
    fullNameBn: 'রহিমা বেগম',
    dob: '1994-03-12',
    gender: 'female',
    address: 'Holding 14, Santkhola Road, Tangail',
    phone: '01711002200',
    emergencyContact: null,
    bloodGroup: 'B+',
    nationalId: '1994123456789',
    designation: 'Dental assistant',
    department: 'Clinical',
    salaryMicro: 1_800_000,
    joiningDate: '2023-02-01',
    employmentStatus: 'active',
    notes: null,
    photoPath: null,
    linkedUserId: null,
    linkedUsername: null,
    createdAt: Date.UTC(2023, 1, 1),
    ...overrides
  }
}

function renderStaff(): void {
  render(
    <MemoryRouter initialEntries={['/settings/staff']}>
      <StaffScreen />
      <ConfirmDialogHost />
      <Toaster />
    </MemoryRouter>
  )
}

describe('staff register', () => {
  it('lists staff with Bangla names and re-queries on search, status and archived filters', async () => {
    signIn()
    const assistant = staffFixture()
    const receptionist = staffFixture({
      id: 12,
      fullName: 'Nurul Islam',
      fullNameBn: 'নুরুল ইসলাম',
      designation: 'Receptionist',
      department: 'Front desk',
      phone: '01822334455',
      employmentStatus: 'probation',
      salaryMicro: 1_500_000
    })
    mockChannels({ 'staff.list': () => ({ items: [assistant, receptionist], total: 2 }) })

    renderStaff()

    expect(await screen.findByText('Rahima Begum')).toBeInTheDocument()
    /* Bengali spellings must survive to the table (§5). */
    expect(screen.getByText('নুরুল ইসলাম')).toBeInTheDocument()
    /* "Probation" is both the row badge and one of the filter options. */
    expect(screen.getAllByText('Probation').length).toBeGreaterThan(1)
    /* 1 800 000 micro-Taka is ৳ 180.00 and is formatted only here, at the edge. */
    expect(screen.getByText('৳ 180.00')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search staff'), { target: { value: 'nurul' } })
    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'staff.list').at(-1)?.payload as { search?: string }
      expect(filter.search).toBe('nurul')
    })

    fireEvent.change(screen.getByLabelText('Employment status'), { target: { value: 'probation' } })
    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'staff.list').at(-1)?.payload as { status?: string }
      expect(filter.status).toBe('probation')
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Show archived' }))
    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'staff.list').at(-1)?.payload as { includeArchived?: boolean }
      expect(filter.includeArchived).toBe(true)
    })
  })

  it('adds a staff member through the save channel', async () => {
    signIn()
    mockChannels({ 'staff.list': () => ({ items: [staffFixture()], total: 1 }) })
    let saved: {
      fullName?: string
      designation?: string | null
      phone?: string | null
      salaryMicro?: number | null
      joiningDate?: string | null
      employmentStatus?: string
    } | null = null
    mockChannels({
      'staff.save': (payload) => {
        saved = payload
        return staffFixture({ id: 21, fullName: payload.fullName, designation: payload.designation ?? null, phone: payload.phone ?? null, salaryMicro: payload.salaryMicro ?? null, joiningDate: payload.joiningDate ?? null })
      }
    })

    renderStaff()
    await screen.findByText('Rahima Begum')
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }))

    fireEvent.change(await screen.findByLabelText(/Full name/), { target: { value: 'Jamal Uddin' } })
    fireEvent.change(screen.getByLabelText(/Designation/), { target: { value: 'Technician' } })
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: '01911223344' } })
    const salary = screen.getByLabelText(/Monthly salary/)
    fireEvent.change(salary, { target: { value: '15000' } })
    fireEvent.blur(salary)
    fireEvent.change(screen.getByLabelText(/Joining date/), { target: { value: '2025-01-15' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add to register' }))

    await waitFor(() => {
      expect(saved).not.toBeNull()
      expect(saved?.fullName).toBe('Jamal Uddin')
      expect(saved?.designation).toBe('Technician')
      expect(saved?.phone).toBe('01911223344')
      expect(saved?.salaryMicro).toBe(150_000_000)
      expect(saved?.joiningDate).toBe('2025-01-15')
      expect(saved?.employmentStatus).toBe('active')
    })
    expect(await screen.findByText('Jamal Uddin added to the register')).toBeInTheDocument()
  })

  it('archives a staff member with a reason and stores an uploaded photo', async () => {
    signIn()
    const target = staffFixture()
    mockChannels({ 'staff.list': () => ({ items: [target], total: 1 }) })
    let archived: { id?: number, reason?: string | null } | null = null
    let uploaded: { id?: number, fileName?: string, dataBase64?: string } | null = null
    mockChannels({
      'staff.archive': (payload) => {
        archived = payload
        return { ok: true as const }
      },
      'staff.uploadPhoto': (payload) => {
        uploaded = payload
        return staffFixture({ photoPath: `staff-photos/${payload.fileName}` })
      }
    })

    renderStaff()
    await screen.findByText('Rahima Begum')
    fireEvent.click(screen.getByRole('button', { name: 'Archive Rahima Begum' }))

    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: 'Left for a job in Dhaka' } })
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(archived).not.toBeNull()
      expect(archived?.id).toBe(11)
      expect(archived?.reason).toBe('Left for a job in Dhaka')
    })
    expect(await screen.findByText('Rahima Begum archived')).toBeInTheDocument()

    /* A photo goes through the same record, base64 encoded, never to a network path. */
    fireEvent.click(screen.getByRole('button', { name: 'Edit Rahima Begum' }))
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'rahima.png', { type: 'image/png' })
    const input = await screen.findByLabelText(/Photo/)
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload now' }))

    await waitFor(() => {
      expect(uploaded).not.toBeNull()
      expect(uploaded?.id).toBe(11)
      expect(uploaded?.fileName).toBe('rahima.png')
      expect(uploaded?.dataBase64?.length).toBeGreaterThan(0)
    })
  })

  it('shows the register read-only when the role may not manage staff', async () => {
    signIn(['staff.view'])
    mockChannels({ 'staff.list': () => ({ items: [staffFixture()], total: 1 }) })

    renderStaff()

    expect(await screen.findByText('Rahima Begum')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add staff member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Rahima Begum' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive Rahima Begum' })).not.toBeInTheDocument()
  })
})
