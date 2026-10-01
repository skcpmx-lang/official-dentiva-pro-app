# Printing verification

> Companion to `docs/PRINTING_SPECIFICATION.md`. Records what is verified automatically in this
> repository, what can only be verified on the Windows build runner, and how to check it there.
> Last update: printing checkpoint (engine, profiles, preview, history).

## 1. What is verified automatically

Run with `npx vitest run` (or `npm run test`). The printing behaviour is covered by:

| Behaviour | Test |
|---|---|
| A rendered document is the exact HTML the printer receives (preview = print = PDF source) | `tests/renderer/printing-ui.test.tsx` (preview `srcdoc` asserted, then the same payload asserted on `printing.print`) |
| A refused printer never loses the document: failure is shown, the preview stays, retry and Save-as-PDF keep working | `tests/renderer/printing-ui.test.tsx`, `tests/integration/printing.test.ts` |
| A failed job stores its rendered HTML under `<dataDir>/print-jobs`, the history row exposes `hasPayload`, and a successful retry deletes the copy | `tests/integration/printing.test.ts` |
| Bengali text reaches the rendered page unchanged (no `?` substitution, no mojibake) | `tests/integration/printing.test.ts` (patient summary asserts the Bengali name in the HTML) |
| A document profile (paper, printer, copies, default flag) is applied when no profile is named in the request | `tests/integration/printing.test.ts` |
| One default profile per document type; archive-with-reason writes an audit entry and hides the profile | `tests/integration/printing.test.ts`, `tests/renderer/printing-settings.test.tsx` |
| Test page uses the requested roll width (`58 mm` → 58 000 µm page) | `tests/integration/printing.test.ts` |
| PDFs are produced offline through the host's `renderPdf`; the saved path is recorded in history | `tests/integration/printing.test.ts` |
| Receipts, appointment slips and reports carry their own identity (payment id, appointment id, report key + period) into the request | `tests/renderer/printing-surfaces.test.tsx` |
| Print history filters and "kept document" viewing | `tests/renderer/printing-settings.test.tsx` |
| Channel registry parity for all 13 `printing.*` channels | `tests/unit/channels.test.ts` |
| Schema migration replay (profiles/history columns) | `tests/integration/database.test.ts` |

These run on Linux with a controllable print host, so they prove orchestration, data handling and page
generation — not the Windows spooler itself.

## 2. What must be verified on Windows

These steps require Electron on Windows and cannot be executed in the Linux build sandbox:

1. **Printer enumeration** — `win32` host reports installed printers with names, ports, default printer
   and status codes; the settings screen lists them.
2. **Actual paper output** — a prescription on A4 and A5, an invoice, a receipt on a 58 mm and an 80 mm
   thermal roll, an appointment slip and a test page. Margins must not clip the header or footer.
3. **Bengali on paper and in the PDF** — the word `ঢাকা` and a patient name in Bengali must be complete
   glyphs (no boxes, no `????`). The same document saved as PDF must match the preview.
4. **PDF byte output** — `renderPdf` produces a real PDF (starts with `%PDF`) and it opens in a viewer.
5. **Printer failure recovery** — pull the printer's cable (or switch it off), print a prescription: the
   dialog must report the failure, keep the document, and allow Retry / Save as PDF. Reconnect and retry:
   the record must print and the stored copy must be gone.
6. **High-DPI** — at 125 % and 150 % scaling the preview must stay readable and the printed layout
   unchanged.
7. **Two printers** — choose the non-default printer in the dialog and confirm Windows printed to it.

## 3. Where the result is recorded

- The CI job `.github/workflows/ci-windows.yml` runs the automated Windows checks and uploads its log.
- Manual results from step 2 go into `docs/COMPLETION_STATUS.md` (checkpoint 16 evidence) with the
  machine, printer model, paper class and outcome, so the record is auditable.

## 4. Known limitations (honest list)

- Printer status codes are passed through as reported by the platform; the app does not interpret
  vendor-specific codes into user-facing messages beyond "the printer refused the document".
- Paper classes are chosen by the operator (and profiles); the app does not interrogate printer
  capabilities, so choosing A4 on a thermal-only printer fails at the spooler with the ordinary error.
- The preview is an embedded document, not a pixel-identical raster of the final print; Chromium's
  pagination in the print pipeline is the authority, which is why the same HTML is used for both.
- Stored failed jobs are pruned by count (40 documents), not by age.
