import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Ban, CalendarCheck, Download, Pencil, Plus, Receipt, Wallet } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { DateInput, Field, MoneyInput, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { ACCOUNTING_KIND_META, PAYMENT_METHODS, anyMethodLabel, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { AccountingCategory, AccountingEntry, AccountingEntryInput, AccountingKind, DayCloseView } from '../../lib/types'
import { zEntryInput } from '@shared/contracts'

const KIND_OPTIONS = [
  { value: 'all', label: 'Income and expenses' },
  { value: 'income', label: 'Income only' },
  { value: 'expense', label: 'Expenses only' }
]

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'all', label: 'All time' }
]

type RangePresetValue = 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastYear' | 'all'

/**
 * The clinic's books.
 *
 * Income and expenses are recorded as entries, and every day can be closed against the physical cash
 * count: the screen shows what the ledger expects, records what was actually in the drawer, and keeps the
 * difference. A closed day refuses changes until it is reopened with a reason, which is what stops quiet
 * edits to yesterday's takings.
 */
export function AccountingScreen(): ReactNode {
  const format = useFormatters()
  const canManage = usePermission(['accounting.create', 'accounting.edit'])
  const canVoid = usePermission('accounting.delete')
  const canExport = usePermission('accounting.export')

  const [kind, setKind] = useState('all')
  const [categoryId, setCategoryId] = useState('')
  const [preset, setPreset] = useState<RangePresetValue>('last30')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [includeVoid, setIncludeVoid] = useState(false)
  const [editing, setEditing] = useState<AccountingEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const filter = useMemo(
    () => ({
      kind: kind === 'all' ? undefined : (kind as AccountingKind),
      categoryId: categoryId === '' ? undefined : Number(categoryId),
      search: debounced === '' ? undefined : debounced,
      includeVoid,
      range: { preset },
      limit: 100,
      offset: 0
    }),
    [kind, categoryId, debounced, includeVoid, preset]
  )
  const entries = useInvoke('accounting.entries', filter)
  const categories = useInvoke('accounting.categories', { includeInactive: categoriesOpen })
  const day = useInvoke('accounting.dayClose', { date: new Date().toISOString().slice(0, 10) })

  const columns: Array<Column<AccountingEntry>> = [
    {
      key: 'entry',
      header: 'Entry',
      width: 155,
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="num link-strong">{row.entryNo}</span>
          <span className="muted small num">{row.entryDate}</span>
        </div>
      ),
      sortValue: (row) => row.entryNo
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 110,
      render: (row) => <Badge tone={ACCOUNTING_KIND_META[row.kind]?.tone ?? 'neutral'}>{ACCOUNTING_KIND_META[row.kind]?.label ?? row.kind}</Badge>,
      sortValue: (row) => row.kind
    },
    {
      key: 'description',
      header: 'Description',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.description}</span>
          <span className="muted small">
            {row.categoryName}
            {row.party ? ` · ${row.party}` : ''}
            {row.reference ? ` · ref ${row.reference}` : ''}
          </span>
        </div>
      ),
      sortValue: (row) => row.description
    },
    { key: 'method', header: 'Method', width: 120, render: (row) => <span className="small">{anyMethodLabel(row.method)}</span>, sortValue: (row) => row.method, secondary: true },
    {
      key: 'amount',
      header: 'Amount',
      width: 140,
      align: 'right',
      render: (row) => (
        <span className="num">
          {row.kind === 'expense' ? '−' : '+'}
          {format.money(row.amountMicro, { symbol: false })}
        </span>
      ),
      sortValue: (row) => (row.kind === 'expense' ? -row.amountMicro : row.amountMicro)
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (row) => (row.status === 'void' ? <Badge tone="neutral">Void</Badge> : <span className="muted small">{row.createdByName ?? '—'}</span>),
      sortValue: (row) => row.status
    }
  ]

  const voidEntry = async (entry: AccountingEntry): Promise<void> => {
    const answer = await confirmDialog({
      title: `Void ${entry.entryNo}?`,
      message: 'The entry stays in the books marked void with this reason; totals and reports leave it out from then on.',
      confirmLabel: 'Void entry',
      danger: true,
      confirmationPhrase: entry.entryNo
    })
    if (!answer.confirmed) return
    try {
      await invoke('accounting.entry.void', { id: entry.id, reason: answer.phrase ?? 'Voided from the books screen' })
      await entries.reload()
      toast('success', `${entry.entryNo} voided`)
    } catch (error) {
      toast('error', 'The entry could not be voided', errorMessage(error))
    }
  }

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'All categories' },
      ...(categories.data ?? []).map((category) => ({ value: String(category.id), label: `${category.name} (${category.kind})` }))
    ],
    [categories.data]
  )

  return (
    <div className="page">
      <PageHeader
        title="Accounting"
        subtitle="Income, expenses and the daily cash close."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {canExport ? (
              <Button
                variant="tertiary"
                icon={<Download size={16} />}
                loading={exporting}
                onClick={async () => {
                  setExporting(true)
                  try {
                    const result = await invoke('accounting.entries.export', filter)
                    if (result.path === null) toast('info', 'Export cancelled')
                    else toast('success', 'Entries exported', `${result.rowCount} rows written to ${result.path}`)
                  } catch (error) {
                    toast('error', 'The entries could not be exported', errorMessage(error))
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                Export CSV
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button variant="secondary" icon={<Wallet size={16} />} onClick={() => setCategoriesOpen(true)}>
                  Categories
                </Button>
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
                  New entry
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">Income (filtered)</span>
          <strong className="num">{format.money(entries.data?.totals.incomeMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Expenses</span>
          <strong className="num">{format.money(entries.data?.totals.expenseMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Net</span>
          <strong className="num">{format.money(entries.data?.totals.netMicro ?? 0)}</strong>
        </span>
      </div>

      <div className="grid grid--2">
        <Card>
          <CardHeader title="Entries" icon={<Receipt size={17} />} subtitle="Newest first. Voided entries stay visible under the switch." />
          <CardBody>
            <Toolbar>
              <SearchInput value={search} onChange={setSearch} placeholder="Search description, party, reference…" ariaLabel="Search entries" />
              <Select value={kind} onChange={(value: string) => setKind(value)} options={KIND_OPTIONS} ariaLabel="Kind" />
              <Select value={categoryId} onChange={(value: string) => setCategoryId(value)} options={categoryOptions} ariaLabel="Category" />
              <Select value={preset} onChange={(value: string) => setPreset(value as RangePresetValue)} options={RANGE_OPTIONS} ariaLabel="Date range" />
              <Switch checked={includeVoid} onChange={setIncludeVoid} label="Show void" />
            </Toolbar>
          </CardBody>
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={entries.data?.items ?? []}
              getRowId={(row) => row.id}
              loading={entries.loading}
              emptyTitle="No entries in this period"
              emptyMessage="Record an expense or other income, or widen the filters."
              rowActions={(row) => (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  {canManage && row.status === 'active' ? (
                    <Button size="sm" variant="ghost" icon={<Pencil size={15} />} aria-label={`Edit ${row.entryNo}`} onClick={() => setEditing(row)}>
                      Edit
                    </Button>
                  ) : null}
                  {canVoid && row.status === 'active' ? (
                    <Button size="sm" variant="ghost" icon={<Ban size={15} />} aria-label={`Void ${row.entryNo}`} onClick={() => void voidEntry(row)}>
                      Void
                    </Button>
                  ) : null}
                </div>
              )}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Today's close"
            icon={<CalendarCheck size={17} />}
            subtitle="Count the drawer, compare it with the ledger and keep the difference on record."
            actions={
              canManage ? (
                <Button size="sm" variant={day.data?.isClosed ? 'tertiary' : 'primary'} onClick={() => setCloseOpen(true)}>
                  {day.data?.isClosed ? 'Reopen day' : 'Close day'}
                </Button>
              ) : null
            }
          />
          <CardBody>
            {day.data ? <DayClosePanel day={day.data} /> : <p className="muted">Loading…</p>}
          </CardBody>
        </Card>
      </div>

      <EntryDialog
        entry={creating ? null : editing}
        open={creating || editing !== null}
        categories={categories.data ?? []}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          void entries.reload()
          void day.reload()
        }}
      />

      <CategoryDialog
        open={categoriesOpen}
        categories={categories.data ?? []}
        onClose={() => setCategoriesOpen(false)}
        onChanged={() => {
          void categories.reload()
          void entries.reload()
        }}
      />

      <DayCloseDialog
        open={closeOpen}
        day={day.data ?? null}
        onClose={() => setCloseOpen(false)}
        onChanged={() => {
          void day.reload()
          void entries.reload()
        }}
      />
    </div>
  )
}

function DayClosePanel({ day }: { day: DayCloseView }): ReactNode {
  const format = useFormatters()
  return (
    <div className="stack">
      <div className="summary-strip" style={{ marginBottom: 0 }}>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Cash collected</span>
          <strong className="num">{format.money(day.cashCollectedMicro)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Cash expenses</span>
          <strong className="num">{format.money(day.cashExpensesMicro)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Expected in drawer</span>
          <strong className="num">{format.money(day.expectedCashMicro)}</strong>
        </span>
        {day.isClosed ? (
          <>
            <span className="summary-strip__item">
              <span className="summary-strip__label">Counted</span>
              <strong className="num">{format.money(day.countedCashMicro ?? 0)}</strong>
            </span>
            <span className="summary-strip__item">
              <span className="summary-strip__label">Difference</span>
              <strong className="num">{format.money(day.varianceMicro ?? 0)}</strong>
            </span>
          </>
        ) : null}
      </div>

      <p className="muted small">
        {day.isClosed
          ? `Closed ${day.closedAt ? new Date(day.closedAt).toLocaleString() : ''}${day.closedByName ? ` by ${day.closedByName}` : ''}.${day.note ? ` “${day.note}”` : ''}`
          : 'Still open. Entries for today can change until the day is closed.'}
      </p>

      {day.byMethod.length > 0 ? (
        <ul className="plain-list">
          {day.byMethod.map((method) => (
            <li key={method.method} className="plain-list__item">
              <span>{anyMethodLabel(method.method)}</span>
              <span className="num">{format.money(method.amountMicro)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No payments recorded today yet.</p>
      )}
    </div>
  )
}

function EntryDialog({
  entry,
  open,
  categories,
  onClose,
  onSaved
}: {
  entry: AccountingEntry | null
  open: boolean
  categories: AccountingCategory[]
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const form = useZodForm(zEntryInput, {
    id: null,
    kind: 'expense',
    categoryId: null,
    categoryName: 'Clinic rent',
    entryDate: today,
    amountMicro: 0,
    method: 'cash',
    reference: null,
    party: null,
    description: '',
    notes: null
  })

  useEffect(() => {
    if (!open) return
    if (!entry) {
      form.reset({
        id: null,
        kind: 'expense',
        categoryId: null,
        categoryName: categories[0]?.name ?? 'Clinic rent',
        entryDate: today,
        amountMicro: 0,
        method: 'cash',
        reference: null,
        party: null,
        description: '',
        notes: null
      })
      return
    }
    form.reset({
      id: entry.id,
      kind: entry.kind,
      categoryId: entry.categoryId,
      categoryName: entry.categoryName,
      entryDate: entry.entryDate,
      amountMicro: entry.amountMicro,
      method: entry.method,
      reference: entry.reference,
      party: entry.party,
      description: entry.description,
      notes: entry.notes
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry])

  const options = useMemo(() => {
    const wanted = String(form.values.kind ?? 'expense')
    const matching = categories.filter((category) => category.kind === wanted && category.isActive)
    return matching.map((category) => ({ value: category.name, label: category.name }))
  }, [categories, form.values.kind])

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    const chosen = categories.find((category) => category.name === String(form.values.categoryName ?? ''))
    setBusy(true)
    try {
      await invoke('accounting.entry.save', { ...(form.values as AccountingEntryInput), categoryId: chosen?.id ?? null })
      toast('success', entry ? 'Entry updated' : 'Entry recorded')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The entry could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={entry ? `Edit ${entry.entryNo}` : 'New accounting entry'}
      description="Entries are income or expense records with a category, method and the description the auditor will read."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {entry ? 'Save changes' : 'Record entry'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Kind" htmlFor="entryKind" required error={form.errors.kind}>
          <Select
            id="entryKind"
            value={String(form.values.kind ?? 'expense')}
            onChange={(value) => form.setValue('kind', value as AccountingKind)}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' }
            ]}
            ariaLabel="Kind"
          />
        </Field>
        <Field label="Category" htmlFor="entryCategory" required error={form.errors.categoryName}>
          <Select
            id="entryCategory"
            value={String(form.values.categoryName ?? '')}
            onChange={(value) => form.setValue('categoryName', value)}
            options={options}
            ariaLabel="Category"
          />
        </Field>
        <Field label="Date" htmlFor="entryDate" required error={form.errors.entryDate}>
          <DateInput id="entryDate" value={String(form.values.entryDate ?? today)} onChange={(value) => form.setValue('entryDate', value ?? today)} />
        </Field>
        <Field label="Amount (৳)" htmlFor="entryAmount" required error={form.errors.amountMicro}>
          <MoneyInput id="entryAmount" value={Number(form.values.amountMicro ?? 0)} onChange={(value) => form.setValue('amountMicro', value ?? 0)} />
        </Field>
        <Field label="Method" htmlFor="entryMethod" error={form.errors.method}>
          <Select id="entryMethod" value={String(form.values.method ?? 'cash')} onChange={(value) => form.setValue('method', value)} options={PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label }))} ariaLabel="Method" />
        </Field>
        <Field label="Party" htmlFor="entryParty" hint="Landlord, supplier, staff member…" error={form.errors.party}>
          <TextInput id="entryParty" value={String(form.values.party ?? '')} onChange={(value) => form.setValue('party', value || null)} maxLength={160} />
        </Field>
        <Field label="Reference" htmlFor="entryReference" error={form.errors.reference}>
          <TextInput id="entryReference" value={String(form.values.reference ?? '')} onChange={(value) => form.setValue('reference', value || null)} maxLength={120} />
        </Field>
        <Field label="Description" htmlFor="entryDescription" required span={2} error={form.errors.description}>
          <TextArea id="entryDescription" value={String(form.values.description ?? '')} onChange={(value) => form.setValue('description', value)} rows={2} maxLength={300} />
        </Field>
        <Field label="Notes" htmlFor="entryNotes" span={2} error={form.errors.notes}>
          <TextArea id="entryNotes" value={String(form.values.notes ?? '')} onChange={(value) => form.setValue('notes', value || null)} rows={2} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}

function CategoryDialog({
  open,
  categories,
  onClose,
  onChanged
}: {
  open: boolean
  categories: AccountingCategory[]
  onClose(): void
  onChanged(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountingKind>('expense')

  const add = async (): Promise<void> => {
    if (name.trim().length < 2) {
      toast('warning', 'Enter a category name', 'The name must be at least two characters.')
      return
    }
    setBusy(true)
    try {
      await invoke('accounting.categories.save', { id: null, name: name.trim(), kind, isActive: true })
      setName('')
      toast('success', 'Category added')
      onChanged()
    } catch (error) {
      toast('error', 'The category could not be added', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (category: AccountingCategory): Promise<void> => {
    try {
      await invoke('accounting.categories.save', { id: category.id, name: category.name, kind: category.kind, isActive: !category.isActive })
      onChanged()
    } catch (error) {
      toast('error', 'The category could not be changed', errorMessage(error))
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Categories"
      description="Categories group income and expenses for the reports. Built-in ones can be renamed and deactivated but not removed."
      onClose={onClose}
      footer={
        <Button variant="tertiary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field label="New category" htmlFor="categoryName">
          <TextInput id="categoryName" value={name} onChange={setName} maxLength={80} />
        </Field>
        <Field label="Kind" htmlFor="categoryKind">
          <Select
            id="categoryKind"
            value={kind}
            onChange={(value: string) => setKind(value as AccountingKind)}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' }
            ]}
            ariaLabel="Kind"
          />
        </Field>
        <Button variant="primary" loading={busy} onClick={() => void add()}>
          Add
        </Button>
      </div>

      <ul className="plain-list" style={{ marginTop: 16 }}>
        {categories.map((category) => (
          <li key={category.id} className="plain-list__item">
            <span className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <span>{category.name}</span>
              <Badge tone={ACCOUNTING_KIND_META[category.kind]?.tone ?? 'neutral'}>{ACCOUNTING_KIND_META[category.kind]?.label ?? category.kind}</Badge>
              {category.isSystem ? <span className="muted small">built-in</span> : null}
              {!category.isActive ? <Badge tone="neutral">inactive</Badge> : null}
              {category.usageCount > 0 ? <span className="muted small">{category.usageCount} entries</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void toggle(category)}>
              {category.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function DayCloseDialog({
  open,
  day,
  onClose,
  onChanged
}: {
  open: boolean
  day: DayCloseView | null
  onClose(): void
  onChanged(): void
}): ReactNode {
  const format = useFormatters()
  const [counted, setCounted] = useState(0)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !day) return
    setCounted(day.expectedCashMicro)
    setNote('')
    setReason('')
    // The dialog only resets when it opens or the day changes identity; `day` itself is reloaded
    // constantly by the screen, so depending on the object would wipe the operator's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day?.date])

  const submit = async (): Promise<void> => {
    if (!day) return
    setBusy(true)
    try {
      if (day.isClosed) {
        if (reason.trim().length < 3) {
          toast('warning', 'A reason is required', 'Say why the day is being reopened.')
          setBusy(false)
          return
        }
        await invoke('accounting.reopenDay', { date: day.date, reason: reason.trim() })
        toast('success', `${day.date} reopened`, 'Entries for that day can be corrected, then closed again.')
      } else {
        const closed = await invoke('accounting.closeDay', { date: day.date, countedCashMicro: counted, note: note.trim() === '' ? null : note.trim() })
        toast('success', `${day.date} closed`, closed.varianceMicro === 0 ? 'The drawer matches the ledger.' : `Difference recorded: ${format.money(closed.varianceMicro ?? 0)}.`)
      }
      onChanged()
      onClose()
    } catch (error) {
      toast('error', 'The day could not be updated', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={day?.isClosed ? `Reopen ${day.date}` : `Close ${day?.date ?? ''}`}
      description={
        day?.isClosed
          ? 'Reopening lets entries for that day change again. The reason is kept in the audit log.'
          : `The ledger expects ${format.money(day?.expectedCashMicro ?? 0)} in the drawer. Count it, enter the amount and the difference is recorded.`
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={day?.isClosed ? 'danger' : 'primary'}
            loading={busy}
            disabled={day?.isClosed === true && reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {day?.isClosed ? 'Reopen day' : 'Close day'}
          </Button>
        </>
      }
    >
      {day?.isClosed ? (
        <Field label="Why is the day being reopened?" htmlFor="reopenReason" required>
          <TextArea id="reopenReason" value={reason} onChange={setReason} rows={3} maxLength={300} />
        </Field>
      ) : (
        <div className="grid grid--2">
          <Field label="Cash counted (৳)" htmlFor="countedCash" required>
            <MoneyInput id="countedCash" value={counted} onChange={(value) => setCounted(value ?? 0)} />
          </Field>
          <Field label="Note" htmlFor="closeNote" hint="Explains a difference, e.g. “5 taka short — change for a 100 note”.">
            <TextInput id="closeNote" value={note} onChange={setNote} maxLength={500} />
          </Field>
        </div>
      )}
    </Modal>
  )
}
