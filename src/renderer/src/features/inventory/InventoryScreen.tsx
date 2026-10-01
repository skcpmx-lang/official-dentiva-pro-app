import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Boxes, Download, PackagePlus, Pencil, Plus } from 'lucide-react'
import { zInventoryItemInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, MoneyInput, NumberInput, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { INVENTORY_CATEGORIES, inventoryCategoryLabel, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { InventoryCategory, InventoryItem, InventoryItemInput, Supplier } from '../../lib/types'

const CATEGORY_OPTIONS = [{ value: 'all', label: 'All categories' }, ...INVENTORY_CATEGORIES]
const SORT_OPTIONS = [
  { value: 'name', label: 'Sort by name' },
  { value: 'stock', label: 'Sort by stock' },
  { value: 'value', label: 'Sort by value' },
  { value: 'expiry', label: 'Sort by expiry' }
]

/**
 * Stock room.
 *
 * One line per item with the quantity the ledger currently holds, its value, and the two things that
 * actually need action: items at or below their reorder level and batches heading for expiry. Both
 * filters exist because a clinic that only notices expired anaesthetic after it is in a patient's mouth
 * has already lost more than the stock.
 */
export function InventoryScreen(): ReactNode {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const format = useFormatters()
  const canManage = usePermission(['inventory.create', 'inventory.edit'])
  const canAdjust = usePermission('inventory.adjust')
  const canExport = usePermission('inventory.view')

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('name')
  const [lowStock, setLowStock] = useState(false)
  const [expiring, setExpiring] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null)
  const [supplierIds, setSupplierIds] = useState<Supplier[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  useEffect(() => {
    /* Suppliers are needed by the item dialog; loading them once keeps the form instant. */
    invoke('suppliers.list', { includeInactive: true })
      .then(setSupplierIds)
      .catch(() => setSupplierIds([]))
  }, [])

  const filter = useMemo(
    () => ({
      search: debounced === '' ? undefined : debounced,
      category: category === 'all' ? undefined : category,
      lowStock: lowStock || undefined,
      expiringWithinDays: expiring ? 90 : undefined,
      includeInactive,
      sort: sort as 'name' | 'stock' | 'value' | 'expiry',
      limit: 100,
      offset: 0
    }),
    [debounced, category, lowStock, expiring, includeInactive, sort]
  )
  const inventory = useInvoke('inventory.list', filter)
  const totals = inventory.data?.totals

  /* The detail screen links back here with ?edit=<id> so editing has exactly one dialog. */
  const editId = searchParams.get('edit')
  const editTarget = useInvoke('inventory.get', { id: Number(editId) }, { enabled: editId !== null })
  useEffect(() => {
    if (editId !== null && editTarget.data) setEditing(editTarget.data.item)
  }, [editId, editTarget.data])

  const columns: Array<Column<InventoryItem>> = [
    {
      key: 'item',
      header: 'Item',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.name}</span>
          <span className="muted small num">
            {row.code}
            {row.location ? ` · ${row.location}` : ''}
            {row.isActive ? '' : ' · archived'}
          </span>
        </div>
      ),
      sortValue: (row) => row.name
    },
    {
      key: 'category',
      header: 'Category',
      width: 140,
      render: (row) => <Badge tone="info">{inventoryCategoryLabel(row.category)}</Badge>,
      sortValue: (row) => row.category,
      secondary: true
    },
    {
      key: 'stock',
      header: 'On hand',
      width: 120,
      align: 'right',
      render: (row) => (
        <span className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
          <span className="num link-strong">
            {row.quantityOnHand.toLocaleString()} {row.unit}
          </span>
          {row.isLowStock ? <Badge tone="warning">Reorder at {row.reorderLevel}</Badge> : null}
        </span>
      ),
      sortValue: (row) => row.quantityOnHand
    },
    {
      key: 'expiry',
      header: 'Expiry',
      width: 150,
      render: (row) =>
        row.nearestExpiry ? (
          <span className="stack" style={{ gap: 2 }}>
            <span className="num small">{row.nearestExpiry}</span>
            {row.expiredBatches > 0 ? <Badge tone="danger">{row.expiredBatches} expired batch(es)</Badge> : null}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
      sortValue: (row) => row.nearestExpiry ?? '9999-12-31',
      secondary: true
    },
    {
      key: 'value',
      header: 'Stock value',
      width: 130,
      align: 'right',
      render: (row) => <span className="num">{format.money(row.stockValueMicro)}</span>,
      sortValue: (row) => row.stockValueMicro
    },
    {
      key: 'supplier',
      header: 'Supplier',
      width: 170,
      render: (row) => <span className="small">{row.supplierName ?? '—'}</span>,
      sortValue: (row) => row.supplierName ?? ''
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Inventory"
        subtitle="Consumables, instruments and medicines with their stock ledger, batches and expiry."
        actions={
          <div className="row" style={{ gap: 8 }}>
            {canExport ? (
              <Button
                variant="tertiary"
                icon={<Download size={16} />}
                loading={exporting}
                onClick={async () => {
                  setExporting(true)
                  try {
                    const result = await invoke('inventory.movements.export', { limit: 5000, offset: 0 })
                    if (result.path === null) toast('info', 'Export cancelled')
                    else toast('success', 'Stock movements exported', `${result.rowCount} rows written to ${result.path}`)
                  } catch (error) {
                    toast('error', 'The movements could not be exported', errorMessage(error))
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                Export ledger
              </Button>
            ) : null}
            {canManage ? (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                New item
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">Stock value</span>
          <strong className="num">{format.money(totals?.stockValueMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Needs reordering</span>
          <strong className="num">{totals?.lowStock ?? 0}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Expiring in 90 days</span>
          <strong className="num">{totals?.expiringSoon ?? 0}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Already expired</span>
          <strong className="num">{totals?.expired ?? 0}</strong>
        </span>
      </div>

      <Card>
        <CardHeader
          title="Items"
          icon={<Boxes size={17} />}
          subtitle="Quantities come from the movement ledger, never from an editable field."
          actions={
            <div className="row" style={{ gap: 14 }}>
              <Switch checked={lowStock} onChange={setLowStock} label="Below reorder level" />
              <Switch checked={expiring} onChange={setExpiring} label="Expiring within 90 days" />
              <Switch checked={includeInactive} onChange={setIncludeInactive} label="Show archived" />
            </div>
          }
        />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, code or location…" ariaLabel="Search inventory" />
            <Select value={category} onChange={(value: string) => setCategory(value)} options={CATEGORY_OPTIONS} ariaLabel="Category" />
            <Select value={sort} onChange={(value: string) => setSort(value)} options={SORT_OPTIONS} ariaLabel="Sort order" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={inventory.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={inventory.loading}
            emptyTitle="No items match"
            emptyMessage="Add an item to start tracking stock."
            rowActions={(row) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" icon={<Boxes size={15} />} onClick={() => navigate(`/inventory/${row.id}`)}>
                  Open
                </Button>
                {canAdjust ? (
                  <Button size="sm" variant="secondary" icon={<PackagePlus size={15} />} onClick={() => setAdjusting(row)}>
                    Stock in/out
                  </Button>
                ) : null}
                {canManage ? (
                  <Button size="sm" variant="ghost" icon={<Pencil size={15} />} aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                ) : null}
              </div>
            )}
          />
        </CardBody>
        {(inventory.data?.categories.length ?? 0) > 0 ? (
          <CardBody>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              {(inventory.data?.categories ?? []).map((entry) => (
                <span key={entry.category} className="muted small">
                  {inventoryCategoryLabel(entry.category)} · {entry.count}
                </span>
              ))}
              {(totals?.expiringSoon ?? 0) > 0 ? (
                <span className="row small" style={{ gap: 6, color: 'var(--warning, #b45309)' }}>
                  <AlertTriangle size={14} /> {totals?.expiringSoon} batch(es) expire within 90 days
                </span>
              ) : null}
            </div>
          </CardBody>
        ) : null}
      </Card>

      <ItemDialog
        item={creating ? null : editing}
        open={creating || editing !== null}
        suppliers={supplierIds}
        onClose={() => {
          setCreating(false)
          setEditing(null)
          if (editId !== null) {
            const next = new URLSearchParams(searchParams)
            next.delete('edit')
            setSearchParams(next, { replace: true })
          }
        }}
        onSaved={() => void inventory.reload()}
      />

      <AdjustStockDialog
        item={adjusting}
        open={adjusting !== null}
        onClose={() => setAdjusting(null)}
        onSaved={() => void inventory.reload()}
      />
    </div>
  )
}

export function ItemDialog({
  item,
  open,
  suppliers,
  onClose,
  onSaved
}: {
  item: InventoryItem | null
  open: boolean
  suppliers: Supplier[]
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const initial = {
    id: null as number | null,
    code: null as string | null,
    name: '',
    category: 'consumable' as InventoryCategory,
    unit: 'pcs',
    supplierId: null as number | null,
    purchasePriceMicro: 0,
    sellingPriceMicro: 0,
    reorderLevel: 0,
    expiryTracking: false,
    location: null as string | null,
    notes: null as string | null,
    isActive: true
  }
  const form = useZodForm(zInventoryItemInput, initial)

  useEffect(() => {
    if (!open) return
    form.reset(
      item
        ? {
            id: item.id,
            code: item.code,
            name: item.name,
            category: item.category as InventoryCategory,
            unit: item.unit,
            supplierId: item.supplierId,
            purchasePriceMicro: item.purchasePriceMicro,
            sellingPriceMicro: item.sellingPriceMicro,
            reorderLevel: item.reorderLevel,
            expiryTracking: item.expiryTracking,
            location: item.location,
            notes: item.notes,
            isActive: item.isActive
          }
        : initial
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item])

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      await invoke('inventory.save', form.values as InventoryItemInput)
      toast('success', item ? 'Item updated' : 'Item added', item ? undefined : 'Record opening stock next so quantities start from a real count.')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The item could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={item ? `Edit ${item.name}` : 'New inventory item'}
      description="Quantity is never typed here: stock changes only through purchases, issues and count corrections, so the ledger always explains the shelf."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Item name" htmlFor="itemName" required error={form.errors.name}>
          <TextInput id="itemName" value={String(form.values.name ?? '')} onChange={(value) => form.setValue('name', value)} maxLength={160} />
        </Field>
        <Field label="Code" htmlFor="itemCode" hint="Leave blank to generate one (ITM-…)." error={form.errors.code}>
          <TextInput id="itemCode" value={String(form.values.code ?? '')} onChange={(value) => form.setValue('code', value || null)} maxLength={24} />
        </Field>
        <Field label="Category" htmlFor="itemCategory" error={form.errors.category}>
          <Select
            id="itemCategory"
            value={String(form.values.category ?? 'consumable')}
            onChange={(value) => form.setValue('category', value as InventoryCategory)}
            options={INVENTORY_CATEGORIES}
            ariaLabel="Category"
          />
        </Field>
        <Field label="Unit" htmlFor="itemUnit" required error={form.errors.unit} hint="pcs, box, cartridge, ml…">
          <TextInput id="itemUnit" value={String(form.values.unit ?? '')} onChange={(value) => form.setValue('unit', value)} maxLength={16} />
        </Field>
        <Field label="Supplier" htmlFor="itemSupplier" error={form.errors.supplierId}>
          <Select
            id="itemSupplier"
            value={form.values.supplierId === null || form.values.supplierId === undefined ? '' : String(form.values.supplierId)}
            onChange={(value) => form.setValue('supplierId', value === '' ? null : Number(value))}
            options={[{ value: '', label: 'No usual supplier' }, ...suppliers.map((supplier) => ({ value: String(supplier.id), label: supplier.name }))]}
            ariaLabel="Supplier"
          />
        </Field>
        <Field label="Location" htmlFor="itemLocation" error={form.errors.location}>
          <TextInput id="itemLocation" value={String(form.values.location ?? '')} onChange={(value) => form.setValue('location', value || null)} maxLength={80} />
        </Field>
        <Field label="Purchase cost (৳)" htmlFor="itemCost" error={form.errors.purchasePriceMicro}>
          <MoneyInput id="itemCost" value={Number(form.values.purchasePriceMicro ?? 0)} onChange={(value) => form.setValue('purchasePriceMicro', value ?? 0)} />
        </Field>
        <Field label="Selling price (৳)" htmlFor="itemPrice" error={form.errors.sellingPriceMicro} hint="Optional; used when an item is billed directly.">
          <MoneyInput id="itemPrice" value={Number(form.values.sellingPriceMicro ?? 0)} onChange={(value) => form.setValue('sellingPriceMicro', value ?? 0)} />
        </Field>
        <Field label="Reorder level" htmlFor="itemReorder" error={form.errors.reorderLevel} hint="Alert when stock falls to or below this number.">
          <NumberInput
            id="itemReorder"
            value={Number(form.values.reorderLevel ?? 0)}
            onChange={(value) => form.setValue('reorderLevel', value ?? 0)}
            min={0}
            max={1_000_000}
          />
        </Field>
        <Field label="Expiry tracking" htmlFor="itemExpiry" error={form.errors.expiryTracking} hint="Requires a batch and expiry date on every receipt; stock is issued first-expiry-first-out.">
          <label className="checkbox">
            <input
              id="itemExpiry"
              type="checkbox"
              role="switch"
              checked={Boolean(form.values.expiryTracking)}
              onChange={(event) => form.setValue('expiryTracking', event.target.checked)}
            />
            <span>Track batches and expiry</span>
          </label>
        </Field>
        <Field label="Notes" htmlFor="itemNotes" span={2} error={form.errors.notes}>
          <TextArea id="itemNotes" value={String(form.values.notes ?? '')} onChange={(value) => form.setValue('notes', value || null)} rows={2} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}

const ADJUST_OPTIONS = [
  { value: 'usage', label: 'Issue to treatment (out)' },
  { value: 'purchase', label: 'Received on credit (in)' },
  { value: 'return_in', label: 'Returned to stock (in)' },
  { value: 'adjustment_in', label: 'Count correction (in)' },
  { value: 'adjustment_out', label: 'Count correction (out)' },
  { value: 'expired', label: 'Expired — write off (out)' },
  { value: 'damaged', label: 'Damaged — write off (out)' }
]

export function AdjustStockDialog({
  item,
  open,
  onClose,
  onSaved
}: {
  item: InventoryItem | null
  open: boolean
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [type, setType] = useState('usage')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [batchId, setBatchId] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [expiryDate, setExpiryDate] = useState<string | null>(null)
  const batches = useInvoke('inventory.batches', { itemId: item?.id ?? 0 }, { enabled: open && item !== null })
  const inbound = ['purchase', 'return_in', 'adjustment_in'].includes(type)

  useEffect(() => {
    if (!open) return
    setType('usage')
    setQuantity(1)
    setReason('')
    setReference('')
    setBatchId('')
    setBatchNo('')
    setExpiryDate(null)
  }, [open, item?.id])

  const submit = async (): Promise<void> => {
    if (!item) return
    if (reason.trim().length < 3) {
      toast('warning', 'A reason is required', 'Say why the stock changed — a stock take, a treatment, a write-off.')
      return
    }
    if (quantity <= 0) {
      toast('warning', 'Enter a quantity', 'The quantity must be greater than zero.')
      return
    }
    setBusy(true)
    try {
      await invoke('inventory.movement.add', {
        itemId: item.id,
        batchId: batchId === '' ? null : Number(batchId),
        batch: item.expiryTracking && inbound && batchId === '' ? { batchNo: batchNo.trim() === '' ? null : batchNo.trim(), expiryDate, unitCostMicro: item.purchasePriceMicro, supplierId: item.supplierId, note: null } : undefined,
        movementType: type as never,
        quantity,
        unitCostMicro: item.purchasePriceMicro,
        reason: reason.trim(),
        reference: reference.trim() === '' ? null : reference.trim(),
        supplierId: item.supplierId,
        at: null
      })
      toast('success', 'Stock updated', `${inbound ? 'Added' : 'Removed'} ${quantity} ${item.unit} of ${item.name}.`)
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The movement could not be recorded', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={item ? `Stock movement · ${item.name}` : 'Stock movement'}
      description={item ? `${item.quantityOnHand.toLocaleString()} ${item.unit} on hand. Every movement is kept in the ledger and can be reversed, never edited.` : undefined}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={inbound ? 'primary' : 'secondary'} loading={busy} onClick={() => void submit()}>
            {inbound ? 'Add stock' : 'Take stock out'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Movement" htmlFor="movementType" required>
          <Select id="movementType" value={type} onChange={setType} options={ADJUST_OPTIONS} ariaLabel="Movement type" />
        </Field>
        <Field label={item ? `Quantity (${item.unit})` : 'Quantity'} htmlFor="movementQuantity" required>
          <NumberInput id="movementQuantity" value={quantity} onChange={(value) => setQuantity(value ?? 1)} min={0.01} max={1_000_000} />
        </Field>
        {item?.expiryTracking ? (
          <>
            <Field label="Batch" htmlFor="movementBatch" hint="Leave blank to issue first-expiry-first-out.">
              <Select
                id="movementBatch"
                value={batchId}
                onChange={setBatchId}
                options={[
                  { value: '', label: inbound ? 'Create a new batch' : 'Auto (first expiry first)' },
                  ...((batches.data ?? []).filter((batch) => batch.quantity > 0).map((batch) => ({ value: String(batch.id), label: `${batch.batchNo ?? `Batch #${batch.id}`} · ${batch.quantity} ${item.unit}${batch.expiryDate ? ` · exp ${batch.expiryDate}` : ''}` })))
                ]}
                ariaLabel="Batch"
              />
            </Field>
            {inbound && batchId === '' ? (
              <>
                <Field label="New batch number" htmlFor="movementBatchNo">
                  <TextInput id="movementBatchNo" value={batchNo} onChange={setBatchNo} maxLength={60} />
                </Field>
                <Field label="Expiry date" htmlFor="movementExpiry" required>
                  <input
                    id="movementExpiry"
                    type="date"
                    className="field__input num"
                    value={expiryDate ?? ''}
                    onChange={(event) => setExpiryDate(event.target.value || null)}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        <Field label="Reason" htmlFor="movementReason" required span={2} hint="Kept forever next to the movement; “used in restoration”, “stock take”, “expired lot”.">
          <TextArea id="movementReason" value={reason} onChange={setReason} rows={2} maxLength={300} />
        </Field>
        <Field label="Reference" htmlFor="movementReference" span={2} hint="Visit number, supplier invoice, shelf count sheet…">
          <TextInput id="movementReference" value={reference} onChange={setReference} maxLength={120} />
        </Field>
      </div>
    </Modal>
  )
}
