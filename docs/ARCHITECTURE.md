# Dentiva Pro — Architecture

## 1. Decision summary

| Concern | Decision | Rationale |
|---|---|---|
| Desktop shell | **Electron 44** (Chromium + Node) | Best-in-class Windows printing (printer enumeration, silent print, `printToPDF` with micron page sizes), mature NSIS packaging via electron-builder, no extra runtime install on target machines, stable offline operation |
| Language | **TypeScript 5.9** everywhere | single typed language across main/preload/renderer |
| Renderer | **React 19 + Vite 7** (electron-vite) | fast builds, component model, mature ecosystem |
| Database | **SQLite** via `better-sqlite3` | synchronous, transactional, local file, WAL, unlimited records, zero server |
| Validation | **Zod 4** contracts shared by main + renderer | single source of truth for payload validation at the trust boundary |
| State | **Zustand** (session/UI) + server-state hooks over IPC | minimal, no hidden global mutation |
| Styling | CSS layers + design tokens (custom properties), no CSS-in-JS runtime | performance, print fidelity, reduced-motion control |
| Icons | **lucide-react** | one coherent family, consistent stroke weight |
| Zip (backups) | **fflate** (pure JS) | no native dependency, deterministic, streaming-friendly |
| Packaging | **electron-builder → NSIS** | real installer, shortcuts, uninstaller, per-machine/per-user, no Node required |
| PDF | Electron `webContents.printToPDF` | offline, exact same HTML/CSS as print preview, Unicode/Bengali correct |
| Fonts | bundled `@fontsource` WOFF2 (Inter + Noto Sans Bengali) | no CDN, no Google Fonts, works offline and in PDF |
| Tests | Vitest (unit/integration/renderer) + Playwright `_electron` (E2E) | layered pyramid, real product under test |

Rejected alternatives: **Tauri** (Rust toolchain, WebView2 print pipeline cannot enumerate/silent-print
Windows printers reliably and lacks a first-class `printToPDF`), **NW.js** (smaller ecosystem, weaker
packaging), **web app in a browser** (no filesystem/print control, cannot meet offline desktop install
requirement), **Python/Qt** (weaker web-style premium UI velocity, larger runtime).

## 2. Process & module layout

```
electron-vite build output
├─ src/main      (Node, full privileges)      — trusted zone
├─ src/preload   (isolated bridge)            — narrow API surface
└─ src/renderer  (React SPA, no Node access)  — untrusted zone
```

```
src/
  main/
    index.ts                 app lifecycle, single-instance, recovery mode, crash guards
    ipc/router.ts            channel allowlist → handler dispatch, error envelope, audit hooks
    session/sessionManager.ts logged-in sessions keyed by webContents id, lock state, heartbeats
    auth/                     password hashing (scrypt), login throttling, activation gate
    activation/               offline derived-verifier activation
    db/connection.ts          open/WAL/foreign_keys, backup, integrity check, close/reopen
    db/migrate.ts             versioned migrations + schema_migrations table
    db/schema.ts              DDL for schema v1
    db/seed.ts                permissions catalog, roles, condition/advice catalogs, defaults
    modules/<domain>/service.ts   business logic (permission asserted on every entry point)
    modules/<domain>/repo.ts      prepared SQL statements
    printing/                 document HTML builders, printer enumeration, print, PDF, profiles
    files/                    attachments store, safe paths, open/export
    backup/                   package build/validate/restore, scheduling, retention
    search/                   global search fan-out
    reports/                  report queries + CSV/PDF export
    logging/                  rotating local log files, diagnostic bundle
    shared-guards/            permission map, money/date re-exports, error taxonomy
  preload/index.ts            contextBridge: `dentiva.invoke(channel, payload)`, event subscription
  renderer/src/
    app/                      providers, router, bootstrap gate
    design/                   tokens.css, base.css, components.css, print.css
    components/               primitives (Button, Field, DataTable, Modal, ...) + layout shell
    features/<domain>/        screens, hooks, view models
    lib/                      api client, formatters (money/date/Bengali), keyboard shortcuts
  shared/
    contracts/                zod schemas per module (IPC input/output)
    permissions.ts            permission catalog constants
    money.ts                  micro-unit arithmetic + BDT formatting
    datetime.ts               local ISO/epoch helpers, range presets
    dental.ts                 FDI/primary tooth maps, chart model
    errors.ts                 error codes shared by both zones
    bengali.ts                NFC normalisation + search folding
```

**Dependency rule:** renderer → shared only; main → shared only; shared → nothing (no Node/Electron/React imports).
No business rule lives in a React component; no SQL lives outside `main/db` and `main/modules/*/repo.ts`.

## 3. Trust boundary and IPC

The renderer is treated as untrusted. Every IPC message is:
1. routed through an explicit **channel allowlist** (unknown channel → `E_CHANNEL`),
2. parsed with the channel's **Zod input schema** (invalid → `E_VALIDATION` with field details),
3. executed with the **session resolved server-side** from `event.sender.id` (the renderer never sends
   a user id, role or permission list),
4. **authorised** at the service layer (`assertPermission(session, 'billing.invoice.create')`),
5. executed in a **transaction** where multiple records change,
6. written to the **audit log** when the operation is auditable,
7. returned in a **uniform envelope**: `{ ok: true, data }` or `{ ok: false, error: { code, message, fieldErrors?, detail? } }`.

Renderer surface exposed by preload (the only Electron API reachable from the UI):

```ts
window.dentiva = {
  invoke<T>(channel: ChannelId, payload?: unknown): Promise<Envelope<T>>,
  on(event: EventId, cb: (payload: unknown) => void): () => void,   // allowlisted events
  getEnvironment(): EnvInfo,                                        // versions, platform, paths hint
}
```

