# Dentiva Pro 1.0.0 — Final

Dentiva Pro is a complete, fully offline dental-clinic management application for Windows. It runs on
the clinic's own computer: there is no cloud database, no online account, no subscription check, no
telemetry and no advertising. After installation the application never needs an internet connection.

This is the final build. There is no update channel and no future-feature scaffolding in the product.

## What is in this release

| Area | What the release contains |
| --- | --- |
| Patients | Unlimited patient history, profiles with Bengali and English names, timeline, attachments, referrals, duplicate detection |
| Clinical | Visits with treatment lines and attachments, adult and pediatric dental charts on FDI numbering, multi-medicine prescriptions with C/C-O/E-R/E sections and advice |
| Scheduling | Appointment calendar, day and week views, patient queue with live status, missed-appointment tracking |
| Billing | Invoices, partial payments, refunds and adjustments, dues tracking, receipt numbering, daily collections |
| Money in/out | Expense and income ledger, payment methods recorded as categories (cash, bKash, Nagad, Rocket, Upay, card, bank, other) |
| Stock | Inventory items, batches with expiry, suppliers, purchase orders, low-stock and expiry alerts |
| Insight | Dashboard, reports (patients, revenue, treatments, stock, staff productivity), CSV export with UTF-8 BOM |
| People | Staff and user accounts, seven built-in roles plus custom roles, 67 granular permissions enforced in business logic |
| Accountability | Audit log of every write, automatic lock after inactivity, backups with restore history |
| Documents | A4, A5, 58 mm and 80 mm thermal, mini and custom paper sizes; on-screen preview, printer selection, and offline PDF |
| Data safety | Backup and restore with pre-restore snapshot, validation, rollback and retention |

Everything is priced in BDT (৳) and formatted for Bangladesh. Bengali text is stored, searched,
printed and exported without corruption — the bundled Inter and Noto Sans Bengali fonts ship inside
the installer, and nothing is ever loaded from the internet.

## Installation

1. Check the SHA-256 of the downloaded file against `SHA256SUMS.txt` published with this release:

   ```powershell
   Get-FileHash .\DentivaPro-Setup-1.0.0.exe -Algorithm SHA256
   ```

2. Run `DentivaPro-Setup-1.0.0.exe`. It installs for all users of the computer, creates a Start Menu
   entry and, optionally, a desktop shortcut.
3. On first start, Dentiva Pro asks for the clinic details and the activation code supplied with your
   licence. Activation is offline: the code is checked on the computer, nothing is sent anywhere.
4. Sign in with the administrator account you create during setup.

**Requirements:** Windows 10 or Windows 11, 64-bit, 4 GB RAM, 500 MB free disk space (plus room for
patient data and backups), any printer Windows can see.

**Uninstalling** removes the application. Your clinic data in `%APPDATA%\Dentiva Pro` is kept unless
you explicitly choose to delete it on the uninstall page (a silent `/S` uninstall never deletes data).

## Portable copy

`DentivaPro-1.0.0-portable.zip` contains the unpacked application for running from a USB drive or a
network folder without installing. It uses the same data directory and is intended for evaluation and
for moving data between machines, not for shared simultaneous use.

## Backup before you start working

Set an automatic backup schedule in *Settings → Backup* on the first day. Keep a copy of the backup
folder on a separate drive. The restore screen validates an archive and takes a safety copy of the
current database before replacing anything.

## Known limitations

The honest list ships with the product and is published in `docs/KNOWN_LIMITATIONS.md`: the installer
is not Authenticode-signed by default (SmartScreen warns once), activation is a fixed offline code (a
determined attacker with unlimited binary access could eventually recover it — it is not a
cryptographic guarantee), the app is single-workstation, and Bengali search is substring-based.
Nothing on that list is hidden, and none of it affects routine clinic work.

## Support

Shohan Khan — helloiamshohan@gmail.com

When reporting a problem, include the build identity shown on *About* (version, build number and commit
— the installed copy records exactly which build it is), the steps you took, and the log files from
*About → Open log folder*.
