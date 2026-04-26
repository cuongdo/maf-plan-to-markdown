// UI wiring for index.html. Depends on app.js (global functions) and marked (CDN).

(function () {
  const fileInput = document.getElementById('csv-file');
  const pasteArea = document.getElementById('csv-paste');
  const raceDateInput = document.getElementById('race-date');
  const dateLabel = document.getElementById('date-label');
  const isRaceCheckbox = document.getElementById('is-race');
  const longRunDaySelect = document.getElementById('long-run-day');
  const convertBtn = document.getElementById('convert');
  const errorBanner = document.getElementById('error-banner');
  const noteBanner = document.getElementById('note-banner');
  const output = document.getElementById('output');
  const preview = document.getElementById('preview');
  const copyBtn = document.getElementById('copy');
  const downloadBtn = document.getElementById('download');

  raceDateInput.value = todayISO();
  updateDateLabel();
  isRaceCheckbox.addEventListener('change', updateDateLabel);

  function updateDateLabel() {
    dateLabel.textContent = isRaceCheckbox.checked ? 'Race date' : 'End date';
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    pasteArea.value = text;
  });

  convertBtn.addEventListener('click', () => {
    clearBanners();
    output.value = '';
    preview.innerHTML = '';
    const csvText = pasteArea.value.trim();
    if (!csvText) {
      showError('Please pick a CSV file or paste CSV content.');
      return;
    }
    const raceDate = raceDateInput.value;
    if (!raceDate) {
      showError('Please pick a race date.');
      return;
    }
    try {
      const rows = parseCSV(csvText);
      const longRunDayOffset = parseInt(longRunDaySelect.value, 10);
      const isRace = isRaceCheckbox.checked;
      const plan = parsePlan(rows, raceDate, { longRunDayOffset, isRace });
      const md = renderMarkdown(plan);
      output.value = md;
      preview.innerHTML = marked.parse(md);
      if (isRace) {
        const check = checkRaceDateConsistency(plan);
        if (check.moved) {
          showNote(
            `Race day workout placed on ${check.raceDateDay} (it was in the ${check.planDay} column of the source CSV).`
          );
        }
      }
    } catch (err) {
      console.error(err);
      showError(err.message || String(err));
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
      flashButton(copyBtn, 'Copied!');
    } catch {
      output.select();
      document.execCommand('copy');
      flashButton(copyBtn, 'Copied!');
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!output.value) return;
    const blob = new Blob([output.value], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'training-plan.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function clearBanners() {
    errorBanner.hidden = true;
    errorBanner.textContent = '';
    noteBanner.hidden = true;
    noteBanner.textContent = '';
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.hidden = false;
  }

  function showNote(msg) {
    noteBanner.textContent = msg;
    noteBanner.hidden = false;
  }

  function flashButton(btn, label) {
    const original = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
})();
