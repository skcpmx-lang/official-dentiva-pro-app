# Dentiva Pro — Security Model

## 1. Threat model (single-machine clinic workstation)

| Threat | Control |
|---|---|
| Unauthorised physical access to a running session | auto-lock (5/10/15/30 min/configurable), lock screen requires password, all IPC except unlock/logout returns `E_LOCKED` |
| Credential theft from database | scrypt (N=2^15, r=8, p=1, 32-byte key, 16-byte random salt, 64-byte digest) stored as `scrypt$N$r$p$salt$hash`; never plaintext, never reversible, timing-safe comparison |
| Brute force on the lock/login screen | failed-attempt counter per user, exponential delay, temporary lockout (`locked_until`), every attempt written to `login_attempts` + audit log |
| Privilege escalation through the UI | permissions resolved **server-side** in the main process from `users.role_id`; renderer-supplied identity is ignored; every service entry point calls `assertPermission(...)` before touching data |
| Financial data leaks to unprivileged staff | financial services and financial IPC channels require `billing.*`/`accounting.*` permissions; dashboards, notifications, search and exports filter by permission; direct IPC invocation is denied, not merely hidden |
| Tampering with audit history | `audit_log` has no update/delete path in the codebase; modifications are blocked by trigger-level guard (`BEFORE UPDATE/DELETE ... RAISE(ABORT)`) |
| Malicious attachment | extension + MIME allowlist (pdf, jpg, jpeg, png, webp, doc, docx, txt, dicom), max size (configurable, default 25 MB), stored under an app-controlled directory with generated UUID filenames, original name kept only as metadata, `sha256` recorded, never executed by the app |
| Path traversal | every file path resolved through `safeJoin(root, ...segments)`, which refuses NUL bytes and drive-letter/UNC segments outright and then requires the resolved path to stay under the data directory (so `..` and absolute paths are refused); stored paths are always relative. Symbolic links are not chased: the app creates every folder below the data directory with generated names, and a local user who can plant a link there already holds the file system |
| Backup tampering/corruption | manifest with format/schema/app versions, record counts and SHA-256 for database and each attachment; verification before restore |
| Data loss by destructive action | soft delete + typed confirmation + administrator re-authentication + automatic pre-action backup (settings reset, data wipe, business reset, restore) |
| Secret discovery (activation) | no plaintext activation code anywhere in the repository or bundle; only a salted derived verifier is stored; verification uses a slow KDF + constant-time compare (see §3) |
| Secrets in logs | logger redacts password/hash/activation fields and truncates clinical text; no patient names in log messages, only ids |
| Network exfiltration | production code contains no HTTP client, no telemetry, no analytics, no CDN, no remote URL; CSP `default-src 'self'`; `webRequest` blocks all non-`file:`/`app:` schemes in production |
| Electron hardening | `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webviewTag:false`, `allowRunningInsecureContent:false`, `webSecurity:true`, `spellcheck:false`, navigation and `window.open` handlers deny external destinations |

## 2. Permission catalog (granular, enforced in the service layer)

```
patients.view|create|edit|archive|export
clinical.view|create|edit|delete
prescriptions.view|create|edit|print|export|templates
appointments.view|create|edit|cancel|delete
queue.view|manage
billing.view|create|edit|void|refund|discount_override
payments.view|create|edit|void|refund|export
accounting.view|create|edit|delete|reports|export
inventory.view|create|edit|adjust|delete
suppliers.view|manage
staff.view|manage
users.view|manage
roles.view|manage
audit.view|export
settings.view|modify
printing.configure|print
backups.create|restore|configure
data.export|import|maintenance|wipe
reports.view|financial
```

Default roles: **Owner** (all), **Administrator** (all except `data.wipe` unless Owner), **Dentist**
(clinical + prescriptions + patients view/edit + appointments view + queue + own printing),
**Receptionist** (patients, appointments, queue, billing/payments create, no accounting view),
**Dental Assistant** (patients view, clinical view, queue, inventory view),
**Accountant** (payments view, accounting, billing view, reports financial, no clinical),
**Inventory Manager** (inventory + suppliers + purchase expenditure only).

`data.wipe`, `backups.restore`, `roles.manage` and `users.manage` are Owner/Administrator-only by default.

## 3. Offline activation design

