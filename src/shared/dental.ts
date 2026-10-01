/**
 * Dental chart model — FDI (ISO 3950) two-digit tooth numbering.
 *
 * Permanent dentition: quadrant 1 (upper right), 2 (upper left), 3 (lower left), 4 (lower right)
 *   e.g. 11 = upper right central incisor … 48 = lower right third molar.
 * Primary dentition: quadrant 5 (upper right), 6 (upper left), 7 (lower left), 8 (lower right)
 *   e.g. 51 = upper right primary central incisor … 85 = lower right primary second molar.
 */

export type Dentition = 'adult' | 'primary'

export interface ToothDef {
  code: string
  quadrant: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  position: number
  arch: 'upper' | 'lower'
  side: 'right' | 'left'
  dentition: Dentition
  name: string
  shortName: string
}

const PERMANENT_NAMES: Record<number, { name: string; short: string }> = {
  1: { name: 'Central incisor', short: 'CI' },
  2: { name: 'Lateral incisor', short: 'LI' },
  3: { name: 'Canine', short: 'C' },
  4: { name: 'First premolar', short: 'PM1' },
  5: { name: 'Second premolar', short: 'PM2' },
  6: { name: 'First molar', short: 'M1' },
  7: { name: 'Second molar', short: 'M2' },
  8: { name: 'Third molar', short: 'M3' }
}

const PRIMARY_NAMES: Record<number, { name: string; short: string }> = {
  1: { name: 'Primary central incisor', short: 'CI' },
  2: { name: 'Primary lateral incisor', short: 'LI' },
  3: { name: 'Primary canine', short: 'C' },
  4: { name: 'Primary first molar', short: 'M1' },
  5: { name: 'Primary second molar', short: 'M2' }
}

function quadrantMeta(quadrant: number): { arch: 'upper' | 'lower'; side: 'right' | 'left'; dentition: Dentition } {
  switch (quadrant) {
    case 1:
    case 5:
      return { arch: 'upper', side: 'right', dentition: quadrant === 5 ? 'primary' : 'adult' }
    case 2:
    case 6:
      return { arch: 'upper', side: 'left', dentition: quadrant === 6 ? 'primary' : 'adult' }
    case 3:
    case 7:
      return { arch: 'lower', side: 'left', dentition: quadrant === 7 ? 'primary' : 'adult' }
    default:
      return { arch: 'lower', side: 'right', dentition: quadrant === 8 ? 'primary' : 'adult' }
  }
}

function buildDentition(dentition: Dentition): ToothDef[] {
  const startQuadrant = dentition === 'adult' ? 1 : 5
  const positions = dentition === 'adult' ? 8 : 5
  const names = dentition === 'adult' ? PERMANENT_NAMES : PRIMARY_NAMES
  const teeth: ToothDef[] = []
  for (let q = startQuadrant; q < startQuadrant + 4; q++) {
    const meta = quadrantMeta(q)
    for (let position = 1; position <= positions; position++) {
      const info = names[position]!
      teeth.push({
        code: `${q}${position}`,
        quadrant: q as ToothDef['quadrant'],
        position,
        arch: meta.arch,
        side: meta.side,
        dentition,
        name: `${meta.side === 'right' ? 'Upper' : 'Lower'} ${meta.side} ${info.name}`.replace('Lower right', 'Lower right').replace('Upper right', 'Upper right'),
        shortName: info.short
      })
    }
  }
  return teeth
}

export const ADULT_TEETH: readonly ToothDef[] = buildDentition('adult')
export const PRIMARY_TEETH: readonly ToothDef[] = buildDentition('primary')

export function teethFor(dentition: Dentition): readonly ToothDef[] {
  return dentition === 'adult' ? ADULT_TEETH : PRIMARY_TEETH
}

const TOOTH_MAP = new Map<string, ToothDef>([...ADULT_TEETH, ...PRIMARY_TEETH].map((t) => [t.code, t]))

export function isToothCode(code: string, dentition?: Dentition): boolean {
  const tooth = TOOTH_MAP.get(code)
  if (!tooth) return false
  return dentition ? tooth.dentition === dentition : true
}

export function toothInfo(code: string): ToothDef | undefined {
  return TOOTH_MAP.get(code)
}

export function toothLabel(code: string): string {
  const tooth = TOOTH_MAP.get(code)
  if (!tooth) return code
  return `${code} · ${tooth.name}`
}

/**
 * Chart rows for rendering: upper arch is reversed (quadrant 1 then 2, position 8 → 1)
 * so the chart is displayed from the patient's right to left, as in clinical practice.
 */
export function chartRows(dentition: Dentition): { upper: ToothDef[]; lower: ToothDef[] } {
  const teeth = teethFor(dentition)
  const upperRight = teeth.filter((t) => t.arch === 'upper' && t.side === 'right').sort((a, b) => b.position - a.position)
  const upperLeft = teeth.filter((t) => t.arch === 'upper' && t.side === 'left').sort((a, b) => a.position - b.position)
  const lowerRight = teeth.filter((t) => t.arch === 'lower' && t.side === 'right').sort((a, b) => b.position - a.position)
  const lowerLeft = teeth.filter((t) => t.arch === 'lower' && t.side === 'left').sort((a, b) => a.position - b.position)
  return { upper: [...upperRight, ...upperLeft], lower: [...lowerLeft, ...lowerRight] }
}

