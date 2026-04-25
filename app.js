// MAF Plan to Markdown — pure parsing & rendering logic.
// No DOM access. Safe to load in tests.html as well as index.html.

const EXPECTED_WORKOUT_LABELS = [
  'Aerobic run or walk',
  'Higher intensity',
  'Drills and/or strides',
  'Cross-training',
  'Strength training',
];

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function parseCSV(text) {
  if (typeof Papa === 'undefined') {
    throw new Error('Papa Parse is not loaded.');
  }
  const result = Papa.parse(text, { skipEmptyLines: false });
  if (result.errors && result.errors.length) {
    const fatal = result.errors.find(e => e.type === 'Quotes' || e.type === 'Delimiter');
    if (fatal) throw new Error(`CSV parse error: ${fatal.message}`);
  }
  return result.data;
}

function cleanCell(raw) {
  if (raw == null) return '';
  let s = String(raw).replace(/✅/g, '');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map(line => line.trim()).join('\n').trim();
  return s;
}

function isEmpty(cell) {
  const c = cleanCell(cell);
  return c === '' || c === '0';
}

function isYes(cell) {
  return cleanCell(cell).toLowerCase() === 'yes';
}

function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = (row[0] || '').trim().toUpperCase();
    const b = (row[1] || '').trim().toUpperCase();
    if (a === 'WEEK' && b === 'WORKOUT') return i;
  }
  return -1;
}

function extractTitle(rows, headerIdx) {
  for (let i = 0; i < headerIdx; i++) {
    const row = rows[i] || [];
    const a = (row[0] || '').trim();
    if (a && a.toLowerCase() !== 'x') return a;
  }
  return null;
}

function isBlankRow(row) {
  if (!row) return true;
  return row.every(cell => (cell == null || String(cell).trim() === ''));
}

function groupIntoBlocks(rows, headerIdx) {
  const dataRows = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    if (isBlankRow(rows[i])) continue;
    dataRows.push({ row: rows[i], originalIndex: i });
  }
  if (dataRows.length % 5 !== 0) {
    const lastIdx = dataRows.length ? dataRows[dataRows.length - 1].originalIndex + 1 : headerIdx + 1;
    throw new Error(`Expected weekly blocks of 5 rows, got ${dataRows.length} data rows (ending near CSV row ${lastIdx}).`);
  }
  const blocks = [];
  for (let i = 0; i < dataRows.length; i += 5) {
    const block = dataRows.slice(i, i + 5);
    for (let j = 0; j < 5; j++) {
      const label = (block[j].row[1] || '').trim();
      if (label !== EXPECTED_WORKOUT_LABELS[j]) {
        throw new Error(
          `Row ${block[j].originalIndex + 1}: expected WORKOUT label "${EXPECTED_WORKOUT_LABELS[j]}", got "${label}".`
        );
      }
    }
    blocks.push(block.map(b => b.row));
  }
  return blocks;
}

function buildWeek(block) {
  const aerobicRow = block[0];
  const higherRow = block[1];
  const drillsRow = block[2];
  const crossRow = block[3];
  const strengthRow = block[4];

  const number = parseInt((aerobicRow[0] || '').toString().trim(), 10);
  if (isNaN(number)) {
    throw new Error(`Could not parse week number from "${aerobicRow[0]}".`);
  }
  const stage = titleCase(cleanCell(aerobicRow[10]));
  const totalVolume = cleanCell(higherRow[9]);
  const raceWeekStage = cleanCell(higherRow[10]);

  const days = [];
  for (let d = 0; d < 7; d++) {
    const col = d + 2;
    const aerobic = cleanCell(aerobicRow[col]);
    const higherIntensity = cleanCell(higherRow[col]);
    const crossTraining = cleanCell(crossRow[col]);
    const drills = isYes(drillsRow[col]);
    const strength = isYes(strengthRow[col]);
    days.push({
      aerobic: isEmpty(aerobic) ? null : aerobic,
      higherIntensity: isEmpty(higherIntensity) ? null : higherIntensity,
      crossTraining: isEmpty(crossTraining) ? null : crossTraining,
      drills,
      strength,
    });
  }

  return {
    number,
    stage,
    totalVolume,
    raceWeekStage,
    days,
    mondayDate: null,
  };
}

