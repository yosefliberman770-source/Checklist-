// The daily screen: log what actually happened.

import { app, openSheet, closeSheet, toast, goalColor } from '../ctx.js';
import { sortedCats, catLabel } from './categories.js';
import { dayScore, effectiveTarget, evaluate, versionFor } from '../engine.js';
import { getRec, setRec } from '../store.js';
import { esc, addDays, fmtDate } from '../util.js';
import { fmtValue, targetShort, targetText, statusLabel, pct, fmtNum } from '../format.js';

const defaultStep = (cfg) => (cfg.kind === 'duration' ? 15 : 1);

function partMeta(goal, partId) {
  return (goal.parts || []).find((p) => p.id === partId) || { name: 'Part' };
}

function cfgFor(goal, partId, date) {
  const v = versionFor(goal, date);
  return partId ? (v.parts || []).find((p) => p.partId === partId) : v;
}

function stepFor(goal, partId) {
  const meta = partId ? partMeta(goal, partId) : goal;
  return Number(meta.step) || defaultStep(cfgFor(goal, partId, app.ui.date));
}

// The amount "Done" fills in, or null when "Done" makes no sense (at-most goals).
export function fillValue(cfg, date) {
  if (cfg.kind === 'check') return true;
  const t = effectiveTarget(cfg, date);
  const round = (x) => (cfg.kind === 'duration' ? Math.round(x) : Number(Number(x).toFixed(cfg.precision ?? 2)));
  if (t.type === 'atLeast' || t.type === 'exact') return round(Number(t.value) || 0);
  if (t.type === 'range') return round(((Number(t.low) || 0) + (Number(t.high) || 0)) / 2);
  return null;
}

function scoreRing(score) {
  const r = 34, c = 2 * Math.PI * r;
  const f = score == null ? 0 : Math.max(0, Math.min(1, score));
  return `<svg viewBox="0 0 80 80" class="ring" aria-hidden="true">
    <circle cx="40" cy="40" r="${r}" class="ring-bg"/>
    ${f > 0 ? '' : '<!--'}<circle cx="40" cy="40" r="${r}" class="ring-fg" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>${f > 0 ? '' : '-->'}
  </svg>`;
}

function dayTitle(date) {
  const t = app.today;
  if (date === t) return 'Today';
  if (date === addDays(t, -1)) return 'Yesterday';
  return fmtDate(date, { year: date.slice(0, 4) !== t.slice(0, 4) });
}

function valueControl(item, cfg, partId, value, logged, ro) {
  const g = item.goal;
  const pa = partId ? ` data-p="${partId}"` : '';
  if (cfg.kind === 'check') {
    return `<button class="check${value ? ' on' : ''}" data-a="toggle" data-g="${g.id}"${pa} aria-label="Mark done" ${ro}>✓</button>`;
  }
  const fill = fillValue(cfg, app.ui.date);
  const mid = logged
    ? `<button class="val" data-a="entry" data-g="${g.id}"${pa} ${ro}>${esc(fmtValue(value, cfg))}</button>`
    : fill != null
      ? `<button class="val fill" data-a="fill" data-g="${g.id}"${pa} ${ro}>✓ Done</button>`
      : `<button class="val empty" data-a="entry" data-g="${g.id}"${pa} ${ro}>Enter</button>`;
  return `<div class="stepper">
    <button class="step" data-a="step" data-d="-1" data-g="${g.id}"${pa} aria-label="Less" ${ro}>−</button>
    ${mid}
    <button class="step" data-a="step" data-d="1" data-g="${g.id}"${pa} aria-label="More" ${ro}>+</button>
  </div>`;
}

function progressBar(item) {
  if (!item.hasTarget || item.status === 'excused' || item.status === 'unscheduled') return '';
  const c = Math.max(0, Math.min(1, item.credit || 0));
  return `<div class="pbar"><div style="width:${(c * 100).toFixed(1)}%"></div></div>`;
}

