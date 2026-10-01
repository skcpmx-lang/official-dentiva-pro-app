import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Building2, Download, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { DateInput, Field, MoneyInput, NumberInput, Select, TextArea, TextInput, instantToDateInput } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { PAYMENT_METHODS, PURCHASE_STATUS_META, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { InventoryItem, Purchase, PurchaseListItem, PurchaseLineInput, Supplier, SupplierInput } from '../../lib/types'

type PurchaseFilterPreset = 'last30' | 'last90' | 'thisMonth' | 'lastYear' | 'all'

const RANGE_OPTIONS: Array<{ value: PurchaseFilterPreset, label: string }> = [
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'all', label: 'All time' }
]

/**
 * Suppliers and purchases.
 *
 * Receiving a delivery is the only way stock arrives in bulk: each line becomes a batch and an inbound
 * movement in one transaction, so the purchase, the batch and the ledger can never disagree. What is still
 * owed to each supplier is read from the purchases themselves.
 */
export function SuppliersScreen(): ReactNode {
  const format = useFormatters()
  const canManage = usePermission('suppliers.manage')

  const [supplierSearch, setSupplierSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [creating, setCreating] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [paying, setPaying] = useState<Purchase | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [preset, setPreset] = useState<PurchaseFilterPreset>('last30')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(supplierSearch.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [supplierSearch])

  const suppliers = useInvoke('suppliers.list', { search: debounced === '' ? undefined : debounced, includeInactive })
  const purchaseFilter = useMemo(
    () => ({
      supplierId: supplierId === '' ? undefined : Number(supplierId),
      range: { preset },
      limit: 100,
      offset: 0
    }),
    [supplierId, preset]
  )
  const purchases = useInvoke('purchases.list', purchaseFilter)

  const supplierColumns: Array<Column<Supplier>> = [
    {
      key: 'name',
      header: 'Supplier',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.name}</span>
          <span className="muted small">{row.contactPerson ?? '—'}</span>
        </div>
      ),
      sortValue: (row) => row.name
    },
    { key: 'phone', header: 'Phone', width: 140, render: (row) => <span className="num small">{row.phone ?? '—'}</span>, sortValue: (row) => row.phone ?? '' },
    { key: 'purchases', header: 'Purchases', width: 100, align: 'right', render: (row) => <span className="num">{row.purchases}</span>, sortValue: (row) => row.purchases, secondary: true },
    {
      key: 'total',
      header: 'Purchased',
      width: 140,
      align: 'right',
      render: (row) => <span className="num">{format.money(row.totalPurchasedMicro)}</span>,
      sortValue: (row) => row.totalPurchasedMicro
    },
    {
      key: 'due',
      header: 'Owed',
      width: 140,
      align: 'right',
      render: (row) => (row.dueMicro > 0 ? <span className="num link-strong">{format.money(row.dueMicro)}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.dueMicro
    }
  ]

  const purchaseColumns: Array<Column<PurchaseListItem>> = [
    {
      key: 'purchase',
      header: 'Purchase',
      width: 150,
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="num link-strong">{row.purchaseNo}</span>
          <span className="muted small num">{row.purchaseDate}</span>
        </div>
      ),
      sortValue: (row) => row.purchaseNo
    },
    { key: 'supplier', header: 'Supplier', render: (row) => <span>{row.supplierName ?? '—'}</span>, sortValue: (row) => row.supplierName ?? '' },
    {
      key: 'lines',
      header: 'Received',
      render: (row) => <span className="small">{row.lines.map((line) => `${line.itemName} × ${line.quantity}`).join(', ')}</span>,
      sortValue: (row) => row.lines.length,
      secondary: true
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (row) => {
        const meta = PURCHASE_STATUS_META[row.status]
        return <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? row.status}</Badge>
      },
      sortValue: (row) => row.status
    },
    { key: 'total', header: 'Total', width: 130, align: 'right', render: (row) => <span className="num">{format.money(row.totalMicro)}</span>, sortValue: (row) => row.totalMicro },
    { key: 'paid', header: 'Paid', width: 130, align: 'right', render: (row) => <span className="num">{format.money(row.paidMicro)}</span>, sortValue: (row) => row.paidMicro, secondary: true },
    {
      key: 'due',
      header: 'Due',
      width: 130,
      align: 'right',
      render: (row) => (row.dueMicro > 0 ? <span className="num link-strong">{format.money(row.dueMicro)}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.dueMicro
    }
  ]

  const archiveSupplier = async (supplier: Supplier): Promise<void> => {
    const answer = await confirmDialog({
      title: `Archive ${supplier.name}?`,
      message: 'The supplier disappears from lists but its purchases and their payments stay in the accounts. Items keep their history and lose the supplier link.',
      confirmLabel: 'Archive supplier',
      danger: true
    })
    if (!answer.confirmed) return
    try {
      await invoke('suppliers.archive', { id: supplier.id, reason: 'Archived from the supplier screen' })
      toast('success', `${supplier.name} archived`)
      await suppliers.reload()
    } catch (error) {
      toast('error', 'The supplier could not be archived', errorMessage(error))
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Suppliers & purchases"
        subtitle="Who the clinic buys from, what was delivered, and what is still owed."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="tertiary"
              icon={<Download size={16} />}
              loading={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  const result = await invoke('purchases.export', { limit: 5000, offset: 0 })
                  if (result.path === null) toast('info', 'Export cancelled')
                  else toast('success', 'Purchases exported', `${result.rowCount} rows written to ${result.path}`)
                } catch (error) {
                  toast('error', 'The purchases could not be exported', errorMessage(error))
                } finally {
                  setExporting(false)
                }
              }}
            >
              Export purchases
            </Button>
            {canManage ? (
              <>
                <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                  New supplier
                </Button>
                <Button variant="primary" icon={<Truck size={16} />} onClick={() => setReceiving(true)}>
                  Receive stock
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">Purchased (filtered)</span>
          <strong className="num">{format.money(purchases.data?.totals.purchasedMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Paid</span>
          <strong className="num">{format.money(purchases.data?.totals.paidMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Owed to suppliers</span>
          <strong className="num">{format.money(purchases.data?.totals.dueMicro ?? 0)}</strong>
        </span>
      </div>

      <Card>
        <CardHeader title="Suppliers" icon={<Building2 size={17} />} />
        <CardBody>
          <Toolbar>
            <SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search name, phone, contact…" ariaLabel="Search suppliers" />
            <Switch checked={includeInactive} onChange={setIncludeInactive} label="Show archived" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={supplierColumns}
            rows={suppliers.data ?? []}
            getRowId={(row) => row.id}
            loading={suppliers.loading}
            emptyTitle="No suppliers yet"
            emptyMessage="Add the distributors and shops the clinic buys from."
            rowActions={(row) =>
              canManage ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon={<Pencil size={15} />} onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={() => void archiveSupplier(row)}>
                    Archive
                  </Button>
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Purchases"
          icon={<Truck size={17} />}
          subtitle="Every line received into stock. A received purchase is never edited — stock corrections go through the ledger."
        />
        <CardBody>
          <Toolbar>
            <Select
              value={supplierId}
              onChange={(value: string) => setSupplierId(value)}
              options={[{ value: '', label: 'All suppliers' }, ...(suppliers.data ?? []).map((supplier) => ({ value: String(supplier.id), label: supplier.name }))]}
              ariaLabel="Supplier"
            />
            <Select value={preset} onChange={(value: string) => setPreset(value as PurchaseFilterPreset)} options={RANGE_OPTIONS} ariaLabel="Date range" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={purchaseColumns}
            rows={purchases.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={purchases.loading}
            emptyTitle="No purchases in this period"
            emptyMessage="Receive stock to record the first delivery."
            rowActions={(row) =>
              canManage && row.status !== 'void' ? (
                <Button size="sm" variant="secondary" onClick={() => setPaying(row as unknown as Purchase)}>
                  Record payment
                </Button>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <SupplierDialog
        supplier={creating ? null : editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void suppliers.reload()}
      />

      <ReceiveStockDialog
        open={receiving}
        suppliers={suppliers.data ?? []}
        onClose={() => setReceiving(false)}
        onSaved={() => {
          void purchases.reload()
          void suppliers.reload()
        }}
      />

      <PurchasePaymentDialog
        purchase={paying}
        onClose={() => setPaying(null)}
        onSaved={() => {
          void purchases.reload()
          void suppliers.reload()
        }}
      />
    </div>
  )
}

function SupplierDialog({
  supplier,
  open,
  onClose,
  onSaved
}: {
  supplier: Supplier | null
  open: boolean
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState<SupplierInput>({
    id: null,
    name: '',
    contactPerson: null,
    phone: null,
    altPhone: null,
    email: null,
    address: null,
    notes: null,
    isActive: true
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setValues(
      supplier
        ? {
            id: supplier.id,
            name: supplier.name,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
            altPhone: supplier.altPhone,
            email: supplier.email,
            address: supplier.address,
            notes: supplier.notes,
            isActive: supplier.isActive
          }
        : { id: null, name: '', contactPerson: null, phone: null, altPhone: null, email: null, address: null, notes: null, isActive: true }
    )
  }, [open, supplier])

  const save = async (): Promise<void> => {
    if (values.name.trim().length < 2) {
      setError('Enter the supplier name.')
      return
    }
    setBusy(true)
    try {
      await invoke('suppliers.save', values)
      toast('success', supplier ? 'Supplier updated' : 'Supplier added')
      onSaved()
      onClose()
    } catch (caught) {
      toast('error', 'The supplier could not be saved', errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={supplier ? `Edit ${supplier.name}` : 'New supplier'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Supplier name" htmlFor="supplierName" required error={error ?? undefined}>
          <TextInput id="supplierName" value={values.name} onChange={(value) => setValues((current) => ({ ...current, name: value }))} maxLength={140} />
        </Field>
        <Field label="Contact person" htmlFor="supplierContact">
          <TextInput id="supplierContact" value={values.contactPerson ?? ''} onChange={(value) => setValues((current) => ({ ...current, contactPerson: value || null }))} maxLength={120} />
        </Field>
        <Field label="Phone" htmlFor="supplierPhone">
          <TextInput id="supplierPhone" value={values.phone ?? ''} onChange={(value) => setValues((current) => ({ ...current, phone: value || null }))} maxLength={32} />
        </Field>
        <Field label="Alternate phone" htmlFor="supplierAltPhone">
          <TextInput id="supplierAltPhone" value={values.altPhone ?? ''} onChange={(value) => setValues((current) => ({ ...current, altPhone: value || null }))} maxLength={32} />
        </Field>
        <Field label="Email" htmlFor="supplierEmail">
          <TextInput id="supplierEmail" value={values.email ?? ''} onChange={(value) => setValues((current) => ({ ...current, email: value || null }))} maxLength={160} />
        </Field>
        <Field label="Address" htmlFor="supplierAddress" span={2}>
          <TextInput id="supplierAddress" value={values.address ?? ''} onChange={(value) => setValues((current) => ({ ...current, address: value || null }))} maxLength={400} />
        </Field>
        <Field label="Notes" htmlFor="supplierNotes" span={2}>
          <TextArea id="supplierNotes" value={values.notes ?? ''} onChange={(value) => setValues((current) => ({ ...current, notes: value || null }))} rows={2} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}

interface LineDraft {
  key: string
  itemId: string
  quantity: number
  unitCostMicro: number
  batchNo: string
  expiryDate: string | null
}

function blankLine(): LineDraft {
  return { key: `l-${Math.random().toString(36).slice(2, 9)}`, itemId: '', quantity: 1, unitCostMicro: 0, batchNo: '', expiryDate: null }
}

function ReceiveStockDialog({
  open,
  suppliers,
  onClose,
  onSaved
}: {
  open: boolean
  suppliers: Supplier[]
  onClose(): void
  onSaved(): void
}): ReactNode {
  const format = useFormatters()
  const [busy, setBusy] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [purchaseDate, setPurchaseDate] = useState<string | null>(instantToDateInput(Date.now()))
  const [paid, setPaid] = useState(0)
  const [method, setMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const items = useInvoke('inventory.list', { includeInactive: false, sort: 'name', limit: 200, offset: 0 }, { enabled: open })

  useEffect(() => {
    if (!open) return
    setSupplierId('')
    setInvoiceRef('')
    setPurchaseDate(instantToDateInput(Date.now()))
    setPaid(0)
    setMethod('cash')
    setNotes('')
    setLines([blankLine()])
  }, [open])

  const itemById = useMemo(() => new Map((items.data?.items ?? []).map((item) => [String(item.id), item])), [items.data])
  const total = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCostMicro), 0)

  const submit = async (): Promise<void> => {
    const prepared = lines.filter((line) => line.itemId !== '' && line.quantity > 0)
    if (prepared.length === 0) {
      toast('warning', 'Add at least one line', 'Choose the items that arrived.')
      return
    }
    const payloadLines: PurchaseLineInput[] = prepared.map((line) => ({
      itemId: Number(line.itemId),
      batchNo: line.batchNo.trim() === '' ? null : line.batchNo.trim(),
      expiryDate: line.expiryDate,
      quantity: line.quantity,
      unitCostMicro: line.unitCostMicro
    }))
    setBusy(true)
    try {
      const purchase = await invoke('purchases.save', {
        id: null,
        supplierId: supplierId === '' ? null : Number(supplierId),
        invoiceRef: invoiceRef.trim() === '' ? null : invoiceRef.trim(),
        purchaseDate: purchaseDate ?? instantToDateInput(Date.now())!,
        paidMicro: paid,
        paymentMethod: method,
        notes: notes.trim() === '' ? null : notes.trim(),
        lines: payloadLines
      })
      toast('success', `Purchase ${purchase.purchaseNo} received`, `${purchase.lines.length} line(s) added to stock${purchase.dueMicro > 0 ? `, ${format.money(purchase.dueMicro)} owed` : ''}.`)
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The delivery could not be recorded', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="xl"
      title="Receive stock"
      description="Each line creates or tops up a batch and writes an inbound movement, so the shelf and the ledger always agree."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Receive {format.money(total)}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Supplier" htmlFor="purchaseSupplier">
          <Select
            id="purchaseSupplier"
            value={supplierId}
            onChange={setSupplierId}
            options={[{ value: '', label: 'No supplier (cash purchase)' }, ...suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name }))]}
            ariaLabel="Purchase supplier"
          />
        </Field>
        <Field label="Supplier invoice" htmlFor="purchaseInvoice" hint="Printed on the delivery note or bill.">
          <TextInput id="purchaseInvoice" value={invoiceRef} onChange={setInvoiceRef} maxLength={80} />
        </Field>
        <Field label="Received on" htmlFor="purchaseDate">
          <DateInput id="purchaseDate" value={purchaseDate} onChange={setPurchaseDate} />
        </Field>
        <Field label="Paid now (৳)" htmlFor="purchasePaid" hint="Leave at zero to record the bill as owed.">
          <MoneyInput id="purchasePaid" value={paid} onChange={(value) => setPaid(value ?? 0)} />
        </Field>
        <Field label="Payment method" htmlFor="purchaseMethod">
          <Select id="purchaseMethod" value={method} onChange={setMethod} options={PAYMENT_METHODS.map((entry) => ({ value: entry.value, label: entry.label }))} ariaLabel="Payment method" />
        </Field>
        <Field label="Notes" htmlFor="purchaseNotes">
          <TextInput id="purchaseNotes" value={notes} onChange={setNotes} maxLength={1000} />
        </Field>
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        {lines.map((line, index) => {
          const item = itemById.get(line.itemId)
          return (
            <div key={line.key} className="medicine-row">
              <div className="medicine-row__main" style={{ gridTemplateColumns: 'minmax(0, 2fr) 90px 120px 130px 150px' }}>
                <Select
                  value={line.itemId}
                  onChange={(value: string) => {
                    const chosen = itemById.get(value)
                    setLines((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? { ...entry, itemId: value, unitCostMicro: entry.unitCostMicro || (chosen?.purchasePriceMicro ?? 0), batchNo: entry.batchNo }
                          : entry
                      )
                    )
                  }}
                  options={[
                    { value: '', label: 'Select an item…' },
                    ...(items.data?.items ?? []).map((entry: InventoryItem) => ({ value: String(entry.id), label: `${entry.name} (${entry.unit})` }))
                  ]}
                  ariaLabel={`Line ${index + 1} item`}
                />
                <NumberInput value={line.quantity} onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, quantity: value ?? 1 } : entry)))} ariaLabel={`Line ${index + 1} quantity`} min={0.01} max={1_000_000} />
                <MoneyInput value={line.unitCostMicro} onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, unitCostMicro: value ?? 0 } : entry)))} ariaLabel={`Line ${index + 1} unit cost`} />
                <TextInput value={line.batchNo} onChange={(value) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, batchNo: value } : entry)))} ariaLabel={`Line ${index + 1} batch`} placeholder={item?.expiryTracking ? 'Batch (required)' : 'Batch'} maxLength={60} />
                <input
                  type="date"
                  className="field__input num"
                  aria-label={`Line ${index + 1} expiry`}
                  value={line.expiryDate ?? ''}
                  onChange={(event) => setLines((current) => current.map((entry, position) => (position === index ? { ...entry, expiryDate: event.target.value || null } : entry)))}
                />
              </div>
              <div className="medicine-row__side">
                <span className="num small">{format.money(Math.round(line.quantity * line.unitCostMicro))}</span>
                {item?.expiryTracking && !line.expiryDate ? <Badge tone="warning">Expiry needed</Badge> : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={15} />}
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => setLines((current) => (current.length === 1 ? [blankLine()] : current.filter((_, position) => position !== index)))}
                />
              </div>
            </div>
          )
        })}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Button size="sm" variant="secondary" icon={<Plus size={15} />} onClick={() => setLines((current) => [...current, blankLine()])}>
            Add line
          </Button>
          <span className="num">Total {format.money(total)}</span>
        </div>
      </div>
    </Modal>
  )
}

