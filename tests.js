// QUnit tests for app.js. Run by opening tests.html in a browser
// (use a local server, e.g. `python3 -m http.server`, since fetch() needs http://).

QUnit.module('cleanCell', () => {
  QUnit.test('strips checkmarks and trims', assert => {
    assert.equal(cleanCell('  ✅ 45 min at or below MAF  '), '45 min at or below MAF');
  });
  QUnit.test('returns empty for null/whitespace', assert => {
    assert.equal(cleanCell(null), '');
    assert.equal(cleanCell('   '), '');
    assert.equal(cleanCell('\n\n'), '');
  });
});

QUnit.module('splitMultiline', () => {
  QUnit.test('splits on blank lines', assert => {
    const input = 'warm up 15 minutes\n\noption one: 6 x 3 minute intervals\n\ncool down 15 minutes';
    assert.deepEqual(splitMultiline(input), [
      'warm up 15 minutes',
      'option one: 6 x 3 minute intervals',
      'cool down 15 minutes',
    ]);
  });
  QUnit.test('splits on + lines', assert => {
    const input = '  Warm up 15 minutes\n+\n MAF test 3 miles\n+\nCool down 15 minutes';
    assert.deepEqual(splitMultiline(input), [
      'Warm up 15 minutes',
      'MAF test 3 miles',
      'Cool down 15 minutes',
    ]);
  });
  QUnit.test('flattens internal newlines into separate bullets', assert => {
    const input = '4 intervals @ comfortable higher intensity\n\n6 minutes\n4 minutes\n2 minutes\n1 minute\n\ncool down 15 minutes';
    assert.deepEqual(splitMultiline(input), [
      '4 intervals @ comfortable higher intensity',
      '6 minutes',
      '4 minutes',
      '2 minutes',
      '1 minute',
      'cool down 15 minutes',
    ]);
  });
});

QUnit.module('parsePlan (fixture)', hooks => {
  let csvText;
  hooks.before(async () => {
    csvText = await fetch('examples/goal-hm-level-1.csv').then(r => r.text());
  });

  QUnit.test('finds plan title', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    assert.equal(plan.title, 'GOAL HALF MARATHON - LEVEL 1 - TRAIN 3 TO 5 HOURS PER WEEK');
  });

  QUnit.test('parses 12 weeks', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    assert.equal(plan.weeks.length, 12);
    assert.equal(plan.weeks[0].number, 1);
    assert.equal(plan.weeks[11].number, 12);
  });

  QUnit.test('week 9 metadata', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const w9 = plan.weeks.find(w => w.number === 9);
    assert.equal(w9.stage, 'Peak');
    assert.equal(w9.totalVolume, '4 hours 50 minutes');
  });

  QUnit.test('week 12 is race week with Sunday race day in original CSV', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    assert.equal(plan.anchor.raceWeek.number, 12);
    assert.equal(plan.anchor.csvRaceDayOffset, 6, 'CSV Sunday offset 6');
    assert.equal(plan.anchor.userRaceDayOffset, 6, 'user Sunday offset 6');
  });

  QUnit.test('race date 2026-05-17 (Sunday) anchors week 12 Monday to 2026-05-11', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const w12 = plan.weeks.find(w => w.number === 12);
    assert.equal(formatShortDate(w12.mondayDate), '5/11/2026');
  });

  QUnit.test('week 1 Monday computed correctly', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const w1 = plan.weeks.find(w => w.number === 1);
    assert.equal(formatShortDate(w1.mondayDate), '2/23/2026');
  });

  QUnit.test('Tuesday week 1 has aerobic + drills + strength', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const w1 = plan.weeks.find(w => w.number === 1);
    const tue = w1.days[1];
    assert.equal(tue.aerobic, '30 min at or below MAF');
    assert.equal(tue.drills, true);
    assert.equal(tue.strength, true);
  });

  QUnit.test('Monday week 1 is rest', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const w1 = plan.weeks.find(w => w.number === 1);
    assert.equal(w1.days[0].aerobic, 'rest');
  });

  QUnit.test('step-back week 4: higher intensity 0 cells treated as empty', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const w4 = plan.weeks.find(w => w.number === 4);
    assert.equal(w4.stage, 'Step back');
    for (const d of w4.days) {
      assert.equal(d.higherIntensity, null);
    }
  });
});

