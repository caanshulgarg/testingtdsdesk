# Arc UI in FinCom

These files are copied from **Arc** by Elia Kuratli, MIT licence (`LICENSE` in this folder, copied unchanged).

- Source: https://github.com/kuratlielia/arc-library (cloned with git; uiarc.dev is not reachable from the build machine)
- Commit: `86330cc9270c4acc55b7204c9583fcbaa378192c` (09-Oct-2026)
- Copied on 09-Oct-2026 for the arc-ui branch (step 1 and step 2: React 19, the foundation and the shared parts).

## What is here

| Here | From the Arc repository |
|---|---|
| `foundation.css` | `registry/foundation.css` (the design tokens) |
| `lib/motion-tokens.ts` | `registry/motion-tokens.ts` (what Arc's installer puts at `lib/motion-tokens`) |
| `lib/use-today.ts` | `lib/use-today.ts` |
| `registry/components/<name>/` | `registry/components/<name>/` for alert, badge, bar-chart, button, calendar, date-picker, date-range-picker, dialog, drawer, dropdown-menu, empty-state, input, line-chart, sortable-data-table, tabs |

Arc's files import each other as `@/lib/...` and `@/registry/...`. In FinCom, `@` is this folder (`app/vite.config.js` and `app/jsconfig.json`).
Some components are used for their stylesheet (`*.module.css`) on FinCom's own markup, where the tests or the old code
depend on that markup:
- button: a plain `<button>` keeps its words as its own text, which the tests match exactly;
- input: CommitBox;
- date-picker: the popover around the calendar;
- dropdown-menu: the firm menu, built on Radix's menu as Arc's is;
- tabs: the status tabs, Arc's `Tabs` root with Radix's list and triggers in Arc's classes;
- sortable-data-table: the sort button. Its table look is redrawn on `table.lt` in `app/src/styles/arc-look.css`, because its phone layout would undo FinCom's phone cards.

Their `.tsx` files are kept with them, unchanged as copied, and are not bundled where unused.
Used as components: alert, badge, bar-chart, calendar, date-range-picker, dialog, drawer, empty-state, line-chart, tabs (root).
Arc's blocks (`registry/blocks`) hold no app shell, sidebar or dashboard. The app's frame follows the page-header block,
the metric card and the stepper in `app/src/styles/arc-shell.css`.

## FinCom's changes to the copied files

Each change is marked `FinCom:` in the file.

- `lib/use-today.ts`: "today" is India's date (IST), whatever the computer's time zone.
- `registry/components/date-range-picker/date-range-picker.tsx`: a `formatDate` prop, so the dates show as 01-Oct-2026.
- `registry/components/drawer/drawer.tsx`: a `closeLabel` prop for the close button's name (the Tally panel's is "Close", as before).

## FinCom's additions (not Arc's)

- `lib/calm-motion.js`: `motion/react` points here (vite.config.js). Every Arc component takes its own reduced-motion path: short fades, with no travel, spring or blur.
- `app/src/styles/`: FinCom's stylesheet in a cascade layer under Arc's, the token mapping and FinCom's bright accents (`arc-tokens.css`), FinCom's own elements in Arc's look (`arc-look.css`), and the app's frame (`arc-shell.css`).
- Inter and Geist, Arc's typefaces, bundled from `@fontsource-variable` (SIL Open Font Licence).
- `app/src/parts/Button.jsx`, `Tag.jsx`, `EmptyNote.jsx`, `DateBox.jsx`, `DateRange.jsx`: FinCom's parts on Arc's components.

## FinCom's colours on Arc's tokens

| Arc token | FinCom variable | Light | Dark |
|---|---|---|---|
| `--accent`, `--control-on`, `--control-fill`, `--series-1` | `--brand` | #4338CA | #818CF8 |
| `--accent-strong` | `--brand-hover` | #3730A3 | #A5B4FC |
| `--accent-subtle` | `--brand-tint` | #EEF2FF | #1E1B4B |
| `--accent-foreground`, `--control-glyph` | `--on-brand` | #FFFFFF | #0B1120 |
| `--background` | `--paper` | #F8FAFC | #0B1120 |
| `--surface`, `--surface-raised` | `--sheet` | #FFFFFF | #111827 |
| `--surface-muted` | `--sheet-2` | #F1F5F9 | #1F2937 |
| `--foreground` | `--ink` | #0F172A | #E5E7EB |
| `--text-secondary`, `--text-muted` | `--muted` | #475569 | #94A3B8 |
| `--border` | `--rule` | #E2E8F0 | #1F2937 |
| `--border-subtle` | `--rule-soft` | #F1F5F9 | #172033 |
| `--border-strong` | `--rule-strong` | #CBD5E1 | #334155 |
| `--success`, `--series-4` | `--ok` | #15803D | #4ADE80 |
| `--warning`, `--series-3` | `--warn` | #B45309 | #FBBF24 |
| `--danger` | `--bad` | #B91C1C | #F87171 |
| `--series-2` | `--info` | #0369A1 | #38BDF8 |
| `--focus-outline` | `--focus` | #4338CA | #818CF8 |
| `--font-body` (and `--sans`) | was IBM Plex Sans | Inter | Inter |
| `--font-display` | was IBM Plex Sans | Geist | Geist |

The dark column applies when the computer is in dark mode, as FinCom did before.

FinCom's accents (new, `arc-tokens.css`), each as solid / ink / tint, light then dark: indigo #4F46E5 / #3730A3,
emerald #059669 / #065F46, amber #D97706 / #92400E, rose #E11D48 / #9F1239, sky #0284C7 / #075985, violet #7C3AED / #5B21B6,
teal #0D9488 / #115E59, slate #64748B / #334155; dark: the 400 shades as solids and the 200 shades as inks. A tint is the
solid at 13% (dark 20%) over the surface.