function rowMeta(item, cfg) {
  const st = statusLabel(item);
  const parts = item.parts?.length;
  let val = '';
  if (parts && cfg.partMode === 'best') {
    const name = (pid) => partMeta(item.goal, pid).name;
    val = item.chosen ? `${name(item.chosen)} done` : `Do one: ${item.parts.map((p) => name(p.partId)).join(' or ')}`;
  } else if (parts) {
    if (item.total != null) val = item.totalTarget ? `${fmtValue(item.total, item.parts[0].cfg, { unit: false })} / ${fmtValue(item.totalTarget, item.parts[0].cfg)}` : fmtValue(item.total, item.parts[0].cfg);
    else val = `${item.parts.filter((p) => p.logged && p.ev?.met).length} of ${item.parts.filter((p) => p.counted).length} parts met`;
  } else if (cfg.kind !== 'check') {
    const ts = targetShort(cfg, app.ui.date);
    val = item.status === 'logged'
      ? (ts.startsWith('/') ? `${fmtValue(item.value, cfg, { unit: cfg.kind === 'duration' })} ${ts}` : `${fmtValue(item.value, cfg)}${ts ? ' · ' + ts : ''}`)
      : targetText(cfg, app.ui.date);
  }
  const progress = item.hasTarget && item.status === 'logged' && item.progress != null && !parts && cfg.kind !== 'check' &&
    cfg.target?.type === 'atLeast' ? ` · ${pct(item.progress)}` : '';
  const partsPct = parts && cfg.partMode !== 'best' && item.status === 'logged' && item.credit != null && !item.met ? ` · ${pct(item.credit)}` : '';
  const hideMiss = st.cls === 'missed' && st.text === 'No progress';
  const ptsChip = '';
  if (item.weekly) {
    const w = item.weekly;
    const wk = w.complete && item.status !== 'logged' ? `✓ ${w.times}/${w.times} this week` : `${w.done} of ${w.times} this week`;
    val = val ? `${val} · ${wk}` : wk;
  }
  return `<span class="g-meta">${esc(val)}${progress}${partsPct}${st.text && !hideMiss ? ` <span class="chip ${st.cls}">${st.text}</span>` : ''}${ptsChip}${item.note ? ' <span class="noteflag" title="Has a note">✎</span>' : ''}</span>`;
}

function goalRow(item, ro) {
  const g = item.goal;
  const cfg = item.version;
  const color = goalColor(g, app.state.goals.indexOf(g));
  const parts = item.parts || [];
  const open = app.ui.expanded[g.id] ?? cfg.partMode === 'best';
  const isChoice = cfg.partMode === 'best' && parts.length > 0;
  let controls;
  if (isChoice) {
    const chosen = item.chosen ? partMeta(g, item.chosen).name : null;
    controls = `<button class="val choose${chosen ? ' picked' : ''}" data-a="entry" data-g="${g.id}" ${ro}>${chosen ? `✓ ${esc(chosen)}` : 'Choose'}</button>`;
  } else if (parts.length) {
    controls = `<button class="expand${open ? ' open' : ''}" data-a="expand" data-g="${g.id}" data-open="${open ? 1 : 0}" aria-label="Show options">${open ? '▾' : '▸'}</button>`;
  } else {
    const r = getRec(app.state, app.ui.date, g.id);
    controls = valueControl(item, cfg, null, r?.value, item.status === 'logged', ro);
  }
  let partRows = '';
  if (parts.length && open && !isChoice) {
    partRows = `<div class="parts">${parts.map((p) => {
      const meta = partMeta(g, p.partId);
      const st = p.excused ? { text: 'Excused', cls: 'excused' } :
        p.logged ? (p.ev?.hasTarget ? statusLabel({ ...p.ev, status: 'logged', hasTarget: true }) : { text: 'Logged', cls: 'logged' }) : { text: p.cfg.optional ? 'Optional' : '', cls: 'pending' };
      const ts = p.cfg.kind === 'check' ? '' : targetShort(p.cfg, app.ui.date);
      return `<div class="part-row">
        <button class="g-main" data-a="entry" data-g="${g.id}" data-p="${p.partId}">
          <span class="g-text"><span class="g-name">${esc(meta.name)}</span>
          <span class="g-meta">${p.logged && p.cfg.kind !== 'check' ? esc(fmtValue(p.value, p.cfg, { unit: p.cfg.kind === 'duration' || !ts.startsWith('/') })) + ' ' : ''}${esc(ts)}${st.text ? ` <span class="chip ${st.cls}">${st.text}</span>` : ''}${p.record?.note ? ' <span class="noteflag">✎</span>' : ''}</span></span>
        </button>
        ${valueControl(item, p.cfg, p.partId, p.record?.value, p.logged, ro)}
      </div>`;
    }).join('')}
    ${ro || cfg.partMode === 'best' ? '' : `<div class="part-actions"><button class="link" data-a="fillAll" data-g="${g.id}">✓ Fill all parts</button></div>`}
    </div>`;
  }
  return `<div class="goal-row" style="--gc:${color}">
    <div class="row-top">
      <button class="g-main" data-a="${parts.length && !isChoice ? 'expand' : 'entry'}" data-g="${g.id}" data-open="${open ? 1 : 0}">
        ${g.icon ? `<span class="g-icon">${esc(g.icon)}</span>` : '<span class="g-icon"><span class="dot"></span></span>'}
        <span class="g-text"><span class="g-name">${esc(g.name)}${g.pinned ? ' <span class="pin">★</span>' : ''}</span>${rowMeta(item, cfg)}</span>
      </button>
      ${controls}
    </div>
    ${progressBar(item)}
    ${partRows}
  </div>`;
}

