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
| Path traversal | every file path resolved through `safeJoin(root, ...segments)` which rejects `..`, absolute paths, drive letters, NUL bytes and symlink escapes; stored paths are always relative |
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
