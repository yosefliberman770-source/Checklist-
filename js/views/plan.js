// Daily schedule: a calendar-style day view where you place some of your
// tasks (or anything else) at a time. Only what you add shows up. A task can
// keep its slot every day it's due.

import { app, openSheet, closeSheet, toast, goalColor } from '../ctx.js';
import { dayScore } from '../engine.js';
import { esc, addDays, fmtDate, uid, pad } from '../util.js';
import { fmtDur } from '../format.js';

const MAX_AHEAD = 30;
const HOUR_PX = 60;
const DEFAULT_FROM = 6;

const toMin = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};
const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min % 60))}`;

export function fmtClock(min) {
  const d = new Date(2000, 0, 1, Math.floor(min / 60) % 24, Math.round(min % 60));
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const fmtHour = (h) => new Date(2000, 0, 1, h % 24).toLocaleTimeString([], { hour: 'numeric' });
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

const dayPlan = (date) => (app.state.plans[date] ||= { items: [], hidden: {} });

// Older plans stored "done by" times; show them as ending at that time.
function startOf(x) {
  if (x.start) return toMin(x.start);
  if (x.dueBy) return Math.max(0, toMin(x.dueBy) - (Number(x.minutes) || 30));
  return null;
}

// Everything on the calendar for a date.
export function scheduleEntries(date) {
  const { state, today } = app;
  const ds = dayScore(state, date, today);
  const plan = state.plans[date] || { items: [], hidden: {} };
  const due = Object.fromEntries(ds.items.map((i) => [i.goal.id, i]));
  const allItems = Object.fromEntries(ds.all.map((i) => [i.goal.id, i]));
  const out = [];
  for (const x of plan.items || []) {
    const start = startOf(x);
    if (start == null) continue;
    const g = x.goalId ? state.goals.find((y) => y.id === x.goalId && y.state !== 'trash') : null;
    if (x.goalId && !g) continue;
    const it = g ? allItems[g.id] : null;
    out.push({
      key: `i:${x.id || x.goalId}`, id: x.id, goalId: g?.id || null, goal: g, item: it,
      name: g ? g.name : x.name, icon: g?.icon || '', start, minutes: Number(x.minutes) || 30,
      done: g ? !!it?.met : !!x.done, repeat: false,
      kind: g ? (it?.version.parts?.length ? 'multi' : it?.version.kind) : 'oneoff',
    });
  }
  // Tasks with an everyday slot, on days they're due (unless moved/removed today).
  for (const g of state.goals) {
    const slot = g.scheduleSlot || (g.planDefault?.dueBy ? { dueBy: g.planDefault.dueBy, minutes: g.planDefault.minutes } : null);
    if (!slot || g.state !== 'active' || !due[g.id]) continue;
    if ((plan.items || []).some((x) => x.goalId === g.id) || plan.hidden?.[g.id]) continue;
    if (due[g.id].weekly?.complete && due[g.id].status !== 'logged') continue;
    const start = startOf(slot);
    if (start == null) continue;
    const it = due[g.id];
    out.push({
      key: `r:${g.id}`, goalId: g.id, goal: g, item: it, name: g.name, icon: g.icon || '', start,
      minutes: Number(slot.minutes) || 30, done: !!it.met, repeat: true,
      kind: it.version.parts?.length ? 'multi' : it.version.kind,
    });
  }
  return out.sort((a, b) => a.start - b.start || b.minutes - a.minutes);
}

// Side-by-side columns for overlapping blocks.
function layout(entries) {
  const res = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const e of cluster) {
      let c = cols.findIndex((end) => end <= e.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = e.start + e.minutes;
      res.push({ e, col: c });
    }
    for (const r of res.slice(res.length - cluster.length)) r.cols = cols.length;
    cluster = []; clusterEnd = -1;
  };
  for (const e of entries) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.start + e.minutes);
  }
  if (cluster.length) flush();
  return res;
}

function dayTitle(date) {
  const t = app.today;
  if (date === t) return 'Today';
  if (date === addDays(t, 1)) return 'Tomorrow';
  if (date === addDays(t, -1)) return 'Yesterday';
  return fmtDate(date);
}

export function renderPlan() {
  const { ui, today, state } = app;
  const date = ui.date;
  const isToday = date === today;
  const entries = scheduleEntries(date);
  const first = Math.min(DEFAULT_FROM, ...entries.map((e) => Math.floor(e.start / 60)));
  const hours = [];
  for (let h = first; h < 24; h++) hours.push(h);
  const top = (min) => ((min - first * 60) / 60) * HOUR_PX;
  const canLog = date <= today;
  const blocks = layout(entries).map(({ e, col, cols }) => {
    const h = Math.max(24, (e.minutes / 60) * HOUR_PX - 3);
    const color = e.goal ? goalColor(e.goal, state.goals.indexOf(e.goal)) : 'var(--excused)';
    let check = '';
    if (e.kind === 'oneoff') check = `<button class="blk-check${e.done ? ' on' : ''}" data-a="schedToggle" data-id="${e.id}" aria-label="Done">✓</button>`;
    else if (e.kind === 'check') check = `<button class="blk-check${e.done ? ' on' : ''}" data-a="toggle" data-g="${e.goalId}" aria-label="Done" ${canLog ? '' : 'disabled'}>✓</button>`;
    else check = `<button class="blk-check${e.done ? ' on' : ''}" data-a="entry" data-g="${e.goalId}" aria-label="Log it" ${canLog ? '' : 'disabled'}>✓</button>`;
    return `<div class="blk${e.done ? ' done' : ''}${h < 40 ? ' short' : ''}" style="top:${top(e.start) + 1}px;height:${h}px;left:calc(${(col / cols) * 100}% + 2px);width:calc(${100 / cols}% - 4px);--bc:${color}">
      <button class="blk-main" data-a="schedEdit" data-key="${esc(e.key)}">
        <span class="blk-name">${e.icon ? esc(e.icon) + ' ' : ''}${esc(e.name)}</span>
        <span class="blk-time">${fmtClock(e.start)}–${fmtClock(e.start + e.minutes)}${e.repeat ? ' · every day' : ''}</span>
      </button>${check}
    </div>`;
  }).join('');
  const now = nowMin();
  const nowLine = isToday && now >= first * 60 ? `<div class="now-line" id="now-line" style="top:${top(now)}px"><span></span></div>` : '';
  const left = entries.filter((e) => !e.done).reduce((a, e) => a + e.minutes, 0);

  return `<div class="dayhead">
      <button class="nav-btn" data-a="planPrev" aria-label="Previous day">‹</button>
      <label class="daytitle"><span>${esc(dayTitle(date))}</span>
        <input type="date" data-change="planPickDate" value="${date}" max="${addDays(today, MAX_AHEAD)}" aria-label="Pick a date"></label>
      <button class="nav-btn" data-a="planNext" aria-label="Next day" ${date >= addDays(today, MAX_AHEAD) ? 'disabled' : ''}>›</button>
    </div>
    <div class="sched-bar">
      <span class="muted small">${entries.length ? `${entries.length} on the schedule${left ? ` · ${fmtDur(left)} still to do` : ' · all done ✓'}` : 'Tap a time to put something there'}</span>
      <button class="btn small primary" data-a="schedAdd">+ Add</button>
    </div>
    <div class="cal-day" style="height:${hours.length * HOUR_PX}px">
      ${hours.map((h) => `<div class="hour" style="top:${top(h * 60)}px">
        <span class="hour-label">${fmtHour(h)}</span>
        <button class="slot" data-a="schedAddAt" data-m="${h * 60}" aria-label="Add at ${fmtHour(h)}"></button>
        <button class="slot half" data-a="schedAddAt" data-m="${h * 60 + 30}" aria-label="Add at ${fmtHour(h)} 30"></button>
      </div>`).join('')}
      <div class="blocks">${blocks}</div>
      ${nowLine}
    </div>`;
}

// Scroll the day view to "now" (or the first item) when it opens.
export function afterPlanRender() {
  const target = document.getElementById('now-line') || document.querySelector('.cal-day .blk');
  if (target) target.scrollIntoView({ block: 'center' });
}

// ---------- add / edit ----------

function sheet({ key = '', goalId = '', name = '', start = 9 * 60, minutes = 30, repeat = false, isNew = true }) {
  const { state, ui, today } = app;
  const ds = dayScore(state, ui.date, today);
  const scheduled = new Set(scheduleEntries(ui.date).filter((e) => e.goalId).map((e) => e.goalId));
  const tasks = ds.items.filter((i) => i.goal.state === 'active' && (!scheduled.has(i.goal.id) || i.goal.id === goalId))
    .sort((a, b) => a.goal.name.localeCompare(b.goal.name));
  const pick = isNew ? (goalId || (tasks[0]?.goal.id ?? '__other')) : (goalId || '__other');
  const what = isNew ? `<label class="field"><span>What?</span>
      <select name="what" data-change="schedWhat">
        ${tasks.map((i) => `<option value="${i.goal.id}"${pick === i.goal.id ? ' selected' : ''}>${esc(i.goal.icon || '')} ${esc(i.goal.name)}</option>`).join('')}
        <option value="__other"${pick === '__other' ? ' selected' : ''}>Something else…</option>
      </select></label>` : '';
  openSheet(`
    <div class="sheet-head"><h2>${isNew ? 'Add to schedule' : esc(name)}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted">${esc(dayTitle(ui.date))}</p>
    <form data-submit="schedSave" data-key="${esc(key)}" data-goal="${esc(isNew ? '' : goalId)}">
      ${what}
      <label class="field other-name"${pick === '__other' && !(!isNew && goalId) ? '' : ' hidden'}><span>Name</span>
        <input type="text" name="name" value="${esc(goalId ? '' : name)}" placeholder="e.g. Dentist, meeting, call mom"></label>
      <div class="grid2">
        <label class="field"><span>Starts at</span><input type="time" name="start" value="${toHHMM(start)}" required></label>
        <div class="field"><span>Takes</span>
          <div class="dur-input small">
            <input name="h" type="number" inputmode="numeric" min="0" value="${Math.floor(minutes / 60) || ''}" placeholder="0" aria-label="hours"><span>h</span>
            <input name="m" type="number" inputmode="numeric" min="0" max="59" value="${minutes % 60 || ''}" placeholder="0" aria-label="minutes"><span>m</span>
          </div></div>
      </div>
      <div class="chips">${[15, 30, 45, 60, 90, 120].map((n) => `<button type="button" class="chip-btn" data-a="planDur" data-n="${n}">${fmtDur(n)}</button>`).join('')}</div>
      <label class="check-field repeat-field"${pick === '__other' && !(!isNew && goalId) ? ' hidden' : ''}><input type="checkbox" name="repeat" ${repeat ? 'checked' : ''}> <span>Every day it's due, at this time</span></label>
      <button class="btn primary block" type="submit">${isNew ? 'Add' : 'Save'}</button>
      ${isNew ? '' : `<button type="button" class="btn block danger-text" data-a="schedRemove" data-key="${esc(key)}">Remove from ${repeat ? 'the schedule' : 'this day'}</button>`}
    </form>`);
}

function findEntry(key) { return scheduleEntries(app.ui.date).find((e) => e.key === key); }

export const planActions = {
  planPrev() { app.ui.date = addDays(app.ui.date, -1); app.render(); afterPlanRender(); },
  planNext() {
    if (app.ui.date < addDays(app.today, MAX_AHEAD)) { app.ui.date = addDays(app.ui.date, 1); app.render(); afterPlanRender(); }
  },
  schedAdd() {
    const n = nowMin();
    sheet({ start: app.ui.date === app.today ? Math.ceil((n + 1) / 30) * 30 % (24 * 60) : 9 * 60 });
  },
  schedAddAt(el) { sheet({ start: Number(el.dataset.m) }); },
  schedEdit(el) {
    const e = findEntry(el.dataset.key);
    if (e) sheet({ key: e.key, goalId: e.goalId || '', name: e.name, start: e.start, minutes: e.minutes, repeat: e.repeat, isNew: false });
  },
  planDur(el) {
    const n = Number(el.dataset.n);
    const form = el.closest('form');
    form.h.value = Math.floor(n / 60) || '';
    form.m.value = n % 60 || '';
  },
  schedToggle(el) {
    const x = dayPlan(app.ui.date).items.find((y) => y.id === el.dataset.id);
    if (x) { x.done = !x.done; app.commit(); }
  },
  schedRemove(el) {
    const key = el.dataset.key;
    const p = dayPlan(app.ui.date);
    if (key.startsWith('r:')) {
      const g = app.state.goals.find((y) => y.id === key.slice(2));
      if (!confirm(`Remove ${g.name} from the schedule on every day? (To skip just today, move it instead.)`)) return;
      delete g.scheduleSlot; delete g.planDefault;
    } else {
      const id = key.slice(2);
      const x = p.items.find((y) => (y.id || y.goalId) === id);
      p.items = p.items.filter((y) => y !== x);
      if (x?.goalId) p.hidden[x.goalId] = true;
    }
    closeSheet();
    app.commit();
  },
};

export const planSubmit = {
  schedSave(form) {
    const p = dayPlan(app.ui.date);
    p.hidden ||= {};
    const start = form.start.value;
    if (!start) { toast('Pick a start time'); return; }
    const minutes = Math.max(5, (Number(form.h.value) || 0) * 60 + (Number(form.m.value) || 0) || 30);
    const key = form.dataset.key;
    const goalId = form.dataset.goal || (form.what && form.what.value !== '__other' ? form.what.value : '');
    const repeat = !!form.repeat?.checked && !!goalId;
    // Take the old placement off (when editing), keeping a one-off's id and done mark.
    let old = null;
    if (key.startsWith('i:')) {
      const id = key.slice(2);
      old = p.items.find((y) => (y.id || y.goalId) === id) || null;
      p.items = p.items.filter((y) => y !== old);
    }
    if (goalId) {
      const g = app.state.goals.find((y) => y.id === goalId);
      p.items = p.items.filter((y) => y.goalId !== goalId);
      delete p.hidden[goalId];
      if (repeat) {
        g.scheduleSlot = { start, minutes };
        delete g.planDefault;
      } else {
        if (key.startsWith('r:')) { delete g.scheduleSlot; delete g.planDefault; } // stop repeating
        p.items.push({ id: uid(), goalId, start, minutes });
      }
    } else {
      const name = form.name.value.trim();
      if (!name) { toast('Give it a name'); return; }
      p.items.push({ id: old?.id || uid(), name, start, minutes, done: !!old?.done });
    }
    closeSheet();
    app.commit();
  },
};

export const planChange = {
  planPickDate(el) {
    if (!el.value) return;
    const max = addDays(app.today, MAX_AHEAD);
    app.ui.date = el.value > max ? max : el.value;
    app.render();
    afterPlanRender();
  },
  schedWhat(el) {
    const other = el.value === '__other';
    const form = el.closest('form');
    form.querySelector('.other-name').hidden = !other;
    form.querySelector('.repeat-field').hidden = other;
    if (other) form.name.focus();
  },
};
