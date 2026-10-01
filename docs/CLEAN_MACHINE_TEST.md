# Dentiva Pro — Clean-Machine Install / Uninstall Verification

This is the procedure the owner (or a tester) runs on a **clean Windows machine** before a release is
announced. It cannot be automated from this repository: GitHub's Windows runners are disposable but
they are not a real clinic machine, and the point of this pass is precisely to prove the installer on
a computer that has never seen Dentiva Pro.

Record the results in the table at the end. Anything that fails is an open defect — never "expected".

**Machine used:** a Windows 10 or Windows 11 x64 machine (physical or a fresh VM) with no previous
Dentiva Pro installation, no developer tools and no Node.js. A VM snapshot taken before step 1 lets the
run be repeated exactly.

## A. Prepare

| # | Step | Expected |
| --- | --- | --- |
| A1 | Download `DentivaPro-Setup-1.0.0.exe` and `SHA256SUMS.txt` from the release. | Both files present. |
| A2 | `Get-FileHash .\DentivaPro-Setup-1.0.0.exe -Algorithm SHA256` | Matches the line in `SHA256SUMS.txt` exactly. **Stop if it does not.** |
| A3 | Confirm `%APPDATA%\Dentiva Pro` does not exist. | Folder absent. |
| A4 | Note the free disk space. | At least 500 MB. |

## B. Install

| # | Step | Expected |
| --- | --- | --- |
| B1 | Run the installer as a standard user. | Windows shows the elevation prompt (per-machine install). SmartScreen may warn about an unknown publisher — documented limitation, continue with *More info → Run anyway*. |
| B2 | Licence page. | The Dentiva Pro licence text is shown and must be accepted to continue. |
| B3 | Choose an installation folder (for example `D:\Dentiva Pro`) and finish. | Installer completes without errors; the last page offers to run the application. |
| B4 | Check Start Menu. | "Dentiva Pro" entry exists, icon renders at every Windows scaling (100 % → 200 %). |
| B5 | Check the desktop shortcut, if selected. | Shortcut exists and its icon renders. |
| B6 | Check `Program Files` (or the chosen folder). | Application files installed; `resources\build-info.json` present inside the app resources. |
| B7 | **Disconnect the network** (unplug or disable Wi-Fi) and start Dentiva Pro. | The application starts normally. It must never require a connection. |
| B8 | First run: clinic setup. | Setup asks for clinic identity and the administrator account. Bengali fields accept Bengali input. |
| B9 | Activation: type a wrong code. | Rejected with a clear message; no state written; the field can be retried. |
| B10 | Activation: type the correct code. | Accepted once; stored in the data directory; the application continues to login. |
| B11 | Restart the application. | No activation prompt; the code is not requested again. |
| B12 | Log in with a wrong password five times (the configured limit). | Account locks with the configured message; the audit log records the failures. |
| B13 | Log in with the correct password. | Dashboard opens. |

## C. Working copy

| # | Step | Expected |
| --- | --- | --- |
| C1 | Create one patient with Bengali name and address, plus an attachment. | Saved; Bengali renders in the list, the profile and the printed record. |
| C2 | Create a visit, a chart entry, a prescription and an invoice with a partial payment. | Saved; totals in ৳; due amount correct. |
| C3 | Print the prescription to PDF (Microsoft Print to PDF). | PDF opens; Bengali is correct (no `????` and no boxes). |
| C4 | Print the invoice to a real A4 printer and to a thermal printer if one is attached. | Paper-aware layout; nothing cut off. |
| C5 | Open *About*. | Version 1.0.0, a build number, the commit recorded at packaging time and the author (Shohan Khan) are shown. |
| C6 | Close the application and check Task Manager. | No Dentiva Pro process and no stray background process remains. |
| C7 | Close the application and run `npm run stress:seed` equivalent from the developer machine only — **not** required here. | Data volume is proven by the automated stress run, not on the clean machine. |

## D. Uninstall, keeping data

| # | Step | Expected |
| --- | --- | --- |
| D1 | Windows *Settings → Apps → Dentiva Pro → Uninstall*. | Uninstaller starts; the data question appears with **No** preselected. |
| D2 | Answer **No** (keep my data) when asked to delete clinic data. | Application removed. `%APPDATA%\Dentiva Pro` still present with the database and backups. |
| D3 | Check Start Menu and desktop. | Shortcuts and the install folder are gone. |
| D4 | Reinstall from the same installer. | Setup/activation are not requested again — the original database is opened and the login screen appears with existing data intact. |

## E. Uninstall, deleting data, and silent uninstall

| # | Step | Expected |
| --- | --- | --- |
| E1 | Uninstall and answer **Yes** to deleting clinic data. | `%APPDATA%\Dentiva Pro` is removed. Take a backup first if this is not a test machine. |
| E2 | Install again, then run the uninstaller silently: `DentivaPro-Setup-1.0.0.exe /S` (or `Uninstall Dentiva Pro.exe /S`). | Uninstalls without prompting **and never deletes the data directory**, even if `%APPDATA%\Dentiva Pro` exists. |
| E3 | Confirm the application can be installed a third time into a different folder. | Clean install; existing data directory is reused. |

## F. Rollback and upgrade path

| # | Step | Expected |
| --- | --- | --- |
| F1 | Restore the VM snapshot, install, then uninstall. | No leftover registry entries under `HKLM\Software\Dentiva Pro`, no service, no scheduled task. |
| F2 | Install the release again over an existing installation. | The installer replaces the application; patient data is untouched. |

## G. Record

| Check | Result | Date | Machine / Windows build | Notes |
| --- | --- | --- | --- | --- |
| A2 checksum verified | ☐ | | | |
| B install + activation | ☐ | | | |
| B7 offline start | ☐ | | | |
| C printed output (Bengali, A4 + thermal) | ☐ | | | |
| D uninstall keeps data | ☐ | | | |
| E1 uninstall deletes data when confirmed | ☐ | | | |
| E2 silent uninstall keeps data | ☐ | | | |
| F no leftovers after uninstall | ☐ | | | |

Owner sign-off: ______________________  Date: ______________

Attach photographs or screenshots of B4, B5, C3 and C4 to the release checklist — the printed-page and
icon rendering checks are visual by nature and cannot be proven by a test runner.
