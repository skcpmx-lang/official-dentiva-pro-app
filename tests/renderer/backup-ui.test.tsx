import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackupScreen } from '../../src/renderer/src/features/settings/BackupScreen'
import { Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { BackupRecord, BackupStatus, BackupValidation, RestoreEntry, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Backup & restore screen.
 *
 * The screen must show the real schedule and packages, save exactly what the operator chose, and never
 * let a restore start before the package passed validation and RESTORE was typed — that is the last
 * guard before the clinic's data is replaced.
 */

function signIn(permissions: string[] = ['backups.create', 'backups.restore', 'backups.configure']): void {
  const session: SessionSummary = {
    id: 'session-backup',
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

const status: BackupStatus = {
  folder: 'C:\\Users\\Clinic\\Documents\\Dentiva Pro Backups',
  frequencyDays: 7,
  retention: 10,
  includeAttachments: true,
  lastRunAt: Date.UTC(2026, 8, 1, 14, 0),
  nextRunAt: Date.UTC(2026, 8, 8, 14, 0),
  due: false,
  automaticCount: 2,
  totalCount: 4,
  schemaVersion: 2,
  appVersion: '1.0.0'
}

const record: BackupRecord = {
  id: 11,
  fileName: 'DentivaPro-2026-09-01_20-00-00-full.dentivabackup',
  filePath: 'C:\\Users\\Clinic\\Documents\\Dentiva Pro Backups\\DentivaPro-2026-09-01_20-00-00-full.dentivabackup',
  kind: 'full',
  sizeBytes: 12_345_678,
  checksum: 'a'.repeat(64),
  schemaVersion: 2,
  appVersion: '1.0.0',
  createdAt: Date.UTC(2026, 8, 1, 14, 0),
  createdByName: 'Shohan Khan',
  verified: true,
  includesAttachments: true,
  patientCount: 412,
  note: null,
  fileExists: true
}

const restores: RestoreEntry[] = [
  {
    id: 3,
    fileName: 'DentivaPro-2026-08-20_20-00-00-full.dentivabackup',
    startedAt: Date.UTC(2026, 7, 20, 15, 0),
    finishedAt: Date.UTC(2026, 7, 20, 15, 1),
    result: 'success',
    message: 'Restored from DentivaPro-2026-08-20_20-00-00-full.dentivabackup',
    preRestoreBackupId: 9
  }
]

const validPackage: BackupValidation = {
  ok: true,
  problems: [],
  fileName: record.fileName,
  appVersion: '1.0.0',
  createdAt: record.createdAt,
  schemaVersion: 2,
  includesAttachments: true,
  patientCount: 412,
  counts: { patients: 412 }
}

function mockBackupChannels(validation: BackupValidation = validPackage): void {
  mockChannels({
    'backups.status': () => status,
    'backups.list': () => ({ items: [record] }),
    'backups.restores': () => ({ items: restores }),
    'backups.validate': () => validation,
    'backups.restore': () => ({
      ok: true as const,
      message: 'Restored the package.',
      preRestoreBackupId: 12,
      counts: { patients: 412 },
      relaunching: true
    }),
    'backups.saveSettings': () => status
  })
}

describe('backup screen', () => {
  it('shows the schedule and packages, and saves the chosen settings', async () => {
    signIn()
    mockBackupChannels()
    render(
      <>
        <BackupScreen />
        <Toaster />
      </>
    )

    expect(await screen.findByText(record.fileName)).toBeInTheDocument()
    expect(screen.getByText(/412 patient\(s\) \+ files/)).toBeInTheDocument()
    expect(screen.getByText(/Last run:/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Automatic backup frequency'), '30')
    const retention = screen.getByLabelText('Automatic backups to keep')
    await userEvent.click(retention)
    await userEvent.keyboard('{Control>}a{/Control}5')
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      const saved = callLog.filter((entry) => entry.channel === 'backups.saveSettings').at(-1)
      expect(saved?.payload).toEqual({
        folder: status.folder,
        frequencyDays: 30,
        retention: 5,
        includeAttachments: true
      })
    })
    expect(await screen.findByText('Backup settings saved')).toBeInTheDocument()
  })

  it('requires a validated package and the typed confirmation before restoring', async () => {
    signIn()
    mockBackupChannels()
    render(
      <>
        <BackupScreen />
        <Toaster />
      </>
    )

    await userEvent.click(await screen.findByRole('button', { name: `Restore ${record.fileName}` }))

    /* Validation runs as soon as the dialog opens and the summary is shown. */
    expect(await screen.findByText(/Package verified/)).toBeInTheDocument()
    expect(callLog.some((entry) => entry.channel === 'backups.validate')).toBe(true)

    const confirm = screen.getByRole('button', { name: 'Restore now' })
    expect(confirm).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Restore confirmation'), 'restore')
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.click(confirm)

    await waitFor(() => {
      const called = callLog.filter((entry) => entry.channel === 'backups.restore').at(-1)
      expect(called?.payload).toEqual({ filePath: record.filePath, confirmation: 'restore' })
    })
    expect(await screen.findByText('Restore complete')).toBeInTheDocument()
  })

  it('blocks the restore when the package fails validation', async () => {
    signIn()
    mockBackupChannels({
      ok: false,
      problems: ['The package is incomplete: database/dentiva.db is missing.'],
      fileName: record.fileName,
      appVersion: null,
      createdAt: null,
      schemaVersion: null,
      includesAttachments: null,
      patientCount: null,
      counts: null
    })
    render(
      <>
        <BackupScreen />
        <Toaster />
      </>
    )

    await userEvent.click(await screen.findByRole('button', { name: `Restore ${record.fileName}` }))
    expect(await screen.findByText('This package cannot be restored.')).toBeInTheDocument()
    expect(screen.getByText('The package is incomplete: database/dentiva.db is missing.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Restore confirmation'), 'RESTORE')
    expect(screen.getByRole('button', { name: 'Restore now' })).toBeDisabled()
    expect(callLog.some((entry) => entry.channel === 'backups.restore')).toBe(false)
  })
})
