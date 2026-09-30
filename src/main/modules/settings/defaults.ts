import type { DateFormat, TimeFormat } from '@shared/datetime'

/**
 * Application settings: key → default value, plus the type used for validation.
 * Settings are stored as TEXT rows in the `settings` table; `settingsService` enforces these types,
 * so a corrupted or hand-edited value can never reach the UI as an unexpected type.
 */
export type SettingType = 'string' | 'number' | 'boolean' | 'json' | 'time' | 'dateFormat' | 'timeFormat' | 'enum'

export interface SettingDef {
  key: string
  type: SettingType
  default: string
  label: string
  description?: string
  /** Allowed values for `enum` settings. */
  values?: readonly string[]
  min?: number
  max?: number
}

export const SETTING_DEFS: readonly SettingDef[] = [
  // Practice
  { key: 'practice.currency', type: 'enum', default: 'BDT', label: 'Currency', values: ['BDT'], description: 'Dentiva Pro operates in Bangladeshi Taka only.' },
  { key: 'practice.dateFormat', type: 'dateFormat', default: 'dd/MM/yyyy', label: 'Date format' },
  { key: 'practice.timeFormat', type: 'timeFormat', default: '12h', label: 'Time format', values: ['12h', '24h'] },
  { key: 'practice.openingTime', type: 'time', default: '10:00', label: 'Clinic opening time' },
  { key: 'practice.closingTime', type: 'time', default: '20:00', label: 'Clinic closing time' },
  { key: 'practice.weeklyClosedDays', type: 'json', default: '[]', label: 'Weekly closed days', description: 'Weekday numbers (0 = Sunday … 6 = Saturday) when the clinic is closed.' },
  { key: 'practice.appointmentDuration', type: 'number', default: '20', label: 'Default appointment duration (minutes)', min: 5, max: 240 },
  { key: 'practice.slotStep', type: 'number', default: '10', label: 'Appointment slot interval (minutes)', min: 5, max: 120 },
  { key: 'practice.autoLockMinutes', type: 'enum', default: '10', label: 'Auto-lock after inactivity', values: ['0', '5', '10', '15', '30'], description: '0 disables automatic locking.' },

  // Prescription
  { key: 'prescription.footer', type: 'string', default: '', label: 'Prescription footer message' },
  { key: 'prescription.followUpDays', type: 'number', default: '7', label: 'Default follow-up interval (days)', min: 0, max: 365 },
  { key: 'prescription.includeAdvice', type: 'boolean', default: 'true', label: 'Print structured advice section' },
  { key: 'prescription.showDiagnosis', type: 'boolean', default: 'true', label: 'Print diagnosis on prescription' },

  // Invoice
  { key: 'invoice.numberPrefix', type: 'string', default: 'INV', label: 'Invoice number prefix' },
  { key: 'invoice.dueDays', type: 'number', default: '0', label: 'Payment due (days after issue)', min: 0, max: 365 },
  { key: 'invoice.showDentist', type: 'boolean', default: 'false', label: 'Print dentist name on invoice' },
  { key: 'invoice.footer', type: 'string', default: 'Thank you for choosing our clinic.', label: 'Invoice footer message' },
  { key: 'invoice.allowOverpayment', type: 'boolean', default: 'false', label: 'Allow payments above the invoice total (advance credit)' },

  // Clinical
  { key: 'clinical.defaultDentition', type: 'enum', default: 'adult', label: 'Default dental chart dentition', values: ['adult', 'primary'] },
  { key: 'clinical.requireDentistOnVisit', type: 'boolean', default: 'true', label: 'Require a dentist on every visit' },

  // Inventory
  { key: 'inventory.lowStockAlerts', type: 'boolean', default: 'true', label: 'Show low stock alerts' },
  { key: 'inventory.expiryWarningDays', type: 'number', default: '30', label: 'Near-expiry warning (days)', min: 1, max: 365 },

  // Security
  { key: 'security.passwordMinLength', type: 'number', default: '8', label: 'Minimum password length', min: 6, max: 64 },
  { key: 'security.passwordExpiryDays', type: 'number', default: '0', label: 'Force password change every (days, 0 = never)', min: 0, max: 3650 },
  { key: 'security.maxFailedAttempts', type: 'number', default: '5', label: 'Failed sign-in attempts before temporary lock', min: 3, max: 20 },
  { key: 'security.lockoutMinutes', type: 'number', default: '15', label: 'Temporary lock duration (minutes)', min: 1, max: 1440 },

  // Printing
  { key: 'print.defaultPaperClass', type: 'enum', default: 'a4', label: 'Default paper size', values: ['a4', 'a5', 'thermal', 'mini', 'custom'] },
  { key: 'print.thermalWidthMm', type: 'enum', default: '80', label: 'Thermal roll width', values: ['58', '80'] },
  { key: 'print.copies', type: 'number', default: '1', label: 'Default number of copies', min: 1, max: 10 },
  { key: 'print.openPreviewBeforePrinting', type: 'boolean', default: 'true', label: 'Always open print preview first' },

  // Backup
  { key: 'backup.folder', type: 'string', default: '', label: 'Backup folder', description: 'Empty means the default Documents folder is used.' },
  { key: 'backup.frequencyDays', type: 'enum', default: '7', label: 'Automatic backup frequency', values: ['0', '7', '15', '30'], description: '0 disables automatic backups.' },
  { key: 'backup.retention', type: 'number', default: '10', label: 'Automatic backups to keep', min: 1, max: 100 },
  { key: 'backup.includeAttachments', type: 'boolean', default: 'true', label: 'Include attachments in scheduled backups' },
  { key: 'backup.lastRunAt', type: 'string', default: '', label: 'Last automatic backup' },

  // Notifications
  { key: 'notifications.overdueInvoiceDays', type: 'number', default: '0', label: 'Show invoice as overdue after (days)', min: 0, max: 90 },
  { key: 'notifications.missedAppointmentAlerts', type: 'boolean', default: 'true', label: 'Alert on missed appointments' },
  { key: 'notifications.backupReminder', type: 'boolean', default: 'true', label: 'Remind when a backup is due' },

  // Interface
  { key: 'ui.density', type: 'enum', default: 'comfortable', label: 'Table density', values: ['comfortable', 'compact'] },
  { key: 'ui.reducedMotion', type: 'boolean', default: 'false', label: 'Reduce interface animation' },
  { key: 'ui.sidebarCollapsed', type: 'boolean', default: 'false', label: 'Start with the sidebar collapsed' },
  { key: 'ui.landingPage', type: 'enum', default: 'dashboard', label: 'Start page after sign-in', values: ['dashboard', 'appointments', 'queue', 'patients'] },
  { key: 'ui.rememberUsername', type: 'boolean', default: 'true', label: 'Remember the last username on the sign-in screen' },

  // Setup bookkeeping (written by the setup wizard, never edited directly)
  { key: 'setup.completedAt', type: 'string', default: '', label: 'Setup completed at' },
  { key: 'setup.appVersion', type: 'string', default: '', label: 'Version used during setup' }
] as const

