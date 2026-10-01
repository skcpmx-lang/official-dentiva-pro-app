import { createHash, type Hash } from 'node:crypto'
import { closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { Zip, ZipDeflate, ZipPassThrough, Unzip, UnzipInflate, strFromU8, strToU8 } from 'fflate'

/**
 * Backup package format (`.dentivabackup`).
 *
 * A package is a zip file with exactly this shape:
 *
 *   manifest.json
 *   database/dentiva.db          — a consistent snapshot produced by `VACUUM INTO`
 *   attachments/…                — the attachment archive, mirrored
 *
 * The manifest carries a SHA-256 for every payload, so a package that lost or gained bytes is detected
 * before anything touches the live database. Reading and writing stream through Node and fflate and write
 * straight to a file descriptor, so a clinic with a large attachment archive never has to fit the package
 * in memory.
 */

export const BACKUP_FORMAT = 'dentiva-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_EXTENSION = '.dentivabackup'
export const MANIFEST_ENTRY = 'manifest.json'
export const DATABASE_ENTRY = 'database/dentiva.db'
export const ATTACHMENTS_PREFIX = 'attachments/'

/**
 * Why a package was written.
 *  · `manual`       — adopted from disk, or created before kinds were recorded
 *  · `quick`/`full` — the two manual actions (quick omits attachments, full includes them)
 *  · `auto`         — the scheduled backup
 *  · `pre_restore`  — the safety copy taken immediately before a restore
 *  · `pre_migration`— the safety copy taken before a schema migration runs
 */
export type BackupKind = 'manual' | 'full' | 'quick' | 'auto' | 'pre_restore' | 'pre_migration'

export interface BackupFileEntry {
  /** Package-relative posix path. */
  path: string
  bytes: number
  sha256: string
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  schemaVersion: number
  kind: BackupKind
  createdAt: number
  createdBy: string | null
  includesAttachments: boolean
  database: BackupFileEntry
  attachments: { files: number, bytes: number, sha256: string, entries: BackupFileEntry[] }
  /** Row counts at the moment of the backup; shown in the UI and checked after a restore. */
  counts: Record<string, number>
}

export class BackupPackageError extends Error {
  readonly problems: string[]

  constructor(message: string, problems: string[] = []) {
    super(message)
    this.name = 'BackupPackageError'
    this.problems = problems
  }
}

const COMPRESSED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.docx', '.zip', '.gz', '.dcm'])

/** `DentivaPro-2026-10-01_19-30-00-auto.dentivabackup` — sortable, human-readable, unique per second. */
export function backupFileName(kind: BackupKind, at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `DentivaPro-${stamp}-${kind}${BACKUP_EXTENSION}`
}

export function isBackupFileName(name: string): boolean {
  return name.toLowerCase().endsWith(BACKUP_EXTENSION)
}

export function combinedHash(entries: Array<{ path: string, sha256: string }>): string {
  const hash = createHash('sha256')
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${entry.path}:${entry.sha256}\n`)
  }
  return hash.digest('hex')
}

/* -------------------------------------------------------------------------- */
/* Creation                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateBackupOptions {
  /** Snapshot produced by `VACUUM INTO`; this function never reads the live database. */
  snapshotFile: string
  attachmentsDir: string | null
  targetPath: string
  /** Manifest with placeholder payload entries; the hashes are filled from what is actually written. */
  manifest: Omit<BackupManifest, 'database' | 'attachments'>
}

/** Writes the package and returns its final manifest. */
export async function createBackupPackage(options: CreateBackupOptions): Promise<BackupManifest> {
  const { snapshotFile, attachmentsDir, targetPath, manifest } = options
  mkdirSync(dirname(targetPath), { recursive: true })

  const attachmentPaths = attachmentsDir && manifest.includesAttachments && existsSync(attachmentsDir) ? listFiles(attachmentsDir) : []
  const fd = openSync(targetPath, 'w')
  const attachments: BackupFileEntry[] = []
  let databaseHash = ''

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      const zip = new Zip((error, chunk, final) => {
        if (error) {
          fail(error)
          return
        }
        if (chunk.length > 0) writeSync(fd, chunk)
        if (final) {
          fsyncSync(fd)
          settled = true
          resolve()
        }
      })

      void (async () => {
        try {
          const databaseEntry = new ZipPassThrough(DATABASE_ENTRY)
          zip.add(databaseEntry)
          databaseHash = await pumpFile(snapshotFile, (chunk, isLast) => databaseEntry.push(chunk, isLast))

          for (const absolute of attachmentPaths) {
            const name = `${ATTACHMENTS_PREFIX}${relative(attachmentsDir!, absolute).split(sep).join(posix.sep)}`
            const entry = COMPRESSED_EXTENSIONS.has(extensionOf(name)) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 })
            zip.add(entry)
            const sha256 = await pumpFile(absolute, (chunk, isLast) => entry.push(chunk, isLast))
            attachments.push({ path: name, bytes: statSync(absolute).size, sha256 })
          }

          const finalManifest: BackupManifest = {
            ...manifest,
            database: { path: DATABASE_ENTRY, bytes: statSync(snapshotFile).size, sha256: databaseHash },
            attachments: {
              files: attachments.length,
              bytes: attachments.reduce((total, entry) => total + entry.bytes, 0),
              sha256: combinedHash(attachments),
              entries: attachments
            }
          }
          const manifestEntry = new ZipPassThrough(MANIFEST_ENTRY)
          zip.add(manifestEntry)
          manifestEntry.push(strToU8(JSON.stringify(finalManifest, null, 2)), true)
          zip.end()
        } catch (error) {
          fail(error)
        }
      })()
    })
  } catch (error) {
    rmSync(targetPath, { force: true })
    throw error
  } finally {
    closeSync(fd)
  }

  return readBackupManifest(targetPath)
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index).toLowerCase()
}

function listFiles(root: string): string[] {
  const result: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) result.push(absolute)
    }
  }
  walk(root)
  return result.sort()
}

/** Streams a file into `push` and returns its SHA-256. */
function pumpFile(path: string, push: (chunk: Uint8Array, isLast: boolean) => void): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => {
      const bytes = chunk as Buffer
      hash.update(bytes)
      push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), false)
    })
    stream.on('end', () => {
      push(new Uint8Array(0), true)
      resolve(hash.digest('hex'))
    })
    stream.on('error', reject)
  })
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** Reads only the manifest, stopping before the payload is decompressed. */
export async function readBackupManifest(filePath: string): Promise<BackupManifest> {
  const buffer = await readEntry(filePath, MANIFEST_ENTRY)
  if (!buffer) throw new BackupPackageError('The package has no manifest and is not a Dentiva Pro backup.')
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(buffer))
  } catch {
    throw new BackupPackageError('The package manifest is not readable.')
  }
  return assertManifest(parsed)
}

export function assertManifest(value: unknown): BackupManifest {
  const manifest = value as Partial<BackupManifest> | null
  const problems: string[] = []
  if (!manifest || typeof manifest !== 'object') problems.push('The manifest is missing.')
  if (manifest?.format !== BACKUP_FORMAT) problems.push('This file is not a Dentiva Pro backup package.')
  if (typeof manifest?.formatVersion !== 'number') problems.push('The manifest has no format version.')
  else if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    problems.push(`The package was written by a newer version of Dentiva Pro (format ${manifest.formatVersion}). Install that version to restore it.`)
  }
  if (typeof manifest?.schemaVersion !== 'number') problems.push('The manifest has no schema version.')
  if (!manifest?.database || typeof manifest.database.sha256 !== 'string') problems.push('The manifest has no database checksum.')
  if (!manifest?.attachments || typeof manifest.attachments.sha256 !== 'string') problems.push('The manifest has no attachment checksum.')
  if (problems.length > 0) throw new BackupPackageError(problems[0]!, problems)
  return manifest as BackupManifest
}

/**
 * Extracts one entry without decompressing the rest. fflate's streaming reader stops as soon as the
 * wanted entry is complete, which keeps opening a package cheap even when the archive is huge.
 */
function readEntry(filePath: string, wanted: string): Promise<Uint8Array | null> {
  return new Promise<Uint8Array | null>((resolve) => {
    const chunks: Uint8Array[] = []
    let result: Uint8Array | null = null
    let stop = false
    let done = false

    const finish = (): void => {
      if (done) return
      done = true
      resolve(result)
    }

    const unzip = new Unzip((file) => {
      file.ondata = (_error, data, final) => {
        if (file.name !== wanted) {
          if (final && !stop) {
            /* Keep scanning; other entries are ignored. */
          }
          return
        }
        if (data.length > 0) chunks.push(data)
        if (final) {
          result = concat(chunks)
          stop = true
          stream.destroy()
          finish()
        }
      }
      file.start()
    })
    unzip.register(UnzipInflate)

    const stream = createReadStream(filePath, { highWaterMark: 512 * 1024 })
    stream.on('data', (chunk) => {
      if (stop) return
      try {
        const bytes = chunk as Buffer
        unzip.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), false)
      } catch {
        finish()
      }
    })
    stream.on('end', () => {
      if (stop) return
      try {
        unzip.push(new Uint8Array(0), true)
      } catch {
        /* incomplete file — treated as a missing entry */
      }
      finish()
    })
    stream.on('error', () => finish())
    stream.on('close', () => finish())
  })
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

/**
 * Extracts the whole package into `stagingRoot` while hashing every payload. Entry names are checked
 * before a single byte is written, so a crafted package can never escape the staging directory.
 */
export async function extractBackupPackage(
  filePath: string,
  stagingRoot: string
): Promise<{ manifest: BackupManifest, files: Map<string, { bytes: number, sha256: string }> }> {
  rmSync(stagingRoot, { recursive: true, force: true })
  mkdirSync(stagingRoot, { recursive: true })

  const files = new Map<string, { bytes: number, sha256: string }>()
  const manifestChunks: Uint8Array[] = []
  const problems: string[] = []

  const unzip = new Unzip((file) => {
    const name = file.name
    if (!isSafeEntryName(name)) {
      problems.push(`The package contains an entry that would be written outside the restore folder: ${name}`)
      return
    }
    const absolute = join(stagingRoot, name.split(posix.sep).join(sep))
    mkdirSync(dirname(absolute), { recursive: true })
    const fd = openSync(absolute, 'w')
    const hash: Hash = createHash('sha256')
    let bytes = 0
    file.ondata = (_error, data, final) => {
      if (data.length > 0) {
        writeSync(fd, data)
        hash.update(data)
        bytes += data.length
        if (name === MANIFEST_ENTRY) manifestChunks.push(data)
      }
      if (final) {
        fsyncSync(fd)
        closeSync(fd)
        files.set(name, { bytes, sha256: hash.digest('hex') })
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => {
      try {
        const bytes = chunk as Buffer
        unzip.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), false)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        stream.destroy()
      }
    })
    stream.on('end', () => {
      try {
        unzip.push(new Uint8Array(0), true)
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    stream.on('error', reject)
  })

  if (problems.length > 0) throw new BackupPackageError(problems[0]!, problems)
  if (manifestChunks.length === 0) throw new BackupPackageError('The package has no manifest and is not a Dentiva Pro backup.')
  const manifest = assertManifest(JSON.parse(strFromU8(concat(manifestChunks))))

  /* Every payload the manifest promises must be present, and nothing else may have been written. */
  const expected = new Set<string>([MANIFEST_ENTRY, manifest.database.path, ...manifest.attachments.entries.map((entry) => entry.path)])
  for (const path of expected) {
    if (!files.has(path)) problems.push(`The package is incomplete: ${path} is missing.`)
  }
  for (const path of files.keys()) {
    if (!expected.has(path)) problems.push(`The package contains an unexpected entry: ${path}.`)
  }
  if (problems.length > 0) throw new BackupPackageError(problems[0]!, problems)

  return { manifest, files }
}

export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 512) return false
  if (name.startsWith('/') || name.startsWith('\\')) return false
  if (name.includes('\\')) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  const segments = name.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return name === MANIFEST_ENTRY || name === DATABASE_ENTRY || name.startsWith(ATTACHMENTS_PREFIX)
}

/* -------------------------------------------------------------------------- */
/* Verification of a staged package                                           */
/* -------------------------------------------------------------------------- */

export function verifyStagedCoverage(manifest: BackupManifest, files: Map<string, { bytes: number, sha256: string }>): string[] {
  const problems: string[] = []
  const database = files.get(manifest.database.path)
  if (!database) problems.push('The database snapshot is missing from the package.')
  else {
    if (database.sha256 !== manifest.database.sha256) problems.push('The database snapshot failed its checksum — the package is damaged.')
    if (manifest.database.bytes !== 0 && database.bytes !== manifest.database.bytes) problems.push('The database snapshot size does not match the manifest.')
  }

  for (const entry of manifest.attachments.entries) {
    const staged = files.get(entry.path)
    if (!staged) problems.push(`Attachment ${entry.path} is missing from the package.`)
    else if (staged.sha256 !== entry.sha256 || staged.bytes !== entry.bytes) problems.push(`Attachment ${entry.path} failed its checksum.`)
  }
  if (manifest.attachments.entries.length > 0) {
    const combined = combinedHash(manifest.attachments.entries.map((entry) => ({ path: entry.path, sha256: files.get(entry.path)?.sha256 ?? '' })))
    if (combined !== manifest.attachments.sha256) problems.push('The attachment set failed its combined checksum.')
  }
  return problems
}

/** Removes a staging directory; called after a restore finishes or fails. */
export function discardStaging(stagingRoot: string): void {
  try {
    rmSync(stagingRoot, { recursive: true, force: true })
  } catch {
    /* the temp directory is cleaned on next start */
  }
}
