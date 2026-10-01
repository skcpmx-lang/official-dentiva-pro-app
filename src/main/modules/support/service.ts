import {statSync } from 'node:fs'
import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { readSchemaVersion } from '../../db/migrate'

/**
 * Diagnostics, About and third-party notices.
 *
 * `evaluateDiagnostics` powers Settings → Data → Maintenance and the support workflow: it reports row
 * counts, file sizes, integrity results and the location of the log folder, but never any patient data.
 */

export interface Diagnostics {
  appVersion: string
  schemaVersion: number
  databaseSizeBytes: number
  attachmentCount: number
  attachmentBytes: number
  patientCount: number
  visitCount: number
  invoiceCount: number
  auditEntryCount: number
  lastBackupAt: number | null
  logDirectory: string
  dataDirectory: string
  integrityOk: boolean
  foreignKeysOk: boolean
  uptimeMs: number
  tableSizes: Array<{ table: string, rows: number }>
}

const COUNTED_TABLES = [
  'patients',
  'visits',
  'appointments',
  'prescriptions',
  'prescription_medicines',
  'invoices',
  'invoice_lines',
  'payments',
  'inventory_items',
  'inventory_movements',
  'accounting_entries',
  'audit_log',
  'notifications',
  'print_history'
] as const

export function evaluateDiagnostics(ctx: ServiceContext): Diagnostics {
  assertPermission(ctx, 'settings.view')
  const db = ctx.db

  const count = (table: string): number => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
    return row.count
  }

  const attachments = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM patient_attachments WHERE is_deleted = 0')
    .get() as { count: number, bytes: number }

  const lastBackup = db.prepare('SELECT MAX(created_at) AS at FROM backups').get() as { at: number | null }
  const integrity = db.pragma('quick_check') as Array<{ quick_check: string }>
  const foreignKeys = db.pragma('foreign_key_check') as Array<Record<string, unknown>>

  return {
    appVersion: ctx.host.build.version,
    schemaVersion: readSchemaVersion(db),
    databaseSizeBytes: databaseSize(ctx),
    attachmentCount: attachments.count,
    attachmentBytes: Number(attachments.bytes),
    patientCount: count('patients'),
    visitCount: count('visits'),
    invoiceCount: count('invoices'),
    auditEntryCount: count('audit_log'),
    lastBackupAt: lastBackup.at,
    logDirectory: ctx.host.paths.logsDir,
    dataDirectory: ctx.host.paths.dataDir,
    integrityOk: integrity.length === 1 && integrity[0]?.quick_check === 'ok',
    foreignKeysOk: foreignKeys.length === 0,
    uptimeMs: Math.round(performance.now()),
    tableSizes: COUNTED_TABLES.map((table) => ({ table, rows: count(table) }))
  }
}

export function databaseSize(ctx: ServiceContext): number {
  let total = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += statSync(`${ctx.host.paths.databaseFile}${suffix}`).size
    } catch {
      /* file may not exist yet */
    }
  }
  return total
}

export interface DependencyNotice {
  name: string
  version: string
  licence: string
  purpose: string
}

/**
 * Runtime dependencies shipped inside the installer. Versions are verified against package.json by
 * `scripts/audit-dependencies.mjs`; the notices text is also written to THIRD_PARTY_NOTICES.md.
 */
