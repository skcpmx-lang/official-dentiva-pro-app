# Dentiva Pro — UI / UX Specification

## 1. Design language

Premium clinical instrument: deep navy structure, restrained teal/cyan accents, generous whitespace,
crisp 1 px borders, soft elevation, no gradient noise, no oversized rounded cards, no decorative colour.
Everything is legible, calm and dense enough for professional daily use.

## 2. Design tokens (`src/renderer/src/design/tokens.css`)

Spacing scale (8 px base): `--sp-1:4 --sp-2:8 --sp-3:12 --sp-4:16 --sp-5:20 --sp-6:24 --sp-8:32 --sp-10:40 --sp-12:48`

Radii: `--r-sm:6 --r-md:8 --r-lg:12 --r-xl:16 --r-full:999`
Elevation: `--el-1: 0 1px 2px rgba(15,23,42,.06)` … `--el-4: 0 16px 40px rgba(15,23,42,.18)`
Durations: `--dur-fast:120ms --dur:180ms --dur-slow:260ms` easing `--ease: cubic-bezier(.2,.8,.2,1)`
Breakpoints: `sm 1024, md 1280, lg 1440, xl 1680, 2xl 1920`

Colour roles (light clinical theme, `[data-theme]` overridable):

| Token | Value | Use |
|---|---|---|
| `--navy-900/800/700` | #0B1F3A / #10294A / #17365D | sidebar, headers, primary text on light |
| `--brand-600/500/400` | #0E6F87 / #12879F / #3AA8BE | primary actions, focus rings, accents |
| `--teal-500`, `--cyan-400` | #14B8A6, #22D3EE | supporting accents, chart series |
| `--slate-900…50` | standard slate ramp | text/neutral surfaces/borders |
| `--surface`, `--surface-2`, `--bg` | #FFFFFF, #F8FAFC, #F1F5F9 | cards, page background |
| `--success/warn/danger/info` | #16A34A / #D97706 / #DC2626 / #2563EB (+ `-soft` tints) | status only |

Typography: UI font stack **Inter** (bundled woff2, system fallback `Segoe UI`);
Bengali stack **Noto Sans Bengali** (bundled). Sizes: display 28/34, page-title 22/30,
section 17/24, card-title 15/22, body 14/21, secondary 13/19, label 12/16 (600, .02em),
helper 12/16, table 13/18, KPI 30/36 (tabular numerals). All numerals use `font-variant-numeric: tabular-nums`.

## 3. Shell layout (`docs` §15/§16/§142)

| Element | Spec |
|---|---|
| Header | height 68 px; brand + clinic name (left), global search, notifications bell, clock/date, quick actions, profile menu, lock button (right) |
| Sidebar | expanded 272 px, collapsed 72 px, collapse animates 180 ms (`transform`/`width`, no layout jump); icons 20 px, text 13.5 px, section labels 11 px uppercase; tooltips when collapsed; scrollable nav region; keyboard navigable (roving tabindex, Enter/Space activates) |
| Content | page padding 24 px (32 px ≥ 1920), max content width 1720 px, gap 20 px between blocks, grid 12 columns |
| Cards | radius 12 px, 1 px `--slate-200` border, `--el-1` shadow, padding 20 px |
| Controls | input/select 40 px, large primary 44 px, icon button 36 px, table row 44 px (compact 36), modal widths sm 420 / md 560 / lg 760 / xl 1000 / 2xl 1240, modal max-height `88vh` with internal scroll |
| Toasts | bottom-right, 320–420 px, auto-dismiss 5 s (errors persist until dismissed) |

Responsive behaviour: above 1440 px sidebar starts expanded and content uses 4/3/2/1-column card grids
(4 KPI in a row; six equal cards always resolve to 3+3). 1024–1440 px: sidebar collapsed by default,
3→2 column grids. Below 1024 px (small laptops / split view): single column, KPI cards 2-up, tables
switch to horizontal scroll with sticky first column and pinned row actions; no control may be pushed
off-screen, no page-level horizontal scroll. Modals become full-width sheets with internal scroll.

