import { assertPermission } from '../../context'
import { writeCsv, exportStamp, type CsvColumn } from '../../files/csv'
import { formatAmountPlain } from '@shared/money'
import { archiveItem, batchesForItem, expiringBatches, listItems, lowStockItems, saveItem } from '../../modules/inventory/items'
import { inventoryDetail, listMovements, recordMovement, reverseMovement } from '../../modules/inventory/movements'
import { getPurchase, listPurchases, savePurchase, setPurchasePaid } from '../../modules/inventory/purchases'
import { archiveSupplier, getSupplier, listSuppliers, saveSupplier } from '../../modules/inventory/suppliers'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'
import type { MovementRecord } from '../../modules/inventory/items'
import type { PurchaseRecord } from '../../modules/inventory/purchases'

/**
 * Handlers for the stock room: items, batches, the movement ledger, suppliers and purchases.
 *
 * The two CSV exports are the only handlers that write to disk; everything else goes through the services
 * where permissions, the append-only ledger and the audit trail live.
 */
export function createInventoryHandlers(deps: HandlerDeps): PartialHandlerMap {
  const movementColumns: Array<CsvColumn<MovementRecord>> = [
    { key: 'date', header: 'Date', value: (row) => row.movementDate },
    { key: 'itemCode', header: 'Item code', value: (row) => row.itemCode },
    { key: 'item', header: 'Item', value: (row) => row.itemName },
    { key: 'type', header: 'Movement', value: (row) => row.movementType },
    { key: 'quantity', header: 'Quantity', value: (row) => String(row.signedQuantity) },
    { key: 'unit', header: 'Unit', value: (row) => row.unit },
    { key: 'batch', header: 'Batch', value: (row) => row.batchNo ?? '' },
    { key: 'unitCost', header: 'Unit cost (BDT)', value: (row) => formatAmountPlain(row.unitCostMicro, false) },
    { key: 'value', header: 'Value (BDT)', value: (row) => formatAmountPlain(row.valueMicro, false) },
    { key: 'reason', header: 'Reason', value: (row) => row.reason ?? '' },
    { key: 'reference', header: 'Reference', value: (row) => row.reference ?? '' },
    { key: 'supplier', header: 'Supplier', value: (row) => row.supplierName ?? '' },
    { key: 'by', header: 'Recorded by', value: (row) => row.byUserName ?? '' }
  ]

  const purchaseColumns: Array<CsvColumn<PurchaseRecord>> = [
    { key: 'purchaseNo', header: 'Purchase no', value: (row) => row.purchaseNo },
    { key: 'date', header: 'Date', value: (row) => row.purchaseDate },
    { key: 'supplier', header: 'Supplier', value: (row) => row.supplierName ?? '' },
    { key: 'invoiceRef', header: 'Supplier invoice', value: (row) => row.invoiceRef ?? '' },
    { key: 'status', header: 'Status', value: (row) => row.status },
    { key: 'total', header: 'Total (BDT)', value: (row) => formatAmountPlain(row.totalMicro, false) },
    { key: 'paid', header: 'Paid (BDT)', value: (row) => formatAmountPlain(row.paidMicro, false) },
    { key: 'due', header: 'Due (BDT)', value: (row) => formatAmountPlain(row.dueMicro, false) },
    { key: 'lines', header: 'Lines', value: (row) => row.lines.map((line) => `${line.itemName} × ${line.quantity}`).join('; ') }
  ]

  return {
    /* -------------------------------------------------------------------- items */

    'inventory.list': (ctx, input) => listItems(ctx, input),
    'inventory.get': (ctx, input) => inventoryDetail(ctx, input.id),
    'inventory.save': (ctx, input) => saveItem(ctx, input),
    'inventory.archive': (ctx, input) => archiveItem(ctx, input),
    'inventory.batches': (ctx, input) => batchesForItem(ctx, input.itemId),
    'inventory.lowStock': (ctx) => lowStockItems(ctx),
    'inventory.expiring': (ctx, input) => expiringBatches(ctx, input.withinDays),

    /* ---------------------------------------------------------------- movements */

    'inventory.movement.add': (ctx, input) => recordMovement(ctx, input),
    'inventory.movement.reverse': (ctx, input) => reverseMovement(ctx, input),
    'inventory.movements': (ctx, input) => listMovements(ctx, input),
    'inventory.movements.export': async (ctx, input) => {
      assertPermission(ctx, 'inventory.view')
      const page = listMovements(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export stock movements',
        defaultPath: `${deps.host.paths.exportsDir}/stock-movements-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, movementColumns)
      ctx.audit.write({ module: 'inventory', action: 'export', summary: `Exported ${rowCount} stock movement(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },

    /* ---------------------------------------------------------------- suppliers */

    'suppliers.list': (ctx, input) => listSuppliers(ctx, input),
    'suppliers.get': (ctx, input) => getSupplier(ctx, input.id),
    'suppliers.save': (ctx, input) => saveSupplier(ctx, input),
    'suppliers.archive': (ctx, input) => archiveSupplier(ctx, input),

    /* ---------------------------------------------------------------- purchases */

    'purchases.list': (ctx, input) => listPurchases(ctx, input),
    'purchases.get': (ctx, input) => getPurchase(ctx, input.id),
    'purchases.save': (ctx, input) => savePurchase(ctx, input),
    'purchases.setPaid': (ctx, input) => setPurchasePaid(ctx, input),
    'purchases.export': async (ctx, input) => {
      assertPermission(ctx, 'suppliers.view')
      const page = listPurchases(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export purchases',
        defaultPath: `${deps.host.paths.exportsDir}/purchases-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, purchaseColumns)
      ctx.audit.write({ module: 'inventory', action: 'export', summary: `Exported ${rowCount} purchase(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },
  }
}
