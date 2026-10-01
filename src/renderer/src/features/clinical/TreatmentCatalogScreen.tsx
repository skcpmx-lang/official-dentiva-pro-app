import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FolderArchive, Pencil, Plus, Tags } from 'lucide-react'
import { zTreatmentInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, MoneyInput, NumberInput, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { TREATMENT_CATEGORIES, treatmentCategoryLabel, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { Treatment, TreatmentInput } from '../../lib/types'

const CATEGORY_OPTIONS = [{ value: 'all', label: 'All categories' }, ...TREATMENT_CATEGORIES]

/**
 * Treatment catalogue.
 *
 * The catalogue is what reception sees when pricing a visit: a treatment carries its default fee and
 * duration, and the fee is copied onto the visit line so a later price change never rewrites history.
 * Archived treatments disappear from the active list but stay available under “Show archived” because
 * old invoices must remain explainable.
 */
export function TreatmentCatalogScreen(): ReactNode {
  const canManage = usePermission(['clinical.create', 'clinical.edit'])
  const canArchive = usePermission('clinical.delete')
  const format = useFormatters()
  /* `?search=` lets global search and the command palette open the catalogue on the treatment asked for. */
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('all')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Treatment | null>(null)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const filter = useMemo(
    () => ({ search: debounced === '' ? undefined : debounced, category: category === 'all' ? undefined : category, includeInactive }),
    [debounced, category, includeInactive]
  )
  const treatments = useInvoke('treatments.list', filter)
  const categories = useInvoke('treatments.categories', {})

  const columns: Array<Column<Treatment>> = [
    {
      key: 'name',
      header: 'Treatment',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.name}</span>
          {row.nameBn ? <span className="bn muted small">{row.nameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.name
    },
    { key: 'code', header: 'Code', width: 130, render: (row) => <span className="num small">{row.code}</span>, sortValue: (row) => row.code, secondary: true },
    {
      key: 'category',
      header: 'Category',
      width: 150,
      render: (row) => <Badge tone="info">{treatmentCategoryLabel(row.category)}</Badge>,
      sortValue: (row) => row.category
    },
    {
      key: 'price',
      header: 'Default fee',
      width: 130,
      align: 'right',
      render: (row) => <span className="num">{format.money(row.defaultPriceMicro)}</span>,
      sortValue: (row) => row.defaultPriceMicro
    },
    {
      key: 'duration',
      header: 'Minutes',
      width: 100,
      align: 'right',
      render: (row) => (row.durationMin > 0 ? <span className="num">{row.durationMin}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.durationMin,
      secondary: true
    },
    {
      key: 'usage',
      header: 'Performed',
      width: 110,
      align: 'right',
      render: (row) => <span className="num small">{row.usageCount.toLocaleString()}</span>,
      sortValue: (row) => row.usageCount,
      secondary: true
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (row) => (row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Archived</Badge>),
      sortValue: (row) => (row.isActive ? 1 : 0)
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Treatments"
        subtitle="Fees and durations used when work is recorded against a visit."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="tertiary"
              icon={<Download size={16} />}
              loading={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  const result = await invoke('treatments.export', {})
                  if (result.path === null) toast('info', 'Export cancelled')
                  else toast('success', 'Catalogue exported', `${result.rowCount} rows written to ${result.path}`)
                } catch (error) {
                  toast('error', 'The catalogue could not be exported', errorMessage(error))
                } finally {
                  setExporting(false)
                }
              }}
            >
              Export CSV
            </Button>
            {canManage ? (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                New treatment
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader
          title="Catalogue"
          icon={<Tags size={17} />}
          subtitle="Prices here are starting points; each visit line keeps the amount agreed at the time."
        />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, code or Bangla name…" ariaLabel="Search treatments" />
            <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} ariaLabel="Category" />
            <Switch checked={includeInactive} onChange={setIncludeInactive} label="Show archived" />
          </Toolbar>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 'var(--sp-3)' }}>
            {(categories.data ?? []).map((entry) => (
              <button
                key={entry.category}
                type="button"
                className={`chip${category === entry.category ? ' chip--active' : ''}`}
                onClick={() => setCategory(category === entry.category ? 'all' : entry.category)}
              >
                {treatmentCategoryLabel(entry.category)} · {entry.count}
              </button>
            ))}
          </div>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={treatments.data ?? []}
            getRowId={(row) => row.id}
            loading={treatments.loading}
            emptyTitle="No treatments match"
            emptyMessage={debounced || category !== 'all' ? 'Try a different search or category.' : 'Add the treatments your clinic performs, with their usual fees.'}
            rowActions={(row) =>
              canManage || canArchive ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  {canManage ? (
                    <Button size="sm" variant="tertiary" icon={<Pencil size={15} />} onClick={() => setEditing(row)}>
                      Edit
                    </Button>
                  ) : null}
                  {canArchive && row.isActive ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<FolderArchive size={15} />}
                      onClick={async () => {
                        const answer = await confirmDialog({
                          title: `Archive “${row.name}”?`,
                          message: `Archived treatments are hidden from new visits but stay on ${row.usageCount} recorded treatment(s) and their invoices.`,
                          confirmLabel: 'Archive treatment',
                          danger: true
                        })
                        if (!answer.confirmed) return
                        try {
                          await invoke('treatments.archive', { id: row.id, reason: null })
                          toast('success', 'Treatment archived')
                          await treatments.reload()
                        } catch (error) {
                          toast('error', 'The treatment could not be archived', errorMessage(error))
                        }
                      }}
                    >
                      Archive
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <TreatmentDialog
        treatment={creating ? null : editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void treatments.reload()}
      />
    </div>
  )
}

function TreatmentDialog({
  treatment,
  open,
  onClose,
  onSaved
}: {
  treatment: Treatment | null
  open: boolean
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const form = useZodForm(zTreatmentInput, {
    id: null,
    code: null,
    name: '',
    nameBn: null,
    category: 'restorative',
    description: null,
    defaultPriceMicro: 0,
    durationMin: 30,
    isActive: true,
    notes: null
  })

  useEffect(() => {
    if (!open) return
    if (!treatment) {
      form.reset({
        id: null,
        code: null,
        name: '',
        nameBn: null,
        category: 'restorative',
        description: null,
        defaultPriceMicro: 0,
        durationMin: 30,
        isActive: true,
        notes: null
      })
      return
    }
    form.reset({
      id: treatment.id,
      code: treatment.code,
      name: treatment.name,
      nameBn: treatment.nameBn,
      category: treatment.category as TreatmentInput['category'],
      description: treatment.description,
      defaultPriceMicro: treatment.defaultPriceMicro,
      durationMin: treatment.durationMin,
      isActive: treatment.isActive,
      notes: treatment.notes
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, treatment])

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      await invoke('treatments.save', form.values as TreatmentInput)
      toast('success', treatment ? 'Treatment updated' : 'Treatment added', 'New visits will use the updated fee.')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The treatment could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={treatment ? `Edit ${treatment.name}` : 'New treatment'}
      description="The default fee is applied to new visit lines; existing lines keep the amount already agreed."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {treatment ? 'Save changes' : 'Add treatment'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Treatment name" htmlFor="treatmentName" required error={form.errors.name}>
          <TextInput id="treatmentName" value={String(form.values.name ?? '')} onChange={(value) => form.setValue('name', value)} maxLength={120} />
        </Field>
        <Field label="Name in Bangla" htmlFor="treatmentNameBn" error={form.errors.nameBn}>
          <input
            id="treatmentNameBn"
            className="field__input bn"
            value={String(form.values.nameBn ?? '')}
            onChange={(event) => form.setValue('nameBn', event.target.value || null)}
            maxLength={120}
          />
        </Field>
        <Field
          label="Category"
          htmlFor="treatmentCategory"
          hint="A new code is generated per category, for example REST-0007."
          error={form.errors.category}
        >
          <Select
            id="treatmentCategory"
            value={String(form.values.category ?? 'restorative')}
            onChange={(value) => form.setValue('category', value as TreatmentInput['category'])}
            options={TREATMENT_CATEGORIES}
          />
        </Field>
        <Field label="Code" htmlFor="treatmentCode" error={form.errors.code} hint="Leave blank to generate one automatically.">
          <TextInput id="treatmentCode" value={String(form.values.code ?? '')} onChange={(value) => form.setValue('code', value || null)} maxLength={32} />
        </Field>
        <Field label="Default fee (৳)" htmlFor="treatmentPrice" error={form.errors.defaultPriceMicro}>
          <MoneyInput
            id="treatmentPrice"
            value={Number(form.values.defaultPriceMicro ?? 0)}
            onChange={(value) => form.setValue('defaultPriceMicro', value ?? 0)}
          />
        </Field>
        <Field label="Usual duration (minutes)" htmlFor="treatmentDuration" error={form.errors.durationMin}>
          <NumberInput
            id="treatmentDuration"
            value={Number(form.values.durationMin ?? 30)}
            onChange={(value) => form.setValue('durationMin', value ?? 30)}
            min={0}
            max={1440}
          />
        </Field>
        <Field label="Description" htmlFor="treatmentDescription" span={2} error={form.errors.description}>
          <TextArea
            id="treatmentDescription"
            value={String(form.values.description ?? '')}
            onChange={(value) => form.setValue('description', value || null)}
            rows={2}
            maxLength={500}
          />
        </Field>
        <Field label="Available for new visits" htmlFor="treatmentActive" span={2}>
          <Switch
            checked={Boolean(form.values.isActive)}
            onChange={(checked) => form.setValue('isActive', checked)}
            label={form.values.isActive ? 'Offered to reception' : 'Hidden from new visits'}
          />
        </Field>
      </div>
    </Modal>
  )
}
