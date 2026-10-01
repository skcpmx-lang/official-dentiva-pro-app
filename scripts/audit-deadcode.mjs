#!/usr/bin/env node
/**
 * Audit: no unreachable exports.
 *
 * The specification forbids dead code, and the usual way dead code appears in a codebase like this one is
 * an export that nothing imports any more — a helper a screen stopped using, a constant from a deleted
 * feature. This script lists every exported name in the production sources and checks whether anything
 * else in the repository (application, tests, tooling) refers to it.
 *
 * It is a heuristic: a name is only reported when it is mentioned nowhere else in the repository, so a
 * helper used inside its own file is never flagged. Anything deliberately exported for external reasons
 * belongs in ALLOWED with a written reason, so the exception is visible in review rather than silent.
 *
 * Known debt is listed in `scripts/deadcode-baseline.txt`: declarations that exist today and are to be
 * removed before release. The script fails on any declaration that is not in that file, so dead code can
 * never grow again, and `--list` prints the remaining debt for the cleanup pass. The baseline is a
 * shrinking list by design — it is never added to without a written reason.
 *
 * Usage: node scripts/audit-deadcode.mjs [--quiet] [--list]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'scripts', 'deadcode-baseline.txt')

/** Tracked debt: declarations that already existed when the audit was introduced. */
function readBaseline() {
  try {
    return new Set(
      readFileSync(baselinePath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
    )
  } catch {
    return new Set()
  }
}

/** Names kept exported on purpose. Each entry needs a reason a reviewer can check. */
const ALLOWED = new Map([
  /* Channels are addressed by string id; the per-module contract objects are aggregated in
     `src/shared/contracts/index.ts` and their members are read through the CHANNELS map. */
])

const SCAN_DIRECTORIES = ['src']
const REFERENCE_DIRECTORIES = ['src', 'tests', 'scripts']
const extensions = new Set(['.ts', '.tsx', '.mjs'])
const indexPattern = /(^|\/)index\.tsx?$/

const DECLARATIONS = [
  /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^export\s+const\s+([A-Za-z_$][\w$]*)/,
  /^export\s+let\s+([A-Za-z_$][\w$]*)/,
  /^export\s+class\s+([A-Za-z_$][\w$]*)/,
  /^export\s+interface\s+([A-Za-z_$][\w$]*)/,
  /^export\s+type\s+([A-Za-z_$][\w$]*)/,
  /^export\s+enum\s+([A-Za-z_$][\w$]*)/
]

function walk(directory, bucket) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      if (entry === 'node_modules') continue
      walk(path, bucket)
      continue
    }
    if (extensions.has(extname(entry))) bucket.push(path)
  }
}

const productionFiles = []
for (const directory of SCAN_DIRECTORIES) walk(join(root, directory), productionFiles)

const referenceFiles = []
for (const directory of REFERENCE_DIRECTORIES) walk(join(root, directory), referenceFiles)

const contents = new Map()
for (const file of referenceFiles) contents.set(file, readFileSync(file, 'utf8'))

const declarations = new Map()
for (const file of productionFiles) {
  const text = contents.get(file) ?? readFileSync(file, 'utf8')
  contents.set(file, text)
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const pattern of DECLARATIONS) {
      const match = line.match(pattern)
      if (!match) continue
      const name = match[1]
      const entry = declarations.get(name) ?? []
      entry.push({ file, line: index + 1, isIndex: indexPattern.test(file) })
      declarations.set(name, entry)
    }
  })
}

const baseline = readBaseline()
const problems = []
const known = []
let ambiguous = 0
for (const [name, entries] of [...declarations.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
  if (ALLOWED.has(name)) continue

  /* A name declared in several files (a contract type mirrored in the renderer's type aliases) cannot be
     attributed to one place, so this heuristic does not judge it. */
  const declaringFiles = new Set(entries.map((entry) => entry.file))
  if (declaringFiles.size > 1) {
    ambiguous += 1
    continue
  }

  /* Count every mention in the repository and subtract the declaration lines. A symbol used only inside
     its own file still has readers and is not dead code; one mentioned nowhere at all is. */
  const word = new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g')
  let mentions = 0
  for (const file of referenceFiles) {
    const text = contents.get(file) ?? ''
    mentions += (text.match(word) ?? []).length
  }
  const declarationLines = entries.filter((entry) => entry.file === entries[0].file).length
  if (mentions - declarationLines <= 0) {
    const entry = entries[0]
    const finding = `${relative(root, entry.file)}:${entry.line}  ${name} is declared but never used anywhere in the repository`
    if (baseline.has(name)) known.push(finding)
    else problems.push(finding)
  }
}

if (process.argv.includes('--list')) {
  console.log(`audit-deadcode: ${known.length} tracked declaration(s) still to remove:`)
  for (const entry of known) console.log(`  ${entry}`)
  if (problems.length > 0) {
    console.error(`audit-deadcode: ${problems.length} new declaration(s) appeared that are not tracked:`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  process.exit(0)
}

if (problems.length > 0) {
  console.error(`audit-deadcode: ${problems.length} new unreachable declaration(s) found.`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('Remove the declaration, or add it to scripts/deadcode-baseline.txt and to the debt list in docs/COMPLETION_STATUS.md.')
  process.exit(1)
}

if (!process.argv.includes('--quiet')) {
  console.log(
    `audit-deadcode: no new dead code (${declarations.size} names checked, ${ambiguous} declared in more than one ` +
      `file and not judged); ${known.length} tracked declaration(s) remain to be removed.`
  )
}
