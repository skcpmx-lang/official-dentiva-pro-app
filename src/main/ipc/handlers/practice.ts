import type { ServiceContext } from '../../context'
import { getAllSettings, updateSettings, getClinicProfile, updateClinicProfile, getSetting } from '../../modules/settings/service'
import { SETTING_DEFS, settingGroup } from '../../modules/settings/defaults'
import { dentistForContract, listDentists, saveDentist, setDentistActive, archiveDentist, updateDentistPhoto, dentistsOnDuty } from '../../modules/dentists/service'
import { listStaff, getStaff, saveStaff, archiveStaff, updateStaffPhoto } from '../../modules/staff/service'
import {listUsers, saveUser, setUserActive, resetUserPassword, unlockUser, deleteUser, loginHistory } from '../../modules/users/service'
import { listRoles, saveRole, deleteRole, permissionCatalog } from '../../modules/roles/service'
import { getPreferences, listRecentlyViewed, setPreferences } from '../../modules/preferences/service'
import { storeImage, deleteStoredFile, resolveStoredPath } from '../../files/storage'
import type { PartialHandlerMap } from '../router'
import { assertPermission } from '../../context'
import type { HandlerDeps } from './system'

/**
 * Handlers for clinic settings, dentists, staff, users, roles and per-user preferences.
 * Every handler delegates to a service that performs its own permission check; handlers only translate
 * between the IPC contract and the domain layer.
 */
export function createPracticeHandlers(deps: HandlerDeps): PartialHandlerMap {
  /** The contract shape lives with the domain type, so the setup summary returns it too. */
  const withDentistShape = dentistForContract

  const applyLogo = (ctx: ServiceContext, relativePath: string | null): void => {
    ctx.db.prepare('UPDATE clinic SET logo_path = ?, updated_at = ? WHERE id = 1').run(relativePath, ctx.now())
  }

  return {
    'settings.defs': () =>
      SETTING_DEFS.map((def) => ({
        key: def.key,
        group: settingGroup(def.key),
        type: def.type,
        default: def.default,
        label: def.label,
        description: def.description,
        values: def.values ? [...def.values] : undefined,
        min: def.min,
        max: def.max
      })),

    'settings.all': (ctx) => getAllSettings(ctx),
    'settings.update': (ctx, input) => updateSettings(ctx, input.values),
    'settings.clinic': (ctx) => getClinicProfile(ctx),
    'settings.updateClinic': (ctx, input) => updateClinicProfile(ctx, input),
    'settings.workingHours': (ctx) => {
      const clinic = getClinicProfile(ctx)
      return {
        openingTime: clinic.openingTime ?? getSetting(ctx, 'practice.openingTime'),
        closingTime: clinic.closingTime ?? getSetting(ctx, 'practice.closingTime'),
        weeklyClosedDays: clinic.weeklyClosedDays
      }
    },

    'settings.uploadLogo': (ctx, input) => {
      assertPermission(ctx, 'settings.modify')
      const stored = storeImage(ctx.host.paths.dataDir, 'branding', input)
      const previous = getClinicProfile(ctx).logoPath
      applyLogo(ctx, stored.relativePath)
      if (previous) deleteStoredFile(resolveStoredPath(ctx.host.paths.dataDir, previous), ctx.host.paths.dataDir)
      ctx.audit.write({ module: 'settings', action: 'clinic.logo', entityType: 'clinic', entityId: 1, summary: 'Clinic logo updated' })
      return { logoPath: stored.relativePath }
    },

    'settings.clearLogo': (ctx) => {
      assertPermission(ctx, 'settings.modify')
      const previous = getClinicProfile(ctx).logoPath
      applyLogo(ctx, null)
      if (previous) deleteStoredFile(resolveStoredPath(ctx.host.paths.dataDir, previous), ctx.host.paths.dataDir)
      ctx.audit.write({ module: 'settings', action: 'clinic.logo.clear', entityType: 'clinic', entityId: 1, summary: 'Clinic logo removed' })
      return { ok: true as const }
    },

    'dentists.list': (ctx, input) => listDentists(ctx, { includeInactive: input.includeInactive }).map(withDentistShape),
    'dentists.save': (ctx, input) => withDentistShape(saveDentist(ctx, input)),
    'dentists.setActive': (ctx, input) => withDentistShape(setDentistActive(ctx, input.id, input.isActive)),
    'dentists.archive': (ctx, input) => archiveDentist(ctx, input.id),
    'dentists.onDuty': (ctx, input) => dentistsOnDuty(ctx, input.weekday).map(withDentistShape),
    'dentists.uploadPhoto': (ctx, input) => {
      const stored = storeImage(ctx.host.paths.dataDir, 'photos/dentists', input)
      return withDentistShape(updateDentistPhoto(ctx, input.id, stored.relativePath))
    },

    'staff.list': (ctx, input) =>
      listStaff(ctx, { search: input.search, status: input.status, includeArchived: input.includeArchived, limit: input.limit, offset: input.offset }),
    'staff.get': (ctx, input) => getStaff(ctx, input.id),
    'staff.save': (ctx, input) => saveStaff(ctx, input),
    'staff.archive': (ctx, input) => {
      archiveStaff(ctx, input.id, input.reason ?? null)
      return { ok: true as const }
    },
    'staff.uploadPhoto': (ctx, input) => {
      const stored = storeImage(ctx.host.paths.dataDir, 'photos/staff', input)
      return updateStaffPhoto(ctx, input.id, stored.relativePath)
    },

    'users.list': (ctx, input) => listUsers(ctx, { search: input.search, includeInactive: input.includeInactive }),
    'users.save': (ctx, input) => saveUser(ctx, input),
    'users.setActive': (ctx, input) => {
      const user = setUserActive(ctx, input.id, input.isActive)
      deps.invalidateActor(input.id)
      deps.broadcast('session:permissions-changed', { userId: input.id })
      return user
    },
    'users.resetPassword': (ctx, input) => {
      resetUserPassword(ctx, input.id, input.newPassword, input.requireChange)
      deps.invalidateActor(input.id)
      return { ok: true as const }
    },
    'users.unlock': (ctx, input) => unlockUser(ctx, input.id),
    'users.delete': (ctx, input) => {
      deleteUser(ctx, input.id, input.confirmation)
      deps.invalidateActor(input.id)
      return { ok: true as const }
    },
    'users.loginHistory': (ctx, input) => loginHistory(ctx, input.userId, input.limit),

    'roles.list': (ctx, input) => listRoles(ctx, input.includeInactive),
    'roles.permissions': () => permissionCatalog(),
    'roles.save': (ctx, input) => {
      const role = saveRole(ctx, input)
      // Permissions may have changed for every holder of this role: drop cached actors.
      const holders = ctx.db.prepare('SELECT id FROM users WHERE role_id = ? AND is_deleted = 0').all(role.id) as Array<{ id: number }>
      for (const holder of holders) {
        deps.invalidateActor(holder.id)
        deps.broadcast('session:permissions-changed', { userId: holder.id })
      }
      return role
    },
    'roles.delete': (ctx, input) => {
      deleteRole(ctx, input.id, input.confirmation)
      return { ok: true as const }
    },

    'preferences.get': (ctx) => getPreferences(ctx),
    'preferences.set': (ctx, input) => {
      setPreferences(ctx, input.values)
      return { ok: true as const }
    },
    'preferences.recent': (ctx, input) => listRecentlyViewed(ctx, input.limit)
  }
}

