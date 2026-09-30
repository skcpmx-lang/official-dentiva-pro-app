import type { z } from 'zod'
import type { CHANNELS, ChannelOutput } from '@shared/contracts'

/**
 * Renderer-side aliases derived directly from the IPC contracts. Using `ChannelOutput` means a change
 * to a channel's schema immediately surfaces as a type error in the screens that consume it, instead
 * of silently rendering a field that no longer exists.
 */

type InputOf<C extends keyof typeof CHANNELS> = z.input<(typeof CHANNELS)[C]['input']>

export type BootstrapResult = ChannelOutput<'app.bootstrap'>
export type StartupState = ChannelOutput<'app.startupState'>
export type SessionSummary = ChannelOutput<'session.refresh'>
export type SessionState = ChannelOutput<'session.state'>
export type ClinicProfile = ChannelOutput<'settings.clinic'>
export type ActivationState = ChannelOutput<'activation.state'>
export type SetupStatus = ChannelOutput<'setup.status'>
export type SetupSummary = ChannelOutput<'setup.summary'>
export type Dentist = ChannelOutput<'dentists.list'>[number]
export type DentistInput = InputOf<'dentists.save'>
export type Staff = ChannelOutput<'staff.list'>['items'][number]
export type User = ChannelOutput<'users.list'>[number]
export type StaffInput = InputOf<'staff.save'>
export type UserInput = InputOf<'users.save'>
export type Role = ChannelOutput<'roles.list'>[number]
export type RoleInput = InputOf<'roles.save'>
export type RolePermissionDef = ChannelOutput<'roles.permissions'>[number]
export type SettingDef = ChannelOutput<'settings.defs'>[number]
export type PreferenceMap = ChannelOutput<'preferences.get'>
export type RecentEntry = ChannelOutput<'preferences.recent'>[number]
export type AuditEntry = ChannelOutput<'audit.list'>['entries'][number]
export type AuditFilterInput = InputOf<'audit.list'>
export type Patient = ChannelOutput<'patients.list'>['items'][number]
export type PatientFilterInput = InputOf<'patients.list'>
export type PatientInput = InputOf<'patients.save'>
export type PatientSummary = ChannelOutput<'patients.summary'>
export type PatientFinancials = ChannelOutput<'patients.financials'>
export type TimelineEntry = ChannelOutput<'patients.timeline'>['items'][number]
export type PatientAttachment = ChannelOutput<'attachments.list'>[number]
export type Referral = ChannelOutput<'referrals.list'>[number]
export type ReferralInput = InputOf<'referrals.save'>
export type DashboardSummary = ChannelOutput<'dashboard.summary'>
export type QueueCounters = ChannelOutput<'dashboard.queue'>
export type AboutInfo = ChannelOutput<'app.about'>
export type DiagnosticsReport = ChannelOutput<'app.diagnostics'>
export type EnvironmentInfo = ChannelOutput<'app.environment'>
export type ActionResult = ChannelOutput<'auth.logout'>
export type LoginResult = ChannelOutput<'auth.login'>

/** Date-range presets accepted by the shared range schemas (mirrors `zRangePreset`). */
export type RangePreset = NonNullable<AuditFilterInput['range']>['preset']

/* ------------------------------------------------------------------ clinical */

export type Treatment = ChannelOutput<'treatments.list'>[number]
export type TreatmentInput = InputOf<'treatments.save'>
export type VisitSummary = ChannelOutput<'visits.get'>
export type VisitListItem = ChannelOutput<'visits.list'>['items'][number]
export type VisitFilterInput = InputOf<'visits.list'>
export type VisitInput = InputOf<'visits.save'>
export type VisitTreatmentInput = InputOf<'visits.treatments.add'>
export type VisitTreatment = VisitSummary['treatments'][number]
export type VisitFinding = VisitSummary['findings'][number]
export type VisitStatus = VisitSummary['status']

export type ChartView = ChannelOutput<'chart.get'>
export type ChartEntry = ChartView['entries'][number]
export type ChartCondition = ChartView['conditions'][number]
export type ChartEntryInput = InputOf<'chart.setEntry'>

export type Prescription = ChannelOutput<'prescriptions.get'>
export type PrescriptionListItem = ChannelOutput<'prescriptions.list'>['items'][number]
export type PrescriptionInput = InputOf<'prescriptions.save'>
export type Medicine = Prescription['medicines'][number]
export type MedicineInput = InputOf<'prescriptions.templates.save'>['medicines'][number]
export type PrescriptionTemplate = ChannelOutput<'prescriptions.templates.list'>[number]
export type MedicineHistoryEntry = ChannelOutput<'prescriptions.medicines'>[number]

/* ---------------------------------------------------------------- scheduling */