export const DEPENDENCY_NOTICES: readonly DependencyNotice[] = [
  { name: 'Electron', version: '44.x', licence: 'MIT', purpose: 'Desktop application runtime (Chromium + Node.js)' },
  { name: 'React', version: '19.x', licence: 'MIT', purpose: 'User interface library' },
  { name: 'React DOM', version: '19.x', licence: 'MIT', purpose: 'DOM renderer for React' },
  { name: 'React Router', version: '7.x', licence: 'MIT', purpose: 'In-application navigation' },
  { name: 'Zustand', version: '5.x', licence: 'MIT', purpose: 'Session and interface state management' },
  { name: 'Zod', version: '4.x', licence: 'MIT', purpose: 'Runtime validation of all IPC payloads' },
  { name: 'better-sqlite3', version: '13.x', licence: 'MIT', purpose: 'Synchronous SQLite driver for the local clinic database' },
  { name: 'SQLite', version: '3.x', licence: 'Public Domain', purpose: 'Embedded relational database engine' },
  { name: 'fflate', version: '0.8.x', licence: 'MIT', purpose: 'Backup package compression (zip)' },
  { name: 'Lucide', version: '1.x', licence: 'ISC', purpose: 'Icon set' },
  { name: 'Inter (font)', version: '5.x', licence: 'OFL-1.1', purpose: 'Bundled Latin interface typeface' },
  { name: 'Noto Sans Bengali (font)', version: '5.x', licence: 'OFL-1.1', purpose: 'Bundled Bengali Unicode typeface for clinical text, printing and PDF' },
  { name: 'Vite', version: '7.x', licence: 'MIT', purpose: 'Build tooling (not shipped in the runtime bundle)' },
  { name: 'electron-builder', version: '26.x', licence: 'MIT', purpose: 'Windows installer packaging (build-time only)' },
  { name: 'Vitest', version: '3.x', licence: 'MIT', purpose: 'Unit and integration test runner (development only)' },
  { name: 'Playwright', version: '1.x', licence: 'Apache-2.0', purpose: 'End-to-end desktop testing (development only)' }
] as const

export const NOTICES_TEXT: readonly { name: string, licence: string, text: string }[] = [
  {
    name: 'Inter',
    licence: 'SIL Open Font License 1.1',
    text: 'Copyright (c) 2016 The Inter Project Authors. Licensed under the SIL Open Font License, Version 1.1. The font may be used, studied, modified and redistributed freely as long as it is not sold by itself.'
  },
  {
    name: 'Noto Sans Bengali',
    licence: 'SIL Open Font License 1.1',
    text: 'Copyright (c) 2015 The Noto Project Authors. Licensed under the SIL Open Font License, Version 1.1. Bundled to guarantee correct Bengali rendering offline.'
  },
  {
    name: 'Electron, React, React Router, Zustand, Zod, Vite, electron-builder, Vitest',
    licence: 'MIT',
    text: 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, subject to inclusion of the copyright notice and this permission notice.'
  },
  {
    name: 'better-sqlite3',
    licence: 'MIT',
    text: 'Copyright (c) 2017 Joshua Wise. SQLite itself is in the public domain (https://sqlite.org/copyright.html).'
  },
  {
    name: 'fflate',
    licence: 'MIT',
    text: 'Copyright (c) 2020 Arjun Barrett. Pure-JavaScript zip implementation used for backup packages.'
  },
  {
    name: 'Lucide',
    licence: 'ISC',
    text: 'Copyright (c) Lucide Contributors. Permission to use, copy, modify and/or distribute this software for any purpose with or without fee is hereby granted.'
  },
  {
    name: 'Playwright',
    licence: 'Apache-2.0',
    text: 'Copyright (c) Microsoft Corporation. Licensed under the Apache License, Version 2.0. Used for automated end-to-end testing only; not part of the shipped application.'
  }
]

export interface AboutInfo {
  product: string
  version: string
  build: ServiceContext['host']['build']
  author: { name: string, email: string }
  schemaVersion: number
  licence: { activatedAt: number | null, machineId: string, activatedBy: string | null }
  dependencies: DependencyNotice[]
  notices: Array<{ name: string, licence: string, text: string }>
}

export function collectAboutInfo(ctx: ServiceContext): AboutInfo {
  const licence = ctx.db
    .prepare('SELECT activated_at, machine_id, activated_by FROM license_state WHERE id = 1')
    .get() as { activated_at: number | null, machine_id: string | null, activated_by: string | null } | undefined
  return {
    product: 'Dentiva Pro',
    version: ctx.host.build.version,
    build: ctx.host.build,
    author: { name: 'Shohan Khan', email: 'helloiamshohan@gmail.com' },
    schemaVersion: readSchemaVersion(ctx.db),
    licence: {
      activatedAt: licence?.activated_at ?? null,
      machineId: ctx.host.machine.machineId,
      activatedBy: licence?.activated_by ?? null
    },
    dependencies: [...DEPENDENCY_NOTICES],
    notices: [...NOTICES_TEXT]
  }
}

