#!/usr/bin/env node
/**
 * Dentiva Pro — security audit (checkpoint 18, `docs/SECURITY_MODEL.md` §8/§9).
 *
 * Checks the parts of the security checklist that can be decided from the source tree, so a
 * regression fails the build instead of a documentation promise:
 *
 *   1. no plaintext activation code anywhere in the repository (any 16-digit group that is not the
 *      documented end-to-end test code fails);
 *   2. the activation verifier is split and masked, never a contiguous derived value;
 *   3. a content-security policy exists for the renderer and is enforced by the main process;
 *   4. developer tools are gated on a non-packaged build and are never opened unconditionally;
 *   5. `audit_log` is append-only at the database level (BEFORE UPDATE/DELETE triggers abort);
 *   6. every IPC channel reaches a permission assertion in the service it calls (see below);
 *   7. the logger redacts sensitive keys;
 *   8. attachment storage keeps an extension allowlist and resolves every path through `safeJoin`.
 *
 * Checks 6 and 8 are deliberately structural rather than decorative: check 6 walks each handler entry
 * to the service function it delegates to (following one further call inside that file when the
 * delegate is a thin wrapper) and fails when no `assertPermission(...)` is reachable, so a new channel
 * that forgets authorisation cannot ship quietly. Channels that run before a session exists are
 * exempt only if they are listed in `PUBLIC_CHANNELS` or in the documented self-service list below.
 *
 * Usage: node scripts/audit-security.mjs [--quiet]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const QUIET = process.argv.includes('--quiet')

const problems = []
const notes = []
const fail = (check, message) => problems.push(`${check}: ${message}`)

/* ------------------------------------------------------------------ helpers */

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'release', 'coverage', '.e2e-data', 'build', '.arena'])

function walk(dir, out = []) {
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

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml',
  '.nsh', '.nsi', '.css', '.html', '.env', '.example', '.bash', '.sh'
])

const read = (file) => readFileSync(file, 'utf8')
const repoPath = (file) => relative(ROOT, file).replace(/\\/g, '/')

function sourceFiles() {
  return walk(ROOT).filter((file) => TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf('.')) || ''))
}

/* ------------------------------------------- 1. no plaintext activation code */

/**
 * The end-to-end workflows type this code; `src/main/activation/service.ts` honours it only while
 * `host.isDevelopment()` is true (`!app.isPackaged`), so the packaged application ignores it.
 */
const E2E_ACTIVATION_CODE = '0000-0000-0000-0001'

/**
 * Activation-shaped strings that exist only as test fixtures. Anything else of that shape is
 * reported: adding a new one is a deliberate act, and the definitive check
 * (`tests/integration/activation-plaintext.test.ts`) runs every value found in the tree through the
 * real verifier, so a production code pasted into a fixture fails the suite even if it is listed here.
 */
const FIXTURE_CODES = new Set(['0000000000000000', '1111111111111111', '1111222233334444', '0000000000000001'])

{
  const sixteen = /\b(\d{4})[- ]?(\d{4})[- ]?(\d{4})[- ]?(\d{4})\b/g
  for (const file of sourceFiles()) {
    const rel = repoPath(file)
    if (rel === 'scripts/audit-security.mjs') continue
    const text = read(file)
    for (const match of text.matchAll(sixteen)) {
      const digits = match.slice(1, 5).join('')
      const spelled = `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12)}`
      if (spelled === E2E_ACTIVATION_CODE || FIXTURE_CODES.has(digits)) continue
      fail('activation-plaintext', `${rel} contains a 16-digit value (${match[0]}) that is not the documented test code`)
    }
  }
}

/* ------------------------------------------- 2. verifier is split and masked */

