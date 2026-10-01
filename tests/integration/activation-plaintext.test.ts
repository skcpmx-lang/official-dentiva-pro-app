import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkActivationCode } from '@main/activation/verifier'

/**
 * The activation code must not exist in the repository in any form (spec §14).
 *
 * `scripts/audit-security.mjs` can only spot code-shaped strings; this test settles the question
 * completely: it collects every 16-digit group in the tree — however it is grouped or spelled — and
 * runs each one through the real verifier. Only the derived fragment table ships, so the production
 * code cannot be present here without failing. The test is the machine-checkable half of the honesty
 * note in `docs/SECURITY_MODEL.md` §3: a fixed offline code can always be brute-forced by someone who
 * has the build, but it must never be *found* by reading the repository.
 */

const ROOT = resolve(__dirname, '..', '..')

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'release', 'coverage', 'build', '.arena', '.e2e-data'])
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml',
  '.nsh', '.nsi', '.css', '.html'
])

/**
 * The end-to-end workflows type this code into the activation screen. `activation/service.ts` accepts
 * it only while `host.isDevelopment()` is true (`!app.isPackaged`), so a packaged application refuses
 * it; it is a test seam, not a second product code.
 */
const DEV_SEAM_CODE = '0000-0000-0000-0001'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

interface Candidate {
  file: string
  spelled: string
  normalized: string
}

function candidates(): { files: string[], found: Candidate[] } {
  const files = walk(ROOT).filter((file) => TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf('.')) || ''))
  const found: Candidate[] = []
  const pattern = /\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/g
  for (const file of files) {
    if (file.endsWith(join('tests', 'integration', 'activation-plaintext.test.ts'))) continue
    if (statSync(file).size > 4 * 1024 * 1024) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(pattern)) {
      const groups = [match[1]!, match[2]!, match[3]!, match[4]!]
      found.push({
        file: file.slice(ROOT.length + 1),
        spelled: match[0],
        normalized: groups.join('')
      })
    }
  }
  return { files, found }
}

describe('activation code secrecy', () => {
  const { files, found } = candidates()

  it('scans the whole tree, not an empty file list', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(found.length).toBeGreaterThan(0)
  })

  it('has no code-shaped string that the real verifier accepts', () => {
    const accepted: string[] = []
    for (const candidate of found) {
      const spelled = `${candidate.normalized.slice(0, 4)}-${candidate.normalized.slice(4, 8)}-${candidate.normalized.slice(8, 12)}-${candidate.normalized.slice(12)}`
      if (spelled === DEV_SEAM_CODE) continue
      if (checkActivationCode(candidate.normalized).ok) accepted.push(`${candidate.file}: ${candidate.spelled}`)
    }
    expect(accepted).toEqual([])
  })

  it('keeps the derived verifier split, masked and free of any contiguous value', () => {
    const source = readFileSync(join(ROOT, 'src', 'main', 'activation', 'verifier.ts'), 'utf8')
    expect(source).not.toMatch(/\b[0-9a-f]{32,}\b/i)
    const fragments = /const FRAGMENTS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(source)
    expect(fragments).not.toBeNull()
    expect((fragments![1]!.match(/key:/g) ?? []).length).toBeGreaterThanOrEqual(8)
  })
})
