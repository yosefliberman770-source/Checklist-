// Daily plan: when things need to be done by and how long they take.
// Every task due that day is in the plan; tap one to give it a "done by"
// time and a duration (optionally as its everyday default). One-off items
// can be added too. For today, the plan lays tasks out from now in order of
// what's due first and warns when something won't fit in time.

import { app, openSheet, closeSheet, toast } from '../ctx.js';
import { dayScore } from '../engine.js';
import { esc, addDays, fmtDate, uid } from '../util.js';
import { fmtDur } from '../format.js';

const MAX_AHEAD = 14;

const toMin = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
};

export function fmtClock(min) {
  const d = new Date(2000, 0, 1, Math.floor(min / 60) % 24, Math.round(min % 60));
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function planFor(date) {
  const p = app.state.plans[date] || {};
  return { items: p.items || [] };
}

// All entries in the plan for a date: due tasks (with their day override or
// everyday default) plus one-off items.
export function planEntries(date) {
  const { state, today } = app;
  const ds = dayScore(state, date, today);
  const plan = planFor(date);
  const entries = [];
  const tasks = ds.items.filter((i) => i.goal.state === 'active' && !(i.weekly?.complete && i.status !== 'logged'));
  for (const i of tasks) {
    const g = i.goal;
    const own = plan.items.find((x) => x.goalId === g.id);
    const def = g.planDefault || {};
    const src = own || def;
    entries.push({
      key: `g:${g.id}`, goalId: g.id, goal: g, item: i, name: g.name, icon: g.icon || '',
      dueBy: src.dueBy || null, minutes: Number(src.minutes) || 0,
      fromDefault: !own && !!(def.dueBy || def.minutes),
      done: !!i.met, kind: i.version.parts?.length ? (i.version.partMode === 'best' ? 'choice' : 'parts') : i.version.kind,
    });
  }
  for (const x of plan.items.filter((y) => !y.goalId)) {
    entries.push({ key: `o:${x.id}`, oneOff: true, id: x.id, name: x.name, icon: '', dueBy: x.dueBy || null, minutes: Number(x.minutes) || 0, done: !!x.done });
  }
  return { ds, entries };
}

// Lay out what's left from `start`, earliest deadline first.
function schedule(entries, start) {
  const order = entries.filter((e) => !e.done && e.minutes > 0)
    .sort((a, b) => (toMin(a.dueBy) ?? 1e9) - (toMin(b.dueBy) ?? 1e9));
  let cursor = start;
  const slots = {};
  for (const e of order) {
    const s = cursor, end = cursor + e.minutes;
    cursor = end;
    const due = toMin(e.dueBy);
    slots[e.key] = { start: s, end, late: due != null && end > due };
  }
  return { slots, endsAt: cursor };
}

function dayTitle(date) {
  const t = app.today;
  if (date === t) return 'Today';
  if (date === addDays(t, 1)) return 'Tomorrow';
  if (date === addDays(t, -1)) return 'Yesterday';
  return fmtDate(date);
}

function row(e, slot, isToday) {
  const due = toMin(e.dueBy);
  const bits = [];
  if (due != null) bits.push(`by ${fmtClock(due)}`);
  if (e.minutes) bits.push(fmtDur(e.minutes));
  let when = '';
  if (!e.done && slot && isToday) {
    when = slot.late
      ? `<span class="plan-late">⚠ Won't fit by ${fmtClock(due)} — ${due - e.minutes < nowMin() ? 'start right away' : `start by ${fmtClock(due - e.minutes)}`}</span>`
      : `<span class="plan-slot">Do it ${fmtClock(slot.start)}–${fmtClock(slot.end)}</span>`;
  } else if (!e.done && due != null && e.minutes && !isToday) {
    when = `<span class="plan-slot">Start by ${fmtClock(due - e.minutes)}</span>`;
  }
  let check;
  const canLog = app.ui.date <= app.today;
  if (e.oneOff) check = `<button class="check small${e.done ? ' on' : ''}" data-a="planOneToggle" data-id="${e.id}" aria-label="Done">✓</button>`;
  else if (e.kind === 'check') check = `<button class="check small${e.done ? ' on' : ''}" data-a="toggle" data-g="${e.goalId}" aria-label="Done" ${canLog ? '' : 'disabled'}>✓</button>`;
  else check = `<button class="check small${e.done ? ' on' : ''}" data-a="entry" data-g="${e.goalId}" aria-label="Log it" ${canLog ? '' : 'disabled'}>✓</button>`;
  return `<div class="plan-row${e.done ? ' done' : ''}${slot?.late && !e.done && isToday ? ' late' : ''}">
    ${check}
    <button class="plan-main" data-a="planEdit" data-key="${esc(e.key)}">
      <span class="plan-name">${e.icon ? `${esc(e.icon)} ` : ''}${esc(e.name)}${e.oneOff ? ' <span class="chip pending">one-off</span>' : ''}</span>
      <span class="plan-meta">${bits.length ? esc(bits.join(' · ')) : '<span class="muted">Tap to set a time</span>'}${e.fromDefault ? ' <span class="muted small">(every day)</span>' : ''}</span>
      ${when}
    </button>
  </div>`;
}

export function renderPlan() {
  const { ui, today } = app;
  const date = ui.date;
  const isToday = date === today;
  const { entries } = planEntries(date);
  const timed = entries.filter((e) => e.dueBy).sort((a, b) => toMin(a.dueBy) - toMin(b.dueBy));
  const anytime = entries.filter((e) => !e.dueBy).sort((a, b) => (b.minutes > 0) - (a.minutes > 0) || a.name.localeCompare(b.name));
  const start = isToday ? Math.ceil(nowMin() / 5) * 5 : 0;
  const { slots, endsAt } = schedule(entries, start);
  const left = entries.filter((e) => !e.done).reduce((a, e) => a + e.minutes, 0);
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const freeMin = 24 * 60 - endsAt;
  const lateCount = isToday ? Object.values(slots).filter((s) => s.late).length : 0;
  let summary;
  if (!total) summary = '<p class="muted">Tap a task to set when it needs to be done by and how long it takes.</p>';
  else if (isToday) {
    summary = `<div class="plan-sum"><div><b>${left ? fmtDur(left) : 'Nothing'}</b><span class="muted small">left to do</span></div>
      <div><b>${left ? fmtClock(endsAt % (24 * 60)) : '—'}</b><span class="muted small">done at, if you start now</span></div>
      <div><b>${freeMin >= 0 ? fmtDur(freeMin) : '—'}</b><span class="muted small">${freeMin >= 0 ? 'free after that' : 'past midnight'}</span></div></div>
      ${lateCount ? `<div class="notice small plan-warn">⚠ ${lateCount} ${lateCount === 1 ? 'thing won\'t' : 'things won\'t'} fit before ${lateCount === 1 ? 'its' : 'their'} deadline. Start early ones now, or move some times.</div>` : ''}`;
  } else summary = `<div class="plan-sum"><div><b>${fmtDur(total)}</b><span class="muted small">planned</span></div><div><b>${entries.length}</b><span class="muted small">things</span></div></div>`;

  return `<div class="dayhead">
      <button class="nav-btn" data-a="planPrev" aria-label="Previous day">‹</button>
      <label class="daytitle"><span>Plan · ${esc(dayTitle(date))}</span>
        <input type="date" data-change="planPickDate" value="${date}" max="${addDays(today, MAX_AHEAD)}" aria-label="Pick a date"></label>
      <button class="nav-btn" data-a="planNext" aria-label="Next day" ${date >= addDays(today, MAX_AHEAD) ? 'disabled' : ''}>›</button>
    </div>
    <section class="card">${summary}</section>
    ${timed.length ? `<h3 class="group-title">Timeline</h3>${timed.map((e) => row(e, slots[e.key], isToday)).join('')}` : ''}
    ${anytime.length ? `<details class="group" open><summary>${timed.length ? 'No time set yet' : 'Your tasks'} <span class="muted">${anytime.length}</span></summary>
      ${anytime.map((e) => row(e, slots[e.key], isToday)).join('')}</details>` : ''}
    ${!entries.length ? '<p class="muted center">Nothing planned for this day yet.</p>' : ''}
    <button class="btn block" data-a="planAddOne">+ Add something else (one-off)</button>`;
}

// ---------- edit sheet ----------

function editSheet(e) {
  const m = e.minutes || 0;
  const g = e.goal;
  const hasDefault = !!(g?.planDefault && (g.planDefault.dueBy || g.planDefault.minutes));
  openSheet(`
    <div class="sheet-head"><h2>${e.icon ? esc(e.icon) + ' ' : ''}${esc(e.name || 'New item')}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted">${esc(dayTitle(app.ui.date))}</p>
    <form data-submit="planSave" data-key="${esc(e.key || '')}">
      ${e.oneOff || !e.key ? `<label class="field"><span>What is it?</span><input type="text" name="name" value="${esc(e.name || '')}" placeholder="e.g. Dentist, call the bank" required ${e.key ? '' : 'autofocus'}></label>` : ''}
      <label class="field"><span>Needs to be done by <em class="muted">(optional)</em></span>
        <span class="inline"><input type="time" name="dueBy" value="${esc(e.dueBy || '')}"><button type="button" class="link small" data-a="planClearTime">Clear</button></span></label>
      <div class="field"><span>Takes about</span>
        <div class="dur-input small">
          <input name="h" type="number" inputmode="numeric" min="0" value="${m ? Math.floor(m / 60) : ''}" placeholder="0" aria-label="hours"><span>h</span>
          <input name="m" type="number" inputmode="numeric" min="0" max="59" value="${m ? m % 60 : ''}" placeholder="0" aria-label="minutes"><span>m</span>
        </div>
        <div class="chips">${[5, 15, 30, 45, 60, 90, 120].map((n) => `<button type="button" class="chip-btn" data-a="planDur" data-n="${n}">${fmtDur(n)}</button>`).join('')}</div>
      </div>
      ${e.goalId ? `<label class="check-field"><input type="checkbox" name="every" ${hasDefault ? 'checked' : ''}> <span>Use this every day for ${esc(e.name)}</span></label>` : ''}
      <button class="btn primary block" type="submit">Save</button>
      ${e.oneOff ? `<button type="button" class="btn block danger-text" data-a="planRemove" data-key="${esc(e.key)}">Remove from plan</button>` : ''}
    </form>`);
}

function findEntry(key) {
  return planEntries(app.ui.date).entries.find((e) => e.key === key);
}

const plansOf = (date) => (app.state.plans[date] ||= { items: [] });

export const planActions = {
  planPrev() { app.ui.date = addDays(app.ui.date, -1); app.render(); },
  planNext() {
    if (app.ui.date < addDays(app.today, MAX_AHEAD)) { app.ui.date = addDays(app.ui.date, 1); app.render(); }
  },
  planEdit(el) { const e = findEntry(el.dataset.key); if (e) editSheet(e); },
  planAddOne() { editSheet({ oneOff: true }); },
  planDur(el) {
    const n = Number(el.dataset.n);
    const form = el.closest('form');
    form.h.value = Math.floor(n / 60) || '';
    form.m.value = n % 60 || (n >= 60 ? '' : n);
  },
  planClearTime(el) { el.closest('form').dueBy.value = ''; },
  planOneToggle(el) {
    const p = plansOf(app.ui.date);
    const x = p.items.find((y) => y.id === el.dataset.id);
    if (x) { x.done = !x.done; app.commit(); }
  },
  planRemove(el) {
    const p = plansOf(app.ui.date);
    p.items = p.items.filter((y) => `o:${y.id}` !== el.dataset.key);
    closeSheet();
    app.commit();
  },
};

export const planSubmit = {
  planSave(form) {
    const dueBy = form.dueBy.value || null;
    const minutes = (Number(form.h.value) || 0) * 60 + (Number(form.m.value) || 0);
    const p = plansOf(app.ui.date);
    const key = form.dataset.key;
    if (!key || key.startsWith('o:')) {
      const name = form.name.value.trim();
      if (!name) { toast('Give it a name'); return; }
      if (!key) p.items.push({ id: uid(), name, dueBy, minutes, done: false });
      else Object.assign(p.items.find((y) => `o:${y.id}` === key), { name, dueBy, minutes });
    } else {
      const goalId = key.slice(2);
      const goal = app.state.goals.find((g) => g.id === goalId);
      p.items = p.items.filter((y) => y.goalId !== goalId);
      if (form.every?.checked) {
        if (dueBy || minutes) goal.planDefault = { dueBy, minutes };
        else delete goal.planDefault;
      } else {
        p.items.push({ goalId, dueBy, minutes });
      }
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
  },
};

