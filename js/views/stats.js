// Statistics for a period, and the shared period picker.

import { app } from '../ctx.js';
import { periodStats } from '../engine.js';
import { pct, pct100 } from '../format.js';
import { esc, addDays, startOfWeek, startOfMonth, fmtDate, diffDays, DAY_SHORT } from '../util.js';
import { hbars } from '../charts.js';

const PERIODS = [
  ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'],
  ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom'],
];

export function periodRange(id) {
  const t = app.today;
  const end = app.state.settings.includeToday ? t : addDays(t, -1);
  switch (id) {
    case '7d': return { from: addDays(end, -6), to: end };
    case '90d': return { from: addDays(end, -89), to: end };
    case 'week': return { from: startOfWeek(t, app.state.settings.weekStart), to: t };
    case 'month': return { from: startOfMonth(t), to: t };
    case 'year': return { from: t.slice(0, 4) + '-01-01', to: t };
    case 'custom': {
      const from = app.ui.customFrom || addDays(end, -29);
      const to = app.ui.customTo || end;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default: return { from: addDays(end, -29), to: end };
  }
}

export function periodChips() {
  const p = app.ui.period;
  const r = periodRange(p);
  return `<div class="chips period">${PERIODS.map(([id, l]) => `<button class="chip-btn${id === p ? ' on' : ''}" data-a="period" data-p="${id}">${l}</button>`).join('')}</div>
    ${p === 'custom' ? `<div class="inline custom-range"><input type="date" data-change="customFrom" value="${r.from}" max="${app.today}"> to <input type="date" data-change="customTo" value="${r.to}" max="${app.today}"></div>` : ''}
    <p class="muted small period-label">${fmtDate(r.from, { year: true })} – ${fmtDate(r.to, { year: true })}</p>`;
}

function coverageLine(ps) {
  const bits = [`Based on ${ps.scoredDays} of ${ps.totalDays} day${ps.totalDays === 1 ? '' : 's'}`];
  if (ps.skippedDays) bits.push(`${ps.skippedDays} skipped`);
  if (ps.untrackedDays) bits.push(`${ps.untrackedDays} not tracked`);
  if (ps.emptyDays) bits.push(`${ps.emptyDays} with no scored goals`);
  if (ps.excusedItems) bits.push(`${ps.excusedItems} excused goal-day${ps.excusedItems === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

export function renderStats() {
  const { state, today } = app;
  if (!state.goals.some((g) => g.state !== 'trash')) {
    return `<div class="topbar"><h1>Stats</h1></div><p class="muted center">Stats appear once you have goals and a few logged days.</p>`;
  }
  const r = periodRange(app.ui.period);
  const ps = periodStats(state, r.from, r.to, today);
  const len = diffDays(r.from, r.to) + 1;
  const prev = periodStats(state, addDays(r.from, -len), addDays(r.from, -1), today);
  const delta = ps.average != null && prev.average != null ? ps.average - prev.average : null;
  const thr = Number(state.settings.goodDay) || 80;

  const lost = ps.goals.filter((g) => g.lost > 0.05).sort((a, b) => b.lost - a.lost);
  const goalRows = ps.goals.filter((g) => g.scheduled || g.excused).sort((a, b) => (a.goal.order ?? 0) - (b.goal.order ?? 0));
  const wdOrder = state.settings.weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];

  return `<div class="topbar"><h1>Stats</h1></div>
    ${periodChips()}
    <div class="tiles">
      <div class="tile wide"><div class="tile-num big">${pct100(ps.average)}</div>
        <div class="tile-label">Average day score${delta != null ? ` · <span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)} vs previous ${len} days</span>` : ''}</div></div>
      <div class="tile"><div class="tile-num">${ps.goodDays}<span class="of">/${ps.scoredDays}</span></div><div class="tile-label">Good days (≥ ${thr}%)</div></div>
      <div class="tile"><div class="tile-num">${pct100(ps.median)}</div><div class="tile-label">Median day</div></div>
    </div>
    <p class="muted small">${coverageLine(ps)}</p>
    ${ps.changes.length ? `<div class="notice small">Your system changed during this period: ${ps.changes.slice(0, 5).map((c) => `${esc(c.goal.name)} (${fmtDate(c.date, { weekday: false })})`).join(', ')}${ps.changes.length > 5 ? '…' : ''}. Each day is still scored with the settings it had.</div>` : ''}

    <section class="card"><h3>Where your points went</h3>
      ${lost.length ? `<p class="muted small">Average points lost per day, by goal. Fixing the top one moves your score the most.</p>
        ${hbars(lost.map((g) => ({ label: `${esc(g.goal.icon || '')} ${esc(g.goal.name)}`, value: g.lost, href: `#goal/${g.goal.id}` })), { fmt: (v) => v.toFixed(1) })}`
        : '<p class="muted small">No points lost in this period. 🎯</p>'}
    </section>

    <section class="card"><h3>Goals</h3>
      ${goalRows.length ? `<table class="tbl">
        <thead><tr><th>Goal</th><th class="num">Met</th><th class="num">Progress</th></tr></thead>
        <tbody>${goalRows.map((g) => `<tr data-a="nav" data-href="#goal/${g.goal.id}" class="clickable">
          <td>${esc(g.goal.icon || '')} ${esc(g.goal.name)}${g.excused ? ` <span class="muted small">${g.excused} excused</span>` : ''}</td>
          <td class="num">${g.completion != null ? pct(g.completion) : '—'}<div class="muted small">${g.met}/${g.scheduled}</div></td>
          <td class="num">${g.avgCredit != null ? pct(g.avgCredit) : '—'}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">Met = days the target was reached ÷ days it was scheduled. Progress = average credit, including partial days.</p>`
        : '<p class="muted small">Nothing was scheduled in this period.</p>'}
    </section>

    <section class="card"><h3>By day of the week</h3>
      ${ps.scoredDays ? hbars(wdOrder.map((wd) => ({ label: DAY_SHORT[wd], value: ps.weekdayAvg[wd] ?? 0 })), { max: 100, fmt: (v) => (v ? `${Math.round(v)}%` : '—') }) : '<p class="muted small">No scored days yet.</p>'}
    </section>`;
}

export const statsActions = {
  period(el) { app.ui.period = el.dataset.p; app.render(); },
};

export const statsChange = {
  customFrom(el) { app.ui.customFrom = el.value; app.render(); },
  customTo(el) { app.ui.customTo = el.value; app.render(); },
};
