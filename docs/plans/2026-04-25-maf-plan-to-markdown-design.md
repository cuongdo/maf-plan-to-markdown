# MAF Plan to Markdown — Design

**Date:** 2026-04-25
**Status:** Approved (brainstorm complete, ready for planning/implementation)

## Goal

A self-contained static web page that converts a Phil Maffetone (MAF) PB Program training plan, exported as a single-tab CSV, into a clean markdown document with checkboxes, organized by week and day, anchored to a user-supplied race date.

Hosted on GitHub Pages, open source.

## Non-goals

- No LLM dependency — fully deterministic parsing and rendering.
- No server, no build step, no framework.
- No prose rewriting — output reflects the source CSV verbatim (with light deterministic cleanup only).
- No persistence in v1.

## Architecture

Single static page, two CDN dependencies:

- **Papa Parse** — robust CSV parsing (handles quoted multi-line cells, BOM, escaped quotes).
- **marked** — renders the generated markdown for live preview.

Both pinned to specific versions on a CDN (e.g. jsDelivr).

### File layout

```
maf-plan-to-markdown/
  index.html              # the app
  app.js                  # parseCSV, parsePlan, renderMarkdown — pure functions, no DOM
  ui.js                   # UI wiring (file input, buttons, error banner)
  styles.css              # shared styles
  tests.html              # loads QUnit + app.js + tests.js
  tests.js                # QUnit tests
  examples/
    goal-hm-level-1.csv
    goal-hm-level-1.expected.md
  README.md
  LICENSE                 # MIT
  .gitignore
```

The split between `app.js` (pure functions) and `ui.js` (DOM wiring) keeps the parser/renderer testable without a DOM.

### UI

Two-column flexbox layout, stacking on narrow screens:

```
┌─────────────────────┬──────────────────────┐
│ Pick CSV file...    │  Output (markdown)   │
│ Race date: [____]   │  ┌────────────────┐  │
│ [Convert]           │  │ # Plan title   │  │
│                     │  │ ...            │  │
│ Or paste here:      │  └────────────────┘  │
│ ┌─────────────────┐ │  [Copy] [Download]   │
│ │                 │ │                      │
│ └─────────────────┘ │  Rendered preview:   │
│                     │  ┌────────────────┐  │
│                     │  │ (marked HTML)  │  │
│                     │  └────────────────┘  │
└─────────────────────┴──────────────────────┘
```

Clean, system font, no framework.

## Parsing

### Input shape

The PB Program CSVs share a fixed structure:

- Optional row 1: plan title in column A (e.g. `GOAL HALF MARATHON - LEVEL 1 - TRAIN 3 TO 5 HOURS PER WEEK`)
- A few preamble rows (blank or descriptive day-themes).
- A header row with cells: `WEEK, WORKOUT, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY, WEEKLY VOLUME, STAGE`
- Repeating 5-row weekly blocks. Within each block, `WORKOUT` (column B) is fixed:
  | Offset | `WORKOUT` cell | Role |
  |---|---|---|
  | 0 | `Aerobic run or walk` | aerobic + week-level metadata |
  | 1 | `Higher intensity` | speed/intervals + total time |
  | 2 | `Drills and/or strides` | yes/blank flag per day |
  | 3 | `Cross-training` | optional cross-train activity |
  | 4 | `Strength training` | yes/no/blank flag per day |

### Parsing algorithm

1. Run Papa Parse on the CSV text.
2. Capture any non-empty column-A cell *before* the header as the plan title.
3. Find the header row by matching `WEEK` and `WORKOUT` in the first two cells.
4. Group remaining rows into 5-row blocks; validate each block's `WORKOUT` labels match the expected order. Throw a descriptive error pointing at the row number on mismatch.
5. For each block, build a `Week` object:
   - `number` ← block[0][0] (parsed integer)
   - `stage` ← block[0][10], title-cased
   - `totalVolume` ← block[1][9] (the `4 hours 50 minutes` form, preferred over the minutes-only form)
   - `days` ← seven `Day` objects, one per column 2–8
6. Each `Day` holds: `aerobic`, `higherIntensity`, `drills` (boolean), `crossTraining`, `strength` (boolean).

### Cell cleaning

- Trim whitespace.
- Treat empty / whitespace-only / `0` / `no` as empty.
- Treat exact `rest` (case-insensitive) as the literal `Rest day`.
- Strip `✅` characters anywhere they appear (personal annotation, irrelevant).
- Collapse 3+ consecutive blank lines to 2.

## Date anchoring

Dates are *not* in the source CSV. The user supplies the race date; the tool computes everything else.

1. Find the **race week**: the week whose `STAGE` cell equals `Race week` (case-insensitive). If multiple, use the highest-numbered.
2. Find the **CSV race-day column**: scan all day cells (cols 2–8 across all 5 rows) of the race week for one containing `Race day`. The column position determines the CSV race-day offset (col 2 = Mon = 0, …, col 8 = Sun = 6).
3. Compute the **user race-day offset** from the user-supplied race date weekday (Mon=0, …, Sun=6). The calendar is anchored to this — dates always line up with reality.
4. Race week's Monday = `race_date − userRaceDayOffset days`.
5. Each other week's Monday = `race_week_monday − 7 × (race_week_number − N)` for week N.
6. **Race-day cell relocation**: if the CSV's race-day column ≠ the user's race-day column, the race-day cell content is moved from its CSV position to the user's race-day position; the CSV race-day position becomes empty. All other CSV columns stay in place literally — no rotation.
7. Race week is truncated to end on the user's race day (no rendered days after).

