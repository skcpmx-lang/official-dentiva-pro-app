import { useMemo, useState, type ReactNode } from 'react'
import { useFormatters } from '../../lib/format'

/**
 * Charts are hand-built SVG rather than a charting dependency: they stay crisp at every Windows
 * scaling factor, print correctly, respect reduced-motion, and always render an explicit "no data"
 * state instead of empty axes.
 */

export interface SeriesPoint {
  label: string
  value: number
}

function useScale(points: SeriesPoint[]): { max: number, min: number } {
  return useMemo(() => {
    const values = points.map((point) => point.value)
    const max = Math.max(1, ...values)
    const min = Math.min(0, ...values)
    return { max, min }
  }, [points])
}

export function LineChart({
  points,
  height = 200,
  valueFormatter,
  ariaLabel,
  color = 'var(--brand-500)',
  fill = 'rgba(18,135,159,.12)'
}: {
  points: SeriesPoint[]
  height?: number
  valueFormatter?: (value: number) => string
  ariaLabel: string
  color?: string
  fill?: string
}): ReactNode {
  const [hover, setHover] = useState<number | null>(null)
  const { max } = useScale(points)
  const width = 720
  const padding = { top: 12, right: 12, bottom: 26, left: 12 }

  if (points.length === 0) {
    return <NoDataChart height={height} message="No data for the selected period." />
  }

  const stepX = points.length > 1 ? (width - padding.left - padding.right) / (points.length - 1) : 0
  const scaleY = (value: number): number => height - padding.bottom - (value / max) * (height - padding.top - padding.bottom)
  const coords = points.map((point, index) => ({ x: padding.left + index * stepX, y: scaleY(point.value), point }))
  const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1]!.x.toFixed(1)},${height - padding.bottom} L${coords[0]!.x.toFixed(1)},${height - padding.bottom} Z`

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height }}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom - ratio * (height - padding.top - padding.bottom)}
            y2={height - padding.bottom - ratio * (height - padding.top - padding.bottom)}
            stroke="var(--slate-200)"
            strokeDasharray="4 6"
          />
        ))}
        <path d={area} fill={fill} />
        <path d={line} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((coord, index) => (
          <g key={coord.point.label}>
            <circle
              cx={coord.x}
              cy={coord.y}
              r={hover === index ? 4.5 : 2.6}
              fill="var(--surface)"
              stroke={color}
              strokeWidth={2}
              onMouseEnter={() => setHover(index)}
            />
          </g>
        ))}
        {points.map((point, index) =>
          index % Math.ceil(points.length / 8) === 0 || index === points.length - 1 ? (
            <text key={`label-${point.label}`} x={coords[index]!.x} y={height - 8} fontSize="10.5" fill="var(--slate-500)" textAnchor="middle">
              {point.label}
            </text>
          ) : null
        )}
      </svg>
      {hover !== null ? (
        <div
          className="chip"
          style={{ position: 'absolute', top: 0, right: 0, pointerEvents: 'none' }}
          role="status"
        >
          {points[hover]!.label}: {valueFormatter ? valueFormatter(points[hover]!.value) : points[hover]!.value}
        </div>
      ) : null}
    </div>
  )
}

export function BarChart({
  points,
  height = 200,
  valueFormatter,
  ariaLabel
}: {
  points: SeriesPoint[]
  height?: number
  valueFormatter?: (value: number) => string
  ariaLabel: string
}): ReactNode {
  const { max } = useScale(points)
  if (points.length === 0) return <NoDataChart height={height} message="No data for the selected period." />
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: 'var(--sp-3) 0' }} role="img" aria-label={ariaLabel}>
      {points.map((point) => (
        <div key={point.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {valueFormatter ? valueFormatter(point.value) : point.value}
          </span>
          <div
            style={{
              width: '100%',
              maxWidth: 56,
              height: `${Math.max(2, (point.value / max) * (height - 60))}px`,
              borderRadius: '6px 6px 3px 3px',
              background: 'linear-gradient(180deg, var(--brand-400), var(--brand-600))',
              transition: 'height var(--dur-slow) var(--ease)'
            }}
          />
          <span className="small truncate" style={{ maxWidth: '100%', color: 'var(--text-subtle)' }}>
            {point.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export function DonutChart({
  points,
  size = 176,
  valueFormatter,
  ariaLabel
}: {
  points: SeriesPoint[]
  size?: number
  valueFormatter?: (value: number) => string
  ariaLabel: string
}): ReactNode {
  const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0)
  const colors = ['var(--brand-600)', 'var(--teal-500)', 'var(--cyan-400)', 'var(--brand-400)', 'var(--slate-400)', 'var(--navy-700)']

  if (points.length === 0 || total <= 0) return <NoDataChart height={size} message="No payments recorded in this period." />

  const radius = size / 2 - 12
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="row" style={{ gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {points.map((point, index) => {
            const fraction = Math.max(0, point.value) / total
            const dash = fraction * circumference
            const element = (
              <circle
                key={point.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth={18}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            )
            offset += dash
            return element
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" fontSize="13" fill="var(--slate-500)">
          Total
        </text>
        <text x="50%" y="60%" textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--navy-800)">
          {valueFormatter ? valueFormatter(total) : total}
        </text>
      </svg>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
        {points.map((point, index) => (
          <li key={point.label} className="row small" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 8 }}>
              <i style={{ width: 10, height: 10, borderRadius: 3, background: colors[index % colors.length], display: 'inline-block' }} />
              {point.label}
            </span>
            <span className="num muted">{valueFormatter ? valueFormatter(point.value) : point.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function NoDataChart({ height = 160, message }: { height?: number, message: string }): ReactNode {
  return (
    <div
      className="state"
      style={{ height, border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)' }}
      role="status"
    >
      <span className="state__message">{message}</span>
    </div>
  )
}

/** Convenience: money-axis formatter shared by dashboard widgets. */
export function useMoneyAxis(): (micro: number) => string {
  const formatters = useFormatters()
  return (micro: number) => formatters.moneyShort(micro)
}
