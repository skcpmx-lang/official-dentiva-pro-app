# Dentiva Pro — Known Limitations (honest, current)

These are deliberate, documented constraints of the final build — not hidden defects.

## Architectural / product limitations

1. **No automatic updates.** Dentiva Pro 1.0.0 is a final build; there is no update channel, no
   auto-updater and no phone-home check. Installing a newer package replaces the application while
   the data directory (and therefore all patient data) is preserved.
2. **Single workstation / single database file.** Dentiva Pro is a local application. It does not offer
   networked multi-seat access, cloud sync, or merge of two independent databases. Restoring more than
   one backup file performs **sequential restores** (each one replaces the data), never a merge.
3. **Activation is offline with a fixed code.** Because verification happens without a server and the
   accepted code is fixed, a determined reverse engineer with unlimited binary access could eventually
   recover it. The design prevents plaintext discovery (`strings`-style), trivial patching, and casual
   sharing of modified builds; it cannot make offline activation mathematically unbreakable.
4. **Unsigned installer (default CI build).** Unless the vendor supplies a code-signing certificate in
   CI secrets, Windows SmartScreen will show an "unknown publisher" warning on first run and the
   installer will not be Authenticode-signed. The SHA-256 checksum published with the release is the
   integrity reference.
5. **Bengali search is substring-based.** Storage is NFC-normalised and zero-width characters are
   folded, but there is no stemming/transliteration: searching `দাঁত` does not match `দাত`.
6. **DICOM attachments are stored, not rendered.** `.dcm` files can be attached, opened with the OS
   default viewer and included in backups, but Dentiva Pro does not include a DICOM image renderer.
7. **Charts are lightweight by design.** Trend/summary charts are hand-built SVG; very large
   (100k-row) series are downsampled before plotting — raw analytics belong in the report exports.
8. **Thermal printing depends on the Windows driver.** Dentiva Pro enumerates the printers Windows
   exposes (USB, Bluetooth-paired, network) and sends raw page content with the correct roll width;
   cutter/kick-drawer ESC/POS commands are not emitted.
9. **Age handling.** Age is derived from date of birth when available; a manual age override is stored
   for patients whose DOB is unknown, and historical documents keep the age recorded at the time.
10. **Print colour fidelity** depends on the printer; templates are optimised for monochrome thermal
    output and colour inkjet/laser output alike.

## Environment-dependent items (verified where possible, re-verified on release)

11. macOS/Linux builds are **not** produced; only Windows x64 (10/11) is a supported target.
12. High-DPI behaviour is validated under Electron's Windows scaling emulation in CI and documented in
    `docs/COMPLETION_STATUS.md`; a physical 200 %-scaling workstation check is part of the manual
    acceptance record.
13. Automated tests exercise printing **HTML/PDF generation** and the print pipeline entry points; the
    final physical print on the clinic's own printer remains a user-side verification (test-print button
    and print profiles are provided for that purpose).

## Not defects

Any item above that a clinic considers blocking should be reported to helloiamshohan@gmail.com so it can
be prioritised for a future build. No known crash, data-loss, financial-calculation or permission defect
is outstanding in this build (see `docs/COMPLETION_STATUS.md` for the audit record).
