import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { z } from 'zod'
import { parseAmountToMicro, formatAmountPlain, type Micro } from '@shared/money'
import { fromLocalDate, toLocalDate } from '@shared/datetime'

/**
 * Form engine.
 *
 * Validation always runs the **same zod schema the main process uses**, so a form can never accept a
 * value the service layer would reject, and server-side field errors merge straight back into the UI.
 *
 * `useZodForm` intentionally keeps array fields (designations, medicines, invoice lines) outside the
 * generic path: those are edited by dedicated components and injected through `setValues`, which keeps
 * the hook small and predictable.
 */

export type FormErrors = Record<string, string>

export interface ZodForm<S extends z.ZodTypeAny> {
  values: z.input<S>
  setValue<K extends keyof z.input<S>>(key: K, value: z.input<S>[K]): void
  setValues(next: Partial<z.input<S>>): void
  setError(field: string, message: string): void
  errors: FormErrors
  setErrors(errors: FormErrors): void
  touch(field: string): void
  touched: Record<string, boolean>
  validate(): boolean
  submitting: boolean
  isDirty: boolean
  reset(next?: z.input<S>): void
}

export function useZodForm<S extends z.ZodTypeAny>(schema: S, initial: z.input<S>): ZodForm<S> {
  const [values, setValuesState] = useState<z.input<S>>(initial)
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const initialRef = useRef(initial)

  const setValue = useCallback((key: keyof z.input<S>, value: unknown) => {
    setValuesState((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!(key as string in current)) return current
      const next = { ...current }
      delete next[key as string]
      return next
    })
  }, [])

  const setValues = useCallback((next: Partial<z.input<S>>) => {
    setValuesState((current) => ({ ...current, ...next }))
  }, [])

  const validate = useCallback((): boolean => {
    const result = schema.safeParse(values)
    if (result.success) {
      setErrors({})
      return true
    }
    const mapped: FormErrors = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join('.')
      if (!mapped[path]) mapped[path] = issue.message
    }
    setErrors(mapped)
    setTouched((current) => {
      const next = { ...current }
      for (const key of Object.keys(mapped)) next[key] = true
      return next
    })
    return false
  }, [schema, values])

  const isDirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initialRef.current), [values])

  return {
    values,
    setValue,
    setValues,
    setError: (field, message) => setErrors((current) => ({ ...current, [field]: message })),
    errors,
    setErrors: (next) => setErrors(next),
    touch: (field) => setTouched((current) => ({ ...current, [field]: true })),
    touched,
    validate,
    submitting: false,
    isDirty,
    reset: (next) => {
      const target = next ?? initialRef.current
      initialRef.current = target
      setValuesState(target)
      setErrors({})
      setTouched({})
    }
  }
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  span
}: {
  label?: ReactNode
  htmlFor?: string
  required?: boolean
  error?: string
  hint?: ReactNode
  children: ReactNode
  /** Grid span for form layouts (1 = single column, 2 = full width in a two-column form). */
  span?: 1 | 2 | 3
}): ReactNode {
  return (
    <div className={['field', error ? 'field--invalid' : ''].filter(Boolean).join(' ')} style={span ? { gridColumn: `span ${span}` } : undefined}>
      {label ? (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="req">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  )
}

export interface TextInputProps {
  id?: string
  value: string
  onChange(value: string): void
  onBlur?(): void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  autoFocus?: boolean
  type?: 'text' | 'email' | 'password' | 'tel' | 'search'
  ariaLabel?: string
  list?: string
}

export function TextInput({ value, onChange, onBlur, placeholder, disabled, maxLength, autoFocus, type = 'text', ariaLabel, id, list }: TextInputProps): ReactNode {
  return (
    <input
      id={id}
      className="field__input"
      type={type}
      value={value}
      list={list}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  )
}

export function TextArea({
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
  maxLength,
  bengali
}: {
  id?: string
  value: string
  onChange(value: string): void
  placeholder?: string
  rows?: number
  disabled?: boolean
  maxLength?: number
  bengali?: boolean
}): ReactNode {
  return (
    <textarea
      id={id}
      className={`field__textarea${bengali ? ' bn' : ''}`}
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel
}: {
  id?: string
  value: string
  onChange(value: string): void
  options: readonly SelectOption[]
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}): ReactNode {
  return (
    <select
      id={id}
      className="field__select"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  suffix,
  ariaLabel
}: {
  id?: string
  value: number | null
  onChange(value: number | null): void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  suffix?: string
  ariaLabel?: string
}): ReactNode {
  return (
    <div className="field__control">
      <input
        id={id}
        className="field__input"
        type="number"
        inputMode="decimal"
        value={value === null || Number.isNaN(value) ? '' : value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          const raw = event.target.value
          onChange(raw === '' ? null : Number(raw))
        }}
      />
      {suffix ? <span className="field__suffix">{suffix}</span> : null}
    </div>
  )
}

/**
 * Money field: the operator types Taka (with or without separators), the component stores integer
 * micro-Taka, so no rounding error can ever enter the database from the UI.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  disabled,
  ariaLabel,
  allowNegative = false
}: {
  id?: string
  value: Micro | null
  onChange(value: Micro | null): void
  disabled?: boolean
  ariaLabel?: string
  allowNegative?: boolean
}): ReactNode {
  const [text, setText] = useState(value === null ? '' : formatAmountPlain(value, false))
  const [invalid, setInvalid] = useState(false)
  const lastValue = useRef(value)

  // Keep the text in sync when the parent changes the value programmatically (calculations, resets).
  if (lastValue.current !== value) {
    lastValue.current = value
    const formatted = value === null ? '' : formatAmountPlain(value, false)
    if (formatted !== text) setText(formatted)
  }

  return (
    <div className="field__control">
      <span aria-hidden="true" style={{ position: 'absolute', left: 12, color: 'var(--text-subtle)' }}>
        ৳
      </span>
      <input
        id={id}
        className="field__input num"
        style={{ paddingLeft: 28, borderColor: invalid ? 'var(--danger)' : undefined }}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setText(event.target.value)
          setInvalid(false)
        }}
        onBlur={() => {
          const raw = text.trim()
          if (raw === '') {
            setInvalid(false)
            onChange(null)
            return
          }
          try {
            const micro = parseAmountToMicro(raw)
            if (!allowNegative && micro < 0) throw new Error('negative')
            onChange(micro)
            setInvalid(false)
            setText(formatAmountPlain(micro, false))
          } catch {
            setInvalid(true)
          }
        }}
      />
    </div>
  )
}

export function DateInput({
  id,
  value,
  onChange,
  disabled,
  max,
  min,
  ariaLabel
}: {
  id?: string
  /** `YYYY-MM-DD` local date. */
  value: string | null
  onChange(value: string | null): void
  disabled?: boolean
  max?: string
  min?: string
  ariaLabel?: string
}): ReactNode {
  return (
    <input
      id={id}
      className="field__input"
      type="date"
      value={value ?? ''}
      min={min}
      max={max}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    />
  )
}

export function TimeInput({
  id,
  value,
  onChange,
  disabled,
  ariaLabel
}: {
  id?: string
  value: string | null
  onChange(value: string | null): void
  disabled?: boolean
  ariaLabel?: string
}): ReactNode {
  return (
    <input
      id={id}
      className="field__input"
      type="time"
      value={value ?? ''}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    />
  )
}

/** Convert an epoch instant to the local `YYYY-MM-DD` used by date inputs. */
export function instantToDateInput(ms: number | null): string | null {
  return ms === null ? null : toLocalDate(ms)
}

/** Convert an `HH:mm` + `YYYY-MM-DD` pair back into an instant. */
export function dateInputToInstant(date: string | null, time = '00:00'): number | null {
  if (!date) return null
  const base = fromLocalDate(date)
  const [hours, minutes] = time.split(':').map(Number)
  return base + (hours ?? 0) * 3_600_000 + (minutes ?? 0) * 60_000
}

export function FormGrid({ children, columns = 2 }: { children: ReactNode, columns?: 1 | 2 | 3 }): ReactNode {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 'var(--sp-4)' }}>
      {children}
    </div>
  )
}