function PurchasePaymentDialog({ purchase, onClose, onSaved }: { purchase: Purchase | null; onClose(): void; onSaved(): void }): ReactNode {
  const format = useFormatters()
  const [busy, setBusy] = useState(false)
  const [paid, setPaid] = useState(0)
  const [method, setMethod] = useState('bank')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!purchase) return
    setPaid(purchase.paidMicro)
    setMethod('bank')
    setNote('')
  }, [purchase])

  const save = async (): Promise<void> => {
    if (!purchase) return
    setBusy(true)
    try {
      await invoke('purchases.setPaid', { id: purchase.id, paidMicro: paid, method, note: note.trim() === '' ? null : note.trim() })
      toast('success', 'Supplier payment recorded')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The payment could not be recorded', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={purchase !== null}
      title={purchase ? `Payment for ${purchase.purchaseNo}` : 'Supplier payment'}
      description={purchase ? `Total ${format.money(purchase.totalMicro)} · already paid ${format.money(purchase.paidMicro)}.` : undefined}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save payment
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Total paid to date (৳)" htmlFor="purchasePaidTotal" required hint="Absolute amount, not an increment.">
          <MoneyInput id="purchasePaidTotal" value={paid} onChange={(value) => setPaid(value ?? 0)} />
        </Field>
        <Field label="Method" htmlFor="purchasePaidMethod">
          <Select id="purchasePaidMethod" value={method} onChange={setMethod} options={PAYMENT_METHODS.map((entry) => ({ value: entry.value, label: entry.label }))} ariaLabel="Method" />
        </Field>
        <Field label="Note" htmlFor="purchasePaidNote" span={2}>
          <TextInput id="purchasePaidNote" value={note} onChange={setNote} maxLength={300} />
        </Field>
      </div>
    </Modal>
  )
}