export const SETTING_DEFAULTS: Record<string, string> = Object.fromEntries(SETTING_DEFS.map((def) => [def.key, def.default]))

const DEF_MAP = new Map(SETTING_DEFS.map((def) => [def.key, def]))

export function settingDef(key: string): SettingDef | undefined {
  return DEF_MAP.get(key)
}

export function isKnownSetting(key: string): boolean {
  return DEF_MAP.has(key)
}

export const DEFAULT_DATE_FORMAT: DateFormat = 'dd/MM/yyyy'
export const DEFAULT_TIME_FORMAT: TimeFormat = '12h'

/** Backup frequency options presented in Settings. */
export const BACKUP_FREQUENCY_OPTIONS = [
  { value: '0', label: 'Disabled' },
  { value: '7', label: 'Every 7 days' },
  { value: '15', label: 'Every 15 days' },
  { value: '30', label: 'Every 30 days' }
] as const

export const AUTO_LOCK_OPTIONS = [
  { value: '0', label: 'Disabled' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' }
] as const

const GROUP_LABELS: Record<string, string> = {
  practice: 'Clinic & practice',
  prescription: 'Prescription',
  invoice: 'Invoice & billing',
  clinical: 'Clinical',
  inventory: 'Inventory',
  security: 'Users & security',
  print: 'Printing',
  backup: 'Backup',
  notifications: 'Notifications',
  ui: 'Interface',
  setup: 'Setup'
}

export function settingGroup(key: string): string {
  const prefix = key.split('.')[0] ?? 'practice'
  return GROUP_LABELS[prefix] ?? 'Other'
}
