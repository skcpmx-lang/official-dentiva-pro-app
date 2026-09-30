#!/usr/bin/env node
/**
 * Audit: no placeholder functionality.
 *
 * The specification forbids shipping stubs, dead navigation, fake buttons and "coming soon" notices.
 * This script reads the production sources (never tests) and fails on the markers that announce
 * unfinished work, plus on empty handlers that would render a control which does nothing.
 *
 * It deliberately ignores the words that look like markers but are not: SQL parameter lists are called
 * placeholders, and a text input has a `placeholder` attribute.
 *
 * Usage: node scripts/audit-placeholders.mjs [--quiet]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sources = [join(root, 'src')]
const extensions = new Set(['.ts', '.tsx', '.css', '.html'])

/** Markers that announce unfinished work, whatever the context. */
const MARKERS = [
  { pattern: /\bTODO\b/, label: 'TODO marker' },
  { pattern: /\bFIXME\b/, label: 'FIXME marker' },
  { pattern: /\bXXX\b/, label: 'XXX marker' },
  { pattern: /\bHACK\b/, label: 'HACK marker' }
]

/** Phrases that would reach a user or describe missing behaviour. */
const PHRASES = [
  /coming soon/i,
  /not (yet )?implemented/i,
  /will be implemented/i,
  /coming in a future/i,
  /for a future release/i,
  /lorem ipsum/i,
  /placeholder (page|screen|function|handler|button|data)/i,
  /dummy (data|handler|function|page)/i
]

/** Handlers that exist but do nothing. An empty arrow body is only legitimate when it returns a value. */
const EMPTY_HANDLER = /=>\s*\{\s*\}/

const problems = []

function scanFile(path) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const where = `${relative(root, path)}:${index + 1}`
    for (const marker of MARKERS) {
      if (marker.pattern.test(line)) problems.push(`${where}  ${marker.label}: ${line.trim().slice(0, 120)}`)
    }
    for (const phrase of PHRASES) {
      if (phrase.test(line)) problems.push(`${where}  placeholder wording: ${line.trim().slice(0, 120)}`)
    }
    if (EMPTY_HANDLER.test(line) && !/return|throw/.test(line)) {
      problems.push(`${where}  empty handler: ${line.trim().slice(0, 120)}`)
    }
  })
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      if (entry === 'node_modules') continue
      walk(path)
      continue
    }
    if (!extensions.has(extname(entry))) continue
    scanFile(path)
  }
}

for (const source of sources) walk(source)

if (problems.length > 0) {
  console.error(`audit-placeholders: ${problems.length} problem(s) found. Production code must not contain unfinished work.`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

if (!process.argv.includes('--quiet')) {
  console.log('audit-placeholders: clean — no TODO/FIXME markers, no placeholder wording, no empty handlers in src/.')
}