* The vendor-issued code is never embedded. A **verifier** is derived and embedded as:
  `verifier = scrypt(code, salt=DENTIVA_STATIC_SALT_V1, N=2^18, r=8, p=1, dkLen=32)`,
  stored as splits of a hex string assembled at runtime (no contiguous literal in source or bundle).
* Input is normalised (trim, strip spaces/dashes) then run through the same KDF and compared with
  `crypto.timingSafeEqual`. Verification is rate-limited (attempt counter with delay after 3 failures).
* State persisted in `license_state` with `activated_at`, fingerprint (first 8 bytes of the verifier
  hash), machine id (Windows machine GUID or a per-install UUID) and attempting user.
* A tamper check re-derives the stored fingerprint at every startup and marks the record invalid if it
  was edited outside the app, returning the user to activation.
* **Documented limitation:** because verification is offline and the accepted code is fixed, a
  determined reverse engineer with unlimited access to the binary could discover the accepted code.
  The design goal is to prevent casual extraction/`strings`-style discovery and trivial patching by
  keeping no plaintext, using a slow KDF, constant-time comparison and integrity checks.

## 4. Session and locking

`SessionManager` (main process) owns sessions: `{ userId, username, fullName, roleId, permissions,
lockedAt, lastSeenAt }` keyed by `webContents.id`. The renderer holds no authority: it never sends
a user id, never sends permission claims, and cannot mark itself unlocked — `auth.unlock` re-verifies
the password in the main process.

Auto-lock triggers on the configured idle timeout (main-process timer + renderer heartbeat),
on system suspend/lock where detectable, and manually via `Ctrl+L`. Unsaved form state is preserved
in the renderer only as inert client state (no medical data written to disk while locked).

## 5. Audit events (mandatory set)

login success/failure/logout/lock/unlock · activation attempt/success/failure · setup completion ·
user create/update/deactivate/password reset · role create/update/permission change · setting change ·
patient create/update/archive/export · clinical record create/update · prescription create/print/export ·
appointment status change · invoice create/update/void · payment create/void/refund · inventory adjustment
· supplier create/update · accounting entry create/void · staff create/update · backup created/verified/
failed · restore started/completed/failed/rolled-back · data export/import · maintenance operations ·
destructive operations (typed confirmation captured in `detail_json`).

Each entry: `at, user_id, username, module, action, entity_type, entity_id, summary, detail_json, result, session_id`.

## 6. Logging & privacy rules

* Rotation: 7 daily files, 5 MB cap each, oldest pruned; logs live in `<data>/logs`.
* Never logged: passwords, hashes, activation code/verifier, full clinical text, attachment contents,
  patient addresses or phone numbers (`patientId` is used for correlation instead).
* Diagnostic bundle (Settings → Data → Support) collects logs + environment + schema version **only**,
  with a preview so nothing leaves the machine unnoticed.

## 7. Destructive action policy

| Action | Requirements |
|---|---|
| Archive patient | permission + confirmation |
| Delete draft/transient rows | permission + inline confirm |
| Void invoice / payment / accounting entry | permission + mandatory reason + audit |
| Remove user | permission + cannot remove last Owner + audit |
| Reset settings | admin re-auth + pre-action backup + typed `RESET SETTINGS` |
| Delete all data | admin re-auth + pre-action backup + typed `DELETE ALL DATA` + audit |
| Delete business/practice | Owner only + password re-auth + pre-action backup + typed business name + audit |
| Restore backup | permission + validation + automatic pre-restore backup + typed `RESTORE` |

## 8. Verification checklist (security audit, §120)

plaintext secrets absent · passwords hashed · activation not plaintext · RBAC enforced in services ·
financial IPC guarded · audit append-only · path traversal blocked · attachment allowlist enforced ·
no external endpoints in production source · dependencies license-audited · CSP enforced ·
devtools disabled in production build · installer signed metadata documented (unsigned build limitation
recorded in `docs/KNOWN_LIMITATIONS.md`).

## 9. Verification record (checkpoint 18)

The checklist in §8 is no longer a promise: most of it is a CI step or a test. `npm run audit:security`
(`scripts/audit-security.mjs`) runs in `.github/workflows/ci.yml` and fails the build when any of the
static checks below regress.

