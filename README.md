# MAF Plan to Markdown

Convert a Personal Best Running Club training plan, exported as a single-tab CSV, into a clean markdown checklist anchored to your race date.

A self-contained static web page. No build step, no server, no LLM. Runs entirely in your browser.

## Use it

**[Live demo →](https://cuongdo.github.io/maf-plan-to-markdown/)**

Or open `index.html` locally in your browser.

1. Pick the CSV file (or paste the contents)
2. Pick your race date
3. Click **Convert**
4. Copy or download the markdown

## Input expectations

The tool targets the Personal Best Running Club training plan format. The CSV must:

- Be a single tab exported as CSV
- Have a header row with `WEEK, WORKOUT, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY, WEEKLY VOLUME, STAGE`
- Contain weekly blocks of 5 rows in this order: `Aerobic run or walk`, `Higher intensity`, `Drills and/or strides`, `Cross-training`, `Strength training`
- Have one week with stage `Race week` and one cell containing the text `Race day` — these tell the tool which day of the week to anchor your race date to

See [examples/goal-hm-level-1.csv](examples/goal-hm-level-1.csv) for a reference input and [examples/goal-hm-level-1.expected.md](examples/goal-hm-level-1.expected.md) for the corresponding output.

## Output

Each week becomes a section like:

```markdown
## Week 9, April 20, 2026 (Peak)
**Total volume: 4 hours 50 minutes**

### Tuesday, 4/21/2026
- [ ] 45 min at or below MAF
  - [ ] Drills and/or strides
- [ ] Strength training

### Wednesday, 4/22/2026
- [ ] Higher intensity:
  - warm up 15 minutes
  - option one: 6 x 3 minute intervals @ 10k pace, 75 sec recovery jog
  - cool down 15 minutes
```

Cell text is preserved verbatim with light cleanup (trim, strip ✅ marks, collapse blank lines). No LLM rewriting.

## Tests

Two ways:

**In a browser** — serve the directory and open `tests.html`:

```sh
python3 -m http.server
# visit http://localhost:8000/tests.html
```

**In Node** — runs the same logic with a tiny built-in CSV shim:

```sh
node scripts/verify.js
```

## License

MIT — see [LICENSE](LICENSE).