// Category groups start folded; tap a heading to open it (remembered).
// Pinned goals and the plain list (no categories) stay open.
function isCollapsed(gr) {
  if (gr.id === '_pinned' || gr.id === '_all') return !!app.state.collapsed[gr.id];
  return app.state.collapsed[gr.id] ?? true;
}

function groupCount(items) {
  const due = items.filter((i) => i.scored && i.status !== 'excused' && !(i.weeklyOptional && !i.met));
  if (!due.length) return `${items.length}`;
  return `${due.filter((i) => i.met).length} of ${due.length} done`;
}

function groupItems(items) {
  const { state } = app;
  const order = (a, b) => (a.goal.order ?? 0) - (b.goal.order ?? 0);
  items.sort(order);
  const pinned = items.filter((i) => i.goal.pinned);
  const rest = items.filter((i) => !i.goal.pinned);
  const groups = [];
  if (pinned.length) groups.push({ id: '_pinned', name: 'Pinned', items: pinned });
  if (state.settings.groupByCategory && state.categories.length) {
    const cats = sortedCats();
    for (const c of cats) {
      const its = rest.filter((i) => i.goal.categoryId === c.id);
      if (its.length) groups.push({ id: c.id, name: catLabel(c), items: its });
    }
    const unc = rest.filter((i) => !cats.some((c) => c.id === i.goal.categoryId));
    if (unc.length) groups.push({ id: '_unc', name: 'Uncategorized', items: unc });
  } else if (rest.length) groups.push({ id: '_all', name: pinned.length ? 'Everything else' : '', items: rest });
  return groups;
}

export function renderToday() {
  const { state, ui, today } = app;
  const date = ui.date;
  const ds = dayScore(state, date, today);
  const day = state.days[date] || {};
  const ro = date > today ? 'disabled' : '';

  let scoreMain, scoreSub;
  if (ds.skipped) { scoreMain = '—'; scoreSub = 'Day skipped'; }
  else if (ds.untracked) { scoreMain = '—'; scoreSub = 'Not tracked (nothing logged)'; }
  else if (ds.score == null) { scoreMain = '—'; scoreSub = ds.items.length ? 'No scored goals today' : 'Nothing scheduled today'; }
  else {
    scoreMain = `${ds.doneCount}<span class="of-target"> / ${ds.dueCount} done</span>`;
    const left = ds.dueCount - ds.doneCount;
    scoreSub = left === 0 ? '🎉 All done!' : `${left} to go`;
    if (ds.excusedCount) scoreSub += ` · ${ds.excusedCount} excused`;
  }

  const activeGoals = state.goals.filter((g) => g.state === 'active');
  if (!activeGoals.length) {
    return `${header(date)}
      <div class="empty-state">
        <div class="big-icon">◎</div>
        <h2>Build your own system</h2>
        <p>Create the goals you want to track. You decide how each is measured, when it applies and how much it matters.</p>
        <button class="btn primary" data-a="nav" data-href="#new">+ Create your first goal</button>
      </div>`;
  }

  const groups = groupItems([...ds.items]);
  const extraItems = ds.all.filter((i) => !i.scheduled && i.goal.state === 'active' && (i.active || i.status === 'logged'));

  return `${header(date)}
    <button class="score-card" data-a="breakdown" ${ds.score == null ? 'disabled' : ''}>
      ${scoreRing(ds.score)}
      <div class="score-text"><div class="score-big">${scoreMain}</div><div class="score-sub">${esc(scoreSub)}</div>
      ${ds.score != null ? '<div class="score-hint">Tap for breakdown</div>' : ''}</div>
    </button>
    ${ds.skipped ? `<div class="notice">This day is skipped and left out of your averages. <button class="link" data-a="skipDay" ${ro}>Undo</button></div>` : ''}
    ${groups.map((gr) => `
      <section class="group">
        ${gr.name ? `<button class="group-head${isCollapsed(gr) ? '' : ' open'}" data-a="collapse" data-id="${gr.id}" data-closed="${isCollapsed(gr) ? 1 : 0}" aria-expanded="${!isCollapsed(gr)}">
          <span>${isCollapsed(gr) ? '▸' : '▾'} ${gr.id === '_pinned' || gr.id === '_unc' || gr.id === '_all' ? esc(gr.name) : gr.name}</span>
          <span class="group-count">${groupCount(gr.items)}</span></button>` : ''}
        ${isCollapsed(gr) ? '' : gr.items.map((i) => goalRow(i, ro)).join('')}
      </section>`).join('')}
    ${!ds.items.length ? '<p class="muted center">No goals are scheduled for this day.</p>' : ''}
    ${extraItems.length ? `<details class="group extra"${ds.extra.length ? ' open' : ''}>
      <summary>Not scheduled or done for the week <span class="muted">${extraItems.length}</span></summary>
      <p class="muted small">Anything you log here is kept as extra and doesn't change the day score.</p>
      ${extraItems.map((i) => goalRow(i, ro)).join('')}
    </details>` : ''}
    <details class="group daynote"${day.note ? ' open' : ''}>
      <summary>Note for the day${day.note ? ' ✎' : ''}</summary>
      <textarea data-input="dayNote" rows="3" placeholder="Anything that explains this day (optional)" ${ro}>${esc(day.note || '')}</textarea>
    </details>
    <div class="day-actions">
      ${!ds.skipped && date <= today ? `<button class="link" data-a="skipDay">Skip this day</button>` : ''}
    </div>`;
}

