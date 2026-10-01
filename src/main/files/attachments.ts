import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { AppError, ioError } from '@shared/errors'
import {
  ATTACHMENT_ALLOWED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  isAllowedAttachment,
  mimeForExtension,
  resolveStoredPath,
  safeJoin,
  sanitizeFileName,
  sniffImageMime
} from './storage'

/**
 * Patient attachment storage.
 *
 * Every file lives at `attachments/<patientId>/<uuid><ext>` under the clinic data directory. The
 * patient folder is chosen by the process (never by the caller), the file name is sanitised, the size
 * and extension are validated against an allow-list, and every read resolves through `safeJoin`, so a
 * crafted name such as `..\..\windows\system32` cannot escape the data directory.
 */

export interface StoredAttachment {
  /** Original (sanitised) file name shown in the UI and used when exporting. */
  fileName: string
  /** Path relative to the data directory, stored in the database. */
  relativePath: string
  absolutePath: string
  mime: string
  bytes: number
  sha256: string
}

function patientDirectory(attachmentsDir: string, patientId: number): string {
  if (!Number.isInteger(patientId) || patientId <= 0) throw new AppError('E_VALIDATION', 'A patient must be selected before attaching files.')
  return safeJoin(attachmentsDir, String(patientId))
}

export function storeAttachment(
  attachmentsDir: string,
  patientId: number,
  input: { fileName: string, dataBase64: string, maxBytes?: number }
): StoredAttachment {
  const directory = patientDirectory(attachmentsDir, patientId)
  const { baseName, extension } = sanitizeFileName(input.fileName, '')
  if (!extension) throw new AppError('E_VALIDATION', 'The file must have an extension (for example .pdf or .jpg).')
  if (!ATTACHMENT_ALLOWED_EXTENSIONS.includes(extension as (typeof ATTACHMENT_ALLOWED_EXTENSIONS)[number])) {
    throw new AppError('E_VALIDATION', `Files of type “${extension}” are not supported. Allowed: ${ATTACHMENT_ALLOWED_EXTENSIONS.join(', ')}.`)
  }
  if (!isAllowedAttachment(`${baseName}${extension}`)) {
    throw new AppError('E_VALIDATION', 'This file type is not permitted in patient records.')
  }

  const cleaned = input.dataBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
  if (cleaned.length === 0) throw new AppError('E_VALIDATION', 'The selected file is empty.')
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) throw new AppError('E_VALIDATION', 'The selected file could not be read.')
  const buffer = Buffer.from(cleaned, 'base64')
  const limit = input.maxBytes ?? MAX_ATTACHMENT_BYTES
  if (buffer.length === 0) throw new AppError('E_VALIDATION', 'The selected file is empty.')
  if (buffer.length > limit) {
    throw new AppError('E_VALIDATION', `Attachments must be smaller than ${Math.round(limit / (1024 * 1024))} MB.`)
  }

  // Images are content-verified: a mislabelled .jpg that is really an executable is rejected.
  const sniffed = sniffImageMime(buffer)
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp']
  if (imageExtensions.includes(extension) && !sniffed) {
    throw new AppError('E_VALIDATION', 'This image file appears to be damaged or is not a real PNG/JPEG/WebP file.')
  }
  const mime = sniffed ?? mimeForExtension(extension)

  mkdirSync(directory, { recursive: true })
  const fileName = `${baseName}-${randomUUID().slice(0, 8)}${extension}`
  const absolutePath = safeJoin(directory, fileName)
  writeFileSync(absolutePath, buffer)

  return {
    fileName: input.fileName.replace(/[\\/]/g, '_').slice(0, 180),
    relativePath: `${patientId}/${fileName}`,
    absolutePath,
    mime,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex')
  }
}

/** Read an attachment for viewing/printing; verifies the stored file still exists and has a size. */
export function readAttachment(dataDir: string, relativePath: string): Buffer {
  const absolute = resolveStoredPath(dataDir, relativePath)
  try {
    const stats = statSync(absolute)
    if (!stats.isFile()) throw ioError('The stored file is missing.')
    return readFileSync(absolute)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw ioError('The stored attachment could not be opened. It may have been moved or deleted outside Dentiva Pro.')
  }
}

export function removeAttachment(dataDir: string, relativePath: string): void {
  const absolute = resolveStoredPath(dataDir, relativePath)
  try {
    rmSync(absolute, { force: true })
  } catch {
    // A missing file is not an error: the database row is the source of truth and is already hidden.
  }
}

export { MAX_ATTACHMENT_BYTES }