## 4. Screen inventory (with layout intent)

| # | Screen | Layout notes |
|---|---|---|
| 1 | Activation | centred 480 px card, product mark, code field, attempt counter, support instructions |
| 2 | Setup Wizard | stepper 5 steps (Clinic / Dentists / Administrator / Practice / Confirm), validation per step, "Back/Next", final summary table + typed confirmation |
| 3 | Login | split screen: left brand panel (navy, product story), right 380 px form; username, password, remember-username, error region, caps-lock hint |
| 4 | Lock Screen | blurred shell behind, centred unlock card, clock, "sign out instead" |
| 5 | Dashboard | 4 KPI cards row; queue + today's appointments (2 cols); revenue trend chart + payment mix; recent patients, outstanding invoices, low stock, notifications |
| 6 | Patient List | toolbar (search, date-range presets + custom range, status, tag) + table (code, name, age/gender, phone, last visit, due, actions) + pagination + bulk export |
| 7 | New/Edit Patient | 2-column form: identity, contact, clinical history, alerts; inline validation; duplicate-phone/code guard |
| 8 | Patient Profile | header band (avatar, code, alerts chips, quick actions) + tabs Overview / Clinical / Appointments / Financial / Activity |
| 9 | Timeline | vertical chronological stream, icon per event type, filter bar (date, dentist, type, module), lazy "load more" |
| 10 | New Visit | 3-column clinical workspace: complaint/history/exam, findings + teeth picker, treatment/plan; footer actions (save, save & prescribe, save & invoice) |
| 11 | Dental Chart | adult/primary toggle, two arches, per-tooth state colours + legend, multi-select, conditioner panel, visit linkage, save/reset |
| 12 | Appointments | day/week/month views, dentist filter, slot grid, status chips, drag-free rescheduling dialog (audited) |
| 13 | Appointment Creation | patient picker (search + create), dentist, date/time slot, duration, reason, notes |
| 14 | Queue | board columns (Waiting / Called / In progress / Completed) with wait timers, call-next, start, skip, requeue |
| 15 | Treatments | catalog table with category filters, price edit inline, active toggle |
| 16 | Treatment Editor | modal form (name, code, category, price, duration, description, active) |
| 17 | Prescriptions | list (rx no, patient, dentist, date, medicines count, actions) + filters |
| 18 | Prescription Creation | left column C/C, O/E, R/E, advice, diagnosis; right column medicine builder rows; footer follow-up + save/print |
| 19 | Prescription Preview | A4/A5/thermal/PDF aware preview panel, paper selector, print controls, "printed N times" info |
| 20 | Invoice List | filters (status, date, patient), table with totals, dues highlighted, actions (view, print, void) |
| 21 | Invoice Creation | patient picker, line builder from treatment catalog + custom lines, discount (limited by role), totals summary, save/print |
| 22 | Invoice Preview | paper-aware preview, payments list, void action with reason |
| 23 | Payments | list with filters, method chips, refund action, export |
| 24 | Payment Entry | invoice picker or standalone advance, amount, method, reference, receiver, notes, overpay guard |
| 25 | Inventory | table (item, category, stock, reorder, expiry status, value) + filters + alerts banner |
| 26 | Inventory Item | drawer: details, batches, movements ledger, stock actions (in/out/adjust/damage/expire/return/consume) |
| 27 | Suppliers | table + editor + purchase history |
| 28 | Accounting | tabs Income / Expenses / Categories; entry table, totals strip, filters, export |
| 29 | Accounting Entry | modal: kind, category, date, amount, method, reference, party, description |
| 30 | Financial Reports | report picker, date range, KPI strip, charts, tables, CSV/PDF export |
| 31 | Staff | table + editor drawer (sensitive fields masked until revealed) |
| 32 | Staff Profile | details, linked user, salary history summary, employment status |
| 33 | Users | table (username, staff, role, last login, status) + editor (create, reset password, activate) |
| 34 | Roles & Permissions | role list + permission matrix grouped by module with select-all/clear, custom roles |
| 35 | Audit Log | filter bar (user, module, action, result, date) + virtualised table + detail drawer + CSV export |
| 36 | Backup | settings (folder picker, automatic schedule, retention), manual backup (quick/full), history table, verify |
| 37 | Restore | file picker, package validation report, pre-restore backup notice, typed confirmation, progress, result/rollback |
| 38 | Settings | section nav: Clinic / Dentists / Users & Security / Printing / Prescription / Invoice / Inventory / Backup / Data / Accessibility |
| 39 | Printer Profiles | profile table + editor (printer, paper class, orientation, margins, scale, copies, default) + test print |
| 40 | Notifications | popover list + full page history with filters and dismiss |
| 41 | Global Search | command palette (Ctrl+K): grouped results, keyboard navigation, section routing |
| 42 | About | product, author, version/build/schema, license, third-party notices, dependency list |
| 43 | Error State | illustration-free, title, description, "Try again"/"Open data folder"/"Contact support" |
| 44 | Empty State | contextual icon, title, explanation, primary action, secondary hint |
| 45 | Loading State | skeletons that match the final layout (no spinners on full pages) |
| 46 | Permission Denied | explanation + request-access guidance; route guard prevents render |

