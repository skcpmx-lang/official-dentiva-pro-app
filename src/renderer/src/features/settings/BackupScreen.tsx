import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DatabaseBackup, FolderOpen, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, NumberInput, Select, TextInput } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type {
  BackupRecord,
  BackupStatus,
  BackupValidation,
  RestoreEntry,
  ScannedBackup
} from '../../lib/types'
import type { EventPayloads } from '@shared/events'

/**
 * Backup and restore.
 *
 * The screen shows where packages are written, the automatic schedule, every package with its checksum
 * state, and the history of restores. A restore is deliberately slow and explicit: the package is
 * validated first, the operator must type RESTORE, a safety copy of the current data is taken
 * automatically, and the application restarts afterwards so nothing stale is left in memory.
 */

const KIND_LABELS: Record<string, string> = {
  full: 'Full',
  quick: 'Quick',
  auto: 'Automatic',
  pre_restore: 'Pre-restore',
  pre_migration: 'Pre-migration',
  manual: 'Added by hand'
}

const FREQUENCY_OPTIONS = [
  { value: '0', label: 'Off — back up only when I ask' },
  { value: '7', label: 'Every 7 days' },
  { value: '15', label: 'Every 15 days' },
  { value: '30', label: 'Every 30 days' }
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function restoreTone(result: string): 'success' | 'danger' | 'neutral' {
  if (result === 'success') return 'success'
  if (result === 'failed') return 'danger'
  return 'neutral'
}

export function BackupScreen(): ReactNode {
  const format = useFormatters()
  const canCreate = usePermission('backups.create')
  const canRestore = usePermission('backups.restore')
  const canConfigure = usePermission('backups.configure')

  const status = useInvoke('backups.status', {})
  const backups = useInvoke('backups.list', {})
  const restores = useInvoke('backups.restores', { limit: 25 })

  const [folder, setFolder] = useState('')
  const [frequencyDays, setFrequencyDays] = useState('7')
  const [retention, setRetention] = useState(10)
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<'full' | 'quick' | null>(null)
  const [restoring, setRestoring] = useState<BackupRecord | null>(null)
  const [scanOpen, setScanOpen] = useState(false)

  const statusData: BackupStatus | null = status.data

  useEffect(() => {
    if (!statusData) return
    setFolder(statusData.folder)
    setFrequencyDays(String(statusData.frequencyDays))
    setRetention(statusData.retention)
    setIncludeAttachments(statusData.includeAttachments)
  }, [statusData])

  const saveSettings = async (): Promise<void> => {
    setSaving(true)
    try {
      await invoke('backups.saveSettings', {
        folder: folder.trim() === '' ? null : folder.trim(),
        frequencyDays: Number(frequencyDays),
        retention,
        includeAttachments
      })
      toast('success', 'Backup settings saved', 'Automatic backups follow the new schedule.')
      await status.reload()
    } catch (error) {
      toast('error', 'The backup settings could not be saved', errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const chooseFolder = async (): Promise<void> => {
    try {
      const result = await invoke('backups.chooseFolder', {})
      if (result.folder) setFolder(result.folder)
    } catch (error) {
      toast('error', 'The folder could not be chosen', errorMessage(error))
    }
  }

  const create = async (kind: 'full' | 'quick'): Promise<void> => {
    setRunning(kind)
    try {
      const result = await invoke('backups.create', { kind })
      toast('success', kind === 'full' ? 'Full backup created' : 'Quick backup created', `${result.record.fileName} · ${formatBytes(result.sizeBytes)}`)
      await Promise.all([backups.reload(), status.reload()])
    } catch (error) {
      toast('error', 'The backup could not be created', errorMessage(error))
    } finally {
      setRunning(null)
    }
  }

  const remove = async (row: BackupRecord): Promise<void> => {
    const answer = await confirmDialog({
      title: 'Delete this backup?',
      message: `“${row.fileName}” will be removed from the list and deleted from disk.`,
      detail: 'Restoring from a deleted backup is no longer possible. Other packages are not affected.',
      confirmLabel: 'Delete backup',
      danger: true
    })
    if (!answer.confirmed) return
    try {
      await invoke('backups.delete', { id: row.id, removeFile: true })
      toast('success', 'Backup deleted', row.fileName)
      await backups.reload()
    } catch (error) {
      toast('error', 'The backup could not be deleted', errorMessage(error))
    }
  }

  const reveal = async (row: BackupRecord): Promise<void> => {
    try {
      await invoke('backups.reveal', { id: row.id })
    } catch (error) {
      toast('error', 'The file could not be shown', errorMessage(error))
    }
  }

  const columns: Array<Column<BackupRecord>> = useMemo(
    () => [
      {
        key: 'file',
        header: 'Backup',
        render: (row) => (
          <span className="stack" style={{ gap: 2 }}>
            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="link-strong">{row.fileName}</span>
              {row.verified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>}
              {!row.fileExists ? <Badge tone="danger">missing</Badge> : null}
            </span>
            <span className="muted small">
              {formatBytes(row.sizeBytes)} · schema v{row.schemaVersion} · created by {row.createdByName ?? 'system'}
            </span>
          </span>
        )
      },
      { key: 'kind', header: 'Kind', width: 130, render: (row) => KIND_LABELS[row.kind] ?? row.kind },
      { key: 'created', header: 'Created', width: 170, render: (row) => format.dateTime(row.createdAt) },
      {
        key: 'contents',
        header: 'Contents',
        width: 170,
        render: (row) =>
          `${row.patientCount ?? '—'} patient(s)${row.includesAttachments ? ' + files' : ', database only'}`
      }
    ],
    [format]
  )

  const restoreColumns: Array<Column<RestoreEntry>> = useMemo(
    () => [
      { key: 'when', header: 'When', width: 170, render: (row) => format.dateTime(row.startedAt) },
      { key: 'file', header: 'Package', render: (row) => row.fileName },
      {
        key: 'result',
        header: 'Result',
        width: 110,
        render: (row) => <Badge tone={restoreTone(row.result)}>{row.result.replace('_', ' ')}</Badge>
      },
      { key: 'message', header: 'Message', render: (row) => row.message ?? '—' }
    ],
    [format]
  )

  return (
    <div className="page">
      <PageHeader
        title="Backup & restore"
        subtitle="Packages are written offline as .dentivabackup files. A restore takes a safety copy first."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="tertiary"
              icon={<FolderOpen size={16} />}
              onClick={() => void invoke('backups.openFolder', {}).catch((error) => toast('error', 'The folder could not be opened', errorMessage(error)))}
              disabled={!canCreate}
            >
              Open folder
            </Button>
            <Button variant="secondary" icon={<DatabaseBackup size={16} />} onClick={() => void create('quick')} loading={running === 'quick'} disabled={!canCreate || running !== null}>
              Quick backup
            </Button>
            <Button variant="primary" icon={<DatabaseBackup size={16} />} onClick={() => void create('full')} loading={running === 'full'} disabled={!canCreate || running !== null}>
              Full backup
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader
          title="Automatic backups"
          subtitle="The scheduler runs while the application is open and keeps the newest packages."
          actions={
            <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void status.reload()} loading={status.loading}>
              Refresh
            </Button>
          }
        />
        <CardBody>
          <div className="form-grid">
            <Field label="Backup folder" hint="Packages are written here. It can be a network folder the clinic already backs up.">
              <div className="row" style={{ gap: 8 }}>
                <TextInput value={folder} onChange={setFolder} ariaLabel="Backup folder" disabled={!canConfigure} />
                <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void chooseFolder()} disabled={!canConfigure}>
                  Choose
                </Button>
              </div>
            </Field>
            <Field label="Schedule">
              <Select value={frequencyDays} onChange={setFrequencyDays} options={FREQUENCY_OPTIONS} ariaLabel="Automatic backup frequency" disabled={!canConfigure} />
            </Field>
            <Field label="Keep automatic backups" hint="1–100. Manual, pre-restore and pre-migration packages are never pruned.">
              <NumberInput value={retention} onChange={(value) => setRetention(value ?? 1)} min={1} max={100} ariaLabel="Automatic backups to keep" disabled={!canConfigure} />
            </Field>
            <Field label="Scheduled packages include attachments">
              <Switch checked={includeAttachments} onChange={setIncludeAttachments} label="Include attachments in scheduled backups" disabled={!canConfigure} />
            </Field>
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <Button variant="primary" onClick={() => void saveSettings()} loading={saving} disabled={!canConfigure}>
              Save settings
            </Button>
            <span className="muted small">
              Last run: {format.dateTime(statusData?.lastRunAt ?? null)} · Next run: {format.dateTime(statusData?.nextRunAt ?? null)}
              {statusData?.due ? ' · a backup is due' : ''}
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Packages"
          subtitle={`${backups.data?.items.length ?? 0} package(s) registered on this machine.`}
          actions={
            canConfigure ? (
              <Button size="sm" variant="ghost" icon={<ShieldCheck size={15} />} onClick={() => setScanOpen(true)}>
                Find files
              </Button>
            ) : null
          }
        />
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={backups.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={backups.loading}
            emptyTitle="No backups yet"
            emptyMessage="Create a full backup after finishing the day's work, and keep a copy outside this computer."
            rowActions={(row) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {canRestore ? (
                  <Button size="sm" variant="ghost" icon={<RotateCcw size={15} />} aria-label={`Restore ${row.fileName}`} onClick={() => setRestoring(row)} disabled={!row.fileExists}>
                    Restore
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={<FolderOpen size={15} />} aria-label={`Show ${row.fileName}`} onClick={() => void reveal(row)} disabled={!row.fileExists}>
                  Show
                </Button>
                {canConfigure ? (
                  <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} aria-label={`Delete ${row.fileName}`} onClick={() => void remove(row)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            )}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Restore history" subtitle="Every restore attempt, including the ones that were rolled back." />
        <CardBody flush>
          <DataTable
            columns={restoreColumns}
            rows={restores.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={restores.loading}
            emptyTitle="No restores have been made"
            emptyMessage="When a package is restored, the safety copy and the result are recorded here."
          />
        </CardBody>
      </Card>

      <RestoreDialog
        record={restoring}
        onClose={() => setRestoring(null)}
        onFinished={() => {
          void backups.reload()
          void restores.reload()
        }}
      />

      <ScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onAdopted={() => void backups.reload()} />
    </div>
  )
}

function RestoreDialog({
  record,
  onClose,
  onFinished
}: {
  record: BackupRecord | null
  onClose(): void
  onFinished(): void
}): ReactNode {
  const format = useFormatters()
  const [validation, setValidation] = useState<BackupValidation | null>(null)
  const [validating, setValidating] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [progress, setProgress] = useState<EventPayloads['backup:progress'] | null>(null)

  useEffect(() => {
    if (!record) {
      setValidation(null)
      setPhrase('')
      setFailure(null)
      setProgress(null)
      return
    }
    let cancelled = false
    setValidating(true)
    setValidation(null)
    setPhrase('')
    setFailure(null)
    setProgress(null)
    void invoke('backups.validate', { filePath: record.filePath })
      .then((result) => {
        if (!cancelled) setValidation(result)
      })
      .catch((error) => {
        if (!cancelled) setFailure(errorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setValidating(false)
      })
    return () => {
      cancelled = true
    }
  }, [record])

  useEffect(() => {
    if (!record || !busy) return
    return window.dentiva.on('backup:progress', (payload) => setProgress(payload))
  }, [record, busy])

  const confirmed = phrase.trim().toLowerCase() === 'restore' && validation?.ok === true

  const start = async (): Promise<void> => {
    if (!record) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await invoke('backups.restore', { filePath: record.filePath, confirmation: phrase })
      toast('success', 'Restore complete', `${result.message} Dentiva Pro will restart to reload everything.`)
      onFinished()
      onClose()
    } catch (error) {
      setFailure(errorMessage(error))
      onFinished()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={record !== null}
      size="lg"
      busy={busy}
      title={record ? `Restore ${record.fileName}` : 'Restore'}
      description="The clinic data on this computer will be replaced by the contents of the package."
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void start()} loading={busy} disabled={!confirmed || busy}>
            Restore now
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {validating ? <p className="muted">Checking the package and its checksums…</p> : null}

        {validation && !validation.ok ? (
          <div className="notice notice--danger">
            <strong>This package cannot be restored.</strong>
            <ul>
              {validation.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {validation?.ok ? (
          <div className="stack" style={{ gap: 4 }}>
            <p>
              <strong>Package verified.</strong> Written {format.dateTime(validation.createdAt)} by Dentiva Pro {validation.appVersion ?? '—'} (schema v
              {validation.schemaVersion ?? '—'}).
            </p>
            <p className="muted small">
              Contains {validation.patientCount ?? 0} patient(s){validation.includesAttachments ? ' and the attachment archive' : ' and no attachments'}. The
              current data is backed up automatically before anything is replaced.
            </p>
          </div>
        ) : null}

        {failure ? (
          <div className="notice notice--danger">
            <strong>Restore failed</strong>
            <p>{failure}</p>
          </div>
        ) : null}

        {busy ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="progress">
              <div className="progress__bar" style={{ width: `${progress?.percent ?? 5}%` }} />
            </div>
            <span className="muted small">{progress?.message ?? 'Starting…'}</span>
          </div>
        ) : (
          <Field label="Type RESTORE to confirm" hint="This replaces all patients, visits, prescriptions, invoices and payments on this computer.">
            <TextInput value={phrase} onChange={setPhrase} ariaLabel="Restore confirmation" placeholder="RESTORE" disabled={validation?.ok !== true} />
          </Field>
        )}
      </div>
    </Modal>
  )
}

function ScanDialog({ open, onClose, onAdopted }: { open: boolean; onClose(): void; onAdopted(): void }): ReactNode {
  const [items, setItems] = useState<ScannedBackup[]>([])
  const [loading, setLoading] = useState(false)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await invoke('backups.scan', {})
      setItems(result.items)
    } catch (error) {
      toast('error', 'The folder could not be read', errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const adopt = async (item: ScannedBackup): Promise<void> => {
    setBusyPath(item.filePath)
    try {
      await invoke('backups.adopt', { filePath: item.filePath })
      toast('success', 'Package added to the list', item.fileName)
      await load()
      onAdopted()
    } catch (error) {
      toast('error', 'The package could not be added', errorMessage(error))
    } finally {
      setBusyPath(null)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Packages in the backup folder"
      description="Files copied here from another computer can be added to the list after they pass validation."
      onClose={onClose}
      footer={
        <Button variant="tertiary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {loading ? <p className="muted">Reading the folder…</p> : null}
      {!loading && items.length === 0 ? <p className="muted">No .dentivabackup or .db files were found in the folder.</p> : null}
      {items.length > 0 ? (
        <ul className="plain-list">
          {items.map((item) => (
            <li key={item.filePath} className="plain-list__item">
              <span className="stack" style={{ gap: 2 }}>
                <span className="link-strong">{item.fileName}</span>
                <span className="muted small">{formatBytes(item.sizeBytes)}</span>
              </span>
              {item.registered ? (
                <Badge tone="neutral">already listed</Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => void adopt(item)} loading={busyPath === item.filePath}>
                  Add to list
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  )
}
