import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { Field } from '../../components/ui/form'
import { errorMessage, invoke } from '../../lib/api'
import { useSession, useSetting } from '../../store/appStore'
import { toast } from '../../components/ui/overlay'
import type { ApiError } from '../../lib/api'

/**
 * Password change.
 *
 * Used both voluntarily and when an administrator requires a change at next sign-in. The main process
 * re-validates the current password and applies the clinic's password policy, so this form cannot be
 * used to weaken security.
 */
export function ChangePasswordScreen(): ReactNode {
  const navigate = useNavigate()
  const session = useSession()
  const minLength = Number(useSetting('security.passwordMinLength', '8'))
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setFieldErrors({})
    setGeneralError(null)
    try {
      await invoke('auth.changePassword', { currentPassword, newPassword, confirmPassword })
      toast('success', 'Your password has been changed')
      navigate('/', { replace: true })
    } catch (caught) {
      const apiError = caught as ApiError
      if (apiError.fieldErrors) setFieldErrors(apiError.fieldErrors)
      else setGeneralError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Change password"
        subtitle={
          session?.mustChangePassword
            ? 'Your password must be changed before you can continue working.'
            : 'Choose a password you do not use anywhere else.'
        }
      />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 560px)' }}>
        <Card>
          <CardHeader title="Account security" icon={<KeyRound size={17} />} subtitle={`At least ${minLength} characters, with letters and numbers.`} />
          <CardBody>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <Field label="Current password" htmlFor="current-password" required error={fieldErrors.currentPassword}>
                <input
                  id="current-password"
                  className="field__input"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  disabled={busy}
                />
              </Field>

              <Field label="New password" htmlFor="new-password" required error={fieldErrors.newPassword}>
                <input
                  id="new-password"
                  className="field__input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </Field>

              <Field label="Confirm new password" htmlFor="confirm-password" required error={fieldErrors.confirmPassword}>
                <input
                  id="confirm-password"
                  className="field__input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </Field>

              {generalError ? (
                <p className="field__error" role="alert">
                  {generalError}
                </p>
              ) : null}

              <div className="row">
                <Button type="submit" variant="primary" loading={busy}>
                  Change password
                </Button>
                {!session?.mustChangePassword ? (
                  <Button type="button" variant="tertiary" onClick={() => navigate(-1)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
