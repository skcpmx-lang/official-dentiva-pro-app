import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, Lock, Pencil, Plus, UserCheck, UserX } from 'lucide-react'
import { zUserInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, Select, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { usePermission } from '../../store/appStore'
import type { User, UserInput } from '../../lib/types'

/**
 * User accounts.
 *
 * Accounts are separate from dentist and staff records: a receptionist, an accountant and a dentist
 * each get exactly the permissions their role describes. Passwords are hashed by the main process
 * (scrypt) — nothing here ever sees a stored password.
 */
export function UsersScreen(): ReactNode {
  const canManage = usePermission('users.manage')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const users = useInvoke('users.list', { includeInactive })
  const roles = useInvoke('roles.list', { includeInactive: false })

  const columns: Array<Column<User>> = [
    {
      key: 'user',
      header: 'User',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.fullName}</span>
          <span className="muted small num">{row.username}</span>
        </div>
      ),
      sortValue: (row) => row.fullName
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => <Badge tone="info">{row.roleName}</Badge>,
      sortValue: (row) => row.roleName
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      width: 170,
      render: (row) => (row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : <span className="muted">never</span>),
      sortValue: (row) => row.lastLoginAt ?? 0,
      secondary: true
    },
    {
      key: 'status',
      header: 'Status',
      width: 150,
      render: (row) => (
        <span className="row" style={{ gap: 6 }}>
          {row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>}
          {row.isLocked ? <Badge tone="warning">Locked</Badge> : null}
          {row.mustChangePassword ? <Badge tone="info">Must change</Badge> : null}
        </span>
      ),
      sortValue: (row) => (row.isActive ? 1 : 0)
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Users"
        subtitle="Each account signs in with a username and password and receives exactly the permissions of its role."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Add user
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title="Accounts"
          icon={<UserCheck size={17} />}
          actions={<Switch checked={includeInactive} onChange={setIncludeInactive} label="Show disabled accounts" />}
        />
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={users.data ?? []}
            getRowId={(row) => row.id}
            loading={users.loading}
            emptyTitle="No user accounts"
            emptyMessage="Create an account for each person who needs access to Dentiva Pro."
            rowActions={(row) =>
              canManage ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="tertiary" icon={<Pencil size={15} />} onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<KeyRound size={15} />} onClick={() => setResetting(row)}>
                    Reset password
                  </Button>
                  {row.isLocked ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Lock size={15} />}
                      onClick={async () => {
                        try {
                          await invoke('users.unlock', { id: row.id })
                          toast('success', `${row.username} can sign in again`)
                          await users.reload()
                        } catch (error) {
                          toast('error', 'The account could not be unlocked', errorMessage(error))
                        }
                      }}
                    >
                      Unlock
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={row.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                    onClick={async () => {
                      if (row.isActive) {
                        const answer = await confirmDialog({
                          title: `Disable ${row.username}?`,
                          message: 'The account cannot sign in until it is enabled again. Historical records keep the user attribution.',
                          confirmLabel: 'Disable account',
                          danger: true
                        })
                        if (!answer.confirmed) return
                      }
                      try {
                        await invoke('users.setActive', { id: row.id, isActive: !row.isActive })
                        toast('success', row.isActive ? `${row.username} disabled` : `${row.username} enabled`)
                        await users.reload()
                      } catch (error) {
                        toast('error', 'The account could not be updated', errorMessage(error))
                      }
                    }}
                  >
                    {row.isActive ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <UserDialog
        user={creating ? null : editing}
        open={creating || editing !== null}
        roles={(roles.data ?? []).map((role) => ({ value: String(role.id), label: role.name }))}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void users.reload()}
      />

      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onSaved={() => void users.reload()} />
    </div>
  )
}

function UserDialog({
  user,
  open,
  roles,
  onClose,
  onSaved
}: {
  user: User | null
  open: boolean
  roles: Array<{ value: string, label: string }>
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const form = useZodForm(zUserInput, {
    id: null,
    username: '',
    fullName: '',
    roleId: 0,
    requirePasswordChange: true,
    isActive: true,
    staffId: null,
    dentistId: null
  })

  useEffect(() => {
    if (!open) return
    if (!user) {
      form.reset({
        id: null,
        username: '',
        fullName: '',
        roleId: roles[0] ? Number(roles[0].value) : 0,
        password: undefined,
        requirePasswordChange: true,
        isActive: true,
        staffId: null,
        dentistId: null
      })
      return
    }
    form.reset({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleId: user.roleId,
      requirePasswordChange: user.mustChangePassword,
      isActive: user.isActive,
      staffId: user.staffId,
      dentistId: user.dentistId
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, roles.length])

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    if (!user && !form.values.password) {
      form.setError('password', 'Set an initial password for this account.')
      return
    }
    setBusy(true)
    try {
      await invoke('users.save', form.values as UserInput)
      toast('success', user ? 'User account updated' : 'User account created')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The account could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={user ? `Edit ${user.username}` : 'Add a user account'}
      description="Passwords are stored as salted scrypt hashes; nobody can read them back."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {user ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="grid grid--two">
        <Field label="Full name" htmlFor="userFullName" required error={form.errors.fullName}>
          <TextInput id="userFullName" value={String(form.values.fullName ?? '')} onChange={(value) => form.setValue('fullName', value)} maxLength={120} />
        </Field>
        <Field label="Username" htmlFor="userUsername" required error={form.errors.username} hint="Letters, numbers, dot, dash or underscore.">
          <TextInput id="userUsername" value={String(form.values.username ?? '')} onChange={(value) => form.setValue('username', value)} maxLength={32} />
        </Field>
        <Field label="Role" htmlFor="userRole" required error={form.errors.roleId}>
          <Select id="userRole" value={String(form.values.roleId ?? 0)} onChange={(value) => form.setValue('roleId', Number(value))} options={roles} />
        </Field>
        {!user ? (
          <Field label="Initial password" htmlFor="userPassword" required error={form.errors.password}>
            <input
              id="userPassword"
              className="field__input"
              type="password"
              value={String(form.values.password ?? '')}
              onChange={(event) => form.setValue('password', event.target.value)}
              maxLength={128}
            />
          </Field>
        ) : null}
        <Field label="Account state" htmlFor="userActive" span={2}>
          <div className="stack" style={{ gap: 8 }}>
            <Switch checked={Boolean(form.values.isActive)} onChange={(checked) => form.setValue('isActive', checked)} label={form.values.isActive ? 'Account enabled' : 'Account disabled'} />
            <Switch
              checked={Boolean(form.values.requirePasswordChange)}
              onChange={(checked) => form.setValue('requirePasswordChange', checked)}
              label="Require a password change at next sign-in"
            />
          </div>
        </Field>
      </div>
    </Modal>
  )
}

function ResetPasswordDialog({ user, onClose, onSaved }: { user: User | null, onClose(): void, onSaved(): void }): ReactNode {
  const [password, setPassword] = useState('')
  const [mustChange, setMustChange] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPassword('')
    setMustChange(true)
  }, [user])

  if (!user) return null

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('users.resetPassword', { id: user.id, newPassword: password, requireChange: mustChange })
      toast('success', `Password reset for ${user.username}`, 'The user will be asked to choose a new password at next sign-in.')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The password could not be reset', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title={`Reset the password of ${user.username}`}
      description="Share the new password with the user through a secure channel, then ask them to change it."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={password.length < 6} loading={busy} onClick={() => void submit()}>
            Reset password
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="New password" htmlFor="resetPassword" required hint="At least 6 characters; the clinic policy is applied by the main process.">
          <input
            id="resetPassword"
            className="field__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={128}
            autoFocus
          />
        </Field>
        <Switch checked={mustChange} onChange={setMustChange} label="Require the user to change it at next sign-in" />
      </div>
    </Modal>
  )
}
