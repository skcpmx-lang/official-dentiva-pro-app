import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { AppError } from '@shared/errors'

/**
 * Safe file handling for attachments, branding images and exports.
 *
 * Every path that originates from the UI or the database passes through `safeJoin`, which rejects
 * traversal, absolute paths, drive letters and NUL bytes; stored paths are always relative to the
 * application data directory so the clinic folder can be moved or restored without breaking links.
 */

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export function safeJoin(root: string, ...segments: string[]): string {
  const cleanRoot = resolve(root)
  const target = resolve(cleanRoot, ...segments.map((segment) => normalize(String(segment))))
  if (target !== cleanRoot && !target.startsWith(`${cleanRoot}${sep}`)) {
    throw new AppError('E_PERMISSION', 'The requested file location is outside the application data folder.')
  }
  return target
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

export function isPathInside(root: string, candidate: string): boolean {
  const cleanRoot = resolve(root)
  const target = resolve(candidate)
  return target === cleanRoot || target.startsWith(`${cleanRoot}${sep}`)
}

/** Sanitise a user-supplied file name: keep a readable stem, force a safe extension. */
export function sanitizeFileName(original: string, fallbackExt: string): { baseName: string, extension: string } {
  const rawExt = extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '')
  const extension = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : fallbackExt
  const stem = original
    .slice(0, original.length - extname(original).length)
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')
    .trim()
    .slice(0, 80)
  return { baseName: stem.length > 0 ? stem : 'file', extension }
}

const IMAGE_MAGIC: Array<{ ext: string, mime: string, test: (buffer: Buffer) => boolean }> = [
  { ext: '.png', mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: '.jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.webp', mime: 'image/webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' }
]

export interface StoredFile {
  /** Absolute path on disk. */
  absolutePath: string
  /** Path relative to the data directory, as stored in the database. */
  relativePath: string
  bytes: number
  sha256: string
  mime: string
}

export function sniffImageMime(buffer: Buffer): string | null {
  for (const entry of IMAGE_MAGIC) {
    if (entry.test(buffer)) return entry.mime
  }
  return null
}

export function decodeBase64Image(input: { fileName: string, dataBase64: string }): { buffer: Buffer, extension: string, mime: string } {
  const cleaned = input.dataBase64.replace(/^data:[^;]+;base64,/, '')
  if (!/^[A-Za-z0-9+/=\s]+$/.test(cleaned)) throw new AppError('E_VALIDATION', 'The selected image could not be read.')
  const buffer = Buffer.from(cleaned, 'base64')
  if (buffer.length === 0) throw new AppError('E_VALIDATION', 'The selected image is empty.')
  if (buffer.length > MAX_IMAGE_BYTES) throw new AppError('E_VALIDATION', 'Images must be smaller than 8 MB.')
  const mime = sniffImageMime(buffer)
  if (!mime) throw new AppError('E_VALIDATION', 'Only PNG, JPEG or WebP images are supported.')
  const extension = IMAGE_MAGIC.find((entry) => entry.mime === mime)!.ext
  return { buffer, extension, mime }
}

/** Persist an uploaded image (clinic logo, dentist/staff photo) under a controlled sub-folder. */
export function storeImage(dataDir: string, subFolder: string, input: { fileName: string, dataBase64: string }): StoredFile {
  const { buffer, extension, mime } = decodeBase64Image(input)
  const directory = safeJoin(dataDir, subFolder)
  ensureDir(directory)
  const { baseName } = sanitizeFileName(input.fileName, extension)
  const fileName = `${baseName}-${randomUUID().slice(0, 8)}${extension}`
  const absolutePath = safeJoin(directory, fileName)
  writeFileSync(absolutePath, buffer)
  return {
    absolutePath,
    relativePath: join(subFolder, fileName),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    mime
  }
}

export function resolveStoredPath(dataDir: string, relativePath: string): string {
  return safeJoin(dataDir, relativePath)
}

export function deleteStoredFile(absolutePath: string, dataDir: string): void {
  if (!isPathInside(dataDir, absolutePath)) return
  try {
    rmSync(absolutePath, { force: true })
  } catch {
    /* deletion is best effort; a stray file is preferable to a failed workflow */
  }
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function readStoredFile(path: string): Buffer {
  return readFileSync(path)
}

/** Write an arbitrary export (CSV/PDF) into the exports folder with a predictable, safe name. */
export function writeExport(dataDir: string, fileName: string, data: Buffer | string): StoredFile {
  const directory = safeJoin(dataDir, 'exports')
  ensureDir(directory)
  const { baseName, extension } = sanitizeFileName(fileName, '.csv')
  const finalName = `${baseName}${extension}`
  const absolutePath = safeJoin(directory, finalName)
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  writeFileSync(absolutePath, buffer)
  return {
    absolutePath,
    relativePath: join('exports', finalName),
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    mime: extension === '.pdf' ? 'application/pdf' : extension === '.csv' ? 'text/csv' : 'application/octet-stream'
  }
}

export const ATTACHMENT_ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.doc', '.docx', '.txt', '.dcm'] as const

export function isAllowedAttachment(fileName: string): boolean {
  const extension = extname(fileName).toLowerCase()
  return (ATTACHMENT_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)
}

export function mimeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.pdf':
      return 'application/pdf'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.doc':
      return 'application/msword'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.txt':
      return 'text/plain'
    case '.dcm':
      return 'application/dicom'
    default:
      return 'application/octet-stream'
  }
}