No `remote`, no `nodeIntegration`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`,
`allowRunningInsecureContent: false`, CSP without `unsafe-inline`, external navigation blocked,
`window.open` denied, `webviewTag` disabled.

## 4. Data & storage layout

```
%APPDATA%\Dentiva Pro\                 (configurable root; DENTIVA_DATA_DIR overrides for tests)
├─ data\dentiva.db                     SQLite (WAL + -wal/-shm)
├─ attachments\<patientId>\<uuid>.<ext> clinical attachments (metadata in DB)
├─ logs\app-YYYY-MM-DD.log             rotating (7 files × 5 MB), no secrets/PII bodies
├─ tmp\                                staging for restore/export, cleared on start
└─ backups\                            only if the user picks the default folder
```

Default backup folder suggestion: `%USERPROFILE%\Documents\Dentiva Pro Backups`
(user-selectable through the native folder picker; the choice is persisted in Settings).

## 5. Database strategy

* Schema version constant `SCHEMA_VERSION`; migrations are ordered, idempotent and recorded in
  `schema_migrations`. Pre-migration automatic backup when the version increases.
* `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`.
* Soft deletion (`is_deleted`, `deleted_at`, `deleted_by`) and status columns on entities whose
  history matters; hard delete is restricted to genuinely transient rows (queue entries, drafts).
* Money stored as integer micro-units (`µ`, 1 ৳ = 10 000 µ). Percentages as integer basis points.
* Every monetary mutation writes an append-only `financial_events`-style ledger through
  `payments`/`invoice` recomputation; invoices keep `issue_snapshot` totals for historical accuracy.
* Bilingual text stored NFC-normalised; `*_fold` companion columns hold a search-folded copy for
  accent/zero-width-insensitive `LIKE` matching.

## 6. Money, dates, identifiers

* `Money` = `{ micro: number }` helpers: `add/sub/mulQty/percent/discount/format`.
* Timestamps: `created_at`, `updated_at` as epoch milliseconds (UT C/UTC) **plus** derived local date
  columns where needed for grouping (`entry_date` `YYYY-MM-DD`).
* Patient code: `DP-YYMM-####` (per-month sequence, DB unique). Invoice no: `<PREFIX>-YYMM-####`.
  Prescription no: `Rx-YYMM-####`. All sequences come from the `counters` table inside transactions.
* Tooth numbering: FDI two-digit (adult 11–48, primary 51–85) — documented in `docs/DATABASE_SCHEMA.md`.

## 7. Printing pipeline

```
service → document model (plain JS object)
        → HTML builder (src/main/printing/templates/*)  ← same code for preview, print, PDF
        → { preview }: sent to renderer iframe (srcDoc)
        → { print }:   hidden BrowserWindow.loadURL(printUrl) → webContents.print({deviceName,pageSize})
        → { pdf }:     hidden BrowserWindow → webContents.printToPDF({pageSize(microns),margins})
        → print_history row (doc type, record id, user, profile, printer, result)
```

Templates are paper-class aware (`a4 | a5 | thermal | custom(width)`) and reflow rather than scale.
Fonts are injected as `@font-face` with bundled absolute file URLs (validated in build; data-URI
fallback available for PDF).

## 8. Sessions, locking, permissions

`SessionManager` holds `webContentsId → { userId, username, fullName, roleId, permissions:Set<string>,
lockedAt, lastSeenAt, lockTimeoutMs }`. A 30 s heartbeat from the renderer plus a main-process timer
drives auto-lock; while locked, every IPC channel except `auth.unlock`, `auth.logout`, `session.state`
returns `E_LOCKED`. Logout and lock are audited. Permission cache is invalidated on role/permission
changes and on unlock.

## 9. Backup / restore

Package `.dentivabackup` = zip (fflate) with:
```
manifest.json     { format:1, app, appVersion, schemaVersion, createdAt, counts, checksums, machine, note }
database/dentiva.db   (produced by SQLite backup API / VACUUM INTO, integrity-checked)
attachments/…          (only in "full" packages)
```
Restore pipeline is strictly ordered: validate → checksum/verify → **pre-restore backup** → confirm →
close DB → replace → integrity check → reopen → consistency scan → audit → result. Any failure triggers
rollback to the pre-restore snapshot. Multiple selected files restore **sequentially** (newest first,
documented) — never merged.

## 10. Error handling, logging, crash safety

* Error taxonomy in `shared/errors.ts` (`E_VALIDATION`, `E_PERMISSION`, `E_LOCKED`, `E_NOT_FOUND`,
  `E_CONFLICT`, `E_STATE`, `E_IO`, `E_DB`, `E_PRINT`, `E_LICENSE`, `E_INTERNAL`).
* `process.on('uncaughtException'/'unhandledRejection')` write to log and keep the app alive when safe;
  terminal DB failures switch the app into **Recovery Mode** (restore / open data folder / diagnostics).
* Renderer error boundary per route + global toast on IPC failure; no raw stack traces in production UI.
* Logs rotate; never contain passwords, hashes, activation material or full clinical text.

## 11. Build & release

* `npm run dev` (electron-vite dev), `npm run build` (typecheck + three bundles),
  `npm run dist:win` (electron-builder NSIS → `release/`), `npm run verify` (lint+typecheck+tests).
* GitHub Actions: `ci.yml` (ubuntu: lint/typecheck/unit/integration/renderer; windows: build + e2e +
  installer + artifacts) and `release.yml` (workflow_dispatch/tag → windows installer + SHA-256 +
  release notes + GitHub Release + `dist/` copies).
* Version identity: `1.0.0 Final` with build metadata (git SHA + build time) surfaced in About.
