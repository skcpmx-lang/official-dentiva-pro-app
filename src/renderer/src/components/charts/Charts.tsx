import { useId, useMemo, type ReactNode } from 'react'
import { formatBDTShort } from '@shared/money'

/**
 * Charts are drawn as inline SVG instead of pulling in a charting library: they stay crisp at every
 * Windows scaling factor, print correctly, work completely offline, and every chart has an accessible
 * text alternative describing the series.
 */

export interface SeriesPoint {
  label: string
  value: number
  /** Optional secondary value used by tooltips (for example, invoice count behind a revenue bar). */
  meta?: string
}

function path(points: SeriesPoint[], width: number, height: number, max: number): { line: string, area: string, coords: Array<{ x: number, y: number }> } {
  const padding = 12
  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0
  const coords = points.map((point, index) => ({
    x: padding + index * step,
    y: padding + usableHeight - (max <= 0 ? 0 : (point.value / max) * usableHeight)
  }))
  const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1]?.x.toFixed(1) ?? padding},${(padding + usableHeight).toFixed(1)} L${coords[0]?.x.toFixed(1) ?? padding},${(padding + usableHeight).toFixed(1)} Z`
  return { line, area, coords }
}

export function LineChart({
  points,
  height = 180,
  ariaLabel,
  formatValue = (value) => formatBDTShort(value)
}: {
  points: SeriesPoint[]
  height?: number
  ariaLabel: string
  formatValue?(value: number): string
}): ReactNode {
  const gradientId = useId()
  const width = 720
  const max = useMemo(() => Math.max(...points.map((point) => point.value), 1), [points])
  const geometry = useMemo(() => path(points, width, height, max), [points, height, max])

  if (points.length === 0) return <EmptyChart height={height} message="No data for the selected period." />

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ height }}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-500)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand-500)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={0}
            x2={width}
            y1={height * ratio}
            y2={height * ratio}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="4 6"
          />
        ))}
        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path d={geometry.line} fill="none" stroke="var(--brand-500)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {geometry.coords.map((coord, index) => (
          <circle key={index} cx={coord.x} cy={coord.y} r={2.6} fill="var(--surface)" stroke="var(--brand-500)" strokeWidth={1.6}>
            <title>{`${points[index]!.label}: ${formatValue(points[index]!.value)}${points[index]!.meta ? ` (${points[index]!.meta})` : ''}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="chart__axis">
        <span>{points[0]?.label}</span>
        <span>{points[Math.floor(points.length / 2)]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  )
}

export function BarChart({
  points,
  height = 180,
  ariaLabel,
  formatValue = (value) => formatBDTShort(value),
  tone = 'brand'
}: {
  points: SeriesPoint[]
  height?: number
  ariaLabel: string
  formatValue?(value: number): string
  tone?: 'brand' | 'teal' | 'amber'
}): ReactNode {
  const max = useMemo(() => Math.max(...points.map((point) => point.value), 1), [points])
  if (points.length === 0) return <EmptyChart height={height} message="No data for the selected period." />
  return (
    <figure className="chart" role="img" aria-label={ariaLabel}>
      <div className="bars" style={{ height }}>
        {points.map((point) => (
          <div key={point.label} className="bars__item">
            <span className="bars__value">{formatValue(point.value)}</span>
            <div
              className={`bars__bar bars__bar--${tone}`}
              style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }}
              title={`${point.label}: ${formatValue(point.value)}${point.meta ? ` (${point.meta})` : ''}`}
            />
            <span className="bars__label truncate">{point.label}</span>
          </div>
        ))}
      </div>
    </figure>
  )
}

export function DonutChart({
  points,
  size = 168,
  ariaLabel,
  centerLabel,
  formatValue = (value) => formatBDTShort(value)
}: {
  points: SeriesPoint[]
  size?: number
  ariaLabel: string
  centerLabel?: string
  formatValue?(value: number): string
}): ReactNode {
  const total = points.reduce((sum, point) => sum + point.value, 0)
  const radius = size / 2 - 12
  const circumference = 2 * Math.PI * radius
  const palette = ['var(--brand-600)', 'var(--teal-500)', 'var(--cyan-400)', 'var(--amber-500)', 'var(--navy-600)', 'var(--slate-400)']

  if (points.length === 0 || total <= 0) return <EmptyChart height={size} message="Nothing recorded in this period." />

  let offset = 0
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        {points.map((point, index) => {
          const fraction = point.value / total
          const dash = fraction * circumference
          const element = (
            <circle
              key={point.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={palette[index % palette.length]}
              strokeWidth={16}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${point.label}: ${formatValue(point.value)} (${Math.round(fraction * 100)}%)`}</title>
            </circle>
          )
          offset += dash
          return element
        })}
        <text x="50%" y="47%" textAnchor="middle" className="donut__total">
          {formatValue(total)}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="donut__label">
          {centerLabel ?? 'Total'}
        </text>
      </svg>
      <ul className="legend">
        {points.map((point, index) => (
          <li key={point.label}>
            <span className="legend__swatch" style={{ background: palette[index % palette.length] }} aria-hidden="true" />
            <span className="grow truncate">{point.label}</span>
            <span className="num">{formatValue(point.value)}</span>
            <span className="muted small num">{total > 0 ? `${Math.round((point.value / total) * 100)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function EmptyChart({ height, message }: { height: number, message: string }): ReactNode {
  return (
    <div className="chart chart--empty" style={{ height }} role="status">
      <span className="muted small">{message}</span>
    </div>
  )
}
