// Node-based verification harness — runs the same logic as tests.js without a browser.
// Provides a tiny Papa shim (RFC 4180-ish) good enough for this CSV.

const fs = require('fs');
const path = require('path');

function tinyCSVParse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

global.Papa = {
  parse(text) {
    return { data: tinyCSVParse(text), errors: [] };
  },
};

const app = require('../app.js');
const {
  parseCSV,
  parsePlan,
  renderMarkdown,
  cleanCell,
  splitMultiline,
  checkRaceDateConsistency,
  formatShortDate,
} = app;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}

function eq(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

function ok(cond, label = '') {
  if (!cond) throw new Error(`assertion failed: ${label}`);
}

function deepEq(a, b, label = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label}\n      expected: ${JSON.stringify(b)}\n      actual:   ${JSON.stringify(a)}`);
  }
}

function throws(fn, regex, label = '') {
  let threw = false;
  let msg = '';
  try { fn(); } catch (e) { threw = true; msg = e.message; }
  if (!threw) throw new Error(`${label}: did not throw`);
  if (regex && !regex.test(msg)) throw new Error(`${label}: thrown message "${msg}" did not match ${regex}`);
}

const csvText = fs.readFileSync(path.join(__dirname, '..', 'examples', 'goal-hm-level-1.csv'), 'utf8');

console.log('cleanCell');
test('strips checkmarks and trims', () => {
  eq(cleanCell('  ✅ 45 min at or below MAF  '), '45 min at or below MAF');
});
test('null/whitespace -> empty', () => {
  eq(cleanCell(null), '');
  eq(cleanCell('   '), '');
});

console.log('\nsplitMultiline');
test('splits on blank lines', () => {
  deepEq(
    splitMultiline('warm up 15 minutes\n\noption one: 6 x 3\n\ncool down 15 minutes'),
    ['warm up 15 minutes', 'option one: 6 x 3', 'cool down 15 minutes']
  );
});
test('splits on + lines', () => {
  deepEq(
    splitMultiline('  Warm up 15 minutes\n+\n MAF test 3 miles\n+\nCool down 15 minutes'),
    ['Warm up 15 minutes', 'MAF test 3 miles', 'Cool down 15 minutes']
  );
});
test('flattens internal newlines into separate bullets', () => {
  deepEq(
    splitMultiline('4 intervals\n\n6 minutes\n4 minutes\n2 minutes\n1 minute\n\ncool down'),
    ['4 intervals', '6 minutes', '4 minutes', '2 minutes', '1 minute', 'cool down']
  );
});

console.log('\nparsePlan (fixture)');
test('finds plan title', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  eq(plan.title, 'GOAL HALF MARATHON - LEVEL 1 - TRAIN 3 TO 5 HOURS PER WEEK');
});
test('parses 12 weeks', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  eq(plan.weeks.length, 12);
  eq(plan.weeks[0].number, 1);
  eq(plan.weeks[11].number, 12);
});
test('week 9 metadata', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  const w9 = plan.weeks.find(w => w.number === 9);
  eq(w9.stage, 'Peak');
  eq(w9.totalVolume, '4 hours 50 minutes');
});
test('week 12 race week, Sunday race day', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  eq(plan.anchor.raceWeek.number, 12);
  eq(plan.anchor.csvRaceDayOffset, 6);
  eq(plan.anchor.userRaceDayOffset, 6);
});
test('race date Sunday 2026-05-17 -> week 12 Monday 5/11/2026', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  const w12 = plan.weeks.find(w => w.number === 12);
  eq(formatShortDate(w12.mondayDate), '5/11/2026');
});
test('week 1 Monday computed correctly', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  const w1 = plan.weeks.find(w => w.number === 1);
  eq(formatShortDate(w1.mondayDate), '2/23/2026');
});
test('Tuesday week 1 has aerobic + drills + strength', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  const tue = plan.weeks.find(w => w.number === 1).days[1];
  eq(tue.aerobic, '30 min at or below MAF');
  eq(tue.drills, true);
  eq(tue.strength, true);
});
test('Monday week 1 is rest', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  eq(plan.weeks.find(w => w.number === 1).days[0].aerobic, 'rest');
});
test('step-back week 4 higher intensity 0 -> empty', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  const w4 = plan.weeks.find(w => w.number === 4);
  eq(w4.stage, 'Step back');
  for (const d of w4.days) eq(d.higherIntensity, null);
});

console.log('\ncheckRaceDateConsistency');
test('no movement when race date matches column', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-17');
  eq(checkRaceDateConsistency(plan).moved, false);
});
test('movement reported when race date is Saturday but CSV race day is Sunday', () => {
  const plan = parsePlan(parseCSV(csvText), '2026-05-16');
  const c = checkRaceDateConsistency(plan);
  eq(c.moved, true);
  eq(c.raceDateDay, 'Saturday');
  eq(c.planDay, 'Sunday');
});

console.log('\nrenderMarkdown');
const plan = parsePlan(parseCSV(csvText), '2026-05-17');
const md = renderMarkdown(plan);

test('starts with H1 from title', () => {
  ok(md.startsWith('# GOAL HALF MARATHON'));
});
test('week 9 heading + total volume', () => {
  ok(md.includes('## Week 9, April 20, 2026 (Peak)'));
  ok(md.includes('**Total volume: 4 hours 50 minutes**'));
});
test('day headings with short date', () => {
  ok(md.includes('### Tuesday, 4/21/2026'));
  ok(md.includes('### Sunday, 4/26/2026'));
});
test('rest day for empty Monday', () => {
  ok(md.includes('### Monday, 4/20/2026\n- [ ] Rest day'));
});
test('drills nested under aerobic', () => {
  ok(/- \[ \] 45 min at or below MAF\n  - \[ \] Drills and\/or strides/.test(md));
});
test('higher intensity sub-bullets', () => {
  ok(md.includes('- [ ] Higher intensity:'));
  ok(md.includes('  - warm up 15 minutes'));
  ok(md.includes('  - cool down 15 minutes'));
});
test('11 horizontal rule separators between 12 weeks', () => {
  const hrCount = (md.match(/^---$/gm) || []).length;
  eq(hrCount, 11);
});
test('race day renders as plain "Race Day!" with no bullets or checkboxes', () => {
  const w12 = md.split(/^## Week 12,/m)[1];
  const sun = w12.split(/### Sunday,/)[1];
  ok(/^Race Day!$/m.test(sun), 'plain "Race Day!" line present');
  ok(!/- \[ \]/.test(sun), 'no checkbox in race day section');
  ok(!/^- /m.test(sun.split(/^---$/m)[0]), 'no bullet in race day section');
  ok(!/Higher intensity:/i.test(sun), 'no "Higher intensity:" wrapper');
});
test('Sunday race week renders all 7 days (no truncation)', () => {
  const w12Section = md.split(/^## Week 12,/m)[1];
  ok(w12Section.includes('### Sunday, 5/17/2026'), 'Sunday rendered as final day');
  ok(!/### Monday,.*5\/18/.test(w12Section), 'no day after race');
});
test('Saturday race truncates race week + dates correct + race day moved', () => {
  // Original CSV has Race day in Sunday column. User picks Saturday race date.
  const satPlan = parsePlan(parseCSV(csvText), '2026-05-16');
  const satMd = renderMarkdown(satPlan);
  const w12 = satMd.split(/^## Week 12,/m)[1];
  ok(w12.includes('### Saturday, 5/16/2026'), 'Saturday rendered with correct date');
  ok(!/### Sunday,/.test(w12), 'Sunday not rendered (truncated)');
  ok(/### Monday, 5\/11\/2026/.test(w12), 'Monday is the actual Mon 5/11, not shifted');
  // Race day workout should now be on Saturday
  const satSection = w12.split(/### Saturday,/)[1];
  ok(/^Race Day!$/m.test(satSection), 'race day rendered as plain "Race Day!" line');
  ok(!/- \[ \] Higher intensity:[\s\S]*Race day/i.test(satSection), 'no checkbox/bullet wrapper for race day');
  // Earlier weeks still go full Mon-Sun with correct dates
  const w11 = satMd.split(/^## Week 11,/m)[1].split(/^---$/m)[0];
  ok(/### Sunday, 5\/10\/2026/.test(w11), 'week 11 Sunday = real Sun 5/10');
});

console.log('\nerror cases');
test('empty CSV -> Header row not found', () => {
  throws(() => parsePlan(parseCSV(''), '2026-05-17'), /Header row not found/);
});
test('missing Race week -> throws', () => {
  const csv = [
    'WEEK,WORKOUT,MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY,SUNDAY,WEEKLY VOLUME,STAGE',
    '1,Aerobic run or walk,rest,30 min,,rest,30 min,30 min,,180 minutes,build',
    ',Higher intensity,,,,,,,,3 hours,',
    ',Drills and/or strides,,yes,,,,yes,,,',
    ',Cross-training,,,,30 min,,40 min,,,',
    ',Strength training,,yes,,,yes,,,,',
  ].join('\n');
  throws(() => parsePlan(parseCSV(csv), '2026-05-17'), /Race week/);
});
test('invalid race date -> throws', () => {
  throws(() => parsePlan([['WEEK', 'WORKOUT']], 'not-a-date'), /Invalid race date/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Write the rendered output as the expected fixture for browser tests too
const outPath = path.join(__dirname, '..', 'examples', 'goal-hm-level-1.expected.md');
fs.writeFileSync(outPath, md);
console.log(`\nWrote expected output to ${outPath}`);
