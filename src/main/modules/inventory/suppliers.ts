import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { conflictError, notFoundError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import type { zSupplierInput } from '@shared/contracts'
import { z } from 'zod'

export type SupplierInput = z.infer<typeof zSupplierInput>

export interface SupplierRecord {
  id: number
  name: string
  contactPerson: string | null
  phone: string | null
  altPhone: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  purchases: number
  totalPurchasedMicro: number
  dueMicro: number
  createdAt: number
  updatedAt: number
}

interface SupplierRow {
  id: number
  name: string
  contact_person: string | null
  phone: string | null
  alt_phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active: number
  purchases: number
  total_purchased_micro: number
  due_micro: number
  created_at: number
  updated_at: number
}

const SELECT_SUPPLIER = `
  SELECT s.id, s.name, s.contact_person, s.phone, s.alt_phone, s.email, s.address, s.notes, s.is_active, s.created_at, s.updated_at,
         (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.status <> 'void') AS purchases,
         (SELECT COALESCE(SUM(p.total_micro), 0) FROM purchases p WHERE p.supplier_id = s.id AND p.status <> 'void') AS total_purchased_micro,
         (SELECT COALESCE(SUM(p.total_micro - p.paid_micro), 0) FROM purchases p WHERE p.supplier_id = s.id AND p.status <> 'void') AS due_micro
    FROM suppliers s
`

function mapSupplier(row: SupplierRow): SupplierRecord {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    isActive: row.is_active === 1,
    purchases: row.purchases,
    totalPurchasedMicro: row.total_purchased_micro,
    dueMicro: row.due_micro,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listSuppliers(ctx: ServiceContext, filter: { search?: string, includeInactive: boolean }): SupplierRecord[] {
  assertPermission(ctx, 'suppliers.view')
  const clauses: string[] = ['s.is_deleted = 0']
  const params: Record<string, unknown> = {}
  if (!filter.includeInactive) clauses.push('s.is_active = 1')
  if (filter.search && filter.search.trim() !== '') {
    params.term = `%${filter.search.trim()}%`
    params.fold = `%${foldForSearch(filter.search)}%`
    clauses.push('(s.name LIKE @term OR s.name_fold LIKE @fold OR s.phone LIKE @term OR s.contact_person LIKE @term)')
  }
  const rows = ctx.db
    .prepare(`${SELECT_SUPPLIER} WHERE ${clauses.join(' AND ')} ORDER BY s.name_fold ASC`)
    .all(params) as SupplierRow[]
  return rows.map(mapSupplier)
}

export function getSupplier(ctx: ServiceContext, id: number): SupplierRecord {
  assertPermission(ctx, 'suppliers.view')
  const row = ctx.db.prepare(`${SELECT_SUPPLIER} WHERE s.id = ? AND s.is_deleted = 0`).get(id) as SupplierRow | undefined
  if (!row) throw notFoundError('supplier', id)
  return mapSupplier(row)
}

export function saveSupplier(ctx: ServiceContext, input: SupplierInput): SupplierRecord {
  assertPermission(ctx, 'suppliers.manage')
  const fold = foldForSearch(input.name)
  const duplicate = ctx.db
    .prepare('SELECT id FROM suppliers WHERE is_deleted = 0 AND name_fold = ? AND id <> ?')
    .get(fold, input.id ?? -1) as { id: number } | undefined
  if (duplicate) throw conflictError(`A supplier named “${input.name}” already exists.`, { name: 'Already used' })

  const now = ctx.now()
  const id = ctx.db.transaction(() => {
    if (input.id) {
      const existing = ctx.db.prepare('SELECT id FROM suppliers WHERE id = ? AND is_deleted = 0').get(input.id)
      if (!existing) throw notFoundError('supplier', input.id)
      ctx.db
        .prepare(
          `UPDATE suppliers
              SET name = @name, name_fold = @fold, contact_person = @contactPerson, phone = @phone, alt_phone = @altPhone,
                  email = @email, address = @address, notes = @notes, is_active = @isActive, updated_at = @now
            WHERE id = @id`
        )
        .run({
          id: input.id,
          name: input.name,
          fold,
          contactPerson: input.contactPerson ?? null,
          phone: input.phone ?? null,
          altPhone: input.altPhone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
          isActive: input.isActive ? 1 : 0,
          now
        })
      ctx.audit.write({
        module: 'inventory',
        action: 'supplier.update',
        entityType: 'supplier',
        entityId: input.id,
        summary: `Updated supplier ${input.name}`,
        detail: null
      })
      return input.id
    }
    const result = ctx.db
      .prepare(
        `INSERT INTO suppliers (name, name_fold, contact_person, phone, alt_phone, email, address, notes, is_active, created_at, updated_at)
         VALUES (@name, @fold, @contactPerson, @phone, @altPhone, @email, @address, @notes, @isActive, @now, @now)`
      )
      .run({
        name: input.name,
        fold,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        altPhone: input.altPhone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ? 1 : 0,
        now
      })
    const created = Number(result.lastInsertRowid)
    ctx.audit.write({
      module: 'inventory',
      action: 'supplier.create',
      entityType: 'supplier',
      entityId: created,
      summary: `Added supplier ${input.name}`,
      detail: null
    })
    return created
  })()

  return getSupplier(ctx, id)
}

export function archiveSupplier(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'suppliers.manage')
  const supplier = getSupplier(ctx, input.id)
  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE suppliers SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?').run(now, input.id)
    ctx.db.prepare('UPDATE inventory_items SET supplier_id = NULL, updated_at = ? WHERE supplier_id = ?').run(now, input.id)
    ctx.audit.write({
      module: 'inventory',
      action: 'supplier.archive',
      entityType: 'supplier',
      entityId: input.id,
      summary: `Archived supplier ${supplier.name} (${supplier.purchases} purchases, due ${supplier.dueMicro} µ)`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}
