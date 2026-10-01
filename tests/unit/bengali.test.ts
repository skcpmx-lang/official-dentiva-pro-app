import { describe, expect, it } from 'vitest'
import { bengaliDigitsToAscii, foldForSearch, hasBengali, normalizeBengali, normalizePhone } from '@shared/bengali'

/**
 * Bengali text handling.
 *
 * Requirement §5 is blunt: Bangla names, addresses, clinical text and prescriptions must save, search,
 * print and restore without corruption — never `????`. These helpers are where that is decided: text is
 * stored in NFC with invisible characters removed, and every searchable column keeps a fold produced
 * here.
 */

describe('normalisation', () => {
  it('composes Bengali text into NFC so two spellings of one name match', () => {
    const decomposed = '\u09A1\u09BE\u0995\u09CD\u09A4\u09BE\u09B0' // ডাক্তার with a split vowel sign
    expect(normalizeBengali(decomposed).normalize('NFC')).toBe(normalizeBengali(decomposed))
    expect(normalizeBengali(decomposed)).toBe(decomposed.normalize('NFC'))
  })

  it('strips zero-width joiners and non-joiners that would otherwise break equality', () => {
    expect(normalizeBengali('রাকিব\u200d হাসান')).toBe('রাকিব হাসান')
    expect(normalizeBengali('\u200b\u200c\u200d\u200e\u200f\ufeff\u2060')).toBe('')
    expect(normalizeBengali('')).toBe('')
  })

  it('recognises Bengali script and leaves Latin alone', () => {
    expect(hasBengali('টাঙ্গাইল')).toBe(true)
    expect(hasBengali('Tangail')).toBe(false)
    expect(hasBengali('Tangail টাঙ্গাইল')).toBe(true)
    expect(hasBengali('')).toBe(false)
    // Assamese/Bengali block boundaries are part of the same Unicode range.
    expect(hasBengali('অ')).toBe(true)
  })
})

describe('search folding', () => {
  it('folds case, whitespace and punctuation but keeps Bengali diacritics', () => {
    expect(foldForSearch('  Rakib   Hasan ')).toBe('rakib hasan')
    expect(foldForSearch('রাকিব হাসান')).toBe('রাকিব হাসান')
    expect(foldForSearch('দাঁতের ব্যথা।')).toBe('দাঁতের ব্যথা.')
    expect(foldForSearch('“X-ray” – report')).toBe('"x-ray" - report')
    expect(foldForSearch('')).toBe('')
    expect(foldForSearch('   ')).toBe('')
  })

  it('makes a substring search over a Bengali name predictable', () => {
    const stored = foldForSearch('মোঃ রাকিব হাসান')
    expect(stored.includes('রাকিব')).toBe(true)
    expect(stored.includes('হাসান')).toBe(true)
    // The fold is what the LIKE query matches against, so a differently spaced query still hits.
    expect(stored.includes(foldForSearch('  রাকিব '))).toBe(true)
  })

  it('collapses non-breaking spaces so pasted text cannot defeat a search', () => {
    expect(foldForSearch('রাকিব\u00a0হাসান')).toBe('রাকিব হাসান')
    expect(foldForSearch('রাকিব\tহাসান\n')).toBe('রাকিব হাসান')
  })
})

describe('digits and phone numbers', () => {
  it('converts Bengali digits to ASCII', () => {
    expect(bengaliDigitsToAscii('০১২৩৪৫৬৭৮৯')).toBe('0123456789')
    expect(bengaliDigitsToAscii('ফোন: ০১৭১১-০০০০০০')).toBe('ফোন: 01711-000000')
    expect(bengaliDigitsToAscii('no digits')).toBe('no digits')
  })

  it('normalises phone numbers so one patient is not registered twice', () => {
    expect(normalizePhone('01712345678')).toBe('01712345678')
    expect(normalizePhone('01711-000000')).toBe('01711000000')
    expect(normalizePhone('+880 1711 000000')).toBe('+8801711000000')
    expect(normalizePhone('০১৭১১-০০০০০০')).toBe('01711000000')
    expect(normalizePhone('(017) 11 00 00 00')).toBe('01711000000')
    // A stray plus in the middle is dropped rather than stored.
    expect(normalizePhone('017+11')).toBe('01711')
    expect(normalizePhone('')).toBe('')
  })
})
