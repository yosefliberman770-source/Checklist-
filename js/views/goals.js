// Goal list, categories, and a goal's own page (stats, history, lifecycle).

import { app, openSheet, closeSheet, toast, go, goalColor } from '../ctx.js';
import { inPause, periodStats, consistencyRanking, goalDay, partsShareUnit, effectiveTarget } from '../engine.js';
import { describe, fmtValue, pct, targetText, weightLabel, scheduleText, statusLabel } from '../format.js';
import { esc, uid, addDays, fmtDate, dateRange } from '../util.js';
import { countRecords, deleteGoalForever } from '../store.js';
import { valueBars } from '../charts.js';
import { periodChips, periodRange } from './stats.js';

export function goalBadges(g) {
  const t = app.today;
  const b = [];
  if (g.state === 'archived') b.push(['Archived', 'muted']);
  else if (g.state === 'trash') b.push(['In trash', 'missed']);
  else if (g.start && g.start > t) b.push([`Starts ${fmtDate(g.start, { weekday: false })}`, 'pending']);
  else if (g.end && g.end < t) b.push(['Ended', 'muted']);
  else if (inPause(g, t)) b.push(['Paused', 'partial']);
  const v = g.versions[g.versions.length - 1];
  if (!v.scored) b.push(['Not in score', 'muted']);
  return b.map(([t2, c]) => `<span class="chip ${c}">${esc(t2)}</span>`).join(' ');
}

function cfgWithNames(g, v) {
  return { ...v, parts: (v.parts || []).map((p) => ({ ...p, name: (g.parts || []).find((x) => x.id === p.partId)?.name || '' })) };
}

function goalListRow(g, list, idx) {
  const v = g.versions[g.versions.length - 1];
  const movable = g.state === 'active';
  return `<div class="list-row" style="--gc:${goalColor(g, app.state.goals.indexOf(g))}">
    <button class="g-main" data-a="nav" data-href="#goal/${g.id}">
      ${g.icon ? `<span class="g-icon">${esc(g.icon)}</span>` : '<span class="g-icon"><span class="dot"></span></span>'}
      <span class="g-text"><span class="g-name">${esc(g.name)}${g.pinned ? ' <span class="pin">★</span>' : ''} ${goalBadges(g)}</span>
      <span class="g-meta">${esc(describe(cfgWithNames(g, v)))}</span></span>
    </button>
    ${movable ? `<div class="move">
      <button class="icon-btn" data-a="goalMove" data-g="${g.id}" data-d="-1" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
      <button class="icon-btn" data-a="goalMove" data-g="${g.id}" data-d="1" aria-label="Move down" ${idx === list.length - 1 ? 'disabled' : ''}>↓</button>
    </div>` : ''}
  </div>`;
}

function groupsOf(goals) {
  const cats = [...app.state.categories].sort((a, b) => a.order - b.order);
  const sorted = [...goals].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups = cats.map((c) => ({ id: c.id, name: c.name, goals: sorted.filter((g) => g.categoryId === c.id) }));
  groups.push({ id: '', name: cats.length ? 'Uncategorized' : '', goals: sorted.filter((g) => !cats.some((c) => c.id === g.categoryId)) });
  return groups.filter((g) => g.goals.length);
}

export function renderGoals() {
  const { state } = app;
  const active = state.goals.filter((g) => g.state === 'active');
  const archived = state.goals.filter((g) => g.state === 'archived');
  const trash = state.goals.filter((g) => g.state === 'trash');
  return `<div class="topbar"><h1>Goals</h1><button class="btn primary small" data-a="nav" data-href="#new">+ New</button></div>
    ${!active.length ? `<div class="empty-state"><p>No active goals yet. Your goals, your rules — create the first one.</p>
      <button class="btn primary" data-a="nav" data-href="#new">+ Create a goal</button></div>` : ''}
    ${groupsOf(active).map((gr) => `<section class="group">
      ${gr.name ? `<h3 class="group-title">${esc(gr.name)}</h3>` : ''}
      ${gr.goals.map((g, i) => goalListRow(g, gr.goals, i)).join('')}
    </section>`).join('')}
    <div class="center"><button class="btn" data-a="categories">Manage categories</button></div>
    ${archived.length ? `<details class="group"><summary>Archived <span class="muted">${archived.length}</span></summary>
      <p class="muted small">No longer tracked. All their history is kept and still shows in your past scores.</p>
      ${archived.map((g, i) => goalListRow(g, archived, i)).join('')}</details>` : ''}
    ${trash.length ? `<details class="group"><summary>Trash <span class="muted">${trash.length}</span></summary>
      <p class="muted small">Deleted for good 30 days after being moved here. While here they don't count anywhere.</p>
      ${trash.map((g, i) => goalListRow(g, trash, i)).join('')}</details>` : ''}`;
}

