import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { Button, Card, CardBody } from '../../components/ui/primitives'
import { Field, TextInput } from '../../components/ui/form'
import { invoke, errorMessage } from '../../lib/api'
import { useAppStore } from '../../store/appStore'
import { toast } from '../../components/ui/overlay'
import { applyBootstrap } from '../../App'

/**
 * One-time offline activation.
 *
 * The entered code is verified in the main process against the derived verifier table; nothing about
 * the expected code is present in the renderer bundle. Failed attempts are throttled by the service,
 * and the remaining wait is shown so the operator understands why the button is disabled.
 */
export function ActivationScreen(): ReactNode {
  const navigate = useNavigate()
  const activation = useAppStore((state) => state.activation)
  const setActivation = useAppStore((state) => state.setActivation)
  const build = useAppStore((state) => state.build)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldownMs, setCooldownMs] = useState(activation?.cooldownRemainingMs ?? 0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (cooldownMs <= 0) return
    const timer = window.setInterval(() => setCooldownMs((value) => Math.max(0, value - 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldownMs])

  const submit = async (): Promise<void> => {
    const trimmed = code.trim()
    if (trimmed.length === 0) {
      setError('Enter the activation code supplied with your licence.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke('activation.submit', { code: trimmed })
      const bootstrap = await invoke('app.bootstrap', {})
      applyBootstrap(bootstrap)
      toast('success', 'Dentiva Pro is activated on this computer')
      navigate(bootstrap.stage === 'setup' ? '/setup' : bootstrap.stage === 'login' ? '/login' : '/', { replace: true })
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      try {
        const state = await invoke('activation.state', {})
        setActivation(state)
        setCooldownMs(state.cooldownRemainingMs)
      } catch {
        /* keep the previous state; the main process remains the authority */
      }
    } finally {
      setBusy(false)
    }
  }

  const expectedLength = activation?.codeHint
  const cooldownSeconds = Math.ceil(cooldownMs / 1000)

  return (
    <div className="auth-layout">
      <div className="auth-card stack" style={{ maxWidth: 520 }}>
        <header className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className="brand-badge">
            <ShieldCheck size={22} />
          </span>
          <h1 className="auth-card__title">Activate Dentiva Pro</h1>
          <p className="muted">
            This licence is verified on this computer only. Dentiva Pro never contacts the internet, and the activation code is never transmitted
            anywhere.
          </p>
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
              <Field
                label="Activation code"
                htmlFor="activation-code"
                required
                error={error ?? undefined}
                hint={
                  expectedLength
                    ? `The code contains ${expectedLength.min}–${expectedLength.max} characters. Spaces and dashes are ignored.`
                    : 'Spaces and dashes are ignored when verifying the code.'
                }
              >
                <div className="field__control">
                  <KeyRound size={16} aria-hidden="true" className="field__icon" />
                  <TextInput
                    id="activation-code"
                    value={code}
                    onChange={(value) => {
                      setCode(value)
                      setError(null)
                    }}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    disabled={busy || cooldownSeconds > 0}
                    maxLength={64}
                  />
                </div>
              </Field>

              {cooldownSeconds > 0 ? (
                <p className="field__error" role="alert">
                  Too many incorrect attempts. Try again in {Math.floor(cooldownSeconds / 60)}:{String(cooldownSeconds % 60).padStart(2, '0')}.
                </p>
              ) : null}

              <Button type="submit" variant="primary" block loading={busy} disabled={cooldownSeconds > 0}>
                Activate this computer
              </Button>
            </form>
          </CardBody>
        </Card>

        <footer className="stack small muted" style={{ textAlign: 'center' }}>
          <span>
            Dentiva Pro {build?.version ?? ''} {build?.buildNumber && build.buildNumber !== 'dev' ? `(build ${build.buildNumber})` : ''}
          </span>
          <span>
            Lost your code? Contact the supplier with the machine identifier shown in the recovery screen. Activation works fully offline.
          </span>
        </footer>
      </div>
    </div>
  )
}
