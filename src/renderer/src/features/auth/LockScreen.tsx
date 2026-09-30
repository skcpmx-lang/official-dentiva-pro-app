import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Unlock } from 'lucide-react'
import { Button } from '../../components/ui/primitives'
import { Field } from '../../components/ui/form'
import { errorMessage, invoke } from '../../lib/api'
import { landingRoute } from '../../lib/interface'
import { clearSessionState, useAppStore } from '../../store/appStore'

/**
 * Lock screen.
 *
 * A locked session keeps the operator's identity but blocks every screen and every channel except
 * state, touch, unlock and sign-out — the block is enforced by the IPC router, not by hiding the UI.
 * The password of the signed-in user is required to continue.
 */
export function LockScreen(): ReactNode {
  const navigate = useNavigate()
  const session = useAppStore((state) => state.session)
  const clinic = useAppStore((state) => state.clinic)
  const setSession = useAppStore((state) => state.setSession)
  const setLocked = useAppStore((state) => state.setLocked)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const unlock = async (): Promise<void> => {
    if (!password) {
      setError('Enter your password to unlock.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const summary = await invoke('auth.unlock', { password })
      setSession(summary)
      setLocked(false)
      setPassword('')
      navigate(landingRoute(useAppStore.getState().settings), { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
      setPassword('')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    try {
      await invoke('auth.logout', {})
    } finally {
      clearSessionState()
      navigate('/login', { replace: true })
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card stack" style={{ maxWidth: 420 }}>
        <header className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className="brand-badge">
            <Unlock size={20} />
          </span>
          <h1 className="auth-card__title">Dentiva Pro is locked</h1>
          <p className="muted">
            {session?.fullName} · {clinic?.name || 'Dental practice'}
          </p>
        </header>

        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void unlock()
          }}
        >
          <Field label="Password" htmlFor="unlock-password" required error={error ?? undefined}>
            <input
              id="unlock-password"
              ref={inputRef}
              className="field__input"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError(null)
              }}
              maxLength={256}
              autoComplete="current-password"
              disabled={busy}
            />
          </Field>
          <Button type="submit" variant="primary" block loading={busy}>
            Unlock
          </Button>
          <Button type="button" variant="tertiary" block onClick={() => void signOut()}>
            Sign out instead
          </Button>
        </form>
      </div>
    </div>
  )
}
