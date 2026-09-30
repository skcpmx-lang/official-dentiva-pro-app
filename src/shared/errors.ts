/**
 * Error taxonomy shared by the main process and the renderer.
 *
 * Every failure that crosses the IPC boundary is normalised into `SerializedAppError`, so the UI can
 * always show a professional message plus a recovery action instead of a stack trace.
 */

export type ErrorCode =
  | 'E_VALIDATION'
  | 'E_PERMISSION'
  | 'E_LOCKED'
  | 'E_UNAUTHENTICATED'
  | 'E_NOT_FOUND'
  | 'E_CONFLICT'
  | 'E_STATE'
  | 'E_IO'
  | 'E_DB'
  | 'E_PRINT'
  | 'E_LICENSE'
  | 'E_RATE_LIMIT'
  | 'E_UNSUPPORTED'
  | 'E_INTERNAL'

export interface SerializedAppError {
  code: ErrorCode
  message: string
  /** Field-level messages for form rendering, keyed by field path. */
  fieldErrors?: Record<string, string>
  /** Non-secret diagnostic context (ids, operation name) shown in development or support logs. */
  detail?: Record<string, unknown>
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly fieldErrors?: Record<string, string>
  readonly detail?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, options: { fieldErrors?: Record<string, string>; detail?: Record<string, unknown> } = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors
    if (options.detail) this.detail = options.detail
  }

  toSerialized(): SerializedAppError {
    const out: SerializedAppError = { code: this.code, message: this.message }
    if (this.fieldErrors) out.fieldErrors = this.fieldErrors
    if (this.detail) out.detail = this.detail
    return out
  }
}

export function validationError(message: string, fieldErrors?: Record<string, string>): AppError {
  return new AppError('E_VALIDATION', message, fieldErrors ? { fieldErrors } : {})
}

export function permissionError(permission: string, detail?: Record<string, unknown>): AppError {
  return new AppError('E_PERMISSION', 'You do not have permission to perform this action.', {
    detail: { permission, ...detail }
  })
}

export function notFoundError(entity: string, id: unknown): AppError {
  return new AppError('E_NOT_FOUND', `The requested ${entity} could not be found.`, { detail: { entity, id } })
}

export function conflictError(message: string, detail?: Record<string, unknown>): AppError {
  return new AppError('E_CONFLICT', message, detail ? { detail } : {})
}

export function stateError(message: string, detail?: Record<string, unknown>): AppError {
  return new AppError('E_STATE', message, detail ? { detail } : {})
}

export function ioError(message: string, detail?: Record<string, unknown>): AppError {
  return new AppError('E_IO', message, detail ? { detail } : {})
}

/** Convert any thrown value into the serializable envelope, hiding internals from ordinary users. */
export function toSerializedError(error: unknown): SerializedAppError {
  if (error instanceof AppError) return error.toSerialized()
  if (error instanceof Error) {
    return { code: 'E_INTERNAL', message: 'Something went wrong while completing this action. Please try again.' }
  }
  return { code: 'E_INTERNAL', message: 'Something went wrong while completing this action. Please try again.' }
}

/** Developer-facing description used for local logs (never shown to users). */
export function describeErrorForLog(error: unknown): string {
  if (error instanceof AppError) {
    return `[${error.code}] ${error.message}${error.detail ? ` ${JSON.stringify(error.detail)}` : ''}`
  }
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`
  return String(error)
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: SerializedAppError }

export function ok<T>(data: T): Envelope<T> {
  return { ok: true, data }
}

export function fail(error: SerializedAppError): Envelope<never> {
  return { ok: false, error }
}