function categoriesSheet() {
  const cats = [...app.state.categories].sort((a, b) => a.order - b.order);
  openSheet(`
    <div class="sheet-head"><h2>Categories</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted small">Categories only organize your goals. They never change scores.</p>
    ${cats.map((c, i) => `<div class="cat-row">
      <input type="text" value="${esc(c.name)}" data-change="catRename" data-id="${c.id}" aria-label="Category name">
      <button class="icon-btn" data-a="catMove" data-id="${c.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button class="icon-btn" data-a="catMove" data-id="${c.id}" data-d="1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button class="icon-btn danger-text" data-a="catDelete" data-id="${c.id}" aria-label="Delete">✕</button>
    </div>`).join('') || '<p class="muted">No categories yet.</p>'}
    <form data-submit="catAdd" class="inline">
      <input type="text" name="name" placeholder="New category" required>
      <button class="btn small primary" type="submit">Add</button>
    </form>`);
}

// ---------- goal detail ----------

function diffText(goal, a, b) {
  const out = [];
  const na = cfgWithNames(goal, a), nb = cfgWithNames(goal, b);
  if (a.kind !== b.kind) out.push('measurement changed');
  if ((a.unit || '') !== (b.unit || '')) out.push(`unit ${a.unit || '—'} → ${b.unit || '—'}`);
  if (!(a.parts || []).length && !(b.parts || []).length && JSON.stringify(a.target) !== JSON.stringify(b.target)) {
    out.push(`target ${targetText(a)} → ${targetText(b)}`);
  }
  if (JSON.stringify(a.dayTargets || {}) !== JSON.stringify(b.dayTargets || {})) out.push('day-specific targets changed');
  if (Number(a.weight) !== Number(b.weight)) out.push(`importance ${weightLabel(a.weight)} → ${weightLabel(b.weight)}`);
  if (JSON.stringify(a.schedule) !== JSON.stringify(b.schedule)) out.push(`days: ${scheduleText(a.schedule)} → ${scheduleText(b.schedule)}`);
  if (a.credit !== b.credit) out.push(b.credit === 'all' ? 'now all or nothing' : 'now partial credit');
  if (Number(a.cap || 1) !== Number(b.cap || 1)) out.push(`extra credit ${Math.round((a.cap || 1) * 100)}% → ${Math.round((b.cap || 1) * 100)}%`);
  if (!!a.scored !== !!b.scored) out.push(b.scored ? 'now counts toward score' : 'no longer counts toward score');
  if (JSON.stringify(a.parts || []) !== JSON.stringify(b.parts || [])) {
    const an = (na.parts || []).map((p) => p.name).join(', ') || 'none', bn = (nb.parts || []).map((p) => p.name).join(', ') || 'none';
    if (an !== bn) out.push(`parts: ${an} → ${bn}`);
    else {
      const det = [];
      (nb.parts || []).forEach((p) => {
        const o = (na.parts || []).find((x) => x.partId === p.partId);
        if (!o) return;
        if (JSON.stringify(o.target) !== JSON.stringify(p.target) || o.kind !== p.kind || o.unit !== p.unit) det.push(`${p.name} ${targetText(o)} → ${targetText(p)}`);
        if (o.optional !== p.optional) det.push(`${p.name} ${p.optional ? 'now optional' : 'no longer optional'}`);
        if (o.credit !== p.credit) det.push(`${p.name} ${p.credit === 'all' ? 'now all or nothing' : 'now partial credit'}`);
        if (Number(o.weight) !== Number(p.weight)) det.push(`${p.name} importance ${weightLabel(o.weight)} → ${weightLabel(p.weight)}`);
      });
      out.push(det.length ? det.join(' · ') : 'part settings changed');
    }
  }
  if ((a.partWeighting || 'target') !== (b.partWeighting || 'target')) out.push(b.partWeighting === 'equal' ? 'parts weighted by your importance' : 'parts weighted by target size');
  if ((a.partMode || 'each') !== (b.partMode || 'each')) out.push(b.partMode === 'total' ? 'only the total counts' : 'each part counts');
  return out.length ? out.join(' · ') : 'settings changed';
}

