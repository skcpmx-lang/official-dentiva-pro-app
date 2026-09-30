import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch } from '../../components/ui/primitives'
import { Field, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { usePermission } from '../../store/appStore'
import { zRoleInput } from '@shared/contracts'
import type { Role, RoleInput, RolePermissionDef } from '../../lib/types'

/**
 * Roles and permissions.
 *
 * The permission catalog is published by the main process (`roles.permissions`) and grouped by module.
 * A role is a named set of permissions; the owner role always holds every permission and cannot be
 * edited into something weaker, which keeps at least one account able to administer the application.
 */
export function RolesScreen(): ReactNode {
  const canManage = usePermission('roles.manage')
  const roles = useInvoke('roles.list', { includeInactive: true })
  const catalog = useInvoke('roles.permissions', {})
  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)

  const grouped = useMemo(() => {
    const map = new Map<string, RolePermissionDef[]>()
    for (const permission of catalog.data ?? []) {
      const list = map.get(permission.module) ?? []
      list.push(permission)
      map.set(permission.module, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [catalog.data])

  return (
    <div className="page">
      <PageHeader
        title="Roles"
        subtitle="Roles decide what each user can see and do. Financial permissions are enforced in the business layer, not only by hiding buttons."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              New role
            </Button>
          ) : null
        }
      />

      <div className="grid grid--two">
        {(roles.data ?? []).map((role) => (
          <Card key={role.id}>
            <CardHeader
              title={
                <span className="row" style={{ gap: 8 }}>
                  {role.name}
                  {role.isSystem ? <Badge tone="info">Built-in</Badge> : null}
                  {!role.isActive ? <Badge tone="neutral">Disabled</Badge> : null}
                </span>
              }
              icon={<ShieldCheck size={17} />}
              subtitle={role.description}
              actions={
                canManage ? (
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="tertiary" onClick={() => setEditing(role)} disabled={role.code === 'owner'}>
                      Edit
                    </Button>
                    {!role.isSystem ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={15} />}
                        aria-label={`Delete role ${role.name}`}
                        onClick={async () => {
                          const answer = await confirmDialog({
                            title: `Delete the role “${role.name}”?`,
                            message: 'Users holding this role must be moved to another role first. Deletion is recorded in the audit log.',
                            confirmLabel: 'Delete role',
                            danger: true,
                            confirmationPhrase: role.code
                          })
                          if (!answer.confirmed) return
                          try {
                            await invoke('roles.delete', { id: role.id, confirmation: answer.phrase ?? '' })
                            toast('success', 'Role deleted')
                            await roles.reload()
                          } catch (error) {
                            toast('error', 'The role could not be deleted', errorMessage(error))
                          }
                        }}
                      />
                    ) : null}
                  </div>
                ) : null
              }
            />
            <CardBody>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {role.permissions.length === 0 ? (
                  <span className="muted small">No permissions granted</span>
                ) : role.permissions[0] === '*' ? (
                  <Badge tone="success">All permissions</Badge>
                ) : (
                  <>
                    {role.permissions.slice(0, 12).map((code) => (
                      <span key={code} className="chip chip--static">
                        {code}
                      </span>
                    ))}
                    {role.permissions.length > 12 ? <span className="muted small">+{role.permissions.length - 12} more</span> : null}
                  </>
                )}
              </div>
              {role.maxDiscountBasisPoints !== null ? (
                <p className="muted small" style={{ marginTop: 8 }}>
                  Maximum discount without an override: {(role.maxDiscountBasisPoints / 100).toFixed(2)}%
                </p>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </div>

      <RoleDialog
        role={creating ? null : editing}
        open={creating || editing !== null}
        catalog={grouped}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void roles.reload()}
      />
    </div>
  )
}

function RoleDialog({
  role,
  open,
  catalog,
  onClose,
  onSaved
}: {
  role: Role | null
  open: boolean
  catalog: Array<[string, RolePermissionDef[]]>
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const form = useZodForm(zRoleInput, {
    id: null,
    code: '',
    name: '',
    description: '',
    maxDiscountBasisPoints: null,
    isActive: true,
    permissions: []
  })

  useEffect(() => {
    if (!open) return
    if (!role) {
      form.reset({ id: null, code: '', name: '', description: '', maxDiscountBasisPoints: null, isActive: true, permissions: [] })
      setSelected(new Set())
      return
    }
    form.reset({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      maxDiscountBasisPoints: role.maxDiscountBasisPoints,
      isActive: role.isActive,
      permissions: role.permissions[0] === '*' ? [] : role.permissions
    })
    setSelected(new Set(role.permissions[0] === '*' ? [] : role.permissions))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, role])

  const toggle = (code: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const toggleModule = (permissions: RolePermissionDef[], on: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      for (const permission of permissions) {
        if (on) next.add(permission.code)
        else next.delete(permission.code)
      }
      return next
    })
  }

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    if (selected.size === 0) {
      toast('warning', 'Select at least one permission', 'A role without permissions cannot do anything in the application.')
      return
    }
    setBusy(true)
    try {
      await invoke('roles.save', { ...(form.values as RoleInput), permissions: [...selected] })
      toast('success', role ? 'Role updated' : 'Role created', 'Users with this role receive the new permissions immediately.')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The role could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const isOwnerRole = role?.code === 'owner'

  return (
    <Modal
      open={open}
      size="2xl"
      title={role ? `Edit the role “${role.name}”` : 'Create a role'}
      description={isOwnerRole ? 'The owner role always holds every permission and cannot be restricted.' : 'Choose the permissions this role grants.'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={isOwnerRole} onClick={() => void save()}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </>
      }
    >
      {isOwnerRole ? (
        <div className="state">
          <span className="state__icon">
            <Lock size={20} />
          </span>
          <span className="state__title">The owner role cannot be modified</span>
          <span className="state__message">Create a new role if you need a narrower set of permissions.</span>
        </div>
      ) : (
        <>
          <div className="grid grid--two">
            <Field label="Role name" htmlFor="roleName" required error={form.errors.name}>
              <TextInput id="roleName" value={String(form.values.name ?? '')} onChange={(value) => form.setValue('name', value)} maxLength={80} />
            </Field>
            <Field label="Role code" htmlFor="roleCode" required error={form.errors.code} hint="Short identifier used in the audit log, for example “assistant”.">
              <TextInput id="roleCode" value={String(form.values.code ?? '')} onChange={(value) => form.setValue('code', value)} maxLength={32} />
            </Field>
            <Field label="Description" htmlFor="roleDescription" error={form.errors.description} span={2}>
              <TextArea id="roleDescription" value={String(form.values.description ?? '')} onChange={(value) => form.setValue('description', value)} rows={2} maxLength={300} />
            </Field>
            <Field label="Maximum discount without override (%)" htmlFor="roleDiscount" error={form.errors.maxDiscountBasisPoints}>
              <input
                id="roleDiscount"
                className="field__input"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={form.values.maxDiscountBasisPoints === null || form.values.maxDiscountBasisPoints === undefined ? '' : form.values.maxDiscountBasisPoints / 100}
                onChange={(event) => form.setValue('maxDiscountBasisPoints', event.target.value === '' ? null : Math.round(Number(event.target.value) * 100))}
              />
            </Field>
            <Field label="Active" htmlFor="roleActive">
              <Switch
                checked={Boolean(form.values.isActive)}
                onChange={(checked) => form.setValue('isActive', checked)}
                label={form.values.isActive ? 'Role can be assigned' : 'Role cannot be assigned'}
              />
            </Field>
          </div>

          <div className="stack" style={{ marginTop: 'var(--sp-4)' }}>
            {catalog.map(([module, permissions]) => {
              const allSelected = permissions.every((permission) => selected.has(permission.code))
              return (
                <section key={module} className="permission-group">
                  <header className="permission-group__header">
                    <strong>{module.replace(/_/g, ' ')}</strong>
                    <Switch checked={allSelected} onChange={(on) => toggleModule(permissions, on)} label={allSelected ? 'All granted' : 'Grant all'} />
                  </header>
                  <div className="permission-group__grid">
                    {permissions.map((permission) => (
                      <label key={permission.code} className="permission-item">
                        <input type="checkbox" checked={selected.has(permission.code)} onChange={() => toggle(permission.code)} />
                        <span className="stack" style={{ gap: 2 }}>
                          <span>{permission.label}</span>
                          <span className="muted small">{permission.description}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}
