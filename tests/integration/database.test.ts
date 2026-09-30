import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHarness } from './helpers'
import { openDatabase } from '@main/db/connection'
import { readSchemaVersion } from '@main/db/migrate'
import { SCHEMA_VERSION } from '@main/db/schema'
import { PERMISSIONS, DEFAULT_ROLES } from '@shared/permissions'
import { SETTING_DEFS } from '@main/modules/settings/defaults'

describe('database bootstrap', () => {
  it('creates the schema, seeds reference data and passes integrity checks', () => {
    const harness = createHarness()
    try {
      const { db } = harness.database

      expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
      expect(harness.database.integrityCheck().ok).toBe(true)
      expect(harness.database.foreignKeyCheck().ok).toBe(true)

      const permissionCount = (db.prepare('SELECT COUNT(*) AS count FROM permissions').get() as { count: number }).count
      expect(permissionCount).toBe(PERMISSIONS.length)

      const roleCodes = (db.prepare('SELECT code FROM roles ORDER BY code').all() as Array<{ code: string }>).map((row) => row.code)
      expect(roleCodes).toEqual(expect.arrayContaining(DEFAULT_ROLES.map((role) => role.code)))

      const ownerPermissions = db
        .prepare("SELECT COUNT(*) AS count FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'owner'")
        .get() as { count: number }
      expect(ownerPermissions.count).toBe(PERMISSIONS.length)

      const settingCount = (db.prepare('SELECT COUNT(*) AS count FROM settings').get() as { count: number }).count
      expect(settingCount).toBe(SETTING_DEFS.length)

      const treatmentCount = (db.prepare('SELECT COUNT(*) AS count FROM treatments').get() as { count: number }).count
      expect(treatmentCount).toBeGreaterThan(20)

      const findingCategories = (
        db.prepare('SELECT DISTINCT category FROM clinical_findings ORDER BY category').all() as Array<{ category: string }>
      ).map((row) => row.category)
      // The prescription vocabulary (chief complaints, examination notes, advice) shares this table
      // with the dental conditions, whose category is the kind the chart groups by.
      expect(findingCategories).toEqual(expect.arrayContaining(['cc', 'oe', 'advice', 'finding', 'treatment', 'state']))

      const profileCount = (db.prepare('SELECT COUNT(*) AS count FROM print_profiles').get() as { count: number }).count
      expect(profileCount).toBeGreaterThanOrEqual(10)
    } finally {
      harness.cleanup()
    }
  })

  it('survives being reopened and keeps its data', () => {
    const harness = createHarness({ keepData: true })
    const dataDir = harness.dataDir
    harness.database.db
      .prepare('INSERT INTO suppliers (name, name_fold, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('Dhaka Dental Supplies', 'dhaka dental supplies', Date.now(), Date.now())
    harness.database.close()

    const reopened = openDatabase({ filePath: `${dataDir}/data/dentiva.db` })
    try {
      const row = reopened.db.prepare('SELECT name FROM suppliers').get() as { name: string } | undefined
      expect(row?.name).toBe('Dhaka Dental Supplies')
      expect(readSchemaVersion(reopened.db)).toBe(SCHEMA_VERSION)
    } finally {
      reopened.close()
      harness.cleanup()
    }
  })

  it('enforces foreign keys and refuses orphan records', () => {
    const harness = createHarness()
    try {
      expect(() =>
        harness.database.db
          .prepare('INSERT INTO visits (visit_no, patient_id, dentist_id, visit_at, visit_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run('V-2601-0001', 999999, 999999, Date.now(), '2026-01-01', Date.now(), Date.now())
      ).toThrow()
    } finally {
      harness.cleanup()
    }
  })

  it('keeps one prepared statement per distinct SQL text and bounds the cache', () => {
    const harness = createHarness()
    try {
      const { db } = harness.database
      const sql = 'SELECT COUNT(*) AS count FROM patients'
      const first = db.prepare(sql)

      /* The same SQL must come back as the same statement: re-preparing it for every call is what made
         the process accumulate native memory without bound on the stress dataset. */
      expect(db.prepare(sql)).toBe(first)

      /* Filtered list queries build their SQL per call, so the cache size follows the number of distinct
         statements the clinic has issued, not the number of calls. */
      for (let index = 0; index < 60; index += 1) db.prepare(`SELECT ${index} AS value`).get()
      expect(harness.database.statementCacheSize()).toBeLessThanOrEqual(500)
      expect(harness.database.statementCacheSize()).toBeGreaterThanOrEqual(60)
    } finally {
      harness.cleanup()
    }
  })

  it('does not reconfigure prepared statements, which the shared cache depends on', () => {
    /* Statements are cached per SQL text, so a statement reconfigured with `.raw()`, `.pluck()` or
       `.expand()` would hand its changed row shape to the next caller of the same SQL. */
    const offenders: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (!path.endsWith('.ts')) continue
        /* Comments may name the calls; only real code counts. */
        const source = readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|\s)\/\/.*$/gm, '')
        for (const call of ['.raw()', '.pluck()', '.expand()']) {
          if (source.includes(call)) offenders.push(`${path}${call}`)
        }
      }
    }
    walk('src/main')
    walk('src/shared')
    expect(offenders).toEqual([])
  })

  it('keeps the audit log append-only at the database level', () => {
    const harness = createHarness()
    try {
      const { db } = harness.database
      db.prepare(
        `INSERT INTO audit_log (at, user_id, username, module, action, summary, result) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(Date.now(), 1, 'tester', 'test', 'test.event', 'An audit entry', 'success')

      expect(() => db.prepare("UPDATE audit_log SET summary = 'tampered'").run()).toThrow(/append-only/)
      expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/append-only/)
      const count = (db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as { count: number }).count
      expect(count).toBe(1)
    } finally {
      harness.cleanup()
    }
  })
})
