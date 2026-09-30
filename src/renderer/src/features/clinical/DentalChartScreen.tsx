import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, History, Smile, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Segmented, Toolbar } from '../../components/ui/primitives'
import { Field, Select, TextInput, type SelectOption } from '../../components/ui/form'
import { Drawer, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import { ToothGrid } from './ToothGrid'
import type { ChartEntry } from '../../lib/types'

type DentitionChoice = 'adult' | 'primary'

/**
 * Dental chart.
 *
 * The chart is data-driven: conditions come from the `clinical_findings` table, so a clinic can add its
 * own vocabulary (Settings → clinical conditions are seeded with the standard set). Selecting a
 * condition and clicking a tooth records the finding on that tooth; the same tooth/condition pair is
 * updated rather than duplicated, and resolving keeps the history row.
 */
export function DentalChartScreen(): ReactNode {
  const params = useParams()
  const patientId = Number(params.patientId)
  const format = useFormatters()
  const canEdit = usePermission(['clinical.create', 'clinical.edit'])
  const canDelete = usePermission('clinical.edit')

  const [dentition, setDentition] = useState<DentitionChoice>('adult')
  const [conditionChoice, setConditionChoice] = useState('')
  const [note, setNote] = useState('')
  const [busyTooth, setBusyTooth] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyTooth, setHistoryTooth] = useState<string | null>(null)

  const chart = useInvoke('chart.get', { patientId })
  const summary = useInvoke('patients.summary', { id: patientId })

  const conditions = useMemo(() => chart.data?.conditions ?? [], [chart.data])
  const activeConditions = useMemo(() => conditions.filter((condition) => condition.isActive && condition.appliesTooth), [conditions])
  const palette = useMemo(
    () => ({
      findings: activeConditions.filter((condition) => condition.category === 'finding'),
      treatments: activeConditions.filter((condition) => condition.category === 'treatment'),
      states: activeConditions.filter((condition) => condition.category === 'state')
    }),
    [activeConditions]
  )

  const conditionOptions = useMemo<SelectOption[]>(
    () => [
      ...palette.findings.map((condition) => ({ value: condition.code, label: `Finding · ${condition.name}` })),
      ...palette.treatments.map((condition) => ({ value: condition.code, label: `Treatment · ${condition.name}` })),
      ...palette.states.map((condition) => ({ value: condition.code, label: `State · ${condition.name}` }))
    ],
    [palette]
  )

  /*
   * A condition is always both shown and in force: the operator's own choice, or the palette's first
   * finding until they make one. Deriving it while rendering rather than assigning it from an effect is
   * deliberate — the select is a native control that displays its first option when its value matches
   * none, so while the assignment was pending the screen showed “Caries” selected, the “Mark a tooth
   * resolved” button stayed disabled and the first click on a tooth answered “Choose a condition
   * first”. Deriving keeps what the screen shows and what a tooth click records the same value, always.
   */
  const chosen = conditionOptions.some((option) => option.value === conditionChoice)
  const conditionCode = chosen ? conditionChoice : conditionOptions[0]?.value ?? ''

  const history = useInvoke('chart.history', { patientId, toothCode: historyTooth ?? undefined }, { enabled: historyOpen })

  const record = async (toothCode: string, status: 'active' | 'resolved' | 'historic'): Promise<void> => {
    if (conditionCode === '') {
      toast('warning', 'Choose a condition first', 'Pick the finding or treatment you want to record.')
      return
    }
    setBusyTooth(toothCode)
    try {
      await invoke('chart.setEntry', {
        patientId,
        visitId: null,
        toothCode,
        dentition,
        conditionCode,
        treatmentCode: null,
        status,
        note: note.trim() === '' ? null : note.trim()
      })
      await chart.reload()
      toast('success', `Tooth ${toothCode} updated`, status === 'resolved' ? 'Marked as resolved.' : 'Recorded on the chart.')
    } catch (error) {
      toast('error', 'The chart could not be updated', errorMessage(error))
    } finally {
      setBusyTooth(null)
    }
  }

  const remove = async (entry: ChartEntry): Promise<void> => {
    const answer = await confirmDialog({
      title: `Remove “${entry.conditionName}” from tooth ${entry.toothCode}?`,
      message: 'Removing a chart entry deletes it from the record. If the condition was treated, mark it resolved instead so the history stays complete.',
      confirmLabel: 'Remove entry',
      danger: true
    })
    if (!answer.confirmed) return
    try {
      await invoke('chart.removeEntry', { id: entry.id, patientId })
      await chart.reload()
      toast('success', 'Chart entry removed')
    } catch (error) {
      toast('error', 'The entry could not be removed', errorMessage(error))
    }
  }

  if (!Number.isFinite(patientId) || patientId <= 0) {
    return (
      <div className="page">
        <PageHeader title="Dental chart" subtitle="Patient not found." />
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title={summary.data ? `Dental chart — ${summary.data.patient.fullName}` : 'Dental chart'}
        subtitle={summary.data ? `${summary.data.patient.code}${summary.data.patient.ageLabel ? ` · ${summary.data.patient.ageLabel}` : ''}` : 'Loading patient…'}
        breadcrumbs={
          <Link to={`/patients/${patientId}`} className="row small" style={{ gap: 6, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> {summary.data?.patient.fullName ?? 'Patient record'}
          </Link>
        }
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button variant="tertiary" icon={<ArrowLeft size={16} />} onClick={() => window.history.back()}>
              Back
            </Button>
            <Button
              variant="secondary"
              icon={<History size={16} />}
              onClick={() => {
                setHistoryTooth(null)
                setHistoryOpen(true)
              }}
            >
              Chart history
            </Button>
          </div>
        }
      />

      <div className="chart-panel">
        <Card>
          <CardHeader
            title="Odontogram"
            icon={<Smile size={17} />}
            subtitle="Click a tooth to record the selected condition against it."
            actions={
              <Segmented
                value={dentition}
                ariaLabel="Dentition"
                onChange={(value: string) => setDentition(value as DentitionChoice)}
                options={[
                  { value: 'adult', label: 'Adult (11–48)' },
                  { value: 'primary', label: 'Primary (51–85)' }
                ]}
              />
            }
          />
          <CardBody>
            <ToothGrid
              dentition={dentition}
              byTooth={chart.data?.byTooth ?? {}}
              selected={[]}
              disabled={!canEdit || busyTooth !== null}
              caption={(code) => (chart.data?.byTooth[code]?.status === 'active' ? undefined : undefined)}
              onSelect={(code) => void record(code, 'active')}
            />
            {(chart.data?.counts.length ?? 0) > 0 ? (
              <div className="chart-legend" style={{ marginTop: 'var(--sp-4)' }}>
                {chart.data?.counts.map((entry) => (
                  <span key={entry.conditionCode} className="chart-legend__item">
                    <span className="chart-legend__swatch" style={{ background: `var(--${conditions.find((c) => c.code === entry.conditionCode)?.color ?? 'chart-other'})` }} />
                    {entry.conditionName} · {entry.count}
                  </span>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="stack">
          <Card>
            <CardHeader title="Record a condition" subtitle="Choose what to record, then click the tooth." />
            <CardBody>
              <div className="stack">
                <Select value={conditionCode} onChange={setConditionChoice} ariaLabel="Condition" options={conditionOptions} />
                <Field label="Note (optional)" htmlFor="chartNote" hint="Printed in the chart history and visible on the tooth tooltip.">
                  <TextInput id="chartNote" value={note} onChange={setNote} maxLength={300} />
                </Field>
                <div className="row" style={{ gap: 8 }}>
                  <Button variant="secondary" disabled={conditionCode === ''} onClick={() => void record(dentition === 'adult' ? '11' : '51', 'resolved')}>
                    Mark a tooth resolved
                  </Button>
                </div>
                <p className="muted small">
                  “Mark a tooth resolved” applies to the first tooth of the selected arch — use it after choosing the tooth from the chart itself when you want a
                  different one. Hover a tooth to see what is recorded.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Current chart" subtitle={`${chart.data?.entries.length ?? 0} entr(y/ies) recorded`} />
            <CardBody>
              {chart.data && chart.data.entries.length > 0 ? (
                <ul className="plain-list">
                  {chart.data.entries.map((entry) => (
                    <li key={entry.id} className="plain-list__item">
                      <span className="stack" style={{ gap: 2 }}>
                        <span>
                          <span className="num link-strong">{entry.toothCode}</span> · {entry.conditionName}{' '}
                          {entry.status === 'resolved' ? <Badge tone="neutral">resolved</Badge> : <Badge tone="warning">active</Badge>}
                        </span>
                        <span className="muted small">
                          {format.dateTime(entry.recordedAt)}
                          {entry.recordedByName ? ` · ${entry.recordedByName}` : ''}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                      </span>
                      {canDelete ? (
                        <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} aria-label={`Remove ${entry.conditionName} from tooth ${entry.toothCode}`} onClick={() => void remove(entry)} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No chart entries yet. Pick a condition and click a tooth to start the chart.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Patient" subtitle="Quick reference while charting." />
            <CardBody>
              {summary.data ? (
                <dl className="detail-list">
                  <div>
                    <dt>Patient</dt>
                    <dd>
                      <Link className="link" to={`/patients/${patientId}`}>
                        {summary.data.patient.fullName}
                      </Link>
                      {summary.data.patient.fullNameBn ? <span className="bn muted"> · {summary.data.patient.fullNameBn}</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Allergies</dt>
                    <dd>{summary.data.allergies ?? 'None recorded'}</dd>
                  </div>
                  <div>
                    <dt>Medical history</dt>
                    <dd>{summary.data.medicalHistory ?? 'None recorded'}</dd>
                  </div>
                  <div>
                    <dt>Last visit</dt>
                    <dd>{summary.data.lastVisit ? `${summary.data.lastVisit.visitNo} · ${format.date(summary.data.lastVisit.at)}` : 'No visits yet'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="muted">Loading patient…</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Drawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={historyTooth ? `Chart history — tooth ${historyTooth}` : 'Chart history'}
      >
        <div className="stack">
          <Toolbar>
            <span className="muted small">Every change is kept, so you can see when a condition was recorded and when it was resolved.</span>
          </Toolbar>
          {(history.data ?? []).length === 0 ? (
            <p className="muted">No history recorded yet.</p>
          ) : (
            <ul className="plain-list">
              {(history.data ?? []).map((entry) => (
                <li key={entry.id} className="plain-list__item">
                  <span className="stack" style={{ gap: 2 }}>
                    <span>
                      <span className="num link-strong">{entry.toothCode}</span> · {entry.conditionName} · <Badge tone={entry.status === 'active' ? 'warning' : 'neutral'}>{entry.status}</Badge>
                    </span>
                    <span className="muted small">
                      {format.dateTime(entry.recordedAt)}
                      {entry.recordedByName ? ` · ${entry.recordedByName}` : ''}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setHistoryTooth(entry.toothCode)}>
                    Tooth
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Drawer>
    </div>
  )
}