## 5. Component contracts

* **Buttons**: variants primary / secondary / tertiary / ghost / destructive / icon; states
  default, hover, active, focus-visible, loading (inline spinner + disabled), disabled with reason tooltip.
* **DataTable**: columns with width + align + sortable flags, sticky header, row actions menu,
  pagination (25/50/100/All), empty state slot, loading skeleton, error slot, keyboard row navigation,
  column overflow handled with `text-overflow` + title.
* **Forms**: label above input, required `*` marker in label, helper text below, error message replaces
  helper, aria-invalid + aria-describedby, disabled while submitting, dirty-state guard on navigation.
* **Modal / Drawer**: focus trap, Esc closes (unless destructive in progress), scroll lock, `aria-modal`,
  return focus to trigger, unsaved-changes confirmation.
* **Toasts**: success/info/warning/error, optional action button ("View invoice", "Retry").
* **Charts**: hand-built SVG (line/bar/donut) with tooltips, no external chart dependency, palette from
  tokens, animated entrance ≤ 260 ms, disabled by reduced-motion, "no data" state instead of empty axes.

## 6. Interaction & keyboard

Shortcuts: `Ctrl+K` global search · `Ctrl+Shift+P` new patient · `Ctrl+Shift+A` new appointment ·
`Ctrl+Shift+V` new visit · `Ctrl+Shift+R` new prescription · `Ctrl+Shift+I` new invoice ·
`Ctrl+Shift+M` record payment · `Ctrl+P` print current document · `Ctrl+L` lock · `Alt+1..4`
jump to section roots · `Ctrl+/` keyboard help. All shortcuts are discoverable from the help dialog
and tooltips; none collide with native Windows/Chromium bindings.

## 7. Copy & microcopy rules

Human, specific, actionable: *"Unable to create the backup because the selected folder is not writable."*
+ `Choose another folder` + `Retry`. Never expose error codes alone, stack traces, table or column names.
Destructive dialogs state what will be lost, what will be preserved and whether it can be undone.

## 8. Accessibility

WCAG 2.1 AA contrast targets, visible 2 px focus ring (`--brand-500`) with offset, all interactive
elements keyboard reachable in DOM order, icon-only buttons carry `aria-label`/tooltip, tables use
`scope` headers and caption, live regions announce save/print/backup results, `prefers-reduced-motion`
and an in-app setting both disable non-essential animation.

## 9. Visual QA matrix

Screens × resolutions (1280×720, 1366×768, 1440×900, 1600×900, 1920×1080, 2560×1440) × scaling
(100/125/150/175/200 %) checked for: alignment, spacing rhythm, typography, icon alignment, button
sizes, clipping, overflow, scroll behaviour, sticky headers, dialog fit, empty/loading/error states,
table overflow with pinned actions, chart readability, print preview fidelity.
