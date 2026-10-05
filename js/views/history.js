// Calendar heatmap of day scores plus the trend line.

import { app } from '../ctx.js';
import { dayScore, rolling, periodStats } from '../engine.js';
import { scoreLine } from '../charts.js';
import { scoreLabel } from '../format.js';
import { addDays, endOfMonth, weekday, DAY_SHORT, MONTHS_LONG, fmtDate, mean } from '../util.js';

function monthShift(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function renderHistory() {
  const { state, today, ui } = app;
  const scoresLabel = (avg100) => (avg100 == null ? '—' : scoreLabel(avg100 / 100, state.settings));
  const ym = ui.histMonth;
  const first = `${ym}-01`;
  const last = endOfMonth(first);
  const ws = state.settings.weekStart;
  const lead = (weekday(first) - ws + 7) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell blank"></div>');
  const scores = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const ds = d > today ? null : dayScore(state, d, today);
    const s = ds?.score;
    if (s != null && (d < today || state.settings.includeToday)) scores.push(s * 100);
    const cls = ['cal-cell'];
    let style = '';
    if (d > today) cls.push('future');
    else if (ds.skipped) cls.push('skipped');
    else if (s == null) cls.push('none');
    else { style = `--s:${Math.round(s * 100)}`; if (s >= 0.55) cls.push('hi'); }
    if (d === today) cls.push('today');
    if (state.days[d]?.note) cls.push('noted');
    cells.push(`<button class="${cls.join(' ')}" ${style ? `style="${style}"` : ''} data-a="nav" data-href="#today/${d}" ${d > today ? 'disabled' : ''}
      aria-label="${fmtDate(d)}: ${s == null ? 'no score' : Math.round(s * 100) + '%'}">
      <span class="cal-d">${Number(d.slice(8))}</span>${s != null ? `<span class="cal-s">${ds.mode === 'points' ? Math.round(ds.points) : Math.round(s * 100)}</span>` : ''}</button>`);
  }
  const thr = Number(state.settings.goodDay) || 80;
  const wdOrder = [...Array(7)].map((_, i) => (i + ws) % 7);

  // trend
  const n = ui.histRange;
  const end = state.settings.includeToday ? today : addDays(today, -1);
  const ps = periodStats(state, addDays(end, -(n - 1)), end, today);
  const points = ps.days.map((d) => ({ x: d.date, y: d.score == null ? null : d.score * 100, note: !!state.days[d.date]?.note }));
  const avg = rolling(points, 7);
  const markers = ps.changes.map((c) => ({ date: c.date, label: `${c.goal.name} changed` }));

  const [y, m] = ym.split('-').map(Number);
  return `<div class="topbar"><h1>History</h1></div>
    <section class="card">
      <div class="month-nav">
        <button class="nav-btn" data-a="histMonth" data-d="-1" aria-label="Previous month">‹</button>
        <h3>${MONTHS_LONG[m - 1]} ${y}</h3>
        <button class="nav-btn" data-a="histMonth" data-d="1" aria-label="Next month" ${ym >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
      </div>
      <div class="cal">
        ${wdOrder.map((d) => `<div class="cal-h">${DAY_SHORT[d].slice(0, 2)}</div>`).join('')}
        ${cells.join('')}
      </div>
      <div class="legend"><span class="sw grad"></span>${state.settings.scoring === 'points' ? `0 → ${state.settings.dailyTarget || 100} pts` : '0 → 100%'} <span class="sw none"></span>No score <span class="sw skipped"></span>Skipped</div>
      <p class="small">${scores.length ? `Month average <b>${scoresLabel(mean(scores))}</b> · ${scores.filter((s) => s >= thr).length} good day${scores.filter((s) => s >= thr).length === 1 ? '' : 's'} of ${scores.length}` : '<span class="muted">No scored days this month.</span>'}</p>
    </section>
    <section class="card">
      <div class="month-nav"><h3>Day score trend</h3>
        <div class="chips">${[30, 90, 365].map((r) => `<button class="chip-btn${r === n ? ' on' : ''}" data-a="histRange" data-r="${r}">${r === 365 ? '1y' : r + 'd'}</button>`).join('')}</div></div>
      ${scoreLine({ points, avg, markers })}
      <div class="legend"><span class="sw line-daily"></span>Daily <span class="sw line-avg"></span>7-day average ${markers.length ? '<span class="sw marker"></span>Goal settings changed' : ''}</div>
      <p class="muted small">Average ${scoresLabel(ps.average)} over ${ps.scoredDays} scored day${ps.scoredDays === 1 ? '' : 's'}.</p>
    </section>`;
}

export const historyActions = {
  histMonth(el) {
    const next = monthShift(app.ui.histMonth, Number(el.dataset.d));
    if (next > app.today.slice(0, 7)) return;
    app.ui.histMonth = next;
    app.render();
  },
  histRange(el) { app.ui.histRange = Number(el.dataset.r); app.render(); },
};

