/**
 * Bengali (Bangla) text handling.
 *
 * Bengali is stored normalised (Unicode NFC) with zero-width characters removed, and every searchable
 * column keeps a `*_fold` companion produced by `foldForSearch()`. That keeps storage compact and
 * search predictable without a dependency on external collation data.
 */

// The class deliberately includes zero-width joiners/non-joiners (U+200B–U+200D): they are invisible
// characters that must be stripped before search folding, not a copy/paste mistake.
// eslint-disable-next-line no-misleading-character-class
const ZERO_WIDTH = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060]/g
const BENGALI_RANGE = /[\u0980-\u09FF]/
const WHITESPACE = /[\s\u00A0]+/g

/** Common Bangla punctuation variants normalised to their ASCII equivalent for searchability. */
const PUNCTUATION_FOLD: ReadonlyArray<[RegExp, string]> = [
  [/[।॥]/g, '.'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/[–—]/g, '-']
]

export function normalizeBengali(input: string): string {
  if (!input) return ''
  return input.normalize('NFC').replace(ZERO_WIDTH, '')
}

export function hasBengali(input: string): boolean {
  return BENGALI_RANGE.test(input)
}

export function containsBengaliLetters(input: string): boolean {
  return /[\u0985-\u09B9\u09CE\u09DC-\u09DF]/.test(input)
}

/**
 * Produce the searchable fold of a display string: NFC, zero-width stripped, trimmed, inner
 * whitespace collapsed, Latin characters lower-cased and Bangla punctuation normalised.
 * Bengali letters keep their diacritics so that যুক্তাক্ষর words remain matchable by substring.
 */
export function foldForSearch(input: string): string {
  if (!input) return ''
  let value = normalizeBengali(input)
  for (const [pattern, replacement] of PUNCTUATION_FOLD) value = value.replace(pattern, replacement)
  value = value.replace(WHITESPACE, ' ').trim().toLowerCase()
  return value
}

/** Digits of both scripts: Bengali ০-৯ → ASCII 0-9 (phones, codes, amounts typed in Bangla). */
export function bengaliDigitsToAscii(input: string): string {
  return input.replace(/[\u09E6-\u09EF]/g, (ch) => String(ch.charCodeAt(0) - 0x09e6))
}

export function asciiDigitsToBengali(input: string): string {
  return input.replace(/[0-9]/g, (ch) => String.fromCharCode(0x09e6 + Number(ch)))
}

/** Normalise a phone number for comparison/storage: Bangla digits → ASCII, keep leading + and digits. */
export function normalizePhone(input: string): string {
  const digits = bengaliDigitsToAscii(input).replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? `+${digits.slice(1).replace(/\+/g, '')}` : digits.replace(/\+/g, '')
}

const BD_MOBILE_PATTERN = /^(\+?880|0)1[3-9]\d{8}$/

export function isValidBangladeshiPhone(input: string): boolean {
  const normalized = normalizePhone(input)
  if (normalized === '') return false
  return BD_MOBILE_PATTERN.test(normalized) || /^0\d{6,10}$/.test(normalized) || /^\+?\d{8,15}$/.test(normalized)
}

/** Split a bilingual name for display: primary display name plus optional Bengali name. */
export function bilingualDisplay(english: string | null | undefined, bengali: string | null | undefined): string {
  const primary = (english ?? '').trim()
  const secondary = (bengali ?? '').trim()
  if (primary && secondary) return `${primary} (${secondary})`
  return primary || secondary
}

/** Count Bengali grapheme clusters (codepoints joined by virama) for layout decisions such as fitting a print column. */
export function bengaliGlyphLength(input: string): number {
  return [...normalizeBengali(input)].length
}

export const BENGALI_FONT_STACK =
  "'Noto Sans Bengali', 'Nirmala UI', 'Vrinda', 'SolaimanLipi', 'Kalpurush', 'Siyam Rupali', sans-serif"
export const LATIN_FONT_STACK = "'Inter', 'Segoe UI', 'Nirmala UI', system-ui, sans-serif"
/** Mixed-content stack: Latin glyphs first, Bengali fallback resolved per character. */
export const MIXED_FONT_STACK = `${LATIN_FONT_STACK.replace(/,$/, '')}, ${BENGALI_FONT_STACK}`
