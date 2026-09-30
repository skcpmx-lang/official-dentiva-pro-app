# Dentiva Pro — Release Plan

## 1. Version & build identity

`Dentiva Pro 1.0.0 Final` — semantic version `1.0.0`, build metadata `+<gitsha>.<yyyymmddHHmm>`.
Surfaced in About (version, build, schema version, Electron/Chromium/Node versions) and in
`build-info.json` shipped with the app. Windows file version `1.0.0.0`.

## 2. Build pipeline (GitHub Actions only)

| Workflow | Trigger | Runner | Steps |
|---|---|---|---|
| `.github/workflows/ci.yml` | push to any branch, PR, manual | ubuntu-latest | checkout, Node 22, `npm ci`, typecheck, lint, unit + integration + renderer tests, coverage artifact, `npm run build` |
| `.github/workflows/ci-windows.yml` | push to main/arena branch, PR, manual | windows-latest | `npm ci`, rebuild native module, test suites, electron build, Playwright `_electron` E2E, `npm run dist:win`, installer artifact + SHA-256 |
| `.github/workflows/release.yml` | tag `v*` or manual dispatch | windows-latest | full verify, e2e, build installer, generate `SHA256SUMS.txt` + release notes, upload artifacts, create GitHub Release (installer + checksum + notes + notices) |

Artifacts are never produced by hand for a release; local `npm run dist:win` exists only for developer
iteration and cannot substitute for the CI-built installer.

## 3. Release artifacts

```
release/
├─ DentivaPro-Setup-1.0.0.exe        NSIS installer (per-machine, Start Menu + Desktop shortcuts)
├─ DentivaPro-1.0.0-portable.zip     unpacked application (optional, for kiosk imaging)
├─ SHA256SUMS.txt                    checksums for every artifact
├─ RELEASE_NOTES.md                  features, fixes, known limitations, install/upgrade notes
├─ THIRD_PARTY_NOTICES.md            licenses of bundled dependencies
└─ build-info.json                   version, git sha, build time, node/electron versions
dist/                                 copy of the above for the repository fallback path
```

## 4. Verification sequence before publishing

1. CI green on all platforms. 2. Installer produced by the Windows release job.
3. Checksum generated and verified against the artifact. 4. Install on a clean Windows machine.
5. Launch → activation → setup → login → dashboard. 6. Workflow smoke: patient, visit, chart,
prescription + print/PDF, invoice, payments, inventory, accounting, backup, restore, lock, logout,
restart. 7. Uninstall behaviour documented and verified. 8. Logs inspected for unexpected errors.
9. Results recorded in `docs/COMPLETION_STATUS.md` and `docs/CLEAN_MACHINE_TEST.md`.

## 5. Distribution

GitHub Release (`v1.0.0` tag) carrying installer + checksum + notes + notices, with a `dist/` mirror
committed in the repository as the documented fallback when Release creation is unavailable.

## 6. Rollback / support

Reinstalling the same version over a newer data directory is safe (schema migrations are forward-only and
versioned); restoring a pre-upgrade backup is the documented downgrade path. Support contact and the
diagnostic-bundle location are documented in About → Support. Uninstall preserves
`%APPDATA%\Dentiva Pro` unless the user explicitly ticks "remove clinic data".

## 7. Pre-release checklist (gate)

See `docs/ACCEPTANCE_CRITERIA.md` §B. A release may be published only when every gate is TRUE and no
critical defect is open. The PR stays open for the human owner to merge — the agent never merges it.
