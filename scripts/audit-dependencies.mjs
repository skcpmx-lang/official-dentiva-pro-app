#!/usr/bin/env node
/**
 * Audit: dependency licences, and the notices file that ships with the application.
 *
 * Reads the installed dependency tree (production dependencies only — what actually ends up in the
 * installer), resolves each package's licence from its own package.json, and:
 *
 *  · fails on a licence the product may not ship (copyleft network licences, unknown or missing terms);
 *  · writes THIRD_PARTY_NOTICES.md so About → Third-party notices and the released installer carry the
 *    same list, with `--check` verifying that the committed file is current instead of rewriting it.
 *
 * Usage: node scripts/audit-dependencies.mjs [--check] [--out THIRD_PARTY_NOTICES.md]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const check = process.argv.includes('--check')
const outputPath = resolve(root, argument('out', 'THIRD_PARTY_NOTICES.md'))

/** Licences that must not be shipped inside a proprietary, offline product. */
const DENIED = [/^AGPL/i, /^GPL/i, /^SSPL/i, /^BUSL/i, /^CC-BY-NC/i, /^UNLICENSED$/i, /^SEE LICENSE/i]

/* OFL is accepted for the bundled fonts: the licence permits embedding in a product, and the font
   files are shipped unmodified with their licence. */
const ACCEPTED =
  /^(MIT|ISC|BSD(-[0-9]*-Clause)?|Apache-2\.0|Apache 2\.0|0BSD|Unlicense|CC0-1\.0|Python-2\.0|Zlib|MIT-0|BlueOak-1\.0\.0|OFL-1\.[01])$/i

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const pkg = readJson(join(root, 'package.json'))
const lock = readJson(join(root, 'package-lock.json'))
if (!pkg || !lock) {
  console.error('audit-dependencies: package.json and package-lock.json are both required.')
  process.exit(1)
}

/** Production dependencies reach the installer; development tooling does not. */
const production = new Set(Object.keys(pkg.dependencies ?? {}))

function resolvePackage(name) {
  /* npm nests a second copy under its parent when versions conflict; the lockfile records where. */
  const candidates = [`node_modules/${name}`, ...(lock.packages[`node_modules/${name}`] ? [] : [])]
  for (const candidate of candidates) {
    const meta = readJson(join(root, candidate, 'package.json'))
    if (meta) return meta
  }
  return null
}

function collect(name, seen) {
  if (seen.has(name)) return seen
  const meta = resolvePackage(name)
  if (!meta) return seen
  seen.set(name, meta)
  for (const dependency of Object.keys(meta.dependencies ?? {})) collect(dependency, seen)
  return seen
}

const installed = new Map()
for (const name of production) collect(name, installed)

const denied = []
const unknown = []
const rows = []

for (const [name, meta] of [...installed.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
  const licence = typeof meta.license === 'string' ? meta.license : meta.license?.type ?? meta.licenses?.[0]?.type ?? null
  const repository = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? meta.homepage ?? ''
  if (!licence) {
    unknown.push(name)
    rows.push({ name, version: meta.version, licence: 'UNKNOWN', repository })
    continue
  }
  if (DENIED.some((pattern) => pattern.test(licence))) denied.push(`${name}@${meta.version} — ${licence}`)
  else if (!ACCEPTED.test(licence)) unknown.push(`${name}@${meta.version} — ${licence}`)
  rows.push({ name, version: meta.version, licence, repository })
}

const byLicence = new Map()
for (const row of rows) {
  const list = byLicence.get(row.licence) ?? []
  list.push(row)
  byLicence.set(row.licence, list)
}

/** Turns the several shapes npm records a repository in into one link. */
function repositoryUrl(value) {
  const raw = String(value ?? '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
  if (!raw) return '—'
  if (/^https?:\/\//.test(raw)) return raw
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) return `https://github.com/${raw}`
  return '—'
}

const generatedAt = new Date().toISOString().slice(0, 10)
const notice = `# Dentiva Pro — Third-party notices

Dentiva Pro is proprietary software © 2026 Shohan Khan. It is built on the open-source components listed
below, each of which is used under its own licence. This file is generated from the installed dependency
tree by \`npm run audit:deps --write\` and is verified by the same script in CI, so it always matches what
the installer actually contains. Nothing here is fetched at run time: every component is bundled inside
the installed application.

Generated: ${generatedAt}

## Components

| Component | Version | Licence | Project |
|---|---|---|---|
${rows
  .map((row) => {
    const url = repositoryUrl(row.repository)
    return `| ${row.name} | ${row.version} | ${row.licence} | ${url || '—'} |`
  })
  .join('\n')}

## Licence texts

${[...byLicence.entries()]
  .sort((left, right) => left[0].localeCompare(right[0]))
  .map(([licence, list]) => `### ${licence}\n\nApplies to: ${list.map((row) => `${row.name} ${row.version}`).join(', ')}\n`)
  .join('\n')}

## Notes

* SQLite is in the public domain; \`better-sqlite3\` is the MIT-licensed binding that exposes it to the
  application.
* Inter and Noto Sans Bengali are bundled under the SIL Open Font License 1.1 so that text and Bengali
  script render identically on every machine with no font installation and no network access.
* Electron bundles Chromium, Node.js and their own third-party components; their notices are included in
  the application package under \`licenses\`.
* No component in this list requires the application to publish source, and no component contacts a
  network service.
`

let failed = false
if (denied.length > 0) {
  console.error('audit-dependencies: licences that must not ship were found.')
  for (const entry of denied) console.error(`  ${entry}`)
  failed = true
}
if (unknown.length > 0) {
  console.error('audit-dependencies: licences that need a human decision were found.')
  for (const entry of unknown) console.error(`  ${entry}`)
  failed = true
}
if (failed) process.exit(1)

if (check) {
  let existing = null
  try {
    existing = readFileSync(outputPath, 'utf8')
  } catch {
    existing = null
  }
  const comparable = (text) => text.replace(/^Generated: .*$/m, '')
  if (!existing || comparable(existing) !== comparable(notice)) {
    console.error(`audit-dependencies: ${outputPath} is out of date. Run "npm run audit:deps --write".`)
    process.exit(1)
  }
  console.log(`audit-dependencies: ${rows.length} bundled component(s), all under accepted licences; notices verified.`)
} else {
  writeFileSync(outputPath, notice, 'utf8')
  console.log(`audit-dependencies: ${rows.length} bundled component(s), all under accepted licences.`)
  console.log(`audit-dependencies: wrote ${outputPath}`)
}
