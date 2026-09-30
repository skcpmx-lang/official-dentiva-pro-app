import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, Pencil, Plus, Printer, RefreshCw } from 'lucide-react'
import { zPrintProfileInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, NumberInput, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { PrintDocumentInfo, PrintPaperClass, PrintProfile, PrintProfileInput, PrinterStatus } from '../../lib/types'

/**
 * Printing settings.
 *
 * The printers this machine reports, the paper each document goes on, and one profile per document type
 * that the print dialog uses by default. Everything here is stored in the database, so a clinic that has
 * set up its thermal printer for receipts keeps that choice after a restart or a restore.
 */

const DOCUMENT_LABELS: Record<string, string> = {
  prescription: 'Prescription',
  invoice: 'Invoice',
  payment_receipt: 'Payment receipt',
  appointment_slip: 'Appointment slip',
  patient_summary: 'Patient summary',
  report: 'Report',
  test: 'Test page'
}

const PAPER_OPTIONS: Array<{ value: PrintPaperClass, label: string }> = [
  { value: 'a4', label: 'A4 — 210 × 297 mm' },
  { value: 'a5', label: 'A5 — 148 × 210 mm' },
  { value: 'thermal', label: 'Thermal roll — 58 / 80 mm' },
  { value: 'mini', label: 'Mini slip — 80 × 120 mm' },
  { value: 'custom', label: 'Custom size' }
]

function paperLabel(profile: PrintProfile): string {
  if (profile.paperClass === 'custom') return `Custom ${profile.customWidthMm ?? '—'} × ${profile.customHeightMm ?? '—'} mm`
  if (profile.paperClass === 'thermal') return `Thermal ${profile.thermalWidthMm} mm`
  return profile.paperClass.toUpperCase()
}

function profileDefaults(profile?: PrintProfile | null): PrintProfileInput {
  if (profile) {
    return {
      id: profile.id,
      name: profile.name,
      documentType: profile.documentType,
      printerName: profile.printerName,
      paperClass: profile.paperClass,
      customWidthMm: profile.customWidthMm,
      customHeightMm: profile.customHeightMm,
      thermalWidthMm: profile.thermalWidthMm,
      orientation: profile.orientation,
      marginsMm: { ...profile.marginsMm },
      scaleBp: profile.scaleBp,
      copies: profile.copies,
      isDefault: profile.isDefault,
      isActive: profile.isActive,
      notes: profile.notes
    }
  }
  return {
    id: null,
    name: '',
    documentType: 'prescription',
    printerName: null,
    paperClass: 'a4',
    customWidthMm: null,
    customHeightMm: null,
    thermalWidthMm: 80,
    orientation: 'portrait',
    marginsMm: { top: 12, right: 12, bottom: 12, left: 12 },
    scaleBp: 10000,
    copies: 1,
    isDefault: false,
    isActive: true,
    notes: null
  }
}

export function PrintingScreen(): ReactNode {
  const format = useFormatters()
  const canConfigure = usePermission('printing.configure')
  const canPrint = usePermission('printing.print')

  const printers = useInvoke('printing.printers', {})
  const profiles = useInvoke('printing.profiles', { includeInactive: true })
  const catalog = useInvoke('printing.documents', {})

  const [editing, setEditing] = useState<PrintProfile | null>(null)
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState<PrintProfile | null>(null)
  const [testOpen, setTestOpen] = useState(false)

  const status: PrinterStatus | null = printers.data
  const documents: PrintDocumentInfo[] = catalog.data ?? []

  const columns: Array<Column<PrintProfile>> = useMemo(
    () => [
      {
        key: 'name',
        header: 'Profile',
        render: (row) => (
          <span className="stack" style={{ gap: 2 }}>
            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="link-strong">{row.name}</span>
              {row.isDefault ? <Badge tone="info">default</Badge> : null}
              {!row.isActive ? <Badge tone="neutral">inactive</Badge> : null}
            </span>
            {row.notes ? <span className="muted small">{row.notes}</span> : null}
          </span>
        )
      },
      { key: 'documentType', header: 'Document', width: 150, render: (row) => DOCUMENT_LABELS[row.documentType] ?? row.documentType },
      { key: 'printer', header: 'Printer', width: 190, render: (row) => row.printerName ?? 'System default' },
      { key: 'paper', header: 'Paper', width: 170, render: (row) => paperLabel(row) },
      { key: 'orientation', header: 'Orientation', width: 110, render: (row) => (row.orientation === 'landscape' ? 'Landscape' : 'Portrait') },
      { key: 'copies', header: 'Copies', width: 80, align: 'right', render: (row) => row.copies },
      {
        key: 'updatedAt',
        header: 'Updated',
        width: 150,
        render: (row) => format.dateTime(row.updatedAt)
      }
    ],
    [format]
  )

  return (
    <div className="page">
      <PageHeader
        title="Printing"
        subtitle="Printers, paper and the profiles the preview and print dialogs use."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" icon={<Printer size={16} />} onClick={() => setTestOpen(true)} disabled={!status?.available}>
              Test page
            </Button>
            {canConfigure ? (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                New profile
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader
          title="Printers on this machine"
          subtitle="Enumerated offline through the Windows print spooler."
          actions={
            <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void printers.reload()} loading={printers.loading}>
              Refresh
            </Button>
          }
        />
        <CardBody>
          {status && !status.available ? (
            <p className="muted">No printing subsystem was reported. Documents can still be previewed and saved as PDF.</p>
          ) : null}
          {status && status.available && status.printers.length === 0 ? (
            <p className="muted">No printers are installed. Add one in Windows, then refresh.</p>
          ) : null}
          {status && status.printers.length > 0 ? (
            <ul className="plain-list">
              {status.printers.map((printer) => (
                <li key={printer.name} className="plain-list__item">
                  <span className="stack" style={{ gap: 2 }}>
                    <span className="link-strong">{printer.displayName}</span>
                    <span className="muted small">
                      {printer.description || 'No port reported'} · status code {printer.status}
                    </span>
                  </span>
                  {printer.isDefault ? <Badge tone="info">default</Badge> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {status && status.missingFonts.length > 0 ? (
            <p className="muted small">Bundled font files missing: {status.missingFonts.join(', ')}. System fallbacks were used — installed output may differ from the preview.</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Profiles"
          subtitle="One default per document type; the print dialog falls back to the clinic defaults when none is set."
        />
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={profiles.data ?? []}
            getRowId={(row) => row.id}
            loading={profiles.loading}
            emptyTitle="No printer profiles"
            emptyMessage="Add a profile to pin a document to a printer, paper size, margin and copy count."
            rowActions={(row) =>
              canConfigure ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon={<Pencil size={15} />} aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Archive size={15} />} aria-label={`Archive ${row.name}`} onClick={() => setArchiving(row)} disabled={!row.isActive}>
                    Archive
                  </Button>
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <ProfileDialog
        open={creating || editing !== null}
        profile={editing}
        printers={status?.printers ?? []}
        documents={documents}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void profiles.reload()}
      />

      <ArchiveProfileDialog
        profile={archiving}
        onClose={() => setArchiving(null)}
        onArchived={() => void profiles.reload()}
      />

      <TestPageDialog
        open={testOpen}
        printers={status?.printers ?? []}
        onClose={() => setTestOpen(false)}
      />

      {!canPrint ? <p className="muted small">Your role can configure profiles but not send documents to a printer.</p> : null}
    </div>
  )
}

function ProfileDialog({
  open,
  profile,
  printers,
  documents,
  onClose,
  onSaved
}: {
  open: boolean
  profile: PrintProfile | null
  printers: PrinterStatus['printers']
  documents: PrintDocumentInfo[]
  onClose(): void
  onSaved(): void
}): ReactNode {
  const form = useZodForm(zPrintProfileInput, profileDefaults(profile))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    form.reset(profileDefaults(profile))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile])

  const paperClass = form.values.paperClass as PrintPaperClass
  const documentType = form.values.documentType as string
  const allowedPaper = documents.find((entry) => entry.type === documentType)?.paperClasses ?? ['a4']

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      await invoke('printing.profile.save', form.values as PrintProfileInput)
      toast('success', profile ? 'Profile updated' : 'Profile created', form.values.name)
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The profile could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      busy={busy}
      title={profile ? `Edit ${profile.name}` : 'New printer profile'}
      description="Applies to every preview, print and PDF for this document type unless another profile is chosen."
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            Save profile
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="grid grid--2">
          <Field label="Profile name" htmlFor="profile-name" required>
            <TextInput id="profile-name" value={form.values.name} onChange={(value) => form.setValue('name', value)} maxLength={60} />
          </Field>
          <Field label="Document type" htmlFor="profile-document">
            <Select
              id="profile-document"
              value={documentType}
              onChange={(value) => form.setValue('documentType', value as PrintProfileInput['documentType'])}
              options={documents.map((entry) => ({ value: entry.type, label: entry.title }))}
              ariaLabel="Document type"
            />
          </Field>
        </div>

        <div className="grid grid--2">
          <Field label="Printer" htmlFor="profile-printer" hint="Leave empty to use the Windows default printer.">
            <Select
              id="profile-printer"
              value={form.values.printerName ?? ''}
              onChange={(value) => form.setValue('printerName', value === '' ? null : value)}
              options={[{ value: '', label: 'System default' }, ...printers.map((printer) => ({ value: printer.name, label: printer.displayName }))]}
              ariaLabel="Printer"
            />
          </Field>
          <Field label="Copies" htmlFor="profile-copies">
            <NumberInput id="profile-copies" value={form.values.copies ?? 1} min={1} max={10} onChange={(value) => form.setValue('copies', value ?? 1)} />
          </Field>
        </div>

        <div className="grid grid--2">
          <Field label="Paper" htmlFor="profile-paper">
            <Select
              id="profile-paper"
              value={paperClass}
              onChange={(value) => form.setValue('paperClass', value as PrintPaperClass)}
              options={PAPER_OPTIONS.filter((option) => allowedPaper.includes(option.value))}
              ariaLabel="Paper"
            />
          </Field>
          <Field label="Orientation" htmlFor="profile-orientation">
            <Select
              id="profile-orientation"
              value={form.values.orientation ?? 'portrait'}
              onChange={(value) => form.setValue('orientation', value as PrintProfileInput['orientation'])}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' }
              ]}
              ariaLabel="Orientation"
            />
          </Field>
        </div>

        {paperClass === 'custom' ? (
          <div className="grid grid--2">
            <Field label="Width (mm)" htmlFor="profile-width">
              <NumberInput id="profile-width" value={form.values.customWidthMm ?? null} min={40} max={297} onChange={(value) => form.setValue('customWidthMm', value)} />
            </Field>
            <Field label="Height (mm)" htmlFor="profile-height">
              <NumberInput id="profile-height" value={form.values.customHeightMm ?? null} min={40} max={431} onChange={(value) => form.setValue('customHeightMm', value)} />
            </Field>
          </div>
        ) : null}

        {paperClass === 'thermal' ? (
          <Field label="Roll width" htmlFor="profile-thermal">
            <Select
              id="profile-thermal"
              value={String(form.values.thermalWidthMm ?? 80)}
              onChange={(value) => form.setValue('thermalWidthMm', value === '58' ? 58 : 80)}
              options={[
                { value: '58', label: '58 mm' },
                { value: '80', label: '80 mm' }
              ]}
              ariaLabel="Roll width"
            />
          </Field>
        ) : null}

        <div className="grid grid--2">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <Field key={side} label={`${side[0]!.toUpperCase()}${side.slice(1)} margin (mm)`} htmlFor={`profile-margin-${side}`}>
              <NumberInput
                id={`profile-margin-${side}`}
                value={form.values.marginsMm?.[side] ?? 12}
                min={0}
                max={40}
                onChange={(value) => form.setValue('marginsMm', { ...(form.values.marginsMm ?? { top: 12, right: 12, bottom: 12, left: 12 }), [side]: value ?? 0 })}
              />
            </Field>
          ))}
        </div>

        <div className="grid grid--2">
          <Field label="Scale (%)" htmlFor="profile-scale" hint="100% prints the layout at its written size.">
            <NumberInput
              id="profile-scale"
              value={Math.round((form.values.scaleBp ?? 10000) / 100)}
              min={50}
              max={200}
              onChange={(value) => form.setValue('scaleBp', Math.round((value ?? 100) * 100))}
            />
          </Field>
          <div className="stack" style={{ gap: 8 }}>
            <Switch checked={form.values.isDefault ?? false} onChange={(next) => form.setValue('isDefault', next)} label="Make this the default for the document type" />
            <Switch checked={form.values.isActive ?? true} onChange={(next) => form.setValue('isActive', next)} label="Active" />
          </div>
        </div>

        <Field label="Notes" htmlFor="profile-notes" hint="For example: the printer by the reception desk.">
          <TextArea id="profile-notes" value={form.values.notes ?? ''} onChange={(value) => form.setValue('notes', value === '' ? null : value)} rows={2} maxLength={240} />
        </Field>
      </div>
    </Modal>
  )
}

function ArchiveProfileDialog({
  profile,
  onClose,
  onArchived
}: {
  profile: PrintProfile | null
  onClose(): void
  onArchived(): void
}): ReactNode {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => setReason(''), [profile])

  const archive = async (): Promise<void> => {
    if (!profile) return
    if (reason.trim().length < 3) {
      toast('warning', 'A reason is required', 'Say briefly why this profile is no longer used.')
      return
    }
    setBusy(true)
    try {
      await invoke('printing.profile.archive', { id: profile.id, reason: reason.trim() })
      toast('success', `${profile.name} archived`)
      onArchived()
      onClose()
    } catch (error) {
      toast('error', 'The profile could not be archived', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={profile !== null}
      title={profile ? `Archive ${profile.name}` : 'Archive profile'}
      description="Documents already printed keep their history; the profile is simply no longer offered."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void archive()} loading={busy}>
            Archive profile
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="archive-profile-reason" required>
        <TextArea id="archive-profile-reason" value={reason} onChange={setReason} rows={2} maxLength={240} />
      </Field>
    </Modal>
  )
}

function TestPageDialog({ open, printers, onClose }: { open: boolean; printers: PrinterStatus['printers']; onClose(): void }): ReactNode {
  const [printerName, setPrinterName] = useState('')
  const [paperClass, setPaperClass] = useState<PrintPaperClass>('a4')
  const [thermalWidthMm, setThermalWidthMm] = useState<58 | 80>(80)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFailure(null)
    setPrinterName(printers.find((printer) => printer.isDefault)?.name ?? printers[0]?.name ?? '')
  }, [open, printers])

  const print = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await invoke('printing.testPrint', { printerName: printerName === '' ? null : printerName, paperClass, thermalWidthMm })
      if (outcome.ok) {
        toast('success', 'Test page sent', outcome.printerName ?? '')
        onClose()
      } else {
        setFailure(outcome.failureReason ?? 'The printer did not accept the test page.')
      }
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Print a test page"
      description="An alignment grid on the chosen paper. Use it to confirm margins before printing records."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button variant="primary" icon={<Printer size={16} />} loading={busy} onClick={() => void print()} disabled={printers.length === 0}>
            Print test page
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Printer" htmlFor="test-printer">
          <Select
            id="test-printer"
            value={printerName}
            onChange={setPrinterName}
            options={printers.length === 0 ? [{ value: '', label: 'No printer available' }] : printers.map((printer) => ({ value: printer.name, label: printer.displayName }))}
            ariaLabel="Printer"
          />
        </Field>
        <div className="grid grid--2">
          <Field label="Paper" htmlFor="test-paper">
            <Select
              id="test-paper"
              value={paperClass}
              onChange={(value) => setPaperClass(value as PrintPaperClass)}
              options={PAPER_OPTIONS}
              ariaLabel="Paper"
            />
          </Field>
          {paperClass === 'thermal' ? (
            <Field label="Roll width" htmlFor="test-thermal">
              <Select
                id="test-thermal"
                value={String(thermalWidthMm)}
                onChange={(value) => setThermalWidthMm(value === '58' ? 58 : 80)}
                options={[
                  { value: '58', label: '58 mm' },
                  { value: '80', label: '80 mm' }
                ]}
                ariaLabel="Roll width"
              />
            </Field>
          ) : null}
        </div>
        {failure ? <p className="muted small">{failure}</p> : null}
      </div>
    </Modal>
  )
}
