import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Boxes, History, PackagePlus, Pencil, RotateCcw } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, TextArea } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { MOVEMENT_TYPE_META, inventoryCategoryLabel, movementTypeLabel, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import { AdjustStockDialog } from './InventoryScreen'
import type { InventoryBatch, StockMovement } from '../../lib/types'

/**
 * One inventory item, in full.
 *
 * The header shows what is on the shelf right now, the batch table shows which lots that stock consists
 * of, and the ledger below shows every movement that ever changed it — including corrections. A movement
 * is corrected by writing its opposite, so this screen never hides a mistake, it explains it.
 */
export function InventoryItemScreen(): ReactNode {
  const params = useParams()
  const navigate = useNavigate()
  const format = useFormatters()
  const canAdjust = usePermission('inventory.adjust')
  const canManage = usePermission('inventory.edit')

  const itemId = Number(params.itemId)
  const detail = useInvoke('inventory.get', { id: itemId }, { enabled: Number.isFinite(itemId) })
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [reversing, setReversing] = useState<StockMovement | null>(null)

  const item = detail.data?.item
  const batches = detail.data?.batches ?? []
  const movements = detail.data?.movements ?? []

  const batchColumns: Array<Column<InventoryBatch>> = [
    {
      key: 'batch',
      header: 'Batch',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.batchNo ?? `Batch #${row.id}`}</span>
          <span className="muted small num">received {format.date(row.receivedAt)}</span>
        </div>
      ),
      sortValue: (row) => row.batchNo ?? ''
    },
    {
      key: 'expiry',
      header: 'Expiry',
      width: 150,
      render: (row) =>
        row.expiryDate ? (
          <span className="stack" style={{ gap: 2 }}>
            <span className="num small">{row.expiryDate}</span>
            {row.isExpired ? <Badge tone="danger">Expired {Math.abs(row.daysToExpiry ?? 0)} day(s) ago</Badge> : row.daysToExpiry !== null && row.daysToExpiry <= 90 ? <Badge tone="warning">{row.daysToExpiry} day(s) left</Badge> : null}
          </span>
        ) : (
          <span className="muted">—</span>
        ),
      sortValue: (row) => row.expiryDate ?? '9999-12-31'
    },
    { key: 'quantity', header: 'Quantity', width: 120, align: 'right', render: (row) => <span className="num">{row.quantity.toLocaleString()}</span>, sortValue: (row) => row.quantity },
    { key: 'cost', header: 'Unit cost', width: 120, align: 'right', render: (row) => <span className="num">{format.money(row.unitCostMicro)}</span>, sortValue: (row) => row.unitCostMicro, secondary: true },
    {
      key: 'value',
      header: 'Value',
      width: 120,
      align: 'right',
      render: (row) => <span className="num">{format.money(Math.round(row.quantity * row.unitCostMicro))}</span>,
      sortValue: (row) => row.quantity * row.unitCostMicro
    }
  ]

  const movementColumns: Array<Column<StockMovement>> = [
    { key: 'date', header: 'Date', width: 120, render: (row) => <span className="num small">{row.movementDate}</span>, sortValue: (row) => row.at },
    {
      key: 'type',
      header: 'Movement',
      width: 180,
      render: (row) => (
        <Badge tone={MOVEMENT_TYPE_META[row.movementType]?.direction === 'in' ? 'success' : 'warning'}>{movementTypeLabel(row.movementType)}</Badge>
      ),
      sortValue: (row) => row.movementType
    },
    {
      key: 'quantity',
      header: 'Quantity',
      width: 110,
      align: 'right',
      render: (row) => (
        <span className="num">
          {row.signedQuantity > 0 ? '+' : '−'}
          {Math.abs(row.signedQuantity).toLocaleString()}
        </span>
      ),
      sortValue: (row) => row.signedQuantity
    },
    { key: 'batch', header: 'Batch', width: 120, render: (row) => <span className="small num">{row.batchNo ?? '—'}</span> },
    { key: 'reason', header: 'Reason', render: (row) => <span className="small">{row.reason ?? '—'}</span> },
    { key: 'reference', header: 'Reference', width: 140, render: (row) => <span className="small num">{row.reference ?? '—'}</span>, secondary: true },
    { key: 'by', header: 'Recorded by', width: 150, render: (row) => <span className="small">{row.byUserName ?? '—'}</span>, secondary: true }
  ]

  if (detail.error) {
    return (
      <div className="page">
        <PageHeader breadcrumbs={<Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => navigate('/inventory')}>All items</Button>} title="Item not found" subtitle={detail.error.message} />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={
          <button type="button" className="row small link" style={{ gap: 6, background: 'none', border: 0, cursor: 'pointer' }} onClick={() => navigate('/inventory')}>
            <ArrowLeft size={14} /> All inventory
          </button>
        }
        title={
          <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            <span>{item?.name ?? 'Loading…'}</span>
            {item ? <span className="num muted">{item.code}</span> : null}
            {item?.isLowStock ? <Badge tone="warning">Reorder</Badge> : null}
            {item && !item.isActive ? <Badge tone="neutral">Archived</Badge> : null}
          </span>
        }
        subtitle={
          item
            ? `${inventoryCategoryLabel(item.category)} · ${item.quantityOnHand.toLocaleString()} ${item.unit} on hand · ${format.money(item.stockValueMicro)} at cost${item.location ? ` · ${item.location}` : ''}${item.supplierName ? ` · ${item.supplierName}` : ''}`
            : undefined
        }
        actions={
          <div className="row" style={{ gap: 8 }}>
            {item && canManage ? (
              <Button variant="tertiary" icon={<Pencil size={16} />} onClick={() => navigate(`/inventory?edit=${item.id}`)}>
                Edit details
              </Button>
            ) : null}
            {item && canAdjust ? (
              <Button variant="primary" icon={<PackagePlus size={16} />} onClick={() => setAdjustOpen(true)}>
                Stock in/out
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">On hand</span>
          <strong className="num">
            {item ? `${item.quantityOnHand.toLocaleString()} ${item.unit}` : '—'}
          </strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Reorder level</span>
          <strong className="num">{item ? item.reorderLevel.toLocaleString() : '—'}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Purchase cost</span>
          <strong className="num">{format.money(item?.purchasePriceMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Selling price</span>
          <strong className="num">{format.money(item?.sellingPriceMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Nearest expiry</span>
          <strong className="num">{item?.nearestExpiry ?? '—'}</strong>
        </span>
      </div>

      <Card>
        <CardHeader title="Batches" icon={<Boxes size={17} />} subtitle="Stock split by lot, oldest expiry first. Quantities are recomputed from the ledger." />
        <CardBody flush>
          <DataTable
            columns={batchColumns}
            rows={batches}
            getRowId={(row) => row.id}
            loading={detail.loading}
            emptyTitle={item?.expiryTracking ? 'No batches yet' : 'This item is not batch-tracked'}
            emptyMessage={item?.expiryTracking ? 'Receive stock to create the first batch.' : 'Batches and expiry dates are used for medicines and materials that can go off.'}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Stock ledger"
          icon={<History size={17} />}
          subtitle="Newest first. Movements are append-only; a mistake is corrected by a reversal that stays visible."
        />
        <CardBody flush>
          <DataTable
            columns={movementColumns}
            rows={movements}
            getRowId={(row) => row.id}
            loading={detail.loading}
            emptyTitle="No movements yet"
            emptyMessage="Record opening stock or receive a purchase to start the ledger."
            rowActions={(row) =>
              canAdjust ? (
                <Button size="sm" variant="ghost" icon={<RotateCcw size={15} />} onClick={() => setReversing(row)}>
                  Reverse
                </Button>
              ) : null
            }
          />
        </CardBody>
        {(detail.data?.recentUsage.length ?? 0) > 0 ? (
          <CardBody>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
              <span className="muted small">Last 30 days issued:</span>
              {(detail.data?.recentUsage ?? []).map((entry) => (
                <span key={entry.date} className="small num">
                  {entry.date} · {entry.quantity.toLocaleString()} {item?.unit}
                </span>
              ))}
            </div>
          </CardBody>
        ) : null}
      </Card>

      {item ? (
        <AdjustStockDialog
          item={item}
          open={adjustOpen}
          onClose={() => setAdjustOpen(false)}
          onSaved={() => void detail.reload()}
        />
      ) : null}

      <ReverseMovementDialog
        movement={reversing}
        onClose={() => setReversing(null)}
        onSaved={() => void detail.reload()}
      />
    </div>
  )
}

function ReverseMovementDialog({
  movement,
  onClose,
  onSaved
}: {
  movement: StockMovement | null
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!movement) return
    if (reason.trim().length < 3) {
      toast('warning', 'A reason is required', 'Say why the movement is being reversed.')
      return
    }
    setBusy(true)
    try {
      await invoke('inventory.movement.reverse', { id: movement.id, reason: reason.trim() })
      toast('success', 'Movement reversed', 'The opposite entry is now in the ledger next to the original.')
      setReason('')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The movement could not be reversed', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={movement !== null}
      title={movement ? `Reverse movement #${movement.id}` : 'Reverse movement'}
      description={
        movement
          ? `${movementTypeLabel(movement.movementType)} · ${movement.signedQuantity > 0 ? '+' : '−'}${Math.abs(movement.signedQuantity)} ${movement.batchNo ? `· batch ${movement.batchNo}` : ''}. The original stays in the ledger.`
          : undefined
      }
      busy={busy}
      onClose={() => {
        setReason('')
        onClose()
      }}
      footer={
        <>
          <Button
            variant="tertiary"
            disabled={busy}
            onClick={() => {
              setReason('')
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()}>
            Reverse movement
          </Button>
        </>
      }
    >
      <Field label="Why is this movement being reversed?" htmlFor="reverseReason" required>
        <TextArea
          id="reverseReason"
          value={reason}
          onChange={setReason}
          rows={3}
          maxLength={300}
          placeholder="For example: the syringe was recorded as damaged but was actually used."
        />
      </Field>
    </Modal>
  )
}