QUnit.module('checkRaceDateConsistency', hooks => {
  let csvText;
  hooks.before(async () => {
    csvText = await fetch('examples/goal-hm-level-1.csv').then(r => r.text());
  });

  QUnit.test('no movement when race date matches Race day column', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-17');
    const check = checkRaceDateConsistency(plan);
    assert.equal(check.moved, false);
  });

  QUnit.test('movement reported when race date is Saturday', assert => {
    const rows = parseCSV(csvText);
    const plan = parsePlan(rows, '2026-05-16');
    const check = checkRaceDateConsistency(plan);
    assert.equal(check.moved, true);
    assert.equal(check.raceDateDay, 'Saturday');
    assert.equal(check.planDay, 'Sunday');
  });
});

QUnit.module('renderMarkdown', hooks => {
  let csvText;
  hooks.before(async () => {
    csvText = await fetch('examples/goal-hm-level-1.csv').then(r => r.text());
  });

  QUnit.test('renders H1 from title', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    assert.ok(md.startsWith('# GOAL HALF MARATHON'), 'starts with H1');
  });

  QUnit.test('renders week heading with stage and long date', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    assert.ok(md.includes('## Week 9, April 20, 2026 (Peak)'), 'week 9 heading present');
    assert.ok(md.includes('**Total volume: 4 hours 50 minutes**'), 'total volume present');
  });

  QUnit.test('renders day headings with short date', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    assert.ok(md.includes('### Tuesday, 4/21/2026'), 'tuesday heading present');
    assert.ok(md.includes('### Sunday, 4/26/2026'), 'sunday heading present');
  });

  QUnit.test('renders rest day for empty Monday', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    assert.ok(md.includes('### Monday, 4/20/2026\n- [ ] Rest day'), 'monday rest day');
  });

  QUnit.test('renders drills as nested checkbox under aerobic', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    assert.ok(/- \[ \] 45 min at or below MAF\n  - \[ \] Drills and\/or strides/.test(md), 'drills nested under aerobic');
  });

  QUnit.test('renders higher intensity with sub-bullets', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    assert.ok(md.includes('- [ ] Higher intensity:'), 'higher intensity label');
    assert.ok(md.includes('  - warm up 15 minutes'), 'warm up sub-bullet');
    assert.ok(md.includes('  - cool down 15 minutes'), 'cool down sub-bullet');
  });

  QUnit.test('separates weeks with horizontal rule', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    const hrCount = (md.match(/^---$/gm) || []).length;
    assert.equal(hrCount, 11, '11 separators between 12 weeks');
  });

  QUnit.test('Sunday race week renders all 7 days', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    const w12Section = md.split(/^## Week 12,/m)[1];
    assert.ok(w12Section.includes('### Sunday, 5/17/2026'), 'Sunday is final day');
  });

  QUnit.test('long run day swap moves Sunday content to selected day across all weeks', assert => {
    const sundayPlan = parsePlan(parseCSV(csvText), '2026-05-17');
    const saturdayPlan = parsePlan(parseCSV(csvText), '2026-05-17', { longRunDayOffset: 5 });
    const sun9 = sundayPlan.weeks.find(w => w.number === 9);
    const sat9 = saturdayPlan.weeks.find(w => w.number === 9);
    assert.deepEqual(sat9.days[5], sun9.days[6], 'long run day got Sunday content');
    assert.deepEqual(sat9.days[6], sun9.days[5], 'Sunday got the original Saturday content');
  });

  QUnit.test('long run swap interacts correctly with race day relocation', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-16', { longRunDayOffset: 5 });
    const md = renderMarkdown(plan);
    const w12 = md.split(/^## Week 12,/m)[1];
    assert.ok(w12.includes('### Saturday, 5/16/2026'), 'Saturday is rendered');
    assert.ok(/^Race Day!$/m.test(w12.split(/### Saturday,/)[1]), 'race day still lands on Saturday');
  });

  QUnit.test('non-race mode: end date truncates last week, no Race Day! replacement', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-13', { isRace: false });
    assert.equal(plan.isRace, false);
    const md = renderMarkdown(plan);
    assert.notOk(/^Race Day!$/m.test(md), 'no "Race Day!" line in non-race mode');
    const w12 = md.split(/^## Week 12,/m)[1];
    assert.ok(/### Wednesday, 5\/13\/2026/.test(w12), 'final week ends on user end date');
    assert.notOk(/### Thursday,/.test(w12), 'no Thursday rendered (truncated)');
  });

  QUnit.test('non-race mode + Sunday end date: Race day cell renders as literal content', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17', { isRace: false });
    const md = renderMarkdown(plan);
    const sun = md.split(/^## Week 12,/m)[1].split(/### Sunday,/)[1];
    assert.notOk(/^Race Day!$/m.test(sun), 'no Race Day! plain line');
    assert.ok(/- \[ \] Higher intensity:[\s\S]*Race day/i.test(sun), 'Race day rendered as normal bullet content');
  });

  QUnit.test('default longRunDayOffset is Sunday (no swap)', assert => {
    const a = parsePlan(parseCSV(csvText), '2026-05-17');
    const b = parsePlan(parseCSV(csvText), '2026-05-17', { longRunDayOffset: 6 });
    assert.deepEqual(a.weeks, b.weeks);
  });

  QUnit.test('race day renders as plain "Race Day!" with no bullets or checkboxes', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-17');
    const md = renderMarkdown(plan);
    const w12 = md.split(/^## Week 12,/m)[1];
    const sun = w12.split(/### Sunday,/)[1];
    assert.ok(/^Race Day!$/m.test(sun), 'plain "Race Day!" line present');
    assert.notOk(/- \[ \]/.test(sun), 'no checkbox in race day section');
    assert.notOk(/Higher intensity:/i.test(sun), 'no "Higher intensity:" wrapper');
  });

  QUnit.test('Saturday race truncates race week + dates correct + race day moved', assert => {
    const plan = parsePlan(parseCSV(csvText), '2026-05-16');
    const md = renderMarkdown(plan);
    const w12 = md.split(/^## Week 12,/m)[1];
    assert.ok(w12.includes('### Saturday, 5/16/2026'), 'Saturday rendered with correct date');
    assert.notOk(/### Sunday,/.test(w12), 'Sunday not rendered (truncated)');
    assert.ok(/### Monday, 5\/11\/2026/.test(w12), 'Monday is real Mon 5/11');
    const satSection = w12.split(/### Saturday,/)[1];
    assert.ok(/^Race Day!$/m.test(satSection), 'race day rendered as plain "Race Day!" line');
    const w11 = md.split(/^## Week 11,/m)[1].split(/^---$/m)[0];
    assert.ok(/### Sunday, 5\/10\/2026/.test(w11), 'week 11 Sunday = real Sun 5/10');
  });
});

QUnit.module('error cases', () => {
  QUnit.test('empty CSV throws Header row not found', assert => {
    assert.throws(() => parsePlan(parseCSV(''), '2026-05-17'), /Header row not found/);
  });

  QUnit.test('missing Race week stage throws', assert => {
    const csv = [
      'WEEK,WORKOUT,MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY,SUNDAY,WEEKLY VOLUME,STAGE',
      '1,Aerobic run or walk,rest,30 min,,rest,30 min,30 min,,180 minutes,build',
      ',Higher intensity,,,,,,,,3 hours,',
      ',Drills and/or strides,,yes,,,,yes,,,',
      ',Cross-training,,,,30 min,,40 min,,,',
      ',Strength training,,yes,,,yes,,,,',
    ].join('\n');
    assert.throws(() => parsePlan(parseCSV(csv), '2026-05-17'), /Race week/);
  });

  QUnit.test('invalid race date throws', assert => {
    const rows = [['WEEK', 'WORKOUT']];
    assert.throws(() => parsePlan(rows, 'not-a-date'), /Invalid race date/);
  });
});