export type ConditionKind = 'finding' | 'treatment' | 'state'

export interface ConditionDef {
  code: string
  label: string
  /** Colour token name resolved by the renderer design system. */
  color: string
  kind: ConditionKind
  /** Whether the condition is currently clinically active by default. */
  activeByDefault: boolean
  description?: string
}

/**
 * Default tooth-condition vocabulary. Clinics may add their own entries through
 * Settings → Clinical (stored in `clinical_findings`), and the chart colours are resolved from the
 * design tokens so a custom condition still renders consistently.
 */
export const DEFAULT_TOOTH_CONDITIONS: readonly ConditionDef[] = [
  { code: 'healthy', label: 'Healthy / sound', color: 'chart-healthy', kind: 'state', activeByDefault: false },
  { code: 'caries', label: 'Caries', color: 'chart-caries', kind: 'finding', activeByDefault: true },
  { code: 'gingival_caries', label: 'Gingival / cervical caries', color: 'chart-caries-deep', kind: 'finding', activeByDefault: true },
  { code: 'recurrent_caries', label: 'Recurrent caries', color: 'chart-caries-deep', kind: 'finding', activeByDefault: true },
  { code: 'pulpitis', label: 'Pulpitis', color: 'chart-pulp', kind: 'finding', activeByDefault: true },
  { code: 'periapical', label: 'Periapical pathology', color: 'chart-pulp', kind: 'finding', activeByDefault: true },
  { code: 'periodontitis', label: 'Periodontitis / pocket', color: 'chart-perio', kind: 'finding', activeByDefault: true },
  { code: 'gingivitis', label: 'Gingivitis', color: 'chart-perio', kind: 'finding', activeByDefault: true },
  { code: 'impacted', label: 'Impacted tooth', color: 'chart-impacted', kind: 'finding', activeByDefault: true },
  { code: 'dry_socket', label: 'Dry socket', color: 'chart-danger', kind: 'finding', activeByDefault: true },
  { code: 'abrasion', label: 'Abrasion', color: 'chart-wear', kind: 'finding', activeByDefault: true },
  { code: 'attrition', label: 'Attrition', color: 'chart-wear', kind: 'finding', activeByDefault: true },
  { code: 'erosion', label: 'Erosion', color: 'chart-wear', kind: 'finding', activeByDefault: true },
  { code: 'fracture', label: 'Fractured tooth', color: 'chart-danger', kind: 'finding', activeByDefault: true },
  { code: 'missing', label: 'Missing / extracted', color: 'chart-missing', kind: 'state', activeByDefault: true },
  { code: 'unerupted', label: 'Unerupted', color: 'chart-missing', kind: 'state', activeByDefault: true },
  { code: 'restoration', label: 'Restoration / filling', color: 'chart-restored', kind: 'treatment', activeByDefault: true },
  { code: 'crown', label: 'Crown', color: 'chart-restored', kind: 'treatment', activeByDefault: true },
  { code: 'bridge', label: 'Bridge abutment/pontic', color: 'chart-restored', kind: 'treatment', activeByDefault: true },
  { code: 'root_canal', label: 'Root canal treated', color: 'chart-restored', kind: 'treatment', activeByDefault: true },
  { code: 'implant', label: 'Implant', color: 'chart-restored', kind: 'treatment', activeByDefault: true },
  { code: 'extraction', label: 'Extraction', color: 'chart-extraction', kind: 'treatment', activeByDefault: false },
  { code: 'orthodontic', label: 'Orthodontic appliance', color: 'chart-ortho', kind: 'treatment', activeByDefault: true },
  { code: 'other', label: 'Other finding', color: 'chart-other', kind: 'finding', activeByDefault: true }
]

const CONDITION_MAP = new Map(DEFAULT_TOOTH_CONDITIONS.map((c) => [c.code, c]))

export function conditionInfo(code: string): ConditionDef | undefined {
  return CONDITION_MAP.get(code)
}

export function conditionLabel(code: string): string {
  return CONDITION_MAP.get(code)?.label ?? code
}

export type ChartEntryStatus = 'active' | 'resolved' | 'historic'

export interface ChartEntry {
  toothCode: string
  dentition: Dentition
  conditionCode: string
  treatmentCode: string | null
  status: ChartEntryStatus
  note: string | null
}

/** Parse a free-text tooth list ("11, 12, 36" / "11-13") into validated FDI codes. */
export function parseToothList(input: string, dentition?: Dentition): string[] {
  const codes = new Set<string>()
  const parts = input.split(/[,\s;]+/).filter(Boolean)
  for (const part of parts) {
    const rangeMatch = /^(\d{2})-(\d{2})$/.exec(part)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start <= end) {
        for (let code = start; code <= end; code++) {
          const text = String(code).padStart(2, '0')
          if (isToothCode(text, dentition)) codes.add(text)
        }
      }
      continue
    }
    const normalized = part.padStart(2, '0')
    if (isToothCode(normalized, dentition)) codes.add(normalized)
  }
  return [...codes].sort()
}