function header(date) {
  return `<div class="dayhead">
    <button class="nav-btn" data-a="dayPrev" aria-label="Previous day">‹</button>
    <label class="daytitle"><span>${esc(dayTitle(date))}</span>
      <input type="date" data-change="pickDate" value="${date}" max="${app.today}" aria-label="Pick a date"></label>
    <button class="nav-btn" data-a="dayNext" aria-label="Next day" ${date >= app.today ? 'disabled' : ''}>›</button>
  </div>`;
}

// ---------- entry sheet ----------

function openEntry(goalId, partId) {
  const { state, ui } = app;
  const goal = state.goals.find((g) => g.id === goalId);
  const date = ui.date;
  const v = versionFor(goal, date);
  if (!partId && (v.parts || []).length) return v.partMode === 'best' ? openChoiceSheet(goal, date) : openParentSheet(goal, date);
  const cfg = cfgFor(goal, partId, date);
  if (!cfg) return;
  const r = getRec(state, date, goalId, partId) || {};
  const title = partId ? `${goal.name} · ${partMeta(goal, partId).name}` : goal.name;
  const excused = r.status === 'excused';
  const step = stepFor(goal, partId);
  const fill = fillValue(cfg, date);
  let input;
  if (cfg.kind === 'check') {
    input = `<div class="seg big">
      <button type="button" class="${r.value ? 'on' : ''}" data-a="entrySetCheck" data-v="1">Done</button>
      <button type="button" class="${r.value ? '' : 'on'}" data-a="entrySetCheck" data-v="0">Not done</button></div>
      <input type="hidden" id="entry-check" value="${r.value ? '1' : ''}">`;
  } else if (cfg.kind === 'duration') {
    const val = r.value == null ? '' : Number(r.value);
    const h = val === '' ? '' : Math.floor(Math.abs(val) / 60);
    const m = val === '' ? '' : Math.round(Math.abs(val) % 60);
    input = `<div class="dur-input">
      <input id="entry-h" type="number" inputmode="numeric" min="0" placeholder="0" value="${h}" autofocus><span>h</span>
      <input id="entry-m" type="number" inputmode="numeric" min="0" max="59" placeholder="0" value="${m}"><span>m</span></div>
      <div class="chips">
        ${[-step, step, step * 2, 60].filter((x, i, a) => a.indexOf(x) === i).map((n) => `<button type="button" class="chip-btn" data-a="entryAdd" data-n="${n}">${n > 0 ? '+' : '−'}${fmtValue(Math.abs(n), cfg)}</button>`).join('')}
        ${fill != null ? `<button type="button" class="chip-btn accent" data-a="entryFill">Target: ${esc(fmtValue(fill, cfg))}</button>` : ''}
      </div>`;
  } else {
    input = `<div class="num-input">
      <input id="entry-v" type="text" inputmode="decimal" placeholder="0" value="${r.value ?? ''}" autofocus>
      <span>${esc(cfg.unit || '')}</span></div>
      <div class="chips">
        ${[-step, step, step * 5, step * 10].map((n) => `<button type="button" class="chip-btn" data-a="entryAdd" data-n="${n}">${n > 0 ? '+' : '−'}${fmtNum(Math.abs(n), cfg.precision)}</button>`).join('')}
        ${fill != null ? `<button type="button" class="chip-btn accent" data-a="entryFill">Target: ${esc(fmtValue(fill, cfg))}</button>` : ''}
      </div>`;
  }
  openSheet(`
    <div class="sheet-head"><h2>${esc(goal.icon || '')} ${esc(title)}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted">${esc(fmtDate(date))} · target: ${esc(targetText(cfg, date))}</p>
    <form data-submit="entrySave" data-g="${goalId}" data-p="${partId || ''}">
      ${excused ? '<div class="notice">Marked excused — it won\'t count for or against this day.</div>' : ''}
      ${input}
      <div id="entry-preview" class="preview"></div>
      <label class="field"><span>Note (optional)</span>
        <textarea id="entry-note" rows="2" placeholder="What happened?">${esc(r.note || '')}</textarea></label>
      <button class="btn primary block" type="submit">Save</button>
      <div class="row-btns">
        <button type="button" class="btn" data-a="entryExcuse">${excused ? 'Un-excuse' : 'Excuse'}</button>
        <button type="button" class="btn danger-text" data-a="entryClear">Clear</button>
      </div>
    </form>`);
  updatePreview();
}

