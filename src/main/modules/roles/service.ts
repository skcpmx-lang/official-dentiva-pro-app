import { z } from 'zod'
import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, conflictError, notFoundError, validationError } from '@shared/errors'
import { PERMISSIONS, isKnownPermission } from '@shared/permissions'
import type { zRoleInput } from '@shared/contracts'

export type RoleInput = z.infer<typeof zRoleInput>

export interface RoleRecord {
  id: number
  name: string
  code: string
  description: string | null
  isSystem: boolean
  isActive: boolean
  maxDiscountBasisPoints: number | null
  userCount: number
  permissions: string[]
}

interface RoleRow {
  id: number
  name: string
  code: string
  description: string | null
  is_system: number
  is_active: number
  max_discount_bp: number | null
  user_count: number
}

function loadRole(ctx: ServiceContext, row: RoleRow): RoleRecord {
  const permissions = (
    ctx.db.prepare('SELECT permission_code FROM role_permissions WHERE role_id = ? ORDER BY permission_code').all(row.id) as Array<{
      permission_code: string
    }>
  ).map((entry) => entry.permission_code)
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    isSystem: row.is_system === 1,
    isActive: row.is_active === 1,
    maxDiscountBasisPoints: row.max_discount_bp,
    userCount: row.user_count,
    permissions
  }
}

export function listRoles(ctx: ServiceContext, includeInactive = false): RoleRecord[] {
  assertPermission(ctx, 'roles.view')
  const rows = ctx.db
    .prepare(
      `SELECT r.id, r.name, r.code, r.description, r.is_system, r.is_active, r.max_discount_bp,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.is_deleted = 0) AS user_count
         FROM roles r
        ${includeInactive ? '' : 'WHERE r.is_active = 1'}
        ORDER BY r.is_system DESC, r.name`
    )
    .all() as RoleRow[]
  return rows.map((row) => loadRole(ctx, row))
}

export function getRole(ctx: ServiceContext, id: number): RoleRecord {
  assertPermission(ctx, 'roles.view')
  const row = ctx.db
    .prepare(
      `SELECT r.id, r.name, r.code, r.description, r.is_system, r.is_active, r.max_discount_bp,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.is_deleted = 0) AS user_count
         FROM roles r WHERE r.id = ?`
    )
    .get(id) as RoleRow | undefined
  if (!row) throw notFoundError('role', id)
  return loadRole(ctx, row)
}

export function permissionCatalog(): Array<{ code: string, module: string, label: string, description: string }> {
  return PERMISSIONS.map((permission) => ({ ...permission }))
}

export function saveRole(ctx: ServiceContext, input: RoleInput): RoleRecord {
  assertPermission(ctx, 'roles.manage')
  const now = ctx.now()
  const unknown = input.permissions.filter((code) => !isKnownPermission(code))
  if (unknown.length > 0) throw validationError(`Unknown permission code(s): ${unknown.join(', ')}`)
  const duplicateName = ctx.db.prepare('SELECT id FROM roles WHERE (name = ? COLLATE NOCASE OR code = ?) AND id <> ?').get(input.name, input.code, input.id ?? 0) as
    | { id: number }
    | undefined
  if (duplicateName) throw conflictError('A role with that name or code already exists.')

  const run = ctx.db.transaction(() => {
    let roleId = input.id ?? 0
    if (roleId) {
      const existing = ctx.db.prepare('SELECT is_system, code FROM roles WHERE id = ?').get(roleId) as { is_system: number, code: string } | undefined
      if (!existing) throw notFoundError('role', roleId)
      if (existing.is_system === 1 && existing.code !== input.code) {
        throw validationError('Built-in roles keep their identifier. Change the name or permissions instead.', { code: 'Identifier cannot be changed for built-in roles.' })
      }
      ctx.db
        .prepare('UPDATE roles SET name = @name, description = @description, is_active = @isActive, max_discount_bp = @maxDiscount, updated_at = @now WHERE id = @id')
        .run({
          id: roleId,
          name: input.name,
          description: input.description ?? null,
          isActive: input.isActive ? 1 : 0,
          maxDiscount: input.maxDiscountBasisPoints ?? null,
          now
        })
    } else {
      const result = ctx.db
        .prepare(
          `INSERT INTO roles (code, name, description, is_system, is_active, max_discount_bp, created_at, updated_at)
           VALUES (@code, @name, @description, 0, @isActive, @maxDiscount, @now, @now)`
        )
        .run({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          isActive: input.isActive ? 1 : 0,
          maxDiscount: input.maxDiscountBasisPoints ?? null,
          now
        })
      roleId = Number(result.lastInsertRowid)
    }

    ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
    const insert = ctx.db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
    for (const code of input.permissions) insert.run(roleId, code)
    return roleId
  })

  const roleId = run()
  ctx.audit.write({
    module: 'roles',
    action: input.id ? 'role.update' : 'role.create',
    entityType: 'role',
    entityId: roleId,
    summary: `${input.id ? 'Updated' : 'Created'} role ${input.name}`,
    detail: { permissions: input.permissions.length }
  })
  return getRole(ctx, roleId)
}

export function deleteRole(ctx: ServiceContext, id: number, confirmation: string): void {
  assertPermission(ctx, 'roles.manage')
  const role = getRole(ctx, id)
  if (role.isSystem) throw validationError('Built-in roles cannot be deleted. Deactivate the role or remove its permissions instead.')
  if (role.userCount > 0) throw conflictError(`This role is assigned to ${role.userCount} user(s). Move them to another role first.`)
  if (confirmation.trim().toLowerCase() !== role.name.toLowerCase()) {
    throw validationError('Type the role name exactly to confirm deletion.', { confirmation: `Type “${role.name}” to confirm.` })
  }
  ctx.db.prepare('DELETE FROM roles WHERE id = ?').run(id)
  ctx.audit.write({ module: 'roles', action: 'role.delete', entityType: 'role', entityId: id, summary: `Deleted role ${role.name}` })
}

export function assertRoleUsable(ctx: ServiceContext, roleId: number): void {
  const role = ctx.db.prepare('SELECT id, is_active FROM roles WHERE id = ?').get(roleId) as { id: number, is_active: number } | undefined
  if (!role) throw notFoundError('role', roleId)
  if (role.is_active !== 1) throw new AppError('E_STATE', 'That role is inactive.')
}