export type Appointment = ChannelOutput<'appointments.list'>['items'][number]
export type AppointmentInput = InputOf<'appointments.save'>
export type AppointmentFilterInput = InputOf<'appointments.list'>
export type AppointmentDay = ChannelOutput<'appointments.day'>
export type AppointmentStatus = Appointment['status']
export type QueueEntry = ChannelOutput<'queue.board'>['items'][number]
export type QueueBoard = ChannelOutput<'queue.board'>
export type QueueStatus = QueueEntry['status']

/* ------------------------------------------------------------------- billing */

export type Invoice = ChannelOutput<'invoices.get'>
export type InvoiceListItem = ChannelOutput<'invoices.list'>['items'][number]
export type InvoiceInput = InputOf<'invoices.save'>
export type InvoiceLineInput = InputOf<'invoices.save'>['lines'][number]
export type InvoiceFilterInput = InputOf<'invoices.list'>
export type BillableLine = ChannelOutput<'invoices.billable'>[number]
export type Payment = ChannelOutput<'payments.list'>['items'][number]
export type PaymentInput = InputOf<'payments.add'>
export type PaymentFilterInput = InputOf<'payments.list'>

/* ----------------------------------------------------------------- inventory */

export type InventoryItem = ChannelOutput<'inventory.get'>['item']
export type InventoryListItem = ChannelOutput<'inventory.list'>['items'][number]
export type InventoryItemInput = InputOf<'inventory.save'>
export type InventoryCategory = InventoryItemInput['category']
export type InventoryDetail = ChannelOutput<'inventory.get'>
export type InventoryBatch = InventoryDetail['batches'][number]
export type StockMovement = InventoryDetail['movements'][number]
export type MovementInput = InputOf<'inventory.movement.add'>
export type MovementType = MovementInput['movementType']
export type InventoryFilterInput = InputOf<'inventory.list'>
export type Supplier = ChannelOutput<'suppliers.list'>[number]
export type SupplierInput = InputOf<'suppliers.save'>
export type Purchase = ChannelOutput<'purchases.get'>
export type PurchaseListItem = ChannelOutput<'purchases.list'>['items'][number]
export type PurchaseInput = InputOf<'purchases.save'>
export type PurchaseLineInput = PurchaseInput['lines'][number]

/* --------------------------------------------------------------- accounting */

export type AccountingEntry = ChannelOutput<'accounting.entries'>['items'][number]
export type AccountingEntryInput = InputOf<'accounting.entry.save'>
export type AccountingEntryFilter = InputOf<'accounting.entries'>
export type AccountingCategory = ChannelOutput<'accounting.categories'>[number]
export type AccountingSummary = ChannelOutput<'accounting.summary'>
export type DayCloseView = ChannelOutput<'accounting.dayClose'>
export type AccountingKind = AccountingEntry['kind']

/* ------------------------------------------------------------------ reports */

export type ReportResult = ChannelOutput<'reports.run'>
export type ReportCatalogEntry = ChannelOutput<'reports.catalog'>[number]
export type ReportCell = ReportResult['rows'][number][string]

/* ------------------------------------------------------------------ printing */

export type PrinterStatus = ChannelOutput<'printing.printers'>
export type PrintDocumentInfo = ChannelOutput<'printing.documents'>[number]
export type PrintProfile = ChannelOutput<'printing.profiles'>[number]
export type PrintProfileInput = InputOf<'printing.profile.save'>
export type PrintRequestInput = InputOf<'printing.render'>
export type RenderedPrintDocument = ChannelOutput<'printing.render'>
export type PrintOutcome = ChannelOutput<'printing.print'>
export type PrintHistoryEntry = ChannelOutput<'printing.history'>['items'][number]
export type PrintPaperClass = ChannelOutput<'printing.documents'>[number]['paperClasses'][number]

/* -------------------------------------------------------------------- backup */

export type BackupRecord = ChannelOutput<'backups.list'>['items'][number]
export type BackupStatus = ChannelOutput<'backups.status'>
export type BackupValidation = ChannelOutput<'backups.validate'>
export type ScannedBackup = ChannelOutput<'backups.scan'>['items'][number]
export type RestoreEntry = ChannelOutput<'backups.restores'>['items'][number]
export type BackupKind = BackupRecord['kind']
export type BackupSettingsInput = InputOf<'backups.saveSettings'>

/* ------------------------------------------------------- notifications & search */

export type NotificationItem = ChannelOutput<'notifications.list'>['items'][number]
export type NotificationCounts = ChannelOutput<'notifications.summary'>
export type NotificationFilter = 'all' | 'unread' | 'critical' | 'dismissed'
export type SearchGroup = ChannelOutput<'search.global'>['groups'][number]
export type SearchResultItem = SearchGroup['items'][number]
export type SearchGroupKey = SearchGroup['key']
