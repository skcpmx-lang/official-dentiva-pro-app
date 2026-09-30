import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, FileDown, Printer, RefreshCw } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader } from '../../components/ui/primitives'
import { Field, Select } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import type { PrintOutcome, PrintPaperClass, PrintRequestInput, RenderedPrintDocument } from '../../lib/types'

/**
 * Print preview and paper output.
 *
 * The dialog never builds a page: it asks the main process to render the record, shows exactly that HTML
 * in a sandboxed frame, and sends the same HTML to the printer. When a printer refuses, the failure is
 * shown with the ways out that keep the document safe — retry, another printer, or save it as a PDF —
 * because a prescription must never be lost to a printer problem.
 */

export interface PrintTarget {
  documentType: PrintRequestInput['documentType']
  entityId?: number | null
  reportKey?: string
  reportFrom?: string
  reportTo?: string
  /** Shown in the dialog title, e.g. the prescription number. */
  label?: string
}

interface PrintDialogProps {
  open: boolean
  target: PrintTarget
  onClose(): void
  onPrinted?(): void
}

const COPY_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value} ${value === 1 ? 'copy' : 'copies'}` }))

export function PrintDialog({ open, target, onClose, onPrinted }: PrintDialogProps): ReactNode {
  const printers = useInvoke('printing.printers', {}, { enabled: open })
  const profiles = useInvoke('printing.profiles', { includeInactive: false }, { enabled: open })
  const catalog = useInvoke('printing.documents', {}, { enabled: open })

  const [printerChoice, setPrinterChoice] = useState('')
  const [profileId, setProfileId] = useState('')
  const [paperClass, setPaperClass] = useState<PrintPaperClass | ''>('')
  const [copies, setCopies] = useState('1')
  const [document, setDocument] = useState<RenderedPrintDocument | null>(null)
  const [rendering, setRendering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [lastOutcome, setLastOutcome] = useState<PrintOutcome | null>(null)
  const previewLogged = useRef(false)
  const requestId = useRef(0)

  const info = useMemo(() => catalog.data?.find((entry) => entry.type === target.documentType) ?? null, [catalog.data, target.documentType])

  const request: PrintRequestInput = useMemo(
    () => ({
      documentType: target.documentType,
      entityId: target.entityId ?? null,
      profileId: profileId === '' ? null : Number(profileId),
      paperClass: paperClass === '' ? undefined : paperClass,
      copies: Number(copies),
      reportKey: target.reportKey,
      reportFrom: target.reportFrom,
      reportTo: target.reportTo
    }),
    [target, profileId, paperClass, copies]
  )

  const render = useCallback(async (): Promise<void> => {
    const current = ++requestId.current
    setRendering(true)
    try {
      const result = await invoke('printing.render', request)
      if (current !== requestId.current) return
      setDocument(result)
      setFailure(null)
      if (!previewLogged.current) {
        previewLogged.current = true
        void invoke('printing.previewed', {
          documentType: target.documentType,
          entityId: target.entityId ?? null,
          title: result.title
        }).catch(() => undefined)
      }
    } catch (error) {
      if (current !== requestId.current) return
      setDocument(null)
      setFailure(errorMessage(error))
    } finally {
      if (current === requestId.current) setRendering(false)
    }
  }, [request, target.documentType, target.entityId])

  useEffect(() => {
    if (!open) return
    previewLogged.current = false
    setDocument(null)
    setFailure(null)
    setLastOutcome(null)
    setPrinterChoice('')
    setProfileId('')
    setPaperClass('')
    setCopies('1')
  }, [open, target.documentType, target.entityId, target.reportKey])

  useEffect(() => {
    if (!open) return
    void render()
  }, [open, render])

  /*
   * The printer that will receive the document, derived while rendering: the operator's own choice, else
   * the default printer, else the first installed. Assigning it from an effect let the select display a
   * printer (a native select shows its first option when its value matches none) while the dialog still
   * held none, and the document then went to whatever the system considered default.
   */
  const defaultPrinterName = printers.data?.defaultPrinter ?? printers.data?.printers[0]?.name ?? ''
  const printerName = printerChoice !== '' ? printerChoice : defaultPrinterName

  const print = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await invoke('printing.print', { ...request, printerName: printerName === '' ? null : printerName, confirmOnly: false })
      setLastOutcome(outcome)
      if (outcome.ok) {
        toast('success', 'Sent to the printer', `${document?.title ?? target.label ?? 'Document'}${outcome.printerName ? ` → ${outcome.printerName}` : ''}`)
        onPrinted?.()
      } else {
        setFailure(outcome.failureReason ?? 'The printer did not accept the document.')
      }
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const savePdf = async (): Promise<void> => {
    setBusy(true)
    setFailure(null)
    try {
      const outcome = await invoke('printing.pdf', { ...request, targetPath: null })
      if (outcome.ok) {
        toast('success', 'PDF saved', outcome.filePath ?? '')
        onPrinted?.()
      } else if (outcome.failureReason && !outcome.failureReason.includes('cancelled')) {
        setFailure(outcome.failureReason)
      }
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const printerOptions = [
    ...(printers.data?.printers ?? []).map((printer) => ({
      value: printer.name,
      label: `${printer.displayName}${printer.isDefault ? ' (default)' : ''}`
    }))
  ]
  const profileOptions = [
    { value: '', label: 'Clinic default' },
    ...(profiles.data ?? [])
      .filter((profile) => profile.documentType === target.documentType)
      .map((profile) => ({ value: String(profile.id), label: `${profile.name}${profile.isDefault ? ' (default)' : ''}` }))
  ]
  const paperOptions = (info?.paperClasses ?? ['a4']).map((value) => ({ value, label: value.toUpperCase() }))

  return (
    <Modal
      open={open}
      size="2xl"
      title={`Print — ${document?.title ?? target.label ?? info?.title ?? 'document'}`}
      description="The preview below is the exact document the printer will receive."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {lastOutcome && !lastOutcome.ok ? (
            <Button variant="secondary" icon={<RefreshCw size={16} />} loading={busy} onClick={() => void print()}>
              Retry
            </Button>
          ) : null}
          <Button variant="secondary" icon={<FileDown size={16} />} loading={busy} onClick={() => void savePdf()}>
            Save as PDF
          </Button>
          <Button variant="primary" icon={<Printer size={16} />} loading={busy} disabled={!document || printerOptions.length === 0} onClick={() => void print()}>
            Print
          </Button>
        </>
      }
    >
      <div className="print-dialog">
        <div className="print-dialog__controls">
          <Card>
            <CardHeader title="Output" subtitle={info?.description} />
            <CardBody>
              <div className="stack">
                <Field label="Printer" htmlFor="print-printer">
                  <Select
                    id="print-printer"
                    value={printerName}
                    onChange={setPrinterChoice}
                    options={printerOptions.length > 0 ? printerOptions : [{ value: '', label: 'No printer available — save as PDF' }]}
                    ariaLabel="Printer"
                  />
                </Field>
                <Field label="Printer profile" htmlFor="print-profile" hint="Profiles are managed in Settings → Printing.">
                  <Select id="print-profile" value={profileId} onChange={setProfileId} options={profileOptions} ariaLabel="Printer profile" />
                </Field>
                <Field label="Paper" htmlFor="print-paper">
                  <Select
                    id="print-paper"
                    value={paperClass}
                    onChange={(value) => setPaperClass(value as PrintPaperClass | '')}
                    options={[{ value: '', label: 'Profile / clinic default' }, ...paperOptions]}
                    ariaLabel="Paper"
                  />
                </Field>
                <Field label="Copies" htmlFor="print-copies">
                  <Select id="print-copies" value={copies} onChange={setCopies} options={COPY_OPTIONS} ariaLabel="Copies" />
                </Field>
                {document ? (
                  <div className="muted small">
                    {document.paperClass.toUpperCase()} · {Math.round(document.widthMicrons / 1000)} mm × {Math.round(document.heightMicrons / 1000)} mm ·{' '}
                    {document.layout} layout{document.profileName ? ` · ${document.profileName}` : ''}
                  </div>
                ) : null}
                {printers.data && !printers.data.available ? (
                  <div className="muted small">This machine reports no printing subsystem; the document can still be saved as PDF.</div>
                ) : null}
                {printers.data && printers.data.missingFonts.length > 0 ? (
                  <div className="muted small">Bundled font files missing: {printers.data.missingFonts.join(', ')}. System fallbacks were used.</div>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {failure ? (
            <Card>
              <CardBody>
                <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <AlertTriangle size={18} aria-hidden="true" />
                  <div>
                    <strong>Printing failed</strong>
                    <p className="muted small" style={{ marginTop: 4 }}>
                      {failure}
                    </p>
                    <p className="muted small">The document is kept — retry it, choose another printer, or save it as a PDF.</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {document && document.warnings.length > 0 ? (
            <Card>
              <CardBody>
                <div className="stack" style={{ gap: 6 }}>
                  {document.warnings.map((warning) => (
                    <div key={warning} className="row" style={{ gap: 8 }}>
                      <Badge tone="warning">Check</Badge>
                      <span className="muted small">{warning}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="print-dialog__preview">
          {rendering && !document ? <p className="muted">Preparing the document…</p> : null}
          {document ? (
            <iframe className="print-preview" title="Print preview" sandbox="" srcDoc={document.html} />
          ) : (
            !rendering && <p className="muted">The document could not be prepared.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