// Either/or: pick which option you did (and how much, for numbers/time).
function openChoiceSheet(goal, date) {
  const v = versionFor(goal, date);
  const item = dayScore(app.state, date, app.today).all.find((i) => i.goal.id === goal.id);
  const goalRec = getRec(app.state, date, goal.id) || {};
  const excused = goalRec.status === 'excused';
  const chosen = item?.chosen || (v.parts || []).find((pc) => getRec(app.state, date, goal.id, pc.partId)?.value != null)?.partId || null;
  const options = (v.parts || []).map((pc) => {
    const r = getRec(app.state, date, goal.id, pc.partId) || {};
    const fill = fillValue(pc, date);
    const val = r.value != null && r.value !== true ? Number(r.value) : (fill != null && fill !== true ? fill : '');
    const tags = [pc.kind === 'check' ? 'done / not done' : `target ${targetText(pc, date)}`];
    let amount = '';
    if (pc.kind === 'duration') {
      amount = `<div class="choice-amount"><span class="muted small">How long?</span>
        <input type="number" inputmode="numeric" min="0" name="h-${pc.partId}" value="${val === '' ? '' : Math.floor(val / 60)}" placeholder="0" aria-label="hours"><span>h</span>
        <input type="number" inputmode="numeric" min="0" max="59" name="m-${pc.partId}" value="${val === '' ? '' : Math.round(val % 60)}" placeholder="0" aria-label="minutes"><span>m</span>
        <span class="muted small">target ${esc(targetText(pc, date))}</span></div>`;
    } else if (pc.kind === 'number') {
      amount = `<div class="choice-amount"><span class="muted small">How much?</span>
        <input type="text" inputmode="decimal" name="n-${pc.partId}" value="${val}" placeholder="0" aria-label="amount"><span>${esc(pc.unit || '')}</span>
        <span class="muted small">target ${esc(targetText(pc, date))}</span></div>`;
    }
    return `<label class="choice-card">
      <input type="radio" name="opt" value="${pc.partId}" ${chosen === pc.partId ? 'checked' : ''}>
      <span class="choice-body"><span class="choice-name">${esc(partMeta(goal, pc.partId).name)}</span>
        <span class="muted small">${tags.join(' · ')}</span></span>
      ${amount}
    </label>`;
  }).join('');
  openSheet(`
    <div class="sheet-head"><h2>${esc(goal.icon || '')} ${esc(goal.name)}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted">${esc(fmtDate(date))} · which one did you do?</p>
    <form data-submit="choiceSave" data-g="${goal.id}">
      ${excused ? '<div class="notice">Excused for this day — it won\'t count for or against it.</div>' : ''}
      <div class="choices">${options}</div>
      <label class="field"><span>Note (optional)</span>
        <textarea id="entry-note" rows="2" placeholder="What happened?">${esc(goalRec.note || '')}</textarea></label>
      <button class="btn primary block" type="submit">Save</button>
      <div class="row-btns">
        <button type="button" class="btn" data-a="choiceExcuse" data-g="${goal.id}">${excused ? 'Un-excuse' : 'Excuse'}</button>
        <button type="button" class="btn danger-text" data-a="choiceClear" data-g="${goal.id}">Clear</button>
      </div>
    </form>`);
}

