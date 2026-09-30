import type { z } from 'zod'
import type { CHANNELS, ChannelOutput } from '@shared/contracts'

/**
 * Renderer-side aliases derived directly from the IPC contracts. Using `ChannelOutput` means a change
 * to a channel's schema immediately surfaces as a type error in the screens that consume it, instead
 * of silently rendering a field that no longer exists.
 */

type InputOf<C extends keyof typeof CHANNELS> = z.input<(typeof CHANNELS)[C]['input']>

export type BootstrapResult = ChannelOutput<'app.bootstrap'>
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
export type UserInput = InputOf<'users.save'>
export type Role = ChannelOutput<'roles.list'>[number]
export type RoleInput = InputOf<'roles.save'>
export type RolePermissionDef = ChannelOutput<'roles.permissions'>[number]
export type SettingDef = ChannelOutput<'settings.defs'>[number]
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
