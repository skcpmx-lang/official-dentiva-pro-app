import type { ReactNode } from 'react'
import { chartRows, conditionLabel, toothLabel, type Dentition } from '@shared/dental'
import type { ChartEntry } from '../../lib/types'

/**
 * FDI tooth grid.
 *
 * Renders one arch pair for the chosen dentition (adult 11–48, primary 51–85). Each tooth shows the
 * condition colour recorded against it; the component is presentational, so the dental chart screen and
 * the treatment-line editor on a visit share exactly the same numbering and layout.
 */

export interface ToothGridProps {
  dentition: Dentition
  /** Latest entry per tooth code, as returned by `chart.get`. */
  byTooth?: Record<string, ChartEntry>
  selected?: string[]
  onSelect?(toothCode: string): void
  /** Optional per-tooth caption (for example the treatment recorded on the visit being edited). */
  caption?(toothCode: string): string | undefined
  disabled?: boolean
}

function swatchStyle(entry: ChartEntry | undefined): { background: string } | undefined {
  if (!entry) return undefined
  const token = entry.conditionColor ?? 'chart-other'
  return { background: `var(--${token}, var(--chart-other))` }
}

export function ToothGrid({ dentition, byTooth = {}, selected = [], onSelect, caption, disabled }: ToothGridProps): ReactNode {
  const rows = chartRows(dentition)
  const interactive = typeof onSelect === 'function'

  const renderTooth = (code: string): ReactNode => {
    const entry = byTooth[code]
    const isSelected = selected.includes(code)
    const toothCaption = caption?.(code)
    const label = toothLabel(code)
    return (
      <button
        key={code}
        type="button"
        className="tooth"
        aria-pressed={isSelected}
        disabled={disabled || !interactive}
        title={entry ? `${label} — ${conditionLabel(entry.conditionCode)}${entry.status === 'resolved' ? ' (resolved)' : ''}` : label}
        onClick={() => onSelect?.(code)}
        style={disabled ? { cursor: 'default' } : undefined}
      >
        <span className="tooth__code">{code}</span>
        <span className="tooth__swatch" style={swatchStyle(entry)} />
        <span className="tooth__meta">{toothCaption ?? (entry && entry.status === 'active' ? conditionLabel(entry.conditionCode) : '')}</span>
      </button>
    )
  }

  return (
    <div className="dental-chart">
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted small">Upper {dentition === 'adult' ? 'permanent' : 'primary'} teeth (right → left from the patient&apos;s side)</span>
        <div className="dental-arch">{rows.upper.map((tooth) => renderTooth(tooth.code))}</div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted small">Lower {dentition === 'adult' ? 'permanent' : 'primary'} teeth</span>
        <div className="dental-arch">{rows.lower.map((tooth) => renderTooth(tooth.code))}</div>
      </div>
    </div>
  )
}
