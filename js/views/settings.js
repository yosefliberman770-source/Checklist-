// Preferences, reminders, backup and restore.

import { app, toast } from '../ctx.js';
import { toCSV, validateImport, defaultState, saveState } from '../store.js';
import { ENGINE_VERSION } from '../engine.js';
import { esc, fmtDate, todayStr } from '../util.js';

export const APP_VERSION = '1.10';

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = typeof File === 'function' ? new File([blob], name, { type }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function icsReminder(time) {
  const [h, m] = (time || '21:00').split(':');
  const d = todayStr().replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//My Day//Goal tracker//EN', 'BEGIN:VEVENT',
    `UID:myday-reminder-${Date.now()}@myday`, `DTSTAMP:${stamp}`, `DTSTART:${d}T${h}${m}00`, 'DURATION:PT5M',
    'RRULE:FREQ=DAILY', 'SUMMARY:Log my day', 'DESCRIPTION:Open My Day and log what you did today.',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Log my day', 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function renderSettings() {
  const s = app.state.settings;
  const opt = (v, cur, l) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
  return `<div class="topbar"><h1>Settings</h1></div>
    ${isStandalone() ? '' : `<section class="card install"><h3>📱 Put this on your home screen</h3>
      <p class="small"><b>iPhone (Safari):</b> tap the Share button <span aria-hidden="true">⬆︎</span> → <b>Add to Home Screen</b> → Add.</p>
      <p class="small"><b>Android (Chrome):</b> tap the ⋮ menu → <b>Add to Home screen</b> / <b>Install app</b>.</p>
      <p class="muted small">It then opens full-screen like a normal app and works offline.</p></section>`}
    <section class="card form">
      <h3>Scoring</h3>
      <label class="field"><span>A "good day" is a score of at least</span>
        <span class="inline-num"><input type="number" min="1" max="100" data-setting="goodDay" data-type="num" value="${esc(s.goodDay)}"><span class="unit">%</span></span></label>
      <label class="field"><span>Past days where nothing at all was logged count as</span>
        <select data-setting="unloggedDays">${opt('missed', s.unloggedDays, 'Missed — scheduled goals score 0 (default)')}${opt('untracked', s.unloggedDays, 'Not tracked — left out of averages')}</select></label>
      <label class="field"><span>Most bonus points in one day</span>
        <select data-setting="bonusCap">${[3, 5, 10, 15, 20].map((n) => opt(n, s.bonusCap ?? 10, `+${n}${n === 10 ? ' (default)' : ''}`)).join('')}${opt('none', s.bonusCap, 'No limit')}</select></label>
      <label class="check-field"><input type="checkbox" data-setting="includeToday" data-type="bool" ${s.includeToday ? 'checked' : ''}> Include today (still in progress) in averages</label>
    </section>
    <section class="card form">
      <h3>Display</h3>
      <label class="field"><span>Week starts on</span>
        <select data-setting="weekStart" data-type="num">${opt(1, s.weekStart, 'Monday')}${opt(0, s.weekStart, 'Sunday')}</select></label>
      <label class="check-field"><input type="checkbox" data-setting="groupByCategory" data-type="bool" ${s.groupByCategory ? 'checked' : ''}> Group goals by category on the Today screen</label>
      <label class="field"><span>Theme</span>
        <select data-setting="theme">${opt('auto', s.theme, 'Match my phone')}${opt('light', s.theme, 'Light')}${opt('dark', s.theme, 'Dark')}</select></label>
    </section>
    <section class="card form">
      <h3>Reminder</h3>
      <p class="muted small">One gentle daily reminder, added to your phone's calendar so it works even when the app is closed. Remove it from your calendar any time.</p>
      <div class="inline"><input type="time" data-setting="reminderTime" value="${esc(s.reminderTime || '21:00')}">
        <button class="btn small" data-a="addReminder">Add to my calendar</button></div>
    </section>
    <section class="card form">
      <h3>Backup</h3>
      <p class="muted small">Your data lives only on this phone. Save a backup now and then (e.g. to Files, iCloud Drive or Google Drive).${s.lastBackup ? ` Last backup: ${fmtDate(s.lastBackup, { year: true })}.` : ' No backup yet.'}</p>
      <div class="row-btns wrap">
        <button class="btn" data-a="exportJSON">Save backup</button>
        <button class="btn" data-a="exportCSV">Export spreadsheet (CSV)</button>
        <label class="btn">Restore backup…<input type="file" accept="application/json,.json" data-change="importJSON" hidden></label>
      </div>
    </section>
    <section class="card">
      <h3>About</h3>
      <p class="small">My Day version ${APP_VERSION} · scoring engine v${ENGINE_VERSION}. Your goals, your rules: the app only measures the system you design.</p>
      <button class="btn small" data-a="checkUpdate">Check for updates</button>
      <p class="muted small">${app.state.goals.length} goals · ${Object.keys(app.state.records).length} entries stored on this device.</p>
      <button class="btn small danger" data-a="wipe">Erase all data…</button>
    </section>`;
}

export const settingsActions = {
  async checkUpdate(el) {
    el.disabled = true;
    el.textContent = 'Checking…';
    try {
      const reg = app.swReg || (await navigator.serviceWorker?.getRegistration());
      if (reg) await reg.update();
      // Fetch the newest version number straight from the site.
      const res = await fetch(`./js/views/settings.js?check=${Date.now()}`, { cache: 'no-store' });
      const latest = (await res.text()).match(/APP_VERSION = '([^']+)'/)?.[1];
      if (latest && latest !== APP_VERSION) {
        toast(`Updating to version ${latest}…`);
        setTimeout(() => location.reload(), 900);
        return;
      }
      toast('You have the latest version.');
    } catch {
      toast('Couldn\'t check — are you online?');
    }
    el.disabled = false;
    el.textContent = 'Check for updates';
  },
  async addReminder() {
    await saveFile('my-day-reminder.ics', icsReminder(app.state.settings.reminderTime), 'text/calendar');
  },
  async exportJSON() {
    const ok = await saveFile(`my-day-backup-${app.today}.json`, JSON.stringify(app.state, null, 1), 'application/json');
    if (ok) { app.state.settings.lastBackup = app.today; app.commit(); toast('Backup saved'); }
  },
  async exportCSV() {
    await saveFile(`my-day-entries-${app.today}.csv`, toCSV(app.state), 'text/csv');
  },
  async wipe() {
    if (!confirm('Erase ALL goals and entries on this device? Save a backup first if you might want them back.')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    app.state = defaultState();
    await saveState(app.state);
    toast('All data erased');
    location.hash = '#today';
    app.render();
  },
};

export const settingsChange = {
  async importJSON(el) {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = validateImport(JSON.parse(await file.text()));
      if (!confirm(`Replace everything on this device with this backup (${data.goals.length} goals, ${Object.keys(data.records).length} entries)?`)) return;
      app.state = data;
      await saveState(app.state);
      toast('Backup restored');
      app.render();
    } catch (e) {
      alert(`Couldn't restore: ${e.message}`);
    } finally {
      el.value = '';
    }
  },
};

export function applySetting(el) {
  const key = el.dataset.setting;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.type === 'num') v = Number(v);
  if (key === 'goodDay') v = Math.max(1, Math.min(100, Number(v) || 80));
  app.state.settings[key] = v;
  applyTheme();
  app.commit();
}

export function applyTheme() {
  const t = app.state?.settings?.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
