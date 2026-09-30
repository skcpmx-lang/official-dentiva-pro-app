#!/usr/bin/env node
/**
 * Build identity.
 *
 * Writes `build-info.json` next to `package.json`. The file is packaged as an extra resource, so the
 * About screen can show which version, commit and toolchain produced the installed copy — the answer a
 * support conversation starts with. Nothing here is invented: a value that cannot be read is written as
 * `unknown` and reported on the console.
 *
 * Usage: node scripts/generate-build-info.mjs [--sha <sha>] [--out <path>]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function gitSha() {
  const fromArgument = argument('sha')
  if (fromArgument) return fromArgument
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
}

const pkg = readJson(join(root, 'package.json'))
if (!pkg) {
  console.error('generate-build-info: package.json could not be read.')
  process.exit(1)
}

const sha = gitSha()
const builtAt = new Date()
const electron = readJson(join(root, 'node_modules', 'electron', 'package.json'))?.version ?? 'unknown'
const chromium = process.env.ELECTRON_CHROMIUM_VERSION ?? 'unknown'

const info = {
  product: pkg.productName ?? pkg.name,
  version: pkg.version,
  buildNumber: `${stamp(builtAt)}-${sha.slice(0, 7)}`,
  gitSha: sha,
  builtAt: builtAt.toISOString(),
  electron,
  chromium,
  node: process.version.replace(/^v/, ''),
  builtOn: `${process.platform}-${process.arch}`,
  offline: true
}

if (info.chromium === 'unknown' || info.electron === 'unknown') {
  console.warn('generate-build-info: some toolchain versions are unknown in this environment; the packaged app reports the real ones at run time.')
}

const out = resolve(root, argument('out', 'build-info.json'))
writeFileSync(out, `${JSON.stringify(info, null, 2)}\n`, 'utf8')
console.log(`generate-build-info: wrote ${out}`)
console.log(`  ${info.product} ${info.version} (build ${info.buildNumber}, commit ${info.gitSha.slice(0, 7)})`)
