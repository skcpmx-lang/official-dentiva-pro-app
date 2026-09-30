/**
 * Permission catalog and default roles.
 *
 * This file is the single source of truth for authorisation codes. Both the main-process guard and
 * the renderer's permission-aware UI read from it, so a code can never exist in the UI without a
 * matching enforcement point.
 */

export interface PermissionDef {
  code: string
  module: PermissionModule
  label: string
  description: string
}

export type PermissionModule =
  | 'patients'
  | 'clinical'
  | 'prescriptions'
  | 'appointments'
  | 'queue'
  | 'billing'
  | 'payments'
  | 'accounting'
  | 'inventory'
  | 'suppliers'
  | 'staff'
  | 'users'
  | 'roles'
  | 'audit'
  | 'settings'
  | 'printing'
  | 'backups'
  | 'data'
  | 'reports'

function perm(module: PermissionModule, action: string, label: string, description: string): PermissionDef {
  return { code: `${module}.${action}`, module, label, description }
}

export const PERMISSIONS: readonly PermissionDef[] = [
  perm('patients', 'view', 'View patients', 'Open patient lists, profiles and clinical history'),
  perm('patients', 'create', 'Create patients', 'Register new patients'),
  perm('patients', 'edit', 'Edit patients', 'Modify patient details and clinical background'),
  perm('patients', 'archive', 'Archive patients', 'Archive or restore patient records'),
  perm('patients', 'export', 'Export patients', 'Export patient data to CSV or PDF'),

  perm('clinical', 'view', 'View clinical records', 'Read visits, findings and dental chart'),
  perm('clinical', 'create', 'Create clinical records', 'Record visits, findings and treatments performed'),
  perm('clinical', 'edit', 'Edit clinical records', 'Amend clinical records (audited)'),
  perm('clinical', 'delete', 'Delete clinical records', 'Remove draft clinical records'),

  perm('prescriptions', 'view', 'View prescriptions', 'Read prescriptions and medicine history'),
  perm('prescriptions', 'create', 'Create prescriptions', 'Write and save prescriptions'),
  perm('prescriptions', 'edit', 'Edit prescriptions', 'Amend saved prescriptions (audited)'),
  perm('prescriptions', 'print', 'Print prescriptions', 'Print or export prescriptions as PDF'),
  perm('prescriptions', 'export', 'Export prescriptions', 'Export prescription data'),
  perm('prescriptions', 'templates', 'Manage prescription templates', 'Create and edit favourite medicine sets'),

  perm('appointments', 'view', 'View appointments', 'Open appointment calendar and lists'),
  perm('appointments', 'create', 'Create appointments', 'Book patient appointments'),
  perm('appointments', 'edit', 'Edit appointments', 'Reschedule or update appointments'),
  perm('appointments', 'cancel', 'Cancel appointments', 'Cancel or mark no-show'),
  perm('appointments', 'delete', 'Delete appointments', 'Delete cancelled appointment entries'),

  perm('queue', 'view', 'View queue', 'See the waiting queue'),
  perm('queue', 'manage', 'Manage queue', 'Add, call, start, complete or skip queue entries'),

  perm('billing', 'view', 'View invoices', 'Read invoices, dues and financial summaries'),
  perm('billing', 'create', 'Create invoices', 'Raise invoices for treatments'),
  perm('billing', 'edit', 'Edit invoices', 'Amend unpaid invoices'),
  perm('billing', 'void', 'Void invoices', 'Void invoices with a recorded reason'),
  perm('billing', 'discount_override', 'Override discount limits', 'Apply discounts beyond the role limit'),
  perm('billing', 'export', 'Export invoices', 'Export invoice data'),

  perm('payments', 'view', 'View payments', 'Read payment and refund history'),
  perm('payments', 'create', 'Record payments', 'Record payments against invoices'),
  perm('payments', 'edit', 'Edit payments', 'Amend payment details (audited)'),
  perm('payments', 'void', 'Void payments', 'Void an incorrect payment entry'),
  perm('payments', 'refund', 'Issue refunds', 'Record refunds against paid invoices'),
  perm('payments', 'export', 'Export payments', 'Export payment and collection data'),

  perm('accounting', 'view', 'View accounting', 'Read income and expense entries'),
  perm('accounting', 'create', 'Create accounting entries', 'Record income and expenses'),
  perm('accounting', 'edit', 'Edit accounting entries', 'Amend accounting entries (audited)'),
  perm('accounting', 'delete', 'Void accounting entries', 'Void income or expense entries'),
  perm('accounting', 'reports', 'View financial reports', 'Open revenue, expense and receivables reports'),
  perm('accounting', 'export', 'Export financial data', 'Export financial reports and ledgers'),

  perm('inventory', 'view', 'View inventory', 'Read stock levels, batches and movements'),
  perm('inventory', 'create', 'Create inventory items', 'Add new stock items'),
  perm('inventory', 'edit', 'Edit inventory items', 'Modify item details and thresholds'),
  perm('inventory', 'adjust', 'Adjust stock', 'Record stock in/out, adjustments, damage and expiry'),
  perm('inventory', 'delete', 'Delete inventory items', 'Archive inventory items'),

  perm('suppliers', 'view', 'View suppliers', 'Read supplier details and purchase history'),
  perm('suppliers', 'manage', 'Manage suppliers', 'Create and edit suppliers and purchases'),

  perm('staff', 'view', 'View staff', 'Read staff records'),
  perm('staff', 'manage', 'Manage staff', 'Create and edit staff records'),

  perm('users', 'view', 'View users', 'Read user accounts'),
  perm('users', 'manage', 'Manage users', 'Create users, set roles and reset passwords'),

  perm('roles', 'view', 'View roles', 'Read roles and permission matrix'),
  perm('roles', 'manage', 'Manage roles', 'Create roles and change permissions'),

  perm('audit', 'view', 'View audit log', 'Read the system audit trail'),
  perm('audit', 'export', 'Export audit log', 'Export audit records'),

  perm('settings', 'view', 'View settings', 'Open application settings'),
  perm('settings', 'modify', 'Modify settings', 'Change clinic, prescription, invoice and system settings'),

  perm('printing', 'print', 'Print documents', 'Print prescriptions, invoices and reports'),
  perm('printing', 'configure', 'Configure printing', 'Manage printers, paper sizes and profiles'),

  perm('backups', 'create', 'Create backups', 'Run manual and scheduled backups'),
  perm('backups', 'restore', 'Restore backups', 'Restore clinic data from a backup package'),
  perm('backups', 'configure', 'Configure backups', 'Set backup folder, schedule and retention'),

  perm('reports', 'view', 'View reports', 'Open operational and clinical reports'),
  perm('reports', 'financial', 'View financial reports', 'Open revenue, expense, dues and stock-value reports'),

  perm('data', 'export', 'Export data', 'Export data sets for external use'),
  perm('data', 'import', 'Import data', 'Import patient and item data from CSV'),
  perm('data', 'maintenance', 'Run maintenance', 'Integrity checks, vacuum and archiving'),
  perm('data', 'wipe', 'Erase clinic data', 'Delete all clinic data (irreversible)')
] as const

