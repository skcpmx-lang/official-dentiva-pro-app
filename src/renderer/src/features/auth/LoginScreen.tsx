import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, User } from 'lucide-react'
import { Button, Card, CardBody } from '../../components/ui/primitives'
import { Field, TextInput } from '../../components/ui/form'
import { errorMessage, invoke } from '../../lib/api'
import { landingRoute } from '../../lib/interface'
import { useAppStore } from '../../store/appStore'
import { applyBootstrap } from '../../App'

/**
 * Sign-in.
 *
 * Credentials are checked by the main process, which also counts failed attempts and applies the
 * clinic's lockout policy. The screen shows only what the operator needs: the remembered username
 * (when the clinic allows it), the clinic identity, and a clear error message.
 */
export function LoginScreen(): ReactNode {
  const navigate = useNavigate()
  const clinic = useAppStore((state) => state.clinic)
  const build = useAppStore((state) => state.build)
  const setSession = useAppStore((state) => state.setSession)
  const setStage = useAppStore((state) => state.setStage)
  const setLocked = useAppStore((state) => state.setLocked)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        const remembered = await invoke('auth.rememberedUsername', {})
        if (remembered.username) {
          setUsername(remembered.username)
          passwordRef.current?.focus()
        } else {
          usernameRef.current?.focus()
        }
      } catch {
        usernameRef.current?.focus()
      }
    })()
  }, [])

  const submit = async (): Promise<void> => {
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('auth.login', { username: username.trim(), password })
      setSession(result.session)
      setLocked(false)
      setStage('ready')
      setPassword('')
      const bootstrap = await invoke('app.bootstrap', {})
      applyBootstrap(bootstrap)
      if (result.mustChangePassword || result.passwordExpired) {
        navigate('/account/password', { replace: true })
      } else {
        navigate(landingRoute(useAppStore.getState().settings), { replace: true })
      }
    } catch (caught) {
      setError(errorMessage(caught))
      setPassword('')
      passwordRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card stack" style={{ maxWidth: 460 }}>
        <header className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className="brand-badge">
            <Lock size={20} />
          </span>
          <h1 className="auth-card__title">{clinic?.name || 'Dentiva Pro'}</h1>
          <p className="muted">{clinic?.address || 'Sign in to continue'}</p>
        </header>

        <Card>
          <CardBody>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <Field label="Username" htmlFor="username" required>
                <div className="field__control">
                  <User size={16} aria-hidden="true" className="field__icon" />
                  <TextInput id="username" value={username} onChange={setUsername} autoFocus maxLength={64} disabled={busy} />
                </div>
              </Field>

              <Field label="Password" htmlFor="password" required error={error ?? undefined}>
                <div className="field__control">
                  <Lock size={16} aria-hidden="true" className="field__icon" />
                  <input
                    id="password"
                    ref={passwordRef}
                    className="field__input"
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError(null)
                    }}
                    maxLength={256}
                    disabled={busy}
                    autoComplete="current-password"
                  />
                </div>
              </Field>

              <Button type="submit" variant="primary" block loading={busy}>
                Sign in
              </Button>
            </form>
          </CardBody>
        </Card>

        <footer className="small muted" style={{ textAlign: 'center' }}>
          Dentiva Pro {build?.version ?? ''} · works fully offline · all data stays on this computer
        </footer>
      </div>
    </div>
  )
}