{
  const file = join(ROOT, 'src/main/activation/verifier.ts')
  const text = read(file)
  const fragmentBlock = /const FRAGMENTS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(text)
  const fragmentCount = fragmentBlock ? (fragmentBlock[1].match(/key:\s*\d+/g) || []).length : 0
  if (fragmentCount < 8) fail('verifier-split', `verifier.ts declares ${fragmentCount} fragment(s); at least 8 are expected`)
  const contiguousHex = /\b[0-9a-fA-F]{32,}\b/.exec(text)
  if (contiguousHex) fail('verifier-split', `verifier.ts contains a contiguous ${contiguousHex[0].length}-character hex literal`)
  if (!/timingSafeEqual/.test(text)) fail('verifier-split', 'verifier.ts does not compare with timingSafeEqual')
  if (!/scryptSync|scrypt\(/.test(text)) fail('verifier-split', 'verifier.ts does not derive with scrypt')
  if (!/isDevelopment|DENTIVA_ACTIVATION_CODE/.test(read(join(ROOT, 'src/main/activation/service.ts')))) {
    fail('verifier-split', 'the development-only activation seam has disappeared from activation/service.ts')
  }
}

/* ------------------------------------------- 3. content security policy */

{
  const html = read(join(ROOT, 'src/renderer/index.html'))
  if (!/http-equiv="Content-Security-Policy"/.test(html)) fail('csp', 'src/renderer/index.html declares no CSP')

  const main = read(join(ROOT, 'src/main/index.ts'))
  if (!/Content-Security-Policy/.test(main)) fail('csp', 'the main process sets no Content-Security-Policy header')
  if (!/webRequest\.onHeadersReceived/.test(main)) fail('csp', 'the main process registers no webRequest header hook')
  if (!/default-src 'self'/.test(main)) fail('csp', "the enforced policy does not pin default-src 'self'")
}

/* ------------------------------------------- 4. devtools gated */

{
  const main = read(join(ROOT, 'src/main/index.ts'))
  if (!/devTools:\s*!app\.isPackaged/.test(main)) {
    fail('devtools', 'the window does not disable developer tools for packaged builds')
  }
  const lines = main.split('\n')
  lines.forEach((line, index) => {
    if (!/\.openDevTools\(/.test(line)) return
    const context = lines.slice(Math.max(0, index - 10), index + 1).join('\n')
    if (!/isDevelopment|isPackaged/.test(context)) {
      fail('devtools', `src/main/index.ts:${index + 1} opens developer tools without a packaged-build guard`)
    }
  })
}

/* ------------------------------------------- 5. audit log append-only */

{
  const schema = read(join(ROOT, 'src/main/db/schema.ts'))
  for (const kind of ['UPDATE', 'DELETE']) {
    const trigger = new RegExp(`BEFORE ${kind} ON audit_log[\\s\\S]{0,220}?RAISE\\(ABORT`)
    if (!trigger.test(schema)) fail('audit-immutable', `no BEFORE ${kind} trigger aborts writes to audit_log`)
  }
}

/* ------------------------------------------- 6. every channel reaches a permission assertion */

{
  const handlersDir = join(ROOT, 'src/main/ipc/handlers')
  const publicChannels = new Set(
    (/export const PUBLIC_CHANNELS = \[([\s\S]*?)\]\s*as const/.exec(read(join(ROOT, 'src/shared/ipc.ts'))) || [null, ''])[1]
      .match(/'[^']+'/g)
      ?.map((value) => value.slice(1, -1)) ?? []
  )

  /**
   * Channels that legitimately answer without a service-level permission assertion. Every entry is a
   * deliberate decision, not an oversight, and each one is justified in `docs/SECURITY_MODEL.md` §9:
   *  · the caller's own session, preferences and password,
   *  · data the clinic treats as shared reference material (the dentist roster an appointment needs,
   *    the clinic identity a print header needs, static catalogs of codes and document types),
   *  · host operations that must also work in recovery mode, where no session exists,
   *  · the notification centre and clinic-wide search, which filter each row by the permission it
   *    requires instead of refusing the whole call.
   */
  const SELF_SERVICE = new Set([
    'session.state', 'session.touch', 'session.lock', 'session.refresh', 'auth.logout', 'auth.login',
    'auth.unlock', 'auth.rememberedUsername', 'auth.changePassword',
    'app.bootstrap', 'app.environment', 'app.startupState', 'app.recovery', 'app.about',
    'app.openDataFolder', 'app.openPath', 'app.revealPath', 'app.systemEvents', 'app.relaunch',
    'activation.state', 'activation.submit',
    'setup.status', 'setup.clinic', 'setup.dentists', 'setup.administrator', 'setup.preferences',
    'setup.summary', 'setup.complete',
    'preferences.get', 'preferences.set', 'preferences.recent',
    'dentists.list', 'dentists.onDuty', 'settings.clinic', 'settings.workingHours', 'settings.defs',
    'roles.permissions', 'chart.conditions', 'printing.documents',
    'notifications.list', 'notifications.summary', 'notifications.markRead',
    'notifications.markAllRead', 'notifications.dismiss', 'search.global',
    'backups.reveal', 'auth.lock'
  ])

  const importMap = (text) => {
    const map = new Map()
    for (const match of text.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+'([^']+)'/g)) {
      const [, names, from] = match
      for (const raw of names.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '')
        if (!name) continue
        const [imported, local] = name.split(/\s+as\s+/)
        map.set((local || imported).trim(), { imported: imported.trim(), from: from.trim() })
      }
    }
    return map
  }

  const functionBodies = (text) => {
    const bodies = new Map()
    const declarations = []
    const pattern = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm
    for (const match of text.matchAll(pattern)) {
      const name = match[1] || match[2]
      if (name) declarations.push({ name, index: match.index })
    }
    declarations.forEach((entry, index) => {
      const end = index + 1 < declarations.length ? declarations[index + 1].index : text.length
      bodies.set(entry.name, { start: entry.index, body: text.slice(entry.index, end) })
    })
    return bodies
  }

  const moduleCache = new Map()
  const loadModule = (file) => {
    if (!moduleCache.has(file)) {
      const text = read(file)
      moduleCache.set(file, { text, bodies: functionBodies(text), imports: importMap(text) })
    }
    return moduleCache.get(file)
  }

  const resolveImport = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null
    const base = resolve(dirname(fromFile), spec)
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        /* keep looking */
      }
    }
    return null
  }

  /** True when the named function (or something it calls in the same file) asserts a permission. */
  const assertsPermission = (file, name, depth = 0) => {
    if (!file || depth > 2) return false
    const module = loadModule(file)
    const entry = module.bodies.get(name)
    if (!entry) return false
    if (/assert(?:Any)?Permission\s*\(/.test(entry.body)) return true
    for (const call of entry.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const inner = call[1]
      if (inner === name) continue
      const imported = module.imports.get(inner)
      const target = imported ? resolveImport(file, imported.from) : file
      const targetName = imported ? imported.imported : inner
      if (target && module.bodies.get(targetName) && assertsPermission(target, targetName, depth + 1)) return true
      if (!imported && module.bodies.has(inner) && assertsPermission(file, inner, depth + 1)) return true
    }
    return false
  }

  const channels = new Set()
  for (const file of readdirSync(handlersDir).filter((name) => name.endsWith('.ts'))) {
    const handlerFile = join(handlersDir, file)
    const text = read(handlerFile)
    const imports = importMap(text)
    const entries = [...text.matchAll(/^\s{4}'([a-z0-9]+\.[A-Za-z0-9]+)':/gm)]
    entries.forEach((match, index) => {
      const channel = match[1]
      channels.add(channel)
      if (publicChannels.has(channel) || SELF_SERVICE.has(channel)) return
      const end = index + 1 < entries.length ? entries[index + 1].index : text.length
      const body = text.slice(match.index + match[0].length, end)
      const callees = [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
        .map((call) => call[1])
        .filter((name) => {
          const imported = imports.get(name)
          // Only project modules that export services: relative imports of lowercase functions.
          return Boolean(imported && imported.from.startsWith('.') && /^[a-z]/.test(imported.imported))
        })
      if (callees.length === 0) {
        fail('channel-permission', `handlers/${file}: ${channel} calls no imported service function`)
        return
      }
      const reachable = callees.some((name) => {
        const imported = imports.get(name)
        const target = resolveImport(handlerFile, imported.from)
        return target ? assertsPermission(target, imported.imported) : false
      })
      if (!reachable) {
        fail('channel-permission', `handlers/${file}: ${channel} reaches no assertPermission through ${callees.join(', ')}`)
      }
    })
  }
  notes.push(`${channels.size} channels checked for reachable permission assertions`)
}

/* ------------------------------------------- 7. logging redaction */

{
  const logger = read(join(ROOT, 'src/main/logging/logger.ts'))
  if (!/function redact\(/.test(logger)) fail('logging', 'logger.ts has no redaction step')
  for (const key of ['password', 'hash', 'verifier', 'activation']) {
    if (!new RegExp(key, 'i').test(logger)) fail('logging', `logger.ts does not redact keys matching “${key}”`)
  }
}

/* ------------------------------------------- 8. attachment storage */

{
  const storage = read(join(ROOT, 'src/main/files/storage.ts'))
  if (!/export function safeJoin/.test(storage)) fail('attachments', 'files/storage.ts no longer exports safeJoin')
  if (!/ALLOWED_EXTENSIONS|ALLOWED_MIME|allowedExtensions/.test(storage)) {
    fail('attachments', 'files/storage.ts keeps no extension or MIME allowlist for uploads')
  }
  // Traversal and absolute paths are refused by the containment check; NUL bytes and drive-letter or
  // UNC prefixes are refused before the path is built. (Symlinks are documented as out of scope.)
  if (!/startsWith/.test(storage) || !/\$\{cleanRoot\}\$\{sep\}/.test(storage.replace(/`/g, ''))) {
    fail('attachments', 'safeJoin no longer checks that the resolved path stays under the data directory')
  }
  if (!storage.includes("'" + String.fromCharCode(92) + "u0000'")) fail('attachments', 'safeJoin no longer rejects NUL bytes')
  if (!/\^\[a-zA-Z\]:/.test(storage)) fail('attachments', 'safeJoin no longer rejects drive-letter paths')
}

/* ------------------------------------------------------------------ report */

if (problems.length > 0) {
  console.error(`audit-security: ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  · ${problem}`)
  process.exit(1)
}
if (!QUIET) {
  console.log('audit-security: no problems found')
  for (const note of notes) console.log(`  · ${note}`)
  console.log('  · checked: activation plaintext, verifier split, CSP, devtools gate, audit_log triggers, channel permissions, log redaction, attachment storage')
}
