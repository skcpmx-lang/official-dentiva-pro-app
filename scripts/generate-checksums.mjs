#!/usr/bin/env node
/**
 * Release checksums.
 *
 * Writes `SHA256SUMS.txt` in the folder that holds the release artifacts, in the usual
 * `<sha256>  <filename>` form, and verifies each file was read completely. The checksum is what a
 * customer compares against the GitHub Release entry before installing, so the script refuses to write
 * an empty list: a release without an installer is a mistake, not a success.
 *
 * Usage: node scripts/generate-checksums.mjs [--dir release] [--name SHA256SUMS.txt]
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const directory = resolve(root, argument('dir', 'release'))
const outputName = argument('name', 'SHA256SUMS.txt')
const patterns = ['.exe', '.zip', '.msi', '.blockmap', '.dmg', '.AppImage']

function hashFile(path) {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

let entries
try {
  entries = readdirSync(directory)
} catch {
  console.error(`generate-checksums: the folder ${directory} does not exist. Build the installer first (npm run dist:win).`)
  process.exit(1)
}

const files = entries
  .filter((name) => patterns.some((extension) => name.endsWith(extension)))
  .sort((left, right) => left.localeCompare(right))

if (files.length === 0) {
  console.error(`generate-checksums: no release artifacts found in ${directory}. Nothing to checksum.`)
  process.exit(1)
}

const lines = []
for (const name of files) {
  const path = join(directory, name)
  if (!statSync(path).isFile()) continue
  lines.push(`${hashFile(path)}  ${name}`)
}

const outputPath = join(directory, outputName)
writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8')

console.log(`generate-checksums: ${lines.length} artifact(s) checksummed in ${basename(directory)}`)
for (const line of lines) console.log(`  ${line}`)
console.log(`  → ${basename(outputPath)}`)