function findRaceAnchor(weeks) {
  let raceWeek = null;
  for (const w of weeks) {
    if (w.raceWeekStage && w.raceWeekStage.toLowerCase() === 'race week') {
      if (!raceWeek || w.number > raceWeek.number) raceWeek = w;
    }
  }
  if (!raceWeek) {
    throw new Error("Could not find a week with stage 'Race week'. Is this a race-targeted plan?");
  }
  let raceDayOffset = -1;
  let matches = 0;
  for (let d = 0; d < 7; d++) {
    const day = raceWeek.days[d];
    const cells = [day.aerobic, day.higherIntensity, day.crossTraining];
    for (const cell of cells) {
      if (cell && /race day/i.test(cell)) {
        if (raceDayOffset === -1) raceDayOffset = d;
        matches++;
        break;
      }
    }
  }
  if (raceDayOffset === -1) {
    throw new Error(`Found 'Race week' stage in week ${raceWeek.number} but no 'Race day' cell to identify which day of the week.`);
  }
  return { raceWeek, raceDayOffset, multipleMatches: matches > 1 };
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function parseISODate(input) {
  if (input instanceof Date) return input;
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Invalid race date: ${input}. Expected YYYY-MM-DD.`);
  }
  const [y, m, d] = input.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function emptyDay() {
  return { aerobic: null, higherIntensity: null, crossTraining: null, drills: false, strength: false };
}

function assignDates(weeks, raceDate) {
  const { raceWeek, raceDayOffset: csvRaceDayOffset } = findRaceAnchor(weeks);
  const userRaceDayOffset = (raceDate.getDay() + 6) % 7;
  const raceWeekMonday = addDays(raceDate, -userRaceDayOffset);
  for (const w of weeks) {
    const weeksBefore = raceWeek.number - w.number;
    w.mondayDate = addDays(raceWeekMonday, -7 * weeksBefore);
    w.dayCount = 7;
  }
  raceWeek.dayCount = userRaceDayOffset + 1;
  if (csvRaceDayOffset !== userRaceDayOffset) {
    const raceDayContent = raceWeek.days[csvRaceDayOffset];
    raceWeek.days[csvRaceDayOffset] = emptyDay();
    raceWeek.days[userRaceDayOffset] = raceDayContent;
  }
  return { raceWeek, csvRaceDayOffset, userRaceDayOffset };
}

function swapLongRunDay(weeks, longRunDayOffset) {
  if (longRunDayOffset === 6) return;
  if (longRunDayOffset < 0 || longRunDayOffset > 6) {
    throw new Error(`Invalid long run day offset: ${longRunDayOffset}. Expected 0–6.`);
  }
  for (const w of weeks) {
    const tmp = w.days[longRunDayOffset];
    w.days[longRunDayOffset] = w.days[6];
    w.days[6] = tmp;
  }
}

function parsePlan(rows, raceDateInput, options = {}) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    throw new Error('Header row not found. Expected a row beginning with "WEEK,WORKOUT,...".');
  }
  const title = extractTitle(rows, headerIdx);
  const blocks = groupIntoBlocks(rows, headerIdx);
  const weeks = blocks.map(buildWeek);
  const longRunDayOffset = options.longRunDayOffset != null ? options.longRunDayOffset : 6;
  swapLongRunDay(weeks, longRunDayOffset);
  const raceDate = parseISODate(raceDateInput);
  const anchor = assignDates(weeks, raceDate);
  return { title, weeks, raceDate, anchor, longRunDayOffset };
}

function formatLongDate(date) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function splitMultiline(text) {
  const chunks = [];
  let current = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed === '+') {
      if (current.length) {
        chunks.push(current.join('\n').trim());
        current = [];
      }
    } else {
      current.push(trimmed);
    }
  }
  if (current.length) chunks.push(current.join('\n').trim());

  const flat = [];
  for (const chunk of chunks) {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (t) flat.push(t);
    }
  }
  return flat;
}

function normalizeRest(text) {
  if (text && text.toLowerCase() === 'rest') return 'Rest day';
  return text;
}

function isRaceDay(day) {
  const cells = [day.aerobic, day.higherIntensity, day.crossTraining];
  return cells.some(c => c && /race day/i.test(c));
}

function renderDay(day, dayName, dateStr) {
  const lines = [`### ${dayName}, ${dateStr}`];

  if (isRaceDay(day)) {
    lines.push('Race Day!');
    return lines.join('\n');
  }

  const items = [];

  if (day.aerobic) {
    const aerobicText = normalizeRest(day.aerobic);
    const sub = [];
    if (day.drills) sub.push('  - [ ] Drills and/or strides');
    items.push(`- [ ] ${aerobicText}`);
    items.push(...sub);
  } else if (day.drills) {
    items.push('- [ ] Drills and/or strides');
  }

  if (day.higherIntensity) {
    items.push('- [ ] Higher intensity:');
    const subs = splitMultiline(day.higherIntensity);
    for (const s of subs) items.push(`  - ${s}`);
  }

  if (day.crossTraining) {
    items.push(`- [ ] ${day.crossTraining}`);
  }

  if (day.strength) {
    items.push('- [ ] Strength training');
  }

  if (items.length === 0) {
    items.push('- [ ] Rest day');
  }

  return lines.concat(items).join('\n');
}

function renderWeek(week) {
  const monday = week.mondayDate;
  const stagePart = week.stage ? ` (${week.stage})` : '';
  const lines = [
    `## Week ${week.number}, ${formatLongDate(monday)}${stagePart}`,
    `**Total volume: ${week.totalVolume}**`,
    '',
  ];
  const dayCount = week.dayCount || 7;
  for (let d = 0; d < dayCount; d++) {
    const dayDate = addDays(monday, d);
    lines.push(renderDay(week.days[d], DAY_NAMES[d], formatShortDate(dayDate)));
    lines.push('');
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function renderMarkdown(plan) {
  const out = [];
  if (plan.title) {
    out.push(`# ${plan.title}`);
    out.push('');
  }
  const sortedWeeks = [...plan.weeks].sort((a, b) => a.number - b.number);
  for (let i = 0; i < sortedWeeks.length; i++) {
    if (i > 0) {
      out.push('');
      out.push('---');
      out.push('');
    }
    out.push(renderWeek(sortedWeeks[i]));
  }
  out.push('');
  return out.join('\n');
}

function checkRaceDateConsistency(plan) {
  const { anchor } = plan;
  if (anchor.csvRaceDayOffset !== anchor.userRaceDayOffset) {
    return {
      moved: true,
      raceDateDay: DAY_NAMES[anchor.userRaceDayOffset],
      planDay: DAY_NAMES[anchor.csvRaceDayOffset],
    };
  }
  return { moved: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseCSV,
    parsePlan,
    renderMarkdown,
    cleanCell,
    splitMultiline,
    findRaceAnchor,
    checkRaceDateConsistency,
    formatLongDate,
    formatShortDate,
    addDays,
    DAY_NAMES,
  };
}