export const PERMISSION_CODES: readonly string[] = PERMISSIONS.map((p) => p.code)
const PERMISSION_SET = new Set(PERMISSION_CODES)

export function isKnownPermission(code: string): boolean {
  return PERMISSION_SET.has(code)
}

export interface RoleDefinition {
  code: string
  name: string
  description: string
  isSystem: boolean
  /** `'*'` grants every permission in the catalog. */
  permissions: readonly string[] | '*'
  /** Maximum discount a holder of this role may apply without `billing.discount_override` (bp). */
  maxDiscountBasisPoints?: number
}

const CLINICAL_ROLE = [
  'patients.view',
  'patients.create',
  'patients.edit',
  'clinical.view',
  'clinical.create',
  'clinical.edit',
  'prescriptions.view',
  'prescriptions.create',
  'prescriptions.edit',
  'prescriptions.print',
  'prescriptions.templates',
  'appointments.view',
  'queue.view',
  'queue.manage',
  'inventory.view',
  'printing.print',
  'reports.view'
] as const

export const DEFAULT_ROLES: readonly RoleDefinition[] = [
  {
    code: 'owner',
    name: 'Owner',
    description: 'Full control of the clinic including data erasure and restore',
    isSystem: true,
    permissions: '*'
  },
  {
    code: 'administrator',
    name: 'Administrator',
    description: 'Operational administration: users, settings, backups and every workflow',
    isSystem: true,
    permissions: PERMISSION_CODES.filter((code) => code !== 'data.wipe')
  },
  {
    code: 'dentist',
    name: 'Dentist',
    description: 'Clinical work: patients, visits, dental chart, treatments and prescriptions',
    isSystem: true,
    permissions: CLINICAL_ROLE,
    maxDiscountBasisPoints: 2500
  },
  {
    code: 'receptionist',
    name: 'Receptionist',
    description: 'Front desk: registration, appointments, queue, invoicing and collections',
    isSystem: true,
    permissions: [
      'patients.view',
      'patients.create',
      'patients.edit',
      'appointments.view',
      'appointments.create',
      'appointments.edit',
      'appointments.cancel',
      'queue.view',
      'queue.manage',
      'billing.view',
      'billing.create',
      'billing.edit',
      'billing.export',
      'payments.view',
      'payments.create',
      'payments.export',
      'printing.print',
      'reports.view'
    ],
    maxDiscountBasisPoints: 500
  },
  {
    code: 'dental_assistant',
    name: 'Dental Assistant',
    description: 'Chairside support: patient lookup, clinical reading and queue handling',
    isSystem: true,
    permissions: ['patients.view', 'clinical.view', 'prescriptions.view', 'appointments.view', 'queue.view', 'queue.manage', 'inventory.view', 'printing.print']
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Collections, expenses and financial reporting without clinical access',
    isSystem: true,
    permissions: [
      'patients.view',
      'billing.view',
      'billing.export',
      'payments.view',
      'payments.create',
      'payments.edit',
      'payments.refund',
      'payments.export',
      'accounting.view',
      'accounting.create',
      'accounting.edit',
      'accounting.delete',
      'accounting.reports',
      'accounting.export',
      'reports.view',
      'reports.financial',
      'data.export',
      'printing.print'
    ]
  },
  {
    code: 'inventory_manager',
    name: 'Inventory Manager',
    description: 'Stock, batches, suppliers and purchase expenditure',
    isSystem: true,
    permissions: [
      'inventory.view',
      'inventory.create',
      'inventory.edit',
      'inventory.adjust',
      'suppliers.view',
      'suppliers.manage',
      'reports.view',
      'data.export',
      'printing.print'
    ]
  }
]

export function expandRolePermissions(role: RoleDefinition | { permissions: readonly string[] | '*' }): string[] {
  if (role.permissions === '*') return [...PERMISSION_CODES]
  return role.permissions.filter((code) => PERMISSION_SET.has(code))
}

export interface Actor {
  userId: number
  username: string
  fullName: string
  roleId: number
  roleCode: string
  permissions: ReadonlySet<string>
  maxDiscountBasisPoints: number | null
}

export function can(actor: Pick<Actor, 'permissions'>, code: string): boolean {
  return actor.permissions.has(code)
}

/** Maximum discount basis points an actor may apply. `null` when the actor may apply any discount. */
export function discountLimitFor(actor: Pick<Actor, 'permissions' | 'maxDiscountBasisPoints'>): number | null {
  if (actor.permissions.has('billing.discount_override')) return null
  return actor.maxDiscountBasisPoints ?? 0
}
