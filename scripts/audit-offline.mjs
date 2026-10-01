#!/usr/bin/env node
/**
 * Audit: the application stays offline.
 *
 * Dentiva Pro must work with no internet connection and must not call anything outside the computer it
 * is installed on. This script reads the production sources and the packaging configuration and fails on
 * anything that could reach the network: remote URLs, fetch/XHR/WebSocket usage, DNS or socket imports,
 * or a CDN reference in the HTML shell.
 *
 * XML namespace URIs (`http://www.w3.org/...`) are identifiers, not addresses — an SVG file has to name
 * them — so they are the one documented exception.
 *
 * Usage: node scripts/audit-offline.mjs [--quiet]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TARGETS = [join(root, 'src')]
const EXTRA_FILES = ['electron.vite.config.ts', 'package.json']
const extensions = new Set(['.ts', '.tsx', '.css', '.html', '.json'])

/** URIs that are names, never requests. */
const ALLOWED_URLS = [
  /https?:\/\/www\.w3\.org\/[0-9A-Za-z/#:._-]+/g, // SVG/XML/XHTML namespaces and schema addresses
  /https?:\/\/schemas\.microsoft\.com\/[0-9A-Za-z/#:._-]+/g,
  /https?:\/\/json-schema\.org\/[0-9A-Za-z/#:._-]*/g,
  /https?:\/\/localhost(?::\d+)?(?:\/|")/g, // Electron dev server, never used in a packaged build
  /https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/|")/g
]

const PATTERNS = [
  { pattern: /\bfetch\s*\(/, label: 'fetch() call' },
  { pattern: /new\s+XMLHttpRequest/, label: 'XMLHttpRequest' },
  { pattern: /new\s+WebSocket/, label: 'WebSocket' },
  { pattern: /\bEventSource\s*\(/, label: 'EventSource' },
  { pattern: /navigator\.onLine/, label: 'network status check' },
  { pattern: /from 'node:(http|https|dns|net|tls)'|require\('node:(http|https|dns|net|tls)'\)/, label: 'network module import' },
  { pattern: /from '(axios|node-fetch|got|superagent)'/, label: 'HTTP client library' },
  { pattern: /cdn\.(jsdelivr|unpkg|cloudflare)|fonts\.googleapis|google-analytics|googletagmanager|sentry\.io|segment\.io|mixpanel/, label: 'external service reference' }
]

/**
 * Files whose job is to reproduce licence attributions. A copyright holder's address in a notice is
 * text shown to the operator, never a request — but nowhere else is a remote URL acceptable.
 */
const ATTRIBUTION_FILES = [join(root, 'src', 'main', 'modules', 'support', 'service.ts')]

const problems = []

function stripAllowedUrls(text) {
  let result = text
  for (const allowed of ALLOWED_URLS) result = result.replace(allowed, 'about:offline')
  return result
}

function scanFile(path) {
  const original = readFileSync(path, 'utf8')
  const text = stripAllowedUrls(original)
  const attributionsOnly = ATTRIBUTION_FILES.includes(path)
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    const where = `${relative(root, path)}:${index + 1}`
    for (const entry of PATTERNS) {
      if (entry.pattern.test(line)) problems.push(`${where}  ${entry.label}: ${line.trim().slice(0, 120)}`)
    }
    const url = line.match(/https?:\/\/[^\s'"`)]+/)
    if (url && !attributionsOnly) problems.push(`${where}  remote URL: ${url[0].slice(0, 120)}`)
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

for (const target of TARGETS) walk(target)
for (const extra of EXTRA_FILES) {
  const path = join(root, extra)
  try {
    if (statSync(path).isFile()) scanFile(path)
  } catch {
    /* an optional file that is not present is not a problem */
  }
}

if (problems.length > 0) {
  console.error(`audit-offline: ${problems.length} network reference(s) found. The application must work with no connection.`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

if (!process.argv.includes('--quiet')) {
  console.log('audit-offline: clean — no remote URLs, HTTP clients or network APIs in the shipped sources.')
}
