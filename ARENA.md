# ARENA.md — Dentiva Pro project memory

> Read this file first when resuming work. It is the single source of operational truth.

## Product

**Dentiva Pro** — offline Windows dental clinic management software for Bangladesh.
Author: Shohan Khan (helloiamshohan@gmail.com). Version 1.0.0 Final. Currency BDT (৳). English UI with
full Bengali Unicode support. No internet, no cloud, no paid API, no telemetry.

## Stack

Electron 44 · TypeScript 5.9 · React 19 + Vite 7 (electron-vite) · SQLite via `better-sqlite3` ·
Zod 4 contracts · Zustand · lucide-react icons · fflate backups · electron-builder → NSIS installer ·
Vitest (unit/integration/renderer) + Playwright `_electron` (E2E).

## Build / test commands

| Command | Purpose |
|---|---|
| `npm ci` | install (CI uses this) |
| `npm run dev` | electron-vite dev with HMR |
| `npm run typecheck` | tsc for node + web projects |
| `npm run lint` | ESLint over `src` and `tests` |
| `npm test` | unit + integration + renderer suites (Vitest) |
| `npm run test:e2e` | Playwright Electron E2E (needs `npm run build` first) |
| `npm run build` | typecheck + electron-vite production bundles |
| `npm run dist:win` | NSIS installer (Windows) into `release/` |
| `npm run verify` | typecheck + lint + tests (the CI gate) |
| `npm run stress:seed -- --patients 10000` | generate a synthetic stress dataset |

Tests and E2E use `DENTIVA_DATA_DIR=<temp dir>` so no real clinic data is touched.

## Repository map

`src/shared` (types, contracts, money, datetime, permissions, dental, bengali) ·
`src/main` (Electron main: db, migrations, modules/services, printing, backup, files, logging, session) ·
`src/preload` (contextBridge gateway) · `src/renderer/src` (React UI) ·
`tests/{unit,integration,renderer,e2e}` · `scripts/` (icon generation, stress seed, audits) ·
`docs/` (specification set) · `build/` (icons, installer assets).

## Current status / milestone

See `docs/COMPLETION_STATUS.md` (checkpoints, test counts, audit results, open items). Update both files
after every meaningful milestone.

## Key decisions (short list — full ADR in docs/DECISIONS.md)

* All business logic + permission checks live in the main process; renderer is untrusted.
* Single IPC gateway `dentiva.invoke(channel, payload)` with a channel allowlist and zod validation.
* Money = integer micro-units (1 ৳ = 10 000 µ). Percentages = basis points.
* Timestamps = epoch ms + explicit local `YYYY-MM-DD` columns for day grouping.
* Soft delete for historical entities; void/reversal for financial rows; append-only audit log.
* Printing/preview/PDF share one HTML template engine; paper classes a4/a5/thermal/mini/custom.
* Backup packages `.dentivabackup` = zip(manifest + SQLite snapshot + attachments) with SHA-256 checks.
* Activation = scrypt-derived verifier of the vendor code (no plaintext anywhere) + machine fingerprint.

## Recovery / continuation instructions

1. `git status && git log --oneline -10 && git branch --show-current` (expect `arena/01a0f35f-official-dentiva-pro-app`).
2. Read `docs/COMPLETION_STATUS.md` → "Next actions".
3. `npm ci` if `node_modules` is missing, then `npm run verify` to establish a green/red baseline.
4. Continue from the first incomplete checkpoint; never re-scaffold completed modules.
5. Never merge the PR — the human owner merges.

## Known issues

Tracked in `docs/COMPLETION_STATUS.md` → "Open issues" and `docs/KNOWN_LIMITATIONS.md`.