function openParentSheet(goal, date) {
  const r = getRec(app.state, date, goal.id) || {};
  const excused = r.status === 'excused';
  openSheet(`
    <div class="sheet-head"><h2>${esc(goal.icon || '')} ${esc(goal.name)}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted">${esc(fmtDate(date))} · log each part from the list.</p>
    <form data-submit="entrySave" data-g="${goal.id}" data-p="">
      ${excused ? '<div class="notice">The whole goal is excused for this day.</div>' : ''}
      <label class="field"><span>Note (optional)</span>
        <textarea id="entry-note" rows="2" placeholder="What happened?">${esc(r.note || '')}</textarea></label>
      <button class="btn primary block" type="submit">Save note</button>
      <div class="row-btns">
        <button type="button" class="btn" data-a="fillAll" data-g="${goal.id}">✓ Fill all parts</button>
        <button type="button" class="btn" data-a="entryExcuse">${excused ? 'Un-excuse' : 'Excuse whole goal'}</button>
      </div>
    </form>`);
}

function readEntry(form) {
  const goal = app.state.goals.find((g) => g.id === form.dataset.g);
  const partId = form.dataset.p || null;
  const cfg = cfgFor(goal, partId, app.ui.date);
  const hasParts = !partId && (versionFor(goal, app.ui.date).parts || []).length;
  let value = null, valid = true;
  if (hasParts) value = undefined;
  else if (cfg.kind === 'check') value = form.querySelector('#entry-check').value === '1' ? true : null;
  else if (cfg.kind === 'duration') {
    const h = form.querySelector('#entry-h').value, m = form.querySelector('#entry-m').value;
    value = h === '' && m === '' ? null : (Number(h) || 0) * 60 + (Number(m) || 0);
  } else {
    const raw = form.querySelector('#entry-v').value.trim().replace(',', '.');
    if (raw === '') value = null;
    else if (Number.isNaN(Number(raw))) valid = false;
    else value = Number(raw);
    if (valid && value != null && value < 0 && !cfg.allowNegative) valid = false;
  }
  return { goal, partId, cfg, value, valid, note: form.querySelector('#entry-note').value };
}

function updatePreview() {
  const form = document.querySelector('form[data-submit="entrySave"]');
  const out = document.getElementById('entry-preview');
  if (!form || !out) return;
  const e = readEntry(form);
  if (e.value === undefined || e.cfg.kind === 'check') { out.innerHTML = ''; return; }
  if (!e.valid) { out.innerHTML = '<span class="err">Enter a number' + (e.cfg.allowNegative ? '' : ' (0 or more)') + '</span>'; return; }
  if (e.value == null) { out.innerHTML = ''; return; }
  const ev = evaluate(e.cfg, e.value, app.ui.date);
  if (!ev.hasTarget) { out.innerHTML = ''; return; }
  const st = statusLabel({ ...ev, status: 'logged', hasTarget: true });
  const prog = e.cfg.target?.type === 'atLeast' && ev.progress != null ? `${pct(ev.progress)} of target · ` : '';
  out.innerHTML = `${prog}earns ${pct(ev.credit)} <span class="chip ${st.cls}">${st.text}</span>`;
}

function setCheckButtons(v) {
  const hidden = document.getElementById('entry-check');
  if (!hidden) return;
  hidden.value = v ? '1' : '';
  document.querySelectorAll('[data-a="entrySetCheck"]').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === !!v));
}

