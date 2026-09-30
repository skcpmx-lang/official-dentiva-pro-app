import { useState, type ReactNode } from 'react'
import { Cpu, FolderOpen, HeartHandshake, Info, Mail, RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { formatBytes, formatDateTime } from '../../lib/format'
import { usePermission } from '../../store/appStore'

const AUTHOR_EMAIL = 'helloiamshohan@gmail.com'
const OPEN_FOLDER_KINDS = [
  { kind: 'data', label: 'Data folder' },
  { kind: 'logs', label: 'Log folder' },
  { kind: 'exports', label: 'Exports folder' },
  { kind: 'backups', label: 'Backups folder' },
  { kind: 'attachments', label: 'Attachments folder' }
] as const

/**
 * About Dentiva Pro.
 *
 * Shows the build identity, the runtime environment, the author's support details and the third-party
 * licences shipped with the build. Diagnostics and the folder shortcuts are real actions: the report is
 * plain text the clinic can copy into a support e-mail, and the folder buttons open Windows Explorer.
 */
export function AboutScreen(): ReactNode {
  const about = useInvoke('app.about', {})
  const environment = useInvoke('app.environment', {})
  const canSeeDiagnostics = usePermission('settings.modify')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [notices, setNotices] = useState<{ name: string, licence: string, text: string } | null>(null)

  const openFolder = async (kind: (typeof OPEN_FOLDER_KINDS)[number]['kind']): Promise<void> => {
    try {
      await invoke('app.openDataFolder', { kind })
    } catch (error) {
      toast('error', 'The folder could not be opened', errorMessage(error))
    }
  }

  const runDiagnostics = async (): Promise<void> => {
    setBusy(true)
    try {
      const diagnostics = await invoke('app.diagnostics', {})
      const lines = [
        `Dentiva Pro ${diagnostics.appVersion} · schema v${diagnostics.schemaVersion}`,
        `Database size: ${formatBytes(diagnostics.databaseSizeBytes)}`,
        `Patients: ${diagnostics.patientCount} · visits: ${diagnostics.visitCount} · invoices: ${diagnostics.invoiceCount}`,
        `Attachments: ${diagnostics.attachmentCount} (${formatBytes(diagnostics.attachmentBytes)})`,
        `Audit entries: ${diagnostics.auditEntryCount}`,
        `Last backup: ${diagnostics.lastBackupAt ? formatDateTime(diagnostics.lastBackupAt) : 'none recorded'}`,
        `Integrity check: ${diagnostics.integrityOk ? 'passed' : 'FAILED'}`,
        `Foreign keys: ${diagnostics.foreignKeysOk ? 'consistent' : 'VIOLATIONS FOUND'}`,
        `Uptime: ${Math.round(diagnostics.uptimeMs / 60000)} minute(s)`,
        `Data folder: ${diagnostics.dataDirectory}`,
        `Log folder: ${diagnostics.logDirectory}`,
        '',
        'Table sizes',
        ...diagnostics.tableSizes.map((entry) => `  ${entry.table}: ${entry.rows.toLocaleString()}`)
      ]
      setReport(lines.join('\n'))
    } catch (error) {
      toast('error', 'Diagnostics could not be collected', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const build = about.data?.build ?? environment.data?.build
  const machine = environment.data?.machine

  return (
    <div className="page">
      <PageHeader
        title="About Dentiva Pro"
        subtitle="Offline dental-clinic management for Bangladesh — no internet connection is required or used, ever."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="tertiary"
              icon={<RefreshCw size={16} />}
              onClick={() => {
                void about.reload()
                void environment.reload()
              }}
            >
              Refresh
            </Button>
            <Button variant="secondary" icon={<Cpu size={16} />} loading={busy} onClick={() => void runDiagnostics()}>
              Diagnostics
            </Button>
          </div>
        }
      />

      <div className="grid grid--2">
        <Card>
          <CardHeader title="Build" icon={<Info size={17} />} subtitle="Recorded in every backup manifest and printed document footer." />
          <CardBody>
            {about.data && build ? (
              <dl className="detail-list">
                <div>
                  <dt>Product</dt>
                  <dd>{about.data.product}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>
                    <Badge tone="info">v{about.data.version}</Badge>
                  </dd>
                </div>
                <div>
                  <dt>Build number</dt>
                  <dd className="num small">{build.buildNumber}</dd>
                </div>
                <div>
                  <dt>Source revision</dt>
                  <dd className="num small">{build.gitSha}</dd>
                </div>
                <div>
                  <dt>Built</dt>
                  <dd>{build.builtAt}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd className="num small">
                    Electron {build.electron} · Chromium {build.chromium} · Node {build.node}
                  </dd>
                </div>
                <div>
                  <dt>Database schema</dt>
                  <dd className="num small">v{about.data.schemaVersion}</dd>
                </div>
                <div>
                  <dt>Licence</dt>
                  <dd>
                    {about.data.licence.activatedAt ? (
                      <>
                        <Badge tone="success">Activated</Badge>
                        <span className="muted small"> {formatDateTime(about.data.licence.activatedAt)}</span>
                      </>
                    ) : (
                      <Badge tone="warning">Not activated</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Dentiva machine id</dt>
                  <dd className="num small">{about.data.licence.machineId}</dd>
                </div>
                {about.data.licence.activatedBy ? (
                  <div>
                    <dt>Activated by</dt>
                    <dd>{about.data.licence.activatedBy}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="muted">Reading build information…</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Environment" icon={<Cpu size={17} />} subtitle="Everything below stays on this computer." />
          <CardBody>
            {environment.data && machine ? (
              <>
                <dl className="detail-list">
                  <div>
                    <dt>Computer</dt>
                    <dd className="num small">{machine.hostname}</dd>
                  </div>
                  <div>
                    <dt>Operating system</dt>
                    <dd>
                      {machine.platform} {machine.osVersion} ({machine.arch})
                    </dd>
                  </div>
                  <div>
                    <dt>Locale / time zone</dt>
                    <dd className="num small">
                      {machine.locale} · {machine.timezone}
                    </dd>
                  </div>
                  <div>
                    <dt>Displays</dt>
                    <dd className="num small">
                      {machine.displays.map((display) => `${display.width}×${display.height} @${display.scaleFactor}x`).join(' · ') || 'unknown'}
                    </dd>
                  </div>
                  <div>
                    <dt>Printers detected</dt>
                    <dd>{machine.printersAvailable ? 'Yes' : 'No printer reported — printing can still produce PDF.'}</dd>
                  </div>
                  <div>
                    <dt>Data folder</dt>
                    <dd className="num small" style={{ wordBreak: 'break-all' }}>
                      {environment.data.dataDirectory}
                    </dd>
                  </div>
                  <div>
                    <dt>Backup folder</dt>
                    <dd className="num small" style={{ wordBreak: 'break-all' }}>
                      {environment.data.defaultBackupDirectory}
                    </dd>
                  </div>
                  <div>
                    <dt>Exports folder</dt>
                    <dd className="num small" style={{ wordBreak: 'break-all' }}>
                      {environment.data.exportsDirectory}
                    </dd>
                  </div>
                </dl>
                <div className="row" style={{ gap: 8, marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  {OPEN_FOLDER_KINDS.map((entry) => (
                    <Button key={entry.kind} size="sm" variant="tertiary" icon={<FolderOpen size={15} />} onClick={() => void openFolder(entry.kind)}>
                      {entry.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Reading environment information…</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Author and support" icon={<HeartHandshake size={17} />} subtitle="Dentiva Pro is developed and supported in Bangladesh." />
          <CardBody>
            <dl className="detail-list">
              <div>
                <dt>Author</dt>
                <dd>{about.data?.author.name ?? 'Shohan Khan'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  <a className="link" href={`mailto:${about.data?.author.email ?? AUTHOR_EMAIL}`}>
                    <Mail size={14} aria-hidden /> {about.data?.author.email ?? AUTHOR_EMAIL}
                  </a>
                </dd>
              </div>
              <div>
                <dt>Support</dt>
                <dd>Send the diagnostics report together with a description of the problem and, if relevant, the backup file.</dd>
              </div>
            </dl>
            <p className="muted small" style={{ marginTop: 'var(--sp-3)' }}>
              Dental records are clinical documents. Keep the data folder on an encrypted drive where possible and store backups off the
              workstation — ideally one copy in the cloud drive of your choice and one on removable media.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Third-party notices"
            icon={<ShieldCheck size={17} />}
            subtitle={about.data ? `${about.data.dependencies.length} libraries · all open source` : 'Loading…'}
          />
          <CardBody flush>
            {about.data ? (
              <div className="table-scroll">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th>Library</th>
                      <th>Version</th>
                      <th>Licence</th>
                      <th>Used for</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {about.data.dependencies.map((dependency) => (
                      <tr key={`${dependency.name}@${dependency.version}`}>
                        <td>{dependency.name}</td>
                        <td className="num small">{dependency.version}</td>
                        <td>
                          <Badge tone="neutral">{dependency.licence}</Badge>
                        </td>
                        <td className="muted small">{dependency.purpose}</td>
                        <td>
                          {about.data?.notices.some((notice) => notice.name === dependency.name) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setNotices(about.data?.notices.find((notice) => notice.name === dependency.name) ?? null)
                              }
                            >
                              Licence text
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Loading licence information…</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={report !== null}
        size="lg"
        title="Diagnostics report"
        description="Copy this text into a support message. It contains no patient data."
        onClose={() => setReport(null)}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setReport(null)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!report) return
                try {
                  await navigator.clipboard.writeText(report)
                  toast('success', 'Report copied', 'Paste it into an e-mail to ' + AUTHOR_EMAIL)
                } catch {
                  toast('warning', 'Copying was blocked by the system', 'Select the text below and copy it manually.')
                }
              }}
            >
              Copy to clipboard
            </Button>
          </>
        }
      >
        <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>
          {report}
        </pre>
        {canSeeDiagnostics ? (
          <p className="muted small">
            Integrity and foreign-key checks are executed against the live database. A failed check is reported here immediately and recorded in the
            audit log.
          </p>
        ) : null}
      </Modal>

      <Modal
        open={notices !== null}
        size="lg"
        title={notices ? `${notices.name} — ${notices.licence}` : 'Licence'}
        onClose={() => setNotices(null)}
        footer={
          <Button variant="tertiary" onClick={() => setNotices(null)}>
            Close
          </Button>
        }
      >
        <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>
          {notices?.text ?? ''}
        </pre>
      </Modal>
    </div>
  )
}
