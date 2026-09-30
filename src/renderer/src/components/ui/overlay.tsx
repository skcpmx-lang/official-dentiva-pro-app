import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useAppStore, type ToastKind } from '../../store/appStore'
import { Button, IconButton } from './primitives'

/**
 * Overlays: modal, drawer, toasts and the promise-based confirmation/prompt dialogs used by
 * destructive operations (which always state consequences and, for the riskiest actions, require the
 * operator to type a confirmation phrase).
 */

function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null)

    const first = focusables()[0]
    first?.focus()

    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onEscape()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const firstItem = items[0]!
      const lastItem = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', handler, true)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler, true)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [active, containerRef, onEscape])
}

export interface ModalProps {
  open: boolean
  title: ReactNode
  description?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  onClose(): void
  footer?: ReactNode
  children: ReactNode
  /** Prevents accidental closing (Esc/backdrop) during a destructive operation in progress. */
  busy?: boolean
}

export function Modal({ open, title, description, size = 'md', onClose, footer, children, busy }: ModalProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const handleClose = (): void => {
    if (!busy) onClose()
  }
  useFocusTrap(open, ref, handleClose)
  if (!open) return null

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && handleClose()}>
      <div ref={ref} className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'}>
        <div className="modal__header">
          <div>
            <div className="modal__title">{title}</div>
            {description ? <div className="modal__description">{description}</div> : null}
          </div>
          <IconButton label="Close" icon={<X size={18} />} onClick={handleClose} disabled={busy} />
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer
}: {
  open: boolean
  title: ReactNode
  description?: ReactNode
  onClose(): void
  children: ReactNode
  footer?: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(open, ref, onClose)
  if (!open) return null
  return (
    <>
      <div className="overlay" role="presentation" style={{ background: 'rgba(11,31,58,.28)' }} onMouseDown={(event) => event.target === event.currentTarget && onClose()} />
      <div ref={ref} className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Panel'}>
        <div className="modal__header">
          <div>
            <div className="modal__title">{title}</div>
            {description ? <div className="modal__description">{description}</div> : null}
          </div>
          <IconButton label="Close" icon={<X size={18} />} onClick={onClose} />
        </div>
        <div className="modal__body grow">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ Toasts */

const TOAST_ICON: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={18} color="var(--success)" />,
  error: <XCircle size={18} color="var(--danger)" />,
  warning: <AlertTriangle size={18} color="var(--warning)" />,
  info: <Info size={18} color="var(--info)" />
}

export function Toaster(): ReactNode {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.kind !== 'error')
      .map((toast) => setTimeout(() => dismiss(toast.id), 5000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span style={{ marginTop: 2 }}>{TOAST_ICON[toast.kind]}</span>
          <div className="grow">
            <div className="toast__title">{toast.title}</div>
            {toast.message ? <div className="toast__message">{toast.message}</div> : null}
            {toast.action ? (
              <div style={{ marginTop: 6 }}>
                <Button
                  size="sm"
                  variant="tertiary"
                  onClick={() => {
                    toast.action?.run()
                    dismiss(toast.id)
                  }}
                >
                  {toast.action.label}
                </Button>
              </div>
            ) : null}
          </div>
          <IconButton label="Dismiss" size="sm" icon={<X size={15} />} onClick={() => dismiss(toast.id)} />
        </div>
      ))}
    </div>
  )
}

export function toast(kind: ToastKind, title: string, message?: string, action?: { label: string, run: () => void }): string {
  return useAppStore.getState().pushToast({ kind, title, message, action })
}

/* --------------------------------------------- Confirmation / prompt dialogs */

export interface ConfirmOptions {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Require the operator to type this phrase before the confirm button enables. */
  confirmationPhrase?: string
  /** Extra guard: re-authentication by password (handled by the caller). */
  consequenceList?: string[]
}

interface DialogRequest extends ConfirmOptions {
  kind: 'confirm' | 'prompt'
  resolve(value: boolean | string | null): void
}

interface DialogState {
  request: DialogRequest | null
  open(request: DialogRequest): void
  close(value: boolean | string | null): void
}

const useDialogStore = create<DialogState>((set, get) => ({
  request: null,
  open: (request) => set({ request }),
  close: (value) => {
    get().request?.resolve(value)
    set({ request: null })
  }
}))

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState().open({ ...options, kind: 'confirm', resolve: (value) => resolve(value === true) })
  })
}

export function promptDialog(options: ConfirmOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useDialogStore.getState().open({ ...options, kind: 'prompt', resolve: (value) => resolve(typeof value === 'string' ? value : null) })
  })
}

export function DialogHost(): ReactNode {
  const request = useDialogStore((state) => state.request)
  const close = useDialogStore((state) => state.close)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    setTyped('')
  }, [request])

  if (!request) return null
  const phrase = request.confirmationPhrase
  const phraseSatisfied = !phrase || typed.trim().toLowerCase() === phrase.trim().toLowerCase()

  return (
    <Modal
      open
      size="md"
      title={request.title}
      onClose={() => close(request.kind === 'prompt' ? null : false)}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(request.kind === 'prompt' ? null : false)}>
            {request.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={request.danger ? 'danger' : 'primary'}
            disabled={!phraseSatisfied || (request.kind === 'prompt' && typed.trim().length === 0)}
            onClick={() => close(request.kind === 'prompt' ? typed : true)}
          >
            {request.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>{request.message}</p>
        {request.detail ? <p className="muted small">{request.detail}</p> : null}
        {request.consequenceList && request.consequenceList.length > 0 ? (
          <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
            {request.consequenceList.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {phrase ? (
          <label className="field">
            <span className="field__label">
              Type <strong>{phrase}</strong> to confirm
            </span>
            <input className="field__input" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus aria-label="Confirmation phrase" />
          </label>
        ) : null}
      </div>
    </Modal>
  )
}

/* --------------------------------------------------------------- Popover menu */

export function PopoverMenu({
  trigger,
  children,
  align = 'right'
}: {
  trigger: (props: { open: boolean, toggle(): void }) => ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}): ReactNode {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="popover-anchor" ref={container}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div className="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function Tooltip({ label, children }: { label: string, children: ReactNode }): ReactNode {
  return (
    <span title={label} aria-label={label}>
      {children}
    </span>
  )
}