A non-blocking informational UI note announces the relocation when it happens (e.g. "Race day workout placed on Saturday (it was in the Sunday column of the source CSV).").

## Rendering

### Document structure

```markdown
# {plan title}

## Week 9, April 20, 2026 (Peak)
**Total volume: 4 hours 50 minutes**

### Monday, 4/20/2026
- [ ] Rest day

### Tuesday, 4/21/2026
- [ ] 45 min at or below MAF
  - [ ] Drills and/or strides
- [ ] Strength training

### Wednesday, 4/22/2026
- [ ] Higher intensity:
  - warm up 15 minutes
  - option one: 6 x 3 minute intervals @ 10k pace, 75 sec recovery jog
  - option two: 3 x 5 minute intervals @ 10k pace, 2 to 3 min jog between intervals
  - cool down 15 minutes

...

---

## Week 10, April 27, 2026 (Peak)
...
```

### Per-day item order

For each day, in this fixed order, skipping any that don't apply:

1. **Aerobic** (if non-empty): `- [ ] {cell text}`.
   - **Drills sub-bullet** (if drills column for that day is `yes`): `  - [ ] Drills and/or strides` — with checkbox.
2. **Higher intensity** (if non-empty): `- [ ] Higher intensity:` followed by sub-bullets parsed from the cell — plain bullets, no checkboxes.
3. **Cross-training** (if non-empty): `- [ ] {cell text}`.
4. **Strength training** (if `yes`): `- [ ] Strength training`.

If drills is `yes` but there's no aerobic item that day, promote drills to a top-level checkbox.

If a day has nothing scheduled, still emit the day heading plus `- [ ] Rest day`.

### Multi-line cell parsing (higher-intensity column)

- Split on **blank lines** OR a line containing only `+` (both used as paragraph separators in source).
- Trim each chunk.
- If a chunk still has internal newlines (e.g. an interval-length list), split into separate sub-bullets — flat one-line-per-bullet renders cleanest.

### Headings and separators

- Plan title → `# H1`.
- Week heading → `## Week N, Long Month D, YYYY (Stage)`.
- Total volume → `**Total volume: {hms string}**` immediately under the week heading.
- Day heading → `### Day name, M/D/YYYY`.
- `---` horizontal rule between consecutive weeks.
- **Race week truncation**: the race week ends on the race day. If the `Race day` cell is in the Saturday column (offset 5), the race week renders Mon–Sat only — no Sunday section. All earlier weeks render the full Mon–Sun.

## Edge cases & errors

| Case | Behavior |
|---|---|
| Header row not found | Red error banner: "Header row not found." |
| 5-row block has wrong `WORKOUT` labels | Error pointing at row number. |
| No `Race week` stage found | Error: "Could not find a week with stage 'Race week'." |
| `Race week` found but no `Race day` cell | Error pointing at the week. |
| Multiple `Race day` cells | Use first; console warning. |
| Race date input empty/invalid | Block conversion; show inline form error. |
| Race date weekday ≠ Race day cell column | Trust user's date; show non-blocking UI note. |
| Step-back week with `0` cells in higher intensity | Treated as empty. |
| Plan starts mid-numbering (e.g. week 6) | Fine — math works on race-week-relative offsets. |
| Day-theme row (row 3) order varies by plan | Ignored entirely; day meaning comes from header columns. |

## Testing

QUnit via CDN, browser-runnable. No build step.

`tests.html` loads QUnit + `app.js` + `tests.js`. Test cases:

1. **Parse fixture**: load `examples/goal-hm-level-1.csv`, assert the parsed `Week[]` structure for week 9 (number, monday date, stage, total volume, day cell contents).
2. **Render snapshot**: parse + render with race date `2026-05-17`, assert output matches `examples/goal-hm-level-1.expected.md`.
3. **Race date variant**: same CSV with race date `2026-05-16` (Saturday) — assert dates shift correctly and the date-mismatch warning fires.
4. **Errors**: empty CSV → "Header row not found"; CSV missing `Race week` stage → expected error.

Run locally with `python3 -m http.server` then visit `/tests.html`. Same on GitHub Pages.

## Open source housekeeping

- **LICENSE**: MIT.
- **README.md**: short description, screenshot, live demo link, "open `index.html` in a browser or visit the Pages URL", note about the required `Race week` / `Race day` markers in the source CSV.
- **examples/**: original PB Program CSV (renamed to make clear it's a sample) + its expected `.md` output, doubling as test fixture.
- **`.gitignore`**: `.DS_Store`.

## Out of scope (future work)

- LLM-based prose normalization (option C from brainstorming).
- Multiple input tabs / multi-plan files.
- `localStorage` persistence of last-used race date.
- Non-race-targeted ("base") plans without a race anchor.
- Plan editor UI (currently the user edits CSV manually before importing).
