# Relational algebra join visualizer (CIS3530)

An animated, step-by-step visualizer for relational algebra joins, built with React, shadcn/ui (Radix primitives) and Tailwind CSS v4 on Vite, managed with bun.
It uses the Movies / Artists / Roles tables and R1 / R2 tables from the **Week 2 slides**, and
every query from the slides is available as a preset. Students can also type their own queries, and import their own
tables from CSV files.

## Quick start

- **No install:** double-click `JoinVisualizer.html` (a self-contained build).
- **Dev server:** `bun install` then `bun run dev`, and open the printed URL.
- **Rebuild the standalone file:** `bun run build` → `dist/index.html` (copy it over `JoinVisualizer.html`).

## What it shows

For each operator in the query (evaluated bottom-up as `T1`, `T2`, … like the slide 53 assignment notation):

- **Joins (⋈, ⋈[θ], ×, ⟕, ⟖, ⟗)** – every left row is compared with every right row; a line connects the
  pair, the compared attributes are highlighted, and matching pairs fly into the result table.
  Outer joins then show the *dangling* rows being rescued and padded with `null`.
  Plain natural joins show dangling rows crossed out at the end.
- **σ** – each row is tested, with the condition's values substituted in (`1974 ≥ 1970 ✓`).
- **π** – unused columns fade out and duplicates are merged (set semantics, slide 15).
- **ρ** – renames a relation for self-joins (slides 56–58).

Controls: play/pause (Space), step (← →), restart (Home), final result (End), a timeline scrubber and a speed slider.
The URL hash records the current query so it can be shared.

## Query syntax

| Operation | Symbol form | ASCII form |
|---|---|---|
| Selection | `σ[year >= 1970](Movies)` | `select[...](...)` |
| Projection | `π[aName, title](R)` | `project[...](...)` |
| Rename | `ρ[A1](Artists)` | `rename[...](...)` |
| Cartesian product | `R × S` | `R cross S` |
| Natural join | `R ⋈ S` | `R join S` |
| Theta join | `R ⋈[Movies.mID = Roles.mID] S` | `R join[...] S` |
| Left / right / full outer join | `R ⟕ S`, `R ⟖ S`, `R ⟗ S` | `leftjoin`, `rightjoin`, `fulljoin` |
| Logic | `∧ ∨ ¬` | `and or not` |

σ, π and ρ bind tighter than joins, and joins are evaluated left to right (slide 50). Strings can use straight or
curly quotes. Write `Relation.attr` when a name is ambiguous.

## Import your own tables (CSV)

Under **Database**, choose **Import CSV…** (or drop `.csv` files anywhere on the page). Pick several files at once to
get several tables to join. Each file becomes one table, named after the file (`students.csv` → `students`):

```
sid,name,major,year
1,Ada Lovelace,CS,3
2,"Hopper, Grace",CS,4
4,Katherine Johnson,Math,
```

- The first line lists the column names; every other line is one row with the same number of values.
- Wrap a value in double quotes if it contains a comma (`"Hopper, Grace"`); write `""` for a quote inside quotes.
- An empty value (or the word `null`) is null. Comparisons with null are *unknown*, so σ drops those rows, as in SQL.
- A column is numeric when every value in it is a plain number (`42`, `-3`, `3.5`); anything else, including codes
  with leading zeros such as `007`, is text.
- Names are adjusted so they can be typed in a query: `Student ID` → `Student_ID`, `2023` → `col_2023`, `join` →
  `join_`. Duplicate rows are removed (a relation is a set). The Database panel lists every such change.
- Malformed files are rejected with the line number of the problem, and your previous import is kept.
- Limits: 10 files, 1 MB and 1,000 rows × 40 columns per file; a join may compare at most 50,000 pairs of rows and
  produce at most 5,000 rows (anything bigger cannot be animated smoothly, so use σ first).

The course tables are always available: switch between **Course tables** and **Your import** at any time; picking a
slide example switches back to the course tables. Importing again replaces the previous import. Nothing is uploaded
or saved anywhere: the import lives only in the open page and is gone when it is closed or reloaded.

## Verification

- `python3 scripts/verify_sqlite.py` runs every slide preset plus extra custom queries through the engine and through
  equivalent SQL in SQLite, and checks that the result sets are identical. It also imports the CSV files in
  `scripts/fixtures/` (the queries are in `csv-cases.json`), loading them into SQLite with Python's own CSV reader
  (46/46 pass).
- `bun run verify:csv` checks the CSV importer against hand-written expectations: quoting, line endings, types, nulls,
  name clean-up, limits and the error messages for malformed files (50/50 pass).
- `bun run verify:ui` (after `bun run build`; needs a Chromium, set `CHROMIUM=/path/to/chrome`) drives the real
  UI: it checks every preset's final animated table against the engine, steps through every animation frame to confirm
  rows appear exactly when the narration says so, and saves screenshots to `shots/`. It then imports the CSV fixtures
  through the real file picker and does the same for every query in `csv-cases.json`, and checks switching between the
  course tables and the import, replacing an import, import errors, drag and drop, and that a reload forgets the import.

## Project layout

```
src/engine/          types, slide data, parser, evaluator (produces animation steps), presets, CSV import — framework-free
src/lib/frames.ts    pure frame model: which rows are current / matched / dropped at each animation frame
src/hooks/           usePlayer: playback clock, stepping, seeking
src/components/      stage (tables, connector, flying rows), controls, pipeline, query panel, base tables
src/components/ui/   shadcn components (generated by `bunx shadcn add`)
src/styles/          theme tokens + all animation CSS
scripts/             verification scripts; scripts/fixtures/ holds the CSV test files
```