export const todayActions = {
  dayPrev() { app.ui.date = addDays(app.ui.date, -1); app.render(); },
  dayNext() { if (app.ui.date < app.today) { app.ui.date = addDays(app.ui.date, 1); app.render(); } },
  expand(el) { app.ui.expanded[el.dataset.g] = el.dataset.open !== '1'; app.render(); },
  collapse(el) { app.state.collapsed[el.dataset.id] = el.dataset.closed !== '1'; app.commit(); },
  toggle(el) {
    const { state, ui } = app;
    const r = getRec(state, ui.date, el.dataset.g, el.dataset.p);
    setRec(state, ui.date, el.dataset.g, el.dataset.p, { value: r?.value ? null : true, status: 'logged' });
    app.commit();
  },
  step(el) {
    const { state, ui } = app;
    const goal = state.goals.find((g) => g.id === el.dataset.g);
    const cfg = cfgFor(goal, el.dataset.p, ui.date);
    const r = getRec(state, ui.date, goal.id, el.dataset.p);
    const cur = r?.status === 'logged' && r.value != null ? Number(r.value) : 0;
    let next = cur + Number(el.dataset.d) * stepFor(goal, el.dataset.p);
    if (next < 0 && !cfg.allowNegative) next = 0;
    next = Number(next.toFixed(6));
    setRec(state, ui.date, goal.id, el.dataset.p, { value: next, status: 'logged' });
    app.commit();
  },
  fill(el) {
    const { state, ui } = app;
    const goal = state.goals.find((g) => g.id === el.dataset.g);
    const cfg = cfgFor(goal, el.dataset.p, ui.date);
    const v = fillValue(cfg, ui.date);
    if (v == null) return;
    setRec(state, ui.date, goal.id, el.dataset.p, { value: v, status: 'logged' });
    app.commit();
  },
  fillAll(el) {
    const { state, ui } = app;
    const goal = state.goals.find((g) => g.id === el.dataset.g);
    const v = versionFor(goal, ui.date);
    for (const pc of v.parts || []) {
      const r = getRec(state, ui.date, goal.id, pc.partId);
      if (r?.status === 'excused' || (r?.value != null && r.value !== '')) continue;
      const fv = fillValue(pc, ui.date);
      if (fv != null) setRec(state, ui.date, goal.id, pc.partId, { value: fv, status: 'logged' });
    }
    app.ui.expanded[goal.id] = true;
    closeSheet();
    app.commit();
  },
  entry(el) { if (app.ui.date <= app.today) openEntry(el.dataset.g, el.dataset.p); },
  choiceExcuse(el) {
    const { state, ui } = app;
    const r = getRec(state, ui.date, el.dataset.g);
    const note = document.getElementById('entry-note')?.value ?? r?.note ?? '';
    if (r?.status === 'excused') setRec(state, ui.date, el.dataset.g, null, { status: 'logged', note });
    else setRec(state, ui.date, el.dataset.g, null, { status: 'excused', value: null, note });
    closeSheet();
    app.commit();
  },
  choiceClear(el) {
    const { state, ui } = app;
    const goal = state.goals.find((g) => g.id === el.dataset.g);
    for (const pc of versionFor(goal, ui.date).parts || []) setRec(state, ui.date, goal.id, pc.partId, { status: 'logged', value: null });
    setRec(state, ui.date, goal.id, null, { status: 'logged', value: null, note: '' });
    closeSheet();
    app.commit();
  },
  entrySetCheck(el) { setCheckButtons(el.dataset.v === '1'); },
  entryAdd(el) {
    const n = Number(el.dataset.n);
    const h = document.getElementById('entry-h');
    if (h) {
      const m = document.getElementById('entry-m');
      let tot = (Number(h.value) || 0) * 60 + (Number(m.value) || 0) + n;
      if (tot < 0) tot = 0;
      h.value = Math.floor(tot / 60); m.value = Math.round(tot % 60);
    } else {
      const i = document.getElementById('entry-v');
      let v = (Number(i.value.replace(',', '.')) || 0) + n;
      i.value = Number(v.toFixed(6));
    }
    updatePreview();
  },
  entryFill() {
    const form = document.querySelector('form[data-submit="entrySave"]');
    const { cfg } = readEntry(form);
    const v = fillValue(cfg, app.ui.date);
    const h = document.getElementById('entry-h');
    if (h) { h.value = Math.floor(v / 60); document.getElementById('entry-m').value = Math.round(v % 60); }
    else document.getElementById('entry-v').value = v;
    updatePreview();
  },
  entryExcuse() {
    const form = document.querySelector('form[data-submit="entrySave"]');
    const { goal, partId, note } = readEntry(form);
    const r = getRec(app.state, app.ui.date, goal.id, partId);
    if (r?.status === 'excused') setRec(app.state, app.ui.date, goal.id, partId, { status: 'logged', note });
    else setRec(app.state, app.ui.date, goal.id, partId, { status: 'excused', value: null, note });
    closeSheet();
    app.commit();
  },
  entryClear() {
    const form = document.querySelector('form[data-submit="entrySave"]');
    const { goal, partId } = readEntry(form);
    setRec(app.state, app.ui.date, goal.id, partId, { status: 'logged', value: null, note: '' });
    closeSheet();
    app.commit();
  },
  skipDay() {
    const d = (app.state.days[app.ui.date] ||= {});
    d.skipped = !d.skipped;
    if (!d.skipped && !d.note) delete app.state.days[app.ui.date];
    app.commit();
    if (d.skipped) toast('Day skipped — it won\'t count in averages.');
  },
  breakdown() {
    const ds = dayScore(app.state, app.ui.date, app.today);
    if (ds.score == null) return;
    const name = (i) => `${esc(i.goal.icon || '')} ${esc(i.goal.name)}${i.chosen ? ` <span class="muted small">· ${esc(partMeta(i.goal, i.chosen).name)}</span>` : ''}`;
    const done = ds.breakdown.filter((b) => b.done).map((b) => b.item);
    const notDone = ds.breakdown.filter((b) => !b.done).map((b) => b.item);
    openSheet(`
      <div class="sheet-head"><h2>${ds.doneCount} of ${ds.dueCount} done · ${esc(dayTitle(app.ui.date))}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
      ${done.length ? `<h3 class="sub-h">✓ Done</h3><ul class="check-list">${done.map((i) => `<li class="done">${name(i)}</li>`).join('')}</ul>` : ''}
      ${notDone.length ? `<h3 class="sub-h">Not done${app.ui.date === app.today ? ' yet' : ''}</h3><ul class="check-list">${notDone.map((i) => `<li>${name(i)}${i.status === 'logged' && i.credit != null ? ` <span class="muted small">(${pct(Math.min(1, i.credit))} of the way)</span>` : ''}</li>`).join('')}</ul>` : ''}
      ${ds.excusedCount ? `<p class="muted small">${ds.excusedCount} excused — left out of this day.</p>` : ''}
      ${ds.extra.length ? `<p class="muted small">Also logged (not due today): ${ds.extra.map((i) => esc(i.goal.name)).join(', ')}</p>` : ''}`);
  },
};

