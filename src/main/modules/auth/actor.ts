import type { Db } from '../../db/connection'
import type { Actor } from '@shared/permissions'
import { notFoundError, stateError } from '@shared/errors'
import { rolePermissionCodes } from './service'

/**
 * Build the authoritative actor for a user id: role, permission set and discount authority, read from
 * the database. The renderer never supplies any of this; `deriveActor` is the only way an application
 * permission set comes into existence.
 */
export function deriveActor(db: Db, userId: number): Actor {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.is_active, u.is_deleted, r.id AS role_id, r.code AS role_code, r.is_active AS role_active,
              r.max_discount_bp
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: number
        username: string
        full_name: string
        is_active: number
        is_deleted: number
        role_id: number
        role_code: string
        role_active: number
        max_discount_bp: number | null
      }
    | undefined

  if (!row) throw notFoundError('user', userId)
  if (row.is_active !== 1 || row.is_deleted === 1) throw stateError('This user account is disabled.')
  if (row.role_active !== 1) throw stateError('The role assigned to this account is no longer active.')

  const permissions = new Set(rolePermissionCodes(db, row.role_id))
  return {
    userId: row.id,
    username: row.username,
    fullName: row.full_name,
    roleId: row.role_id,
    roleCode: row.role_code,
    permissions,
    maxDiscountBasisPoints: row.max_discount_bp
  }
}

