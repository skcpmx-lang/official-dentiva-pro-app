# Dentiva Pro — Architecture Decision Record

| ID | Decision | Alternatives considered | Consequences |
|---|---|---|---|
| D-01 | Electron 44 as the desktop shell | Tauri, NW.js, Qt/Python, browser app | guaranteed Windows printing + PDF fidelity, single-language codebase, ~200 MB installer with NSIS; accepted size cost |
| D-02 | SQLite via `better-sqlite3` (synchronous) | sql.js, node:sqlite, Postgres/MySQL, JSON files | real transactions, FK enforcement, indexes, synchronous simplicity; native module rebuilt for Electron in CI |
| D-03 | All business logic in the main process, renderer is untrusted | logic in React/Redux, thin IPC | permission enforcement cannot be bypassed from the renderer; costs extra IPC round-trips, mitigated by coarse-grained channel payloads |
| D-04 | Single generic IPC gateway `dentiva.invoke(channel, payload)` with an allowlist + zod per channel | per-feature bridge methods | one place to audit authorisation/validation/auditing; channel constants are typed |
| D-05 | Money as integer micro-units | floats, JS `number` BDT, decimal library | exact arithmetic everywhere; formatting centralised in `shared/money.ts` |
| D-06 | Timestamps as epoch ms + explicit local date columns | ISO strings only, date-only storage | correct filtering/aggregation by local day with unambiguous ordering |
| D-07 | Soft delete for business/clinical/financial entities; hard delete only for transient rows | universal hard delete | history preserved; requires `is_deleted=0` discipline in every query (enforced by repo layer) |
| D-08 | Audit log append-only with DB triggers blocking UPDATE/DELETE | application-level discipline only | trustworthy trail; must not need corrections (events are additive) |
| D-09 | Void/reversal instead of editing financial records | editable transactions | recomputation is deterministic; reports reconcile to ledger history |
| D-10 | `printToPDF` + shared HTML templates for print/preview/PDF | pdfkit/jsPDF, PDFprinter, wkhtmltopdf binary | identical output across paths, full Unicode/Bengali, no paid library, no extra binary |
| D-11 | Hand-built SVG charts (line/bar/donut) | recharts/chart.js | zero heavy dependency, print-safe, full control of states/animation |
| D-12 | Zustand for session/UI state, server-state via IPC hooks | Redux Toolkit, React Query | small surface area, no cache coherence traps for local data |
| D-13 | `fflate` pure-JS zip for backup packages | adm-zip, 7-Zip binary, tar | no native dependency, deterministic manifests, easy validation |
| D-14 | Activation verifier = scrypt over the code with a fixed app salt, stored as a split hex literal | plaintext constant, obfuscation, online activation | casual extraction prevented; documented reverse-engineering limitation for a fixed offline code |
| D-15 | Auto-lock implemented in the main process (heartbeat + timer) | renderer-only idle detection | cannot be defeated by renderer manipulation; unsaved UI state stays in memory only |
| D-16 | Auto-update deliberately excluded | electron-updater | product is the final build; avoids unsigned update-channel risk (documented in limitations) |
| D-17 | UI theme: light clinical surface, navy structural chrome | dark mode default | higher legibility for long clinical text and printing consistency; dark tokens can be added later without redesign |
| D-18 | Comprehensive vitest + Playwright `_electron` suite rather than only manual QA | manual testing | regressions caught in CI, including real backup/restore and print-generation paths |
| D-19 | Data directory under `%APPDATA%\Dentiva Pro` with `DENTIVA_DATA_DIR` override | portable folder next to the EXE | safe per-user writes, testability, documented uninstall behaviour; portable mode not offered in v1 (documented) |
| D-20 | NSIS per-user-or-per-machine installer produced only by CI | manual `npm run dist` release | reproducible, auditable release artifacts with checksums |

## Open questions resolved by professional default

1. *Should invoices print dentist details?* — No by default; toggle available in Settings → Invoice (ADD prerequisite for §43).
2. *Are prescriptions and invoices linked?* — Optional linkage (visit/invoice can reference each other) but not required; clinical work must never be blocked by billing.
3. *What happens to a patient with dues on archive?* — Archiving is allowed with a warning; dues remain in receivables reports.
4. *Can treatments be deleted?* — Only deactivated; historical lines keep their own copy of name/price.
5. *Multiple dentists in one print job?* — The prescribing/receiving dentist is explicit per document.
6. *Discount authority?* — Role-based maximum discount percentage (`billing.discount_override` bypasses the cap).
7. *Backup retention default* — keep last 10 automatic packages, never delete manual or pre-restore packages automatically.
8. *Aging buckets* — 0–30, 31–60, 61–90, 90+ days (ADD-05).
