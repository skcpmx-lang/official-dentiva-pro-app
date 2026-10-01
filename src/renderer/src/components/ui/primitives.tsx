import type {ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import {SearchIcon, ShieldAlert } from 'lucide-react'

/**
 * UI primitives. Every control here has a complete state set (default, hover, focus, active, disabled,
 * loading) and consistent metrics from the design tokens, so module screens stay declarative and the
 * interface remains visually uniform across the whole application.
 */

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  block?: boolean
  /** Explanation shown (and announced) when the button is disabled. */
  disabledReason?: string
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  block,
  disabled,
  disabledReason,
  children,
  className,
  ...rest
}: ButtonProps): ReactNode {
  const classes = ['btn', `btn--${variant}`]
  if (size === 'sm') classes.push('btn--sm')
  if (size === 'lg') classes.push('btn--lg')
  if (block) classes.push('btn--block')
  if (!children) classes.push('btn--icon', size === 'sm' ? 'btn--icon' : '')
  if (className) classes.push(className)
  return (
    <button
      type="button"
      className={classes.join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={disabled && disabledReason ? disabledReason : rest.title}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon}
      {children}
      {iconRight}
    </button>
  )
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  icon: ReactNode
  variant?: Variant
  size?: 'sm' | 'md'
  badge?: number
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', badge, className, ...rest }: IconButtonProps): ReactNode {
  const classes = ['btn', `btn--${variant}`, 'btn--icon']
  if (size === 'sm') classes.push('btn--sm')
  if (className) classes.push(className)
  return (
    <button type="button" className={classes.join(' ')} aria-label={label} title={rest.title ?? label} {...rest}>
      {icon}
      {badge !== undefined && badge > 0 ? <span className="icon-btn__dot">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  )
}

export interface BadgeProps {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'
  icon?: ReactNode
}

export function Badge({ children, tone = 'neutral', icon }: BadgeProps): ReactNode {
  return (
    <span className={`badge badge--${tone}`}>
      {icon}
      {children}
    </span>
  )
}

export function Card({ children, className, style }: { children: ReactNode, className?: string, style?: CSSProperties }): ReactNode {
  return (
    <section className={['card', className].filter(Boolean).join(' ')} style={style}>
      {children}
    </section>
  )
}

export function CardHeader({ title, subtitle, icon, actions }: { title: ReactNode, subtitle?: ReactNode, icon?: ReactNode, actions?: ReactNode }): ReactNode {
  return (
    <div className="card__header">
      <div>
        <div className="card__title">
          {icon}
          {title}
        </div>
        {subtitle ? <div className="card__subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ children, flush, className }: { children: ReactNode, flush?: boolean, className?: string }): ReactNode {
  return <div className={['card__body', flush ? 'card__body--flush' : '', className].filter(Boolean).join(' ')}>{children}</div>
}

export interface KpiCardProps {
  label: string
  value: ReactNode
  meta?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'success' | 'warning' | 'danger'
  onClick?: () => void
}

export function KpiCard({ label, value, meta, icon, tone = 'default', onClick }: KpiCardProps): ReactNode {
  const classes = ['card', 'kpi']
  if (tone !== 'default') classes.push(`kpi--${tone}`)
  const content = (
    <>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {icon ? <span className="kpi__icon">{icon}</span> : null}
      </div>
      <span className="kpi__value">{value}</span>
      {meta ? <span className="kpi__meta">{meta}</span> : null}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={classes.join(' ')} onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}>
        {content}
      </button>
    )
  }
  return <section className={classes.join(' ')}>{content}</section>
}

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  breadcrumbs?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps): ReactNode {
  return (
    <header className="page__header">
      <div className="page__title">
        {breadcrumbs ? <div className="breadcrumbs">{breadcrumbs}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="muted small">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page__actions">{actions}</div> : null}
    </header>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: Array<{ value: T, label: string }>
  onChange(value: T): void
  ariaLabel: string
}): ReactNode {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T, label: string, count?: number, disabled?: boolean }>
  onChange(value: T): void
}): ReactNode {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined ? <span className="muted small" style={{ marginLeft: 6 }}>{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  autoFocus
}: {
  value: string
  onChange(value: string): void
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
}): ReactNode {
  return (
    <div className="toolbar__search">
      <SearchIcon size={16} aria-hidden="true" />
      <input
        className="field__input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? 'Search…'}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
    </div>
  )
}

export function PermissionDenied({ message }: { message?: string }): ReactNode {
  return (
    <div className="state">
      <span className="state__icon">
        <ShieldAlert size={22} />
      </span>
      <span className="state__title">You do not have access to this area</span>
      <span className="state__message">
        {message ?? 'Your role does not include this permission. Ask an administrator if you need access.'}
      </span>
    </div>
  )
}

export function Stat({ label, value }: { label: string, value: ReactNode }): ReactNode {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }): ReactNode {
  return <div className="toolbar">{children}</div>
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  name,
  id
}: {
  checked: boolean
  onChange(checked: boolean): void
  label: ReactNode
  disabled?: boolean
  name?: string
  id?: string
}): ReactNode {
  return (
    <label className="checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange(next: boolean): void
  label: string
  disabled?: boolean
}): ReactNode {
  return (
    <label className="checkbox" aria-label={label}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

