import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

/**
 * Overlays: modal, drawer, toast host and the promise-based confirmation / typed-confirmation dialogs
 * used by destructive operations.
 *
 * Dialogs are focus-trapped, dismissible with Escape, and never close while a destructive action is
 * still running (`busy`), so an operator cannot dismiss a confirmation half-way through a restore.
 */

export interface ModalProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  busy?: boolean
  onClose(): void
  children: ReactNode
  /** When false the dialog cannot be dismissed by clicking the backdrop (used for critical flows). */
  dismissible?: boolean
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, title, description, footer, size = 'md', busy, onClose, children, dismissible = true }: ModalProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  /* Kept in a ref so the focus/escape effect only runs when the dialog opens or its state changes. A
     caller that re-renders while the operator types (every keystroke changes state) would otherwise hand
     the effect a new `onClose` identity, re-run it and steal focus out of the input being typed in. */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const firstFocusable = container?.querySelector<HTMLElement>(FOCUSABLE)
    ;(firstFocusable ?? container)?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dismissible && !busy) {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !container) return
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = ''
      previouslyFocused.current?.focus?.()
    }
  }, [open, dismissible, busy])

  if (!open) return null

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && dismissible && !busy) onClose()
    }}>
      <div ref={containerRef} className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} tabIndex={-1}>
        <header className="modal__header">
          <div>
            <div className="modal__title">{title}</div>
            {description ? <div className="modal__description">{description}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function Drawer({
  open,
  title,
  description,
  footer,
  onClose,
  children,
  side = 'right'
}: {
  open: boolean
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  onClose(): void
  children: ReactNode
  side?: 'left' | 'right'
}): ReactNode {
  if (!open) return null
  return (
    <>
      <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()} />
      <aside className="drawer" data-side={side} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Panel'}>
        <header className="modal__header">
          <div>
            <div className="modal__title">{title}</div>
            {description ? <div className="modal__description">{description}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </aside>
    </>
  )
}

/* ------------------------------------------------------------------ Toasts */

export function Toaster(): ReactNode {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((toast) =>
      window.setTimeout(() => dismiss(toast.id), toast.kind === 'error' ? 8000 : 4500)
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [toasts, dismiss])

  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          <span className="toast__icon">
            {toast.kind === 'success' ? <CheckCircle2 size={17} /> : null}
            {toast.kind === 'error' ? <XCircle size={17} /> : null}
            {toast.kind === 'warning' ? <AlertTriangle size={17} /> : null}
            {toast.kind === 'info' ? <Info size={17} /> : null}
          </span>
          <div className="grow">
            <div className="toast__title">{toast.title}</div>
            {toast.message ? <div className="toast__message">{toast.message}</div> : null}
            {toast.action ? (
              <button type="button" className="btn btn--tertiary btn--sm" style={{ marginTop: 6 }} onClick={toast.action.run}>
                {toast.action.label}
              </button>
            ) : null}
          </div>
          <button type="button" className="icon-btn" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------- Confirmation dialogs */

export interface ConfirmOptions {
  title: string
  message: ReactNode
  detail?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Operator must type this exact phrase to enable the confirm button (extreme operations). */
  confirmationPhrase?: string
  /** Optional list of consequences shown as bullets. */
  consequences?: string[]
  /** Additional custom body rendered inside the dialog (selects, notes). */
  body?: ReactNode
  render?(close: (result: ConfirmResponse) => void): ReactNode
}

export interface ConfirmResponse {
  confirmed: boolean
  /** Text entered when `confirmationPhrase` was required. */
  phrase?: string
  /** Free text captured by custom bodies. */
  values?: Record<string, string>
}

interface PendingDialog extends ConfirmOptions {
  resolve(response: ConfirmResponse): void
}

let pending: PendingDialog | null = null
const listeners = new Set<(dialog: PendingDialog | null) => void>()

function setPending(dialog: PendingDialog | null): void {
  pending = dialog
  for (const listener of listeners) listener(dialog)
}

/** Ask for confirmation; resolves with the operator's decision. Never resolves twice. */
export function confirmDialog(options: ConfirmOptions): Promise<ConfirmResponse> {
  return new Promise<ConfirmResponse>((resolve) => {
    if (pending) pending.resolve({ confirmed: false })
    setPending({ ...options, resolve })
  })
}

export function ConfirmDialogHost(): ReactNode {
  const [dialog, setDialog] = useState<PendingDialog | null>(pending)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const listener = (next: PendingDialog | null): void => {
      setTyped('')
      setDialog(next)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (!dialog) return null

  const finish = (response: ConfirmResponse): void => {
    const resolve = dialog.resolve
    setPending(null)
    resolve(response)
  }

  const phraseOk = !dialog.confirmationPhrase || typed.trim().toLowerCase() === dialog.confirmationPhrase.trim().toLowerCase()

  return (
    <Modal
      open
      size={dialog.render ? 'xl' : 'md'}
      busy={busy}
      title={dialog.title}
      onClose={() => finish({ confirmed: false })}
      footer={
        <>
          <button type="button" className="btn btn--tertiary" onClick={() => finish({ confirmed: false })} disabled={busy}>
            {dialog.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={`btn ${dialog.danger ? 'btn--danger' : 'btn--primary'}`}
            disabled={!phraseOk || busy}
            onClick={() => {
              setBusy(true)
              finish({ confirmed: true, phrase: typed })
              setBusy(false)
            }}
          >
            {busy ? <Loader2 size={16} className="spin" /> : null}
            {dialog.confirmLabel ?? 'Continue'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{dialog.message}</div>
        {dialog.detail ? <div className="muted small">{dialog.detail}</div> : null}
        {dialog.consequences && dialog.consequences.length > 0 ? (
          <ul className="disk-list">
            {dialog.consequences.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {dialog.body}
        {dialog.confirmationPhrase ? (
          <label className="field">
            <span className="field__label">
              Type <strong>{dialog.confirmationPhrase}</strong> to proceed
            </span>
            <input className="field__input" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus aria-label="Confirmation phrase" />
          </label>
        ) : null}
      </div>
    </Modal>
  )
}

/** Convenience wrappers used across screens. */
export async function confirmDanger(options: ConfirmOptions): Promise<boolean> {
  const response = await confirmDialog({ ...options, danger: true })
  return response.confirmed
}

export function toast(kind: 'success' | 'error' | 'warning' | 'info', title: string, message?: string): void {
  useAppStore.getState().pushToast({ kind, title, message })
}