export const todayChange = {
  pickDate(el) {
    if (!el.value) return;
    app.ui.date = el.value > app.today ? app.today : el.value;
    app.render();
  },
};

let noteTimer;
export const todayInput = {
  dayNote(el) {
    const date = app.ui.date;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const d = (app.state.days[date] ||= {});
      d.note = el.value;
      if (!d.note && !d.skipped) delete app.state.days[date];
      app.save();
    }, 400);
  },
  entryLive() { updatePreview(); },
};

export const todaySubmit = {
  choiceSave(form) {
    const { state, ui } = app;
    const goal = state.goals.find((g) => g.id === form.dataset.g);
    const v = versionFor(goal, ui.date);
    const pick = form.querySelector('input[name="opt"]:checked')?.value || null;
    let value = null;
    if (pick) {
      const pc = v.parts.find((x) => x.partId === pick);
      if (pc.kind === 'check') value = true;
      else if (pc.kind === 'duration') {
        const h = form.querySelector(`[name="h-${pick}"]`).value, m = form.querySelector(`[name="m-${pick}"]`).value;
        value = h === '' && m === '' ? null : (Number(h) || 0) * 60 + (Number(m) || 0);
      } else {
        const raw = form.querySelector(`[name="n-${pick}"]`).value.trim().replace(',', '.');
        value = raw === '' ? null : Number(raw);
        if (Number.isNaN(value) || (value < 0 && !pc.allowNegative)) { toast('Enter a number for how much you did'); return; }
      }
      if (value == null) { toast('Enter how much you did'); return; }
    }
    // One choice per day: the picked option gets the value, the others are cleared.
    for (const pc of v.parts) {
      setRec(state, ui.date, goal.id, pc.partId, { status: 'logged', value: pc.partId === pick ? value : null });
    }
    const goalRec = getRec(state, ui.date, goal.id);
    setRec(state, ui.date, goal.id, null, { note: form.querySelector('#entry-note').value, status: goalRec?.status === 'excused' && !pick ? 'excused' : 'logged' });
    closeSheet();
    app.commit();
  },
  entrySave(form) {
    const e = readEntry(form);
    if (!e.valid) { updatePreview(); return; }
    const patch = { note: e.note };
    if (e.value !== undefined) { patch.value = e.value; patch.status = 'logged'; }
    setRec(app.state, app.ui.date, e.goal.id, e.partId, patch);
    closeSheet();
    app.commit();
  },
};

