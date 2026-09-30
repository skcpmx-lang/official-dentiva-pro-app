import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Ban, FileText, Plus, Save, Trash2, Wallet, XCircle } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch } from '../../components/ui/primitives'
import { DateInput, Field, MoneyInput, NumberInput, Select, TextArea, TextInput, dateInputToInstant, instantToDateInput } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { INVOICE_STATUS_META, PAYMENT_METHODS, paymentMethodLabel, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { Invoice, InvoiceLineInput, PaymentInput } from '../../lib/types'

interface LineDraft {
  key: string
  id: number | null
  visitTreatmentId: number | null
  treatmentId: number | null
  description: string
  toothCodes: string
  quantity: number
  unitPriceMicro: number
  discountMicro: number
}

function blankLine(): LineDraft {
  return {
    key: `l-${Math.random().toString(36).slice(2, 9)}`,
    id: null,
    visitTreatmentId: null,
    treatmentId: null,
    description: '',
    toothCodes: '',
    quantity: 1,
    unitPriceMicro: 0,
    discountMicro: 0
  }
}

/**
 * Invoice editor and payment desk.
 *
 * Invoices can be raised from the unbilled treatments of a visit (the usual path) or by typing lines
 * directly. Payments and refunds are recorded here too; the service recomputes the balance every time, so
 * the figures on this screen are always derived from the stored entries rather than edited by hand.
 */
export function InvoiceScreen(): ReactNode {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const format = useFormatters()
  const canEdit = usePermission('billing.edit')
  const canPay = usePermission('payments.create')
  const canRefund = usePermission('payments.refund')
  const canVoid = usePermission('billing.void')

  const invoiceId = params.invoiceId ? Number(params.invoiceId) : null
  const [busy, setBusy] = useState(false)
  const [patientId, setPatientId] = useState('')
  const [visitId, setVisitId] = useState(searchParams.get('visitId') ?? '')
  const [patientSearch, setPatientSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [issueDate, setIssueDate] = useState<string | null>(instantToDateInput(Date.now()))
  const [dueDate, setDueDate] = useState<string | null>(null)
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [billableOpen, setBillableOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState<{ open: boolean, kind: 'payment' | 'refund' }>({ open: false, kind: 'payment' })

  const invoice = useInvoke('invoices.get', { id: invoiceId ?? 0 }, { enabled: invoiceId !== null })
  const patients = useInvoke('patients.list', { search: debounced === '' ? undefined : debounced, status: 'active', limit: 25, offset: 0 }, { enabled: invoiceId === null })
  const patientSummary = useInvoke('patients.summary', { id: Number(patientId) }, { enabled: patientId !== '' })

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(patientSearch.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [patientSearch])

  useEffect(() => {
    const data = invoice.data
    if (!data) return
    setPatientId(String(data.patientId))
    setVisitId(data.visitId === null ? '' : String(data.visitId))
    setIssueDate(instantToDateInput(data.issueAt))
    setDueDate(data.dueDate ?? null)
    setDiscount(data.discountMicro)
    setNotes(data.notes ?? '')
    setLines(
      data.lines.map((line) => ({
        key: `l-${line.id}`,
        id: line.id,
        visitTreatmentId: line.visitTreatmentId ?? null,
        treatmentId: line.treatmentId ?? null,
        description: line.description,
        toothCodes: line.toothCodes.join(', '),
        quantity: line.quantity,
        unitPriceMicro: line.unitPriceMicro,
        discountMicro: line.discountMicro
      }))
    )
  }, [invoice.data])

  useEffect(() => {
    if (searchParams.get('pay') === '1' && invoice.data && invoice.data.dueMicro > 0 && invoice.data.status !== 'void') {
      setPaymentOpen({ open: true, kind: 'payment' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.data])

  const billable = useInvoke('invoices.billable', { visitId: Number(visitId) || 0 }, { enabled: billableOpen && visitId !== '' })

  const preview = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + Math.max(0, Math.round(line.quantity * line.unitPriceMicro) - line.discountMicro), 0)
    const total = Math.max(0, subtotal - discount)
    return { subtotal, total }
  }, [lines, discount])

  const save = async (): Promise<void> => {
    if (patientId === '') {
      toast('warning', 'Choose a patient', 'Every invoice belongs to a patient.')
      return
    }
    const prepared: InvoiceLineInput[] = lines
      .filter((line) => line.description.trim() !== '')
      .map((line) => ({
        id: line.id,
        treatmentId: line.treatmentId,
        visitTreatmentId: line.visitTreatmentId,
        description: line.description.trim(),
        toothCodes: line.toothCodes.split(',').map((entry) => entry.trim().toUpperCase()).filter((entry) => entry.length > 0),
        quantity: line.quantity ?? 1,
        unitPriceMicro: line.unitPriceMicro,
        discountMicro: line.discountMicro ?? 0,
        notes: null
      }))
    if (prepared.length === 0) {
      toast('warning', 'Add at least one line', 'Describe what is being billed.')
      return
    }
    const issueAt = dateInputToInstant(issueDate, '12:00') ?? Date.now()
    const subtotal = prepared.reduce((sum, line) => sum + Math.max(0, Math.round((line.quantity ?? 1) * line.unitPriceMicro) - (line.discountMicro ?? 0)), 0)
    const discountBp = discount > 0 && subtotal > 0 ? Math.round((discount / subtotal) * 10_000) : 0

    setBusy(true)
    try {
      const saved = await invoke('invoices.save', {
        id: invoiceId,
        patientId: Number(patientId),
        visitId: visitId === '' ? null : Number(visitId),
        appointmentId: null,
        issueAt,
        dueDate,
        discountBp,
        notes: notes.trim() === '' ? null : notes.trim(),
        lines: prepared
      })
      toast('success', `Invoice ${saved.invoiceNo} saved`)
      if (invoiceId === null) navigate(`/invoices/${saved.id}`, { replace: true })
      else await invoice.reload()
    } catch (error) {
      toast('error', 'The invoice could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const voidInvoice = async (): Promise<void> => {
    const data = invoice.data
    if (!data) return
    const answer = await confirmDialog({
      title: `Void invoice ${data.invoiceNo}?`,
      message: 'A voided invoice keeps its number, its lines and this reason. Money already received must be voided first, so a void invoice never hides a balance.',
      confirmLabel: 'Void invoice',
      danger: true,
      confirmationPhrase: data.invoiceNo
    })
    if (!answer.confirmed) return
    setBusy(true)
    try {
      await invoke('invoices.void', { id: data.id, reason: answer.phrase ?? 'Voided by billing staff' })
      await invoice.reload()
      toast('success', 'Invoice voided')
    } catch (error) {
      toast('error', 'The invoice could not be voided', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const removeInvoice = async (): Promise<void> => {
    const data = invoice.data
    if (!data) return
    const answer = await confirmDialog({
      title: `Delete invoice ${data.invoiceNo}?`,
      message: 'Deleting is only possible for an invoice that was never paid. The audit log keeps the record of the deletion.',
      confirmLabel: 'Delete invoice',
      danger: true,
      confirmationPhrase: data.invoiceNo
    })
    if (!answer.confirmed) return
    setBusy(true)
    try {
      await invoke('invoices.delete', { id: data.id, reason: answer.phrase ?? 'Deleted by billing staff' })
      toast('success', 'Invoice deleted')
      navigate('/invoices', { replace: true })
    } catch (error) {
      toast('error', 'The invoice could not be deleted', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const voidPayment = async (paymentId: number, receiptNo: string): Promise<void> => {
    const answer = await confirmDialog({
      title: `Void receipt ${receiptNo}?`,
      message: 'The receipt stays in the history marked void, a linked reversal is written, and the invoice balance is recomputed.',
      confirmLabel: 'Void receipt',
      danger: true,
      confirmationPhrase: receiptNo
    })
    if (!answer.confirmed) return
    try {
      await invoke('payments.void', { id: paymentId, reason: answer.phrase ?? 'Voided by billing staff' })
      await invoice.reload()
      toast('success', 'Receipt voided')
    } catch (error) {
      toast('error', 'The receipt could not be voided', errorMessage(error))
    }
  }

  const data = invoice.data
  const readOnly = invoiceId !== null && (!canEdit || data?.status === 'void' || (data?.payments.length ?? 0) > 0)
  const patientOptions = [
    { value: '', label: debounced === '' ? 'Search for a patient…' : 'Select a patient…' },
    ...((patients.data?.items ?? []).map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.fullName}${entry.phone ? ` · ${entry.phone}` : ''}` })))
  ]

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={
          <button type="button" className="row small link" style={{ gap: 6, background: 'none', border: 0, cursor: 'pointer' }} onClick={() => navigate('/invoices')}>
            <ArrowLeft size={14} /> All invoices
          </button>
        }
        title={data ? <span className="row" style={{ gap: 10, alignItems: 'baseline' }}><span className="num">{data.invoiceNo}</span><Badge tone={INVOICE_STATUS_META[data.status]?.tone ?? 'neutral'}>{INVOICE_STATUS_META[data.status]?.label ?? data.status}</Badge></span> : 'New invoice'}
        subtitle={data ? `${data.patientName}${data.patientNameBn ? ` · ${data.patientNameBn}` : ''} · issued ${format.date(data.issueAt)}` : 'Raise an invoice for the treatments the patient received.'}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {!readOnly ? (
              <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>
                Save invoice
              </Button>
            ) : null}
            {data && canPay && data.status !== 'void' && data.dueMicro > 0 ? (
              <Button variant="secondary" icon={<Wallet size={16} />} onClick={() => setPaymentOpen({ open: true, kind: 'payment' })}>
                Take payment
              </Button>
            ) : null}
            {data && canRefund && data.paidMicro - data.refundedMicro > 0 && data.status !== 'void' ? (
              <Button variant="tertiary" icon={<XCircle size={16} />} onClick={() => setPaymentOpen({ open: true, kind: 'refund' })}>
                Refund
              </Button>
            ) : null}
            {data && canVoid && data.status !== 'void' ? (
              <Button variant="ghost" icon={<Ban size={16} />} onClick={() => void voidInvoice()}>
                Void
              </Button>
            ) : null}
            {data && canVoid && data.payments.length === 0 && (data.status === 'void' || data.status === 'unpaid') ? (
              <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void removeInvoice()}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">Subtotal</span>
          <strong className="num">{format.money(data?.subtotalMicro ?? preview.subtotal)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Discount</span>
          <strong className="num">{format.money(data?.discountMicro ?? discount)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Total</span>
          <strong className="num">{format.money(data?.totalMicro ?? preview.total)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Paid</span>
          <strong className="num">{format.money(data?.paidMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Due</span>
          <strong className="num">{format.money(data?.dueMicro ?? preview.total)}</strong>
        </span>
        {data && data.refundedMicro > 0 ? (
          <span className="summary-strip__item">
            <span className="summary-strip__label">Refunded</span>
            <strong className="num">{format.money(data.refundedMicro)}</strong>
          </span>
        ) : null}
      </div>

      <div className="grid grid--2">
        <Card>
          <CardHeader
            title="Invoice lines"
            subtitle="Treatments billed on this invoice."
            actions={
              !readOnly ? (
                <div className="row" style={{ gap: 8 }}>
                  <Button size="sm" variant="tertiary" icon={<FileText size={15} />} disabled={visitId === ''} onClick={() => setBillableOpen(true)}>
                    From visit
                  </Button>
                  <Button size="sm" variant="secondary" icon={<Plus size={15} />} onClick={() => setLines((current) => [...current, blankLine()])}>
                    Add line
                  </Button>
                </div>
              ) : null
            }
          />
          <CardBody>
            <div className="stack">
              {lines.map((line, index) => (
                <div key={line.key} className="medicine-row">
                  <div className="medicine-row__main" style={{ gridTemplateColumns: 'minmax(0, 2fr) 90px 70px 120px 120px' }}>
                    <TextInput
                      value={line.description}
                      onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, description: value } : entry)))}
                      ariaLabel={`Line ${index + 1} description`}
                      maxLength={200}
                      disabled={readOnly}
                    />
                    <TextInput
                      value={line.toothCodes}
                      onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, toothCodes: value } : entry)))}
                      ariaLabel={`Line ${index + 1} teeth`}
                      placeholder="Teeth"
                      maxLength={60}
                      disabled={readOnly}
                    />
                    <NumberInput
                      value={line.quantity}
                      onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, quantity: value ?? 1 } : entry)))}
                      ariaLabel={`Line ${index + 1} quantity`}
                      min={0.01}
                      max={1000}
                      disabled={readOnly}
                    />
                    <MoneyInput
                      value={line.unitPriceMicro}
                      onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, unitPriceMicro: value ?? 0 } : entry)))}
                      ariaLabel={`Line ${index + 1} unit price`}
                      disabled={readOnly}
                    />
                    <MoneyInput
                      value={line.discountMicro}
                      onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, discountMicro: value ?? 0 } : entry)))}
                      ariaLabel={`Line ${index + 1} discount`}
                      disabled={readOnly}
                    />
                  </div>
                  <div className="medicine-row__side">
                    <span className="num small">{format.money(Math.max(0, Math.round(line.quantity * line.unitPriceMicro) - line.discountMicro))}</span>
                    {line.visitTreatmentId !== null ? <Badge tone="info">From visit</Badge> : null}
                    {!readOnly ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={15} />}
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() => setLines((current) => (current.length === 1 ? [blankLine()] : current.filter((_, position) => position !== index)))}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <div className="stack">
          <Card>
            <CardHeader title="Details" subtitle="Who is being billed and when it is due." />
            <CardBody>
              <div className="stack">
                {invoiceId === null ? (
                  <>
                    <Field label="Find patient" htmlFor="invoicePatientSearch" hint="Type a name, patient ID or phone number.">
                      <TextInput id="invoicePatientSearch" value={patientSearch} onChange={setPatientSearch} maxLength={80} />
                    </Field>
                    <Field label="Patient" htmlFor="invoicePatient" required>
                      <Select id="invoicePatient" value={patientId} onChange={setPatientId} options={patientOptions} ariaLabel="Patient" />
                    </Field>
                  </>
                ) : (
                  <Field label="Patient" htmlFor="invoicePatientReadonly">
                    <TextInput id="invoicePatientReadonly" value={data ? `${data.patientCode} · ${data.patientName}` : 'Loading…'} onChange={() => undefined} disabled />
                  </Field>
                )}
                <Field label="Visit" htmlFor="invoiceVisit" hint="Link the visit to bill its treatment lines, or leave blank for a standalone invoice.">
                  <TextInput id="invoiceVisit" value={visitId} onChange={(value) => setVisitId(value.replace(/[^0-9]/g, ''))} maxLength={12} disabled={readOnly} />
                </Field>
                <div className="grid grid--2">
                  <Field label="Issue date" htmlFor="invoiceIssue">
                    <DateInput id="invoiceIssue" value={issueDate} onChange={setIssueDate} disabled={readOnly} />
                  </Field>
                  <Field label="Due date" htmlFor="invoiceDue">
                    <DateInput id="invoiceDue" value={dueDate} onChange={setDueDate} disabled={readOnly} />
                  </Field>
                </div>
                <Field label="Invoice discount (৳)" htmlFor="invoiceDiscount" hint="Subject to your role's discount limit.">
                  <MoneyInput id="invoiceDiscount" value={discount} onChange={(value) => setDiscount(value ?? 0)} disabled={readOnly} />
                </Field>
                <Field label="Notes" htmlFor="invoiceNotes">
                  <TextArea id="invoiceNotes" value={notes} onChange={setNotes} rows={2} maxLength={1000} disabled={readOnly} />
                </Field>
                {patientId !== '' && patientSummary.data ? (
                  <p className="muted small">
                    Patient position: invoiced {format.money(patientSummary.data.financials.invoicedMicro)} · paid {format.money(patientSummary.data.financials.paidMicro)} · due{' '}
                    <strong>{format.money(patientSummary.data.financials.dueMicro)}</strong>
                  </p>
                ) : null}
                {readOnly && invoiceId !== null ? (
                  <p className="muted small">
                    {data?.status === 'void'
                      ? 'This invoice is void and cannot be edited.'
                      : data && data.payments.length > 0
                        ? 'Payments have been recorded, so the lines are locked. Void the payments to correct them.'
                        : 'Your role can read invoices but not amend them.'}
                  </p>
                ) : null}
              </div>
            </CardBody>
          </Card>

          {data ? (
            <Card>
              <CardHeader title="Payments and refunds" subtitle="Every receipt and refund, including voided entries." />
              <CardBody>
                {data.payments.length === 0 ? (
                  <p className="muted small">No money recorded against this invoice yet.</p>
                ) : (
                  <ul className="plain-list">
                    {data.payments.map((payment) => (
                      <li key={payment.id} className="plain-list__item">
                        <span className="stack" style={{ gap: 2 }}>
                          <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                            <span className="num link-strong">{payment.receiptNo}</span>
                            <Badge tone={payment.kind === 'refund' ? 'warning' : 'success'}>{payment.kind === 'refund' ? 'Refund' : 'Payment'}</Badge>
                            <span className="num">{format.money(payment.amountMicro)}</span>
                            <span className="muted small">{paymentMethodLabel(payment.method)}</span>
                          </span>
                          <span className="muted small">
                            {format.dateTime(payment.paidAt)}
                            {payment.receivedByName ? ` · ${payment.receivedByName}` : ''}
                            {payment.reference ? ` · ref ${payment.reference}` : ''}
                          </span>
                        </span>
                        {canVoid && payment.status !== 'void' ? (
                          <Button size="sm" variant="ghost" icon={<Ban size={15} />} aria-label={`Void receipt ${payment.receiptNo}`} onClick={() => void voidPayment(payment.id, payment.receiptNo)}>
                            Void
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <Modal
        open={billableOpen}
        size="lg"
        title="Unbilled treatments of the visit"
        description="Select the lines to add. Lines already on a live invoice are marked so they cannot be billed twice."
        onClose={() => setBillableOpen(false)}
        footer={
          <Button variant="tertiary" onClick={() => setBillableOpen(false)}>
            Close
          </Button>
        }
      >
        {(billable.data ?? []).length === 0 ? (
          <p className="muted">
            {visitId === '' ? 'Enter the visit number first.' : 'This visit has no treatment lines. Add them on the visit screen, or type invoice lines directly.'}
          </p>
        ) : (
          <ul className="plain-list">
            {(billable.data ?? []).map((entry) => (
              <li key={entry.visitTreatmentId} className="plain-list__item">
                <span className="stack" style={{ gap: 2 }}>
                  <span>
                    {entry.description}
                    {entry.toothCodes.length > 0 ? <span className="muted small"> · teeth {entry.toothCodes.join(', ')}</span> : null}
                  </span>
                  <span className="muted small">
                    {format.money(entry.unitPriceMicro)} × {entry.quantity} = {format.money(entry.totalMicro)}
                    {entry.billed ? ' · already invoiced' : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={entry.billed}
                  onClick={() => {
                    setLines((current) => [
                      ...current.filter((line) => line.description.trim() !== ''),
                      {
                        key: `l-vt-${entry.visitTreatmentId}`,
                        id: null,
                        visitTreatmentId: entry.visitTreatmentId,
                        treatmentId: entry.treatmentId,
                        description: entry.description,
                        toothCodes: entry.toothCodes.join(', '),
                        quantity: entry.quantity,
                        unitPriceMicro: entry.unitPriceMicro,
                        discountMicro: entry.discountMicro
                      }
                    ])
                    toast('success', `${entry.description} added to the invoice`)
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {data ? (
        <PaymentDialog
          invoice={data}
          kind={paymentOpen.kind}
          open={paymentOpen.open}
          onClose={() => setPaymentOpen({ open: false, kind: 'payment' })}
          onSaved={() => void invoice.reload()}
        />
      ) : null}
    </div>
  )
}

function PaymentDialog({
  invoice,
  kind,
  open,
  onClose,
  onSaved
}: {
  invoice: Invoice
  kind: 'payment' | 'refund'
  open: boolean
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState<string | null>(instantToDateInput(Date.now()))
  const [notes, setNotes] = useState('')
  const [recordRefund, setRecordRefund] = useState(false)

  const isRefund = kind === 'refund'

  useEffect(() => {
    if (!open) return
    setAmount(isRefund ? 0 : invoice.dueMicro)
    setMethod('cash')
    setReference('')
    setDate(instantToDateInput(Date.now()))
    setNotes('')
    setRecordRefund(false)
  }, [open, invoice.id, invoice.dueMicro, isRefund])

  const submit = async (): Promise<void> => {
    if (amount <= 0) {
      toast('warning', 'Enter the amount', 'The amount must be greater than zero.')
      return
    }
    if (isRefund && !recordRefund) {
      setRecordRefund(true)
      return
    }
    const paidAt = dateInputToInstant(date, '12:00') ?? Date.now()
    setBusy(true)
    try {
      const payload: PaymentInput = {
        patientId: invoice.patientId,
        invoiceId: invoice.id,
        kind: isRefund ? 'refund' : 'payment',
        amountMicro: amount,
        method: method as PaymentInput['method'],
        reference: reference.trim() === '' ? null : reference.trim(),
        paidAt,
        notes: notes.trim() === '' ? null : notes.trim()
      }
      await invoke('payments.add', payload)
      toast('success', isRefund ? 'Refund recorded' : 'Payment recorded', `${formatStatic(amount)} recorded against ${invoice.invoiceNo}.`)
      onSaved()
      onClose()
    } catch (error) {
      toast('error', isRefund ? 'The refund could not be recorded' : 'The payment could not be recorded', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isRefund ? `Refund against ${invoice.invoiceNo}` : `Take payment for ${invoice.invoiceNo}`}
      description={
        isRefund
          ? `Money already collected on this invoice: ${formatStatic(invoice.paidMicro - invoice.refundedMicro)}. A refund reopens the balance.`
          : `Outstanding balance: ${formatStatic(invoice.dueMicro)}.`
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={isRefund ? 'danger' : 'primary'} loading={busy} onClick={() => void submit()}>
            {isRefund ? (recordRefund ? 'Confirm refund' : 'Continue') : 'Record payment'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Amount (৳)" htmlFor="paymentAmount" required>
          <MoneyInput id="paymentAmount" value={amount} onChange={(value) => setAmount(value ?? 0)} />
        </Field>
        <Field label="Method" htmlFor="paymentMethod" hint="Recorded as a category only; no wallet or bank connection is used.">
          <Select
            id="paymentMethod"
            value={method}
            onChange={setMethod}
            ariaLabel="Method"
            options={PAYMENT_METHODS.map((entry) => ({ value: entry.value, label: entry.label }))}
          />
        </Field>
        <Field label="Date" htmlFor="paymentDate">
          <DateInput id="paymentDate" value={date} onChange={setDate} />
        </Field>
        <Field label="Reference" htmlFor="paymentReference" hint="Wallet transaction ID, cheque number…">
          <TextInput id="paymentReference" value={reference} onChange={setReference} maxLength={120} />
        </Field>
        <Field label="Notes" htmlFor="paymentNotes" span={2}>
          <TextArea id="paymentNotes" value={notes} onChange={setNotes} rows={2} maxLength={500} />
        </Field>
        {isRefund && recordRefund ? (
          <p className="muted small" style={{ gridColumn: 'span 2' }}>
            <Switch checked={recordRefund} onChange={() => undefined} label="Refund confirmed — press Confirm refund to write it to the record." />
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

/** Money formatting outside a React hook (dialogs fire before the store is read). */
function formatStatic(micro: number): string {
  const taka = micro / 10_000
  return `৳ ${taka.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