| §8 item | How it is verified | Result |
|---|---|---|
| no plaintext secrets | `scripts/audit-security.mjs` reports every 16-digit group that is not a documented test fixture, and prints nothing that could be a code itself; `tests/integration/activation-plaintext.test.ts` goes further and runs **every** code-shaped string in the tree (however it is grouped or spelled) through the real verifier, so a production code cannot be present without failing | ✅ — one occurrence found and removed: `tests/renderer/activation.test.tsx` typed the live code into a mocked screen. It now types a fixture, and the suite rejects every value in the tree |
| passwords hashed | scrypt (N=2^15, r=8, p=1, 64-byte digest, per-user salt) in `modules/users`, verified by `tests/integration/users.test.ts`; no plaintext or reversible form is stored or logged | ✅ |
| activation not plaintext | the verifier is a permuted, XOR-masked fragment table assembled at runtime; the audit refuses a contiguous ≥32-character hex literal in `verifier.ts` and requires ≥8 fragments, scrypt and a timing-safe compare | ✅ |
| RBAC enforced in services | the audit resolves every handler entry to the service function it delegates to (one further hop for thin wrappers) and fails when no `assertPermission`/`assertAnyPermission` is reachable: **196 channels** checked. Channels that answer before a session exists, about the caller's own session/preferences, or that filter per row instead of refusing (notification centre, clinic-wide search) are listed as deliberate exceptions in the script | ✅ after fixes (below) |
| financial IPC guarded | billing/payments/accounting services assert their own permissions; `tests/integration/{billing,accounting}.test.ts` exercise the refusals, and end-to-end workflow 08 drives a restricted role over real IPC and expects `E_PERMISSION` | ✅ (end-to-end run pending on the Windows runner) |
| audit append-only | `BEFORE UPDATE`/`BEFORE DELETE` triggers raise `ABORT`; the audit requires both triggers to exist and `tests/integration/database.test.ts` attempts the writes | ✅ |
| path traversal blocked | `safeJoin` (see §1) checked by the audit for the containment test, the NUL rejection and the drive-letter rejection, and exercised by `tests/integration/ipc-authorisation.test.ts` (traversal, absolute path, NUL, drive letter, UNC) | ✅ |
| attachment allowlist enforced | extension + MIME + magic-byte allowlist, 25 MB cap, generated file names, `sha256` recorded (`files/attachments.ts`, `files/storage.ts`) | ✅ |
| no external endpoints in production source | `npm run audit:offline` over `src/**` (with the documented licence-URL exemption) | ✅ |
| dependencies license-audited | `npm run audit:deps:check` — 15 bundled components, MIT/ISC/OFL only, `THIRD_PARTY_NOTICES.md` verified | ✅ |
| CSP enforced | meta policy in `renderer/index.html`, header policy plus a `webRequest` hook in `main/index.ts`; the audit requires all three | ✅ |
| devtools disabled in production | `devTools: !app.isPackaged`, and the audit fails an `openDevTools()` call that is not inside a packaged-build guard | ✅ |
| installer signing limitation recorded | `docs/KNOWN_LIMITATIONS.md` §1 (unsigned build, SmartScreen warning) | ✅ |

### Gaps this checkpoint found and fixed

The channel walk is the reason this checkpoint exists — the three findings below were reachable from a
renderer that hides the buttons, which is exactly the gap §55 warns about.

| Channel | Before | Now |
|---|---|---|
| `dentists.save` | wrote the dentist register (the professional identity printed on prescriptions) with no permission check, while `setDentistActive`, `archiveDentist` and `uploadDentistPhoto` all required one | `settings.modify`, like its siblings |
| `settings.uploadLogo`, `settings.clearLogo` | replaced or deleted the clinic branding, audit-logged but unauthenticated | `settings.modify` in the handler; the underlying `updateClinicProfile` already asserted it |
| `inventory.batches` | returned batch numbers, expiry dates and unit costs to any signed-in user | the service now requires `inventory.view`, `inventory.adjust` or `inventory.create` (so a stock clerk can still issue stock) |

All three are pinned by `tests/integration/ipc-authorisation.test.ts`, and the audit will fail if a
future channel forgets its assertion.

### What this checkpoint cannot decide here

Sandbox limits are stated rather than assumed: this machine has no Wine, no packaged build and no
printer, so the packaged-app hardening (an installer launched from a real clean Windows profile), a
refused printer at the driver level, and the end-to-end workflows themselves remain with the Windows
runner. `docs/CLEAN_MACHINE_TEST.md` records the manual half, and the workflow artefacts are the
machine half.
