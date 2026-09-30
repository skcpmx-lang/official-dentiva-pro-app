# Dentiva Pro

<img src="build/icons/icon-256.png" alt="Dentiva Pro application icon" width="96" align="right" />

**Offline Windows dental clinic management software** — patients, appointments, queue, clinical visits,
dental charting, treatments, prescriptions, invoicing, payments, inventory, accounting, reporting,
staff & permissions, audit, backup/restore and paper-aware printing (A4/A5/thermal) with PDF.

* **Version:** 1.0.0 Final
* **Platform:** Windows 10 (1903+) / Windows 11, x64 — fully offline, no cloud, no telemetry
* **Currency:** BDT (৳) · **Language:** professional English UI with full Bengali Unicode support
* **Author:** Shohan Khan — helloiamshohan@gmail.com

---

## Quick start (developer)

```bash
npm ci                      # install dependencies
npm run dev                 # launch the app in development (HMR)
npm run verify              # typecheck + lint + unit/integration/renderer tests
npm run test:e2e            # Playwright Electron end-to-end workflows (after npm run build)
npm run build               # production bundles
npm run dist:win            # Windows NSIS installer → release/   (Windows)
```

Repository checks (all run by `ci.yml`): `npm run audit:placeholders` (no unfinished work in `src/`),
`npm run audit:offline` (nothing in the application can reach the network),
`npm run audit:deps:check` (licences, and `THIRD_PARTY_NOTICES.md` is current),
`npm run audit:deadcode` (no declaration nothing references) and `npm run icons:check` (the committed
application icon matches its source artwork). `npm run icons` and `npm run audit:deps` regenerate those
artifacts, `npm run build:info` records the build identity, `npm run release:checksums` writes
`SHA256SUMS.txt` for `release/`, and `npm run stress:seed` builds the performance-testing dataset
(see `docs/TEST_PLAN.md`).

Testers can point the app at a scratch data directory (never touches clinic data):

```bash
DENTIVA_DATA_DIR=/tmp/dentiva-dev npm run dev
```

## Documentation

| Document | Contents |
|---|---|
| `docs/PRODUCT_SPECIFICATION.md` | scope, personas, modules, added requirements |
| `docs/ARCHITECTURE.md` | stack decision, process layout, IPC trust boundary, storage layout |
| `docs/DATABASE_SCHEMA.md` | every table, index, relationship and integrity rule |
| `docs/UI_UX_SPECIFICATION.md` | design tokens, shell metrics, all 46 screens, component contracts |
| `docs/SECURITY_MODEL.md` | threat model, RBAC catalog, activation design, audit rules |
| `docs/PRINTING_SPECIFICATION.md` | printing engine, paper classes, profiles, PDF, test matrix |
| `docs/TEST_PLAN.md` | test layers, E2E workflows, coverage targets, performance budget |
| `docs/ACCEPTANCE_CRITERIA.md` | module acceptance criteria + release gate |
| `docs/RELEASE_PLAN.md` | CI/CD pipeline, artifacts, verification sequence |
| `docs/DECISIONS.md` | architecture decision record |
| `docs/KNOWN_LIMITATIONS.md` | honest limitations of the final build |
| `docs/TRACEABILITY_MATRIX.md` | requirement → implementation → test → status |
| `docs/COMPLETION_STATUS.md` | live checkpoints, test results, audit outcomes |
| `ARENA.md` | project memory / continuation instructions |

## First run

1. Install `DentivaPro-Setup-1.0.0.exe` (produced by CI, see `docs/RELEASE_PLAN.md`).
2. Launch **Dentiva Pro**, enter the vendor activation code.
3. Complete the five-step setup wizard (clinic, dentists, administrator, practice defaults, confirmation).
4. Sign in and start registering patients.

Application data lives in `%APPDATA%\Dentiva Pro` (database, attachments, logs, backups). Uninstalling
keeps clinic data unless removal is explicitly requested in the uninstaller.

## License & third-party notices

Dentiva Pro itself is proprietary commercial software © 2026 Shohan Khan.
Bundled open-source components and their licences are listed in `THIRD_PARTY_NOTICES.md` and in
About → Third-party notices inside the application.
