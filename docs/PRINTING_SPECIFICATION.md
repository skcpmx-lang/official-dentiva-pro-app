# Dentiva Pro — Printing & PDF Specification

## 1. Subsystem overview

Printing is a first-class subsystem (`src/main/printing`), shared by preview, physical print and PDF,
so all three render **identical HTML/CSS** for a given document.

```
document model (typed)  →  builder (paper-class aware)  →  HTML + CSS (fonts embedded/linked)
        │                                                        │
        ├── preview  → renderer iframe srcDoc                    ├── print → hidden BrowserWindow → webContents.print()
        └── history  → print_history row                         └── pdf   → webContents.printToPDF()
```

## 2. Paper classes and templates

| Class | Sizes | Template behaviour |
|---|---|---|
| `a4` | 210×297 mm | full clinical layout, two columns for prescription (left C/C·O/E·R/E·advice, right medicines), invoice table with 6 columns |
| `a5` | 148×210 mm | compact layout: reduced type scale (9.5 pt), single-line clinical sections with inline labels, medicine table condensed to 5 columns, condensed invoice header |
| `thermal` | 58 mm / 80 mm roll | receipt layout: centred clinic name, itemised lines, totals right aligned, no tables, no signature block, auto-wrapping text, `@page size: 58mm auto` |
| `mini` | 110×150 mm | short-form receipt/invoice for mini printers |
| `custom` | user-defined mm | reflow using the thermal/compact engine selected by width (< 100 mm → receipt engine, < 170 mm → compact, else full) |

`paperClassFor(widthMm)` decides the engine; templates never scale A4 down to a receipt.

## 3. Supported documents

| Document | Paper classes | Contents |
|---|---|---|
| Prescription | a4, a5, thermal | clinic header (logo, name, address, phone), prescribing dentist name + all designations/qualifications/certifications, patient block (name, code, gender, age, date, visit no), clinical columns C/C, O/E, R/E/advice, medicine list (name, strength, form, dose M/A/N, timing, duration, quantity, instructions/PRN), footer message, clinic hours, follow-up, signature area (empty; never auto-generated) |
| Invoice | a4, a5, thermal, mini | clinic header, invoice no/date/status, patient, line items with qty/price/discount, subtotal, discount, total, paid, due, payment history (A4/A5), thank-you footer |
| Patient clinical summary | a4, a5 | demographics, alerts/allergies, visits, treatments, prescriptions summary, current chart findings, dues (permission filtered) |
| Financial reports | a4 | KPI strip, tables, period statement |
| Appointment slip | a5, thermal | patient, dentist, date/time, reason, queue no |
| Payment receipt | a5, thermal | receipt no, patient, invoice, amount, method, balance |

## 4. Print preview UX

* Preview renders the real document HTML in a sandboxed iframe with the exact page size, showing page
  boundaries and a zoom control (fit-width / 100 % / 125 %).
* Controls: printer (from `webContents.getPrintersAsync()`, with status), paper class + custom size,
  orientation, margins, scale, copies, duplex where supported, `Print`, `Save as PDF`, `Close`.
* Printer state: unavailable/disconnected printers are shown disabled with the reason; if printing fails,
  the document is preserved and the user is offered `Retry`, `Save as PDF`, or `Change printer`.
* Preview never mutates the record. Printing increments `printed_count`/`last_printed_at` and writes a
  `print_history` row (document type, record, user, profile, printer, result).

## 5. Printer profiles

`print_profiles` rows bind: name, document type, printer name, paper class, custom dimensions,
orientation, four margins, scale (bp), copies, thermal width, default flag, active flag.
Profiles are managed in **Settings → Printing → Printer Profiles** and can be exercised with
**Test print**. Each document type resolves its default profile; users may override per print job.

## 6. PDF generation

`webContents.printToPDF` with explicit page size in microns (A4 210000×297000, A5 148000×210000,
thermal width × dynamic height), matching margins and `printBackground: true`.
Output uses the same HTML as the print path, therefore Unicode/Bengali, logos and layout are preserved.
PDF is written to a user-selected path (default `<Documents>\Dentiva Pro Exports`, or the cloud-free
folder of choice) and registered in print history with `result='success'`.

## 7. Fonts

Bundled woff2 assets (`@fontsource` Inter + Noto Sans Bengali) are copied into the build output and
referenced by absolute `file://` URLs derived from `app.getAppPath()`; a data-URI embedding fallback is
used when the print window cannot resolve `file://` resources (validated by automated print tests).
No remote font is requested at any time.

## 8. Print test matrix (automated where possible, manual verification otherwise)

Prescription: A4 / A5 / thermal(58, 80) × {Bengali name + Bengali clinical text, 1 medicine, 12 medicines,
long instructions, PRN instruction, 4 qualifications, 2 designations, secondary dentist selection,
long free-text advice}. Invoice: A4 / A5 / thermal / mini × {single line, 15 lines, discount, partial
payment, fully paid, unpaid with due, Bengali patient name, voided invoice watermark}. Reports: A4 with
10k+ rows (paginated). Appointment slip and payment receipt on A5 + thermal.

Automated coverage: HTML generation snapshots for every template/paper combination, assertion that
Bengali glyph runs and dentist identity are present, page-size CSS assertions, PDF byte-level generation
test (hidden window) on Windows CI, and manual pixel review recorded in `docs/COMPLETION_STATUS.md`.