function occurrenceStrip(items) {
  return `<div class="strip">${items.map((i) => {
    let cls = 'off', title = `${fmtDate(i.date)}: not scheduled`;
    if (i.scheduled || i.status === 'logged') {
      const st = i.scheduled ? statusLabel(i) : { text: 'Extra', cls: 'extra' };
      cls = i.status === 'excused' ? 'excused' : i.status === 'missed' ? 'missed' : i.status === 'pending' ? 'pending'
        : !i.scheduled ? 'extra' : i.met ? 'met' : (i.credit || 0) > 0 ? 'partial' : 'missed';
      title = `${fmtDate(i.date)}: ${st.text || 'pending'}`;
    }
    return `<span class="sq ${cls}" title="${esc(title)}" data-a="nav" data-href="#today/${i.date}"></span>`;
  }).join('')}</div>
  <div class="legend"><span class="sq met"></span>Met <span class="sq partial"></span>Partial <span class="sq missed"></span>Missed <span class="sq excused"></span>Excused <span class="sq off"></span>Not scheduled</div>`;
}

export function renderGoalDetail() {
  const { state } = app;
  const goal = state.goals.find((g) => g.id === app.ui.param);
  if (!goal) return `<div class="topbar"><button class="link" data-a="nav" data-href="#goals">‹ Goals</button></div><p class="muted center">This goal no longer exists.</p>`;
  const v = goal.versions[goal.versions.length - 1];
  const range = periodRange(app.ui.period);
  const ps = periodStats(state, range.from, range.to, app.today);
  const gs = ps.goals.find((x) => x.goal.id === goal.id);
  const cons = consistencyRanking(ps);
  const rankIdx = cons.rows.filter((r) => r.enough).findIndex((r) => r.goal.id === goal.id);
  const rankCount = cons.rows.filter((r) => r.enough).length;
  const dates = range.to >= range.from ? dateRange(range.from, ps.end < range.from ? range.from : ps.end) : [];
  const items = dates.map((d) => goalDay(goal, d, state.records, app.today));
  const cat = state.categories.find((c) => c.id === goal.categoryId);
  const isTrash = goal.state === 'trash';
  const ongoingPause = (goal.pauses || []).find((p) => !p.end || p.end >= app.today);

  // values chart
  let chart = '';
  const hasParts = (v.parts || []).length > 0;
  const measure = hasParts ? (partsShareUnit(v.parts) ? v.parts[0] : null) : v.kind !== 'check' ? v : null;
  if (measure && items.length) {
    const fmt = (x) => fmtValue(Math.round(x * 100) / 100, measure);
    const days = items.map((i) => {
      const vv = i.version;
      let target = null;
      if (i.scheduled) {
        if (vv.parts?.length) target = i.totalTarget ? { lo: i.totalTarget, hi: i.totalTarget } : null;
        else {
          const t = effectiveTarget(vv, i.date);
          if (t.type === 'atLeast' || t.type === 'atMost') target = { lo: t.value, hi: t.value };
          if (t.type === 'exact') target = { lo: t.value, hi: t.value };
          if (t.type === 'range') target = { lo: t.low, hi: t.high };
        }
      }
      const stacks = vv.parts?.length
        ? i.parts.map((p, k) => ({ v: p.logged ? Number(p.value) : 0, color: ['#2a78d6', '#e0763a', '#2f9e7a', '#c2489b', '#8a6bd1', '#c79a1e'][k % 6], label: goal.parts.find((x) => x.id === p.partId)?.name }))
        : [{ v: i.status === 'logged' ? Number(i.value) : 0, color: goalColor(goal, state.goals.indexOf(goal)) }];
      return { x: i.date, stacks, target };
    });
    chart = `<section class="card"><h3>What you logged</h3>${valueBars({ days, fmt })}
      ${hasParts ? `<div class="legend">${v.parts.map((p, k) => `<span class="sw" style="background:${['#2a78d6', '#e0763a', '#2f9e7a', '#c2489b', '#8a6bd1', '#c79a1e'][k % 6]}"></span>${esc(goal.parts.find((x) => x.id === p.partId)?.name || '')}`).join(' ')}</div>` : ''}
      <p class="muted small">Line or band = the target that applied that day.</p></section>`;
  }

  // part table
  let partTable = '';
  if (hasParts) {
    const rows = v.parts.map((pc) => {
      let sched = 0, met = 0, tot = 0, n = 0;
      for (const i of items) {
        const p = i.parts?.find((x) => x.partId === pc.partId);
        if (!p) continue;
        if (p.logged) { tot += Number(p.value) || 0; n++; }
        if (i.scheduled && i.status !== 'unscheduled' && i.status !== 'pending' && p.counted && !p.excused) { sched++; if (p.logged && p.ev?.met) met++; }
      }
      return `<tr><td>${esc(goal.parts.find((x) => x.id === pc.partId)?.name || '')}</td>
        <td class="num">${pc.kind === 'check' ? n : esc(fmtValue(tot, pc))}</td>
        <td class="num">${pc.kind === 'check' ? '—' : n ? esc(fmtValue(tot / n, pc)) : '—'}</td>
        <td class="num">${sched ? pct(met / sched) : '—'}</td></tr>`;
    }).join('');
    partTable = `<section class="card"><h3>Parts</h3><table class="tbl"><thead><tr><th>Part</th><th class="num">Total</th><th class="num">Avg / day</th><th class="num">Met</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }

  const notes = Object.entries(state.records)
    .filter(([k, r]) => k.split('|')[1] === goal.id && r.note && k.slice(0, 10) >= range.from && k.slice(0, 10) <= range.to)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30);

  const versions = goal.versions.map((ver, i) => ({ ver, prev: goal.versions[i - 1] })).reverse();

  return `<div class="topbar"><button class="link" data-a="nav" data-href="#goals">‹ Goals</button>
      <h1 class="ellipsis">${esc(goal.icon || '')} ${esc(goal.name)}</h1>
      ${isTrash ? '<span></span>' : `<button class="btn small" data-a="nav" data-href="#edit/${goal.id}">Edit</button>`}</div>
    <section class="card summary-box" style="--gc:${goalColor(goal, state.goals.indexOf(goal))}">
      <div class="summary-sentence">${esc(describe(cfgWithNames(goal, v)))}</div>
      <div class="muted small">${cat ? esc(cat.name) + ' · ' : ''}since ${fmtDate(goal.start, { year: true })}${goal.end ? ` · until ${fmtDate(goal.end, { year: true })}` : ''} ${goalBadges(goal)}</div>
      ${goal.description ? `<p class="small">${esc(goal.description)}</p>` : ''}
    </section>
    <div class="row-btns wrap">
      ${goal.state === 'active' ? (ongoingPause ? '<button class="btn small" data-a="goalResume">Resume</button>' : '<button class="btn small" data-a="goalPause">Pause</button>') : ''}
      ${goal.state === 'active' ? '<button class="btn small" data-a="goalArchive">Archive</button>' : ''}
      ${goal.state === 'archived' ? '<button class="btn small" data-a="goalRestore">Restore</button>' : ''}
      ${goal.state !== 'trash' ? '<button class="btn small danger-text" data-a="goalTrash">Delete…</button>' : ''}
      ${isTrash ? '<button class="btn small" data-a="goalUntrash">Restore from trash</button><button class="btn small danger" data-a="goalPurge">Delete forever</button>' : ''}
    </div>
    ${periodChips()}
    <div class="tiles">
      <div class="tile"><div class="tile-num">${gs?.completion != null ? pct(gs.completion) : '—'}</div><div class="tile-label">Met (${gs ? `${gs.met} of ${gs.scheduled}` : '0'})</div></div>
      <div class="tile"><div class="tile-num">${gs?.avgCredit != null ? pct(gs.avgCredit) : '—'}</div><div class="tile-label">Average progress</div></div>
      ${rankCount > 1 ? `<div class="tile"><div class="tile-num">${rankIdx >= 0 ? `#${rankIdx + 1}<span class="of">/${rankCount}</span>` : '—'}</div><div class="tile-label">${rankIdx === 0 ? 'Your most consistent goal' : rankIdx === rankCount - 1 ? 'Your least consistent goal' : rankIdx >= 0 ? 'Consistency rank' : 'Not enough days to rank'}</div></div>` : ''}
      ${measure ? `<div class="tile"><div class="tile-num">${gs?.avgValue != null ? esc(fmtValue(gs.avgValue, measure)) : '—'}</div><div class="tile-label">Average logged</div></div>
      <div class="tile"><div class="tile-num">${gs?.values?.length ? esc(fmtValue(gs.total, measure)) : '—'}</div><div class="tile-label">Total</div></div>` : ''}
      ${v.scored ? `<div class="tile"><div class="tile-num">${gs ? gs.lost.toFixed(1) : '—'}</div><div class="tile-label">Points lost / day</div></div>` : ''}
      ${gs?.excused ? `<div class="tile"><div class="tile-num">${gs.excused}</div><div class="tile-label">Excused</div></div>` : ''}
    </div>
    <section class="card"><h3>Consistency</h3>${occurrenceStrip(items)}</section>
    ${chart}
    ${partTable}
    ${notes.length ? `<section class="card"><h3>Notes</h3>${notes.map(([k, r]) => {
      const pid = k.split('|')[2];
      return `<div class="note-row"><button class="link small" data-a="nav" data-href="#today/${k.slice(0, 10)}">${fmtDate(k.slice(0, 10))}</button>${pid ? ` <span class="muted small">${esc(goal.parts.find((x) => x.id === pid)?.name || '')}</span>` : ''}<div>${esc(r.note)}</div></div>`;
    }).join('')}</section>` : ''}
    <section class="card"><h3>History of changes</h3>
      <ul class="changes">${versions.map(({ ver, prev }) => `<li><b>${fmtDate(ver.from, { year: true })}</b> — ${prev ? esc(diffText(goal, prev, ver)) : 'created'}</li>`).join('')}
      ${(goal.pauses || []).map((p) => `<li><b>${fmtDate(p.start, { year: true })}</b> — paused${p.end ? ` until ${fmtDate(p.end, { year: true })}` : ''}${p.reason ? ` (${esc(p.reason)})` : ''}
        <button class="link small" data-a="pauseRemove" data-s="${p.start}">remove</button></li>`).join('')}
      ${goal.archivedOn ? `<li><b>${fmtDate(goal.archivedOn, { year: true })}</b> — archived</li>` : ''}</ul>
      <p class="muted small">Past days are always scored with the settings that applied on that day.</p>
    </section>`;
}

const findGoal = () => app.state.goals.find((g) => g.id === app.ui.param);

export const goalActions = {
  categories() { categoriesSheet(); },
  catMove(el) {
    const cats = [...app.state.categories].sort((a, b) => a.order - b.order);
    const i = cats.findIndex((c) => c.id === el.dataset.id), j = i + Number(el.dataset.d);
    if (j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    cats.forEach((c, k) => { c.order = k; });
    app.save(); categoriesSheet(); app.render();
  },
  catDelete(el) {
    const c = app.state.categories.find((x) => x.id === el.dataset.id);
    const n = app.state.goals.filter((g) => g.categoryId === c.id).length;
    if (!confirm(`Delete "${c.name}"?${n ? ` Its ${n} goal(s) become uncategorized — nothing else changes.` : ''}`)) return;
    app.state.categories = app.state.categories.filter((x) => x.id !== c.id);
    for (const g of app.state.goals) if (g.categoryId === c.id) g.categoryId = null;
    app.save(); categoriesSheet(); app.render();
  },
  goalMove(el) {
    const g = app.state.goals.find((x) => x.id === el.dataset.g);
    const group = groupsOf(app.state.goals.filter((x) => x.state === 'active')).find((gr) => gr.goals.includes(g)).goals;
    const i = group.indexOf(g), j = i + Number(el.dataset.d);
    if (j < 0 || j >= group.length) return;
    const swapped = [...group];
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
    const all = [...app.state.goals].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    const slots = all.map((x, k) => (group.includes(x) ? k : -1)).filter((k) => k >= 0);
    slots.forEach((k, n) => { all[k] = swapped[n]; });
    all.forEach((x, k) => { x.order = k; });
    app.commit();
  },
  goalPause() {
    openSheet(`<div class="sheet-head"><h2>Pause ${esc(findGoal().name)}</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
      <p class="muted small">Paused days aren't scheduled, so they never count as missed. You can pause past days too (e.g. you were sick).</p>
      <form data-submit="pauseSave">
        <label class="field"><span>From</span><input type="date" name="start" value="${app.today}" required></label>
        <label class="field"><span>Until <em class="muted">(leave empty to pause until you resume)</em></span><input type="date" name="end"></label>
        <label class="field"><span>Reason (optional)</span><input type="text" name="reason"></label>
        <button class="btn primary block" type="submit">Pause</button>
      </form>`);
  },
  goalResume() {
    const g = findGoal();
    const p = g.pauses.find((x) => !x.end || x.end >= app.today);
    if (p.start >= app.today) g.pauses = g.pauses.filter((x) => x !== p);
    else p.end = addDays(app.today, -1);
    toast('Resumed from today');
    app.commit();
  },
  pauseRemove(el) {
    const g = findGoal();
    if (!confirm('Remove this pause? Those days will count as scheduled again.')) return;
    g.pauses = g.pauses.filter((p) => p.start !== el.dataset.s);
    app.commit();
  },
  goalArchive() {
    const g = findGoal();
    if (!confirm(`Archive "${g.name}"? It stops appearing from today. All its history stays.`)) return;
    g.state = 'archived';
    g.archivedOn = app.today;
    toast('Archived');
    app.commit();
  },
  goalRestore() {
    const g = findGoal();
    if (g.archivedOn && g.archivedOn < app.today) {
      (g.pauses ||= []).push({ start: g.archivedOn, end: addDays(app.today, -1), reason: 'archived' });
    }
    g.state = 'active';
    g.archivedOn = null;
    toast('Restored — tracking again from today');
    app.commit();
  },
  goalTrash() {
    const g = findGoal();
    const n = countRecords(app.state, g.id);
    if (!n) {
      if (!confirm(`Delete "${g.name}"? It has no logged entries.`)) return;
      deleteGoalForever(app.state, g.id);
      app.save();
      go('#goals');
      return;
    }
    if (!confirm(`Move "${g.name}" to the trash?\n\nIts ${n} entries will stop counting and past day scores will change. Tip: "Archive" stops tracking but keeps history.\n\nIt's deleted for good after 30 days.`)) return;
    g.prevState = g.state;
    g.state = 'trash';
    g.trashedOn = app.today;
    app.save();
    go('#goals');
  },
  goalUntrash() {
    const g = findGoal();
    g.state = g.prevState || 'active';
    delete g.trashedOn;
    toast('Restored');
    app.commit();
  },
  goalPurge() {
    const g = findGoal();
    if (!confirm(`Delete "${g.name}" and all ${countRecords(app.state, g.id)} entries forever? This can't be undone.`)) return;
    deleteGoalForever(app.state, g.id);
    app.save();
    go('#goals');
  },
};

export const goalSubmit = {
  catAdd(form) {
    const name = form.name.value.trim();
    if (!name) return;
    app.state.categories.push({ id: uid(), name, order: app.state.categories.length });
    app.save(); categoriesSheet(); app.render();
  },
  pauseSave(form) {
    const g = findGoal();
    const start = form.start.value, end = form.end.value || null;
    if (end && end < start) { toast('"Until" is before "From"'); return; }
    (g.pauses ||= []).push({ start, end, reason: form.reason.value.trim() });
    g.pauses.sort((a, b) => (a.start < b.start ? -1 : 1));
    closeSheet();
    toast('Paused');
    app.commit();
  },
};

export const goalChange = {
  catRename(el) {
    const c = app.state.categories.find((x) => x.id === el.dataset.id);
    const name = el.value.trim();
    if (c && name) { c.name = name; app.save(); app.render(); }
  },
};

