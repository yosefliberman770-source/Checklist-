// Create / edit a goal. Basic fields first, everything else under
// "More options". Changes to what a goal *means* become a new version that
// applies from a date the user picks, so history keeps its meaning.

import { app, openSheet, closeSheet, toast, go, PALETTE } from '../ctx.js';
import { WEIGHTS, POINT_LEVELS, EXTRA_LEVELS, basePoints, extraPoints, scoringMode, dailyTarget, goalPoints, MAX_OPTION_WORTH, BONUS_SIZES, DEFAULT_BONUS_POINTS, DEFAULT_BONUS_CAP, applyVersion, evaluate, versionFor, isScheduled, hasTarget, totalModeAllowed, partsShareUnit } from '../engine.js';
import { describe, pct, statusLabel } from '../format.js';
import { sortedCats, catLabel, findCatByName, createCategory } from './categories.js';
import { esc, uid, deepClone, DAY_SHORT, DAY_LONG, addDays, weekday, fmtDate } from '../util.js';

const PRESETS = [
  { id: 'check', label: 'Done / not done', kind: 'check' },
  { id: 'count', label: 'Count', kind: 'number', unit: 'times', precision: 0 },
  { id: 'amount', label: 'Amount', kind: 'number', unit: '', precision: 1 },
  { id: 'time', label: 'Time', kind: 'duration' },
  { id: 'percent', label: 'Percentage', kind: 'number', unit: '%', precision: 0 },
  { id: 'distance', label: 'Distance', kind: 'number', unit: 'km', precision: 2 },
  { id: 'custom', label: 'Custom number', kind: 'number', unit: '', precision: 2 },
  { id: 'choice', label: 'Either / or — do one of several options', kind: 'check' },
];
const PRESET_UNITS = PRESETS.map((p) => p.unit).filter(Boolean);

function newOption(worth) {
  return {
    partId: uid(), name: '', step: '', kind: 'check', unit: '', precision: 0, allowNegative: false,
    target: blankTarget(), credit: 'partial', weight: 2, optional: false, worth,
  };
}

const TARGET_TYPES = [
  { id: 'atLeast', label: 'At least' },
  { id: 'atMost', label: 'No more than' },
  { id: 'range', label: 'Between' },
  { id: 'exact', label: 'Exactly' },
  { id: 'none', label: 'No target — just track it' },
];

const MEANING_KEYS = ['kind', 'unit', 'precision', 'allowNegative', 'target', 'dayTargets', 'credit', 'cap',
  'points', 'extraPoints', 'scored', 'bonus', 'bonusPoints', 'schedule', 'parts', 'partMode', 'partWeighting'];

function guessPreset(cfg) {
  if (cfg.partMode === 'best' && (cfg.parts || []).length) return 'choice';
  if (cfg.kind === 'check') return 'check';
  if (cfg.kind === 'duration') return 'time';
  const u = (cfg.unit || '').trim();
  if (u === '%') return 'percent';
  if (u === 'times') return 'count';
  if (u === 'km' || u === 'mi') return 'distance';
  return 'custom';
}

function blankTarget() { return { type: 'atLeast', value: '', low: '', high: '', tolerance: '', zero: '', zeroLow: '', zeroHigh: '' }; }

function newPart(d) {
  const first = d.parts[0];
  return {
    partId: uid(), name: '', step: '',
    kind: first?.kind || (d.kind === 'check' ? 'number' : d.kind),
    unit: first?.unit ?? d.unit ?? '', precision: first?.precision ?? d.precision ?? 0, allowNegative: false,
    target: blankTarget(), credit: 'partial', weight: 2, optional: false,
  };
}

export function newDraft() {
  return {
    isNew: true, name: '', shortName: '', description: '', notes: '', icon: '', color: '', categoryId: '',
    pinned: false, step: '', start: app.today, end: '', preset: 'check',
    kind: 'check', unit: '', precision: 0, allowNegative: false, target: blankTarget(), dayTargets: {},
    credit: 'partial', cap: 1, weight: 2, points: 10, extraPoints: 0, scored: true, bonus: false, bonusPoints: DEFAULT_BONUS_POINTS,
    schedule: { type: 'daily', days: [1, 2, 3, 4, 5], every: 2, anchor: '', dates: [] },
    parts: [], partMode: 'each', partWeighting: 'target', _newDate: app.today,
  };
}

function strip(v) {
  const c = deepClone(v);
  delete c.id; delete c.from; delete c.nameSnapshot;
  return c;
}

export function draftFromGoal(goal) {
  const v = strip(goal.versions[goal.versions.length - 1]);
  const d = newDraft();
  Object.assign(d, {
    isNew: false, id: goal.id, name: goal.name, shortName: goal.shortName || '', description: goal.description || '',
    notes: goal.notes || '', icon: goal.icon || '', color: goal.color || '', categoryId: goal.categoryId || '',
    pinned: !!goal.pinned, step: goal.step ?? '', start: goal.start || app.today, end: goal.end || '',
  });
  Object.assign(d, v);
  d.target = { ...blankTarget(), ...(v.target || {}) };
  d.schedule = { ...newDraft().schedule, ...(v.schedule || {}) };
  d.dayTargets = v.dayTargets || {};
  d.parts = (v.parts || []).map((p) => {
    const meta = (goal.parts || []).find((x) => x.id === p.partId) || {};
    return { ...p, name: meta.name || '', step: meta.step ?? '', target: { ...blankTarget(), ...(p.target || {}) } };
  });
  if (!(Number(d.bonusPoints) > 0)) d.bonusPoints = DEFAULT_BONUS_POINTS;
  d.points = basePoints(v);
  d.extraPoints = Math.round(extraPoints(v) * 10) / 10;
  delete d.difficulty;
  d.preset = guessPreset(d);
  return d;
}

// ---------- draft → version config ----------

const numOrNull = (x) => (x === '' || x == null || Number.isNaN(Number(x)) ? null : Number(x));

function cleanTarget(t, kind) {
  if (kind === 'check') return { type: 'check' };
  const out = { type: t.type };
  const keep = { atLeast: ['value', 'zero'], atMost: ['value', 'zero'], range: ['low', 'high', 'zeroLow', 'zeroHigh'],
    exact: ['value', 'tolerance', 'zeroLow', 'zeroHigh'], none: [] }[t.type] || [];
  for (const k of keep) { const n = numOrNull(t[k]); if (n != null) out[k] = n; }
  return out;
}

function cleanMeasure(m) {
  const out = {
    kind: m.kind,
    unit: m.kind === 'number' ? (m.unit || '').trim() : '',
    precision: m.kind === 'number' ? Math.max(0, Math.min(6, Number(m.precision) || 0)) : 0,
    allowNegative: m.kind === 'number' ? !!m.allowNegative : false,
    target: cleanTarget(m.target, m.kind),
    credit: m.kind === 'check' ? 'all' : m.credit === 'all' ? 'all' : 'partial',
  };
  return out;
}

export function configFromDraft(d) {
  const base = cleanMeasure(d);
  const cfg = {
    ...base,
    dayTargets: {},
    cap: base.target.type === 'atLeast' && base.credit === 'partial' ? Number(d.cap) || 1 : 1,
    points: Number(d.points) > 0 ? Number(d.points) : 10,
    extraPoints: Math.max(0, Number(d.extraPoints) || 0),
    scored: !!d.scored,
    bonus: !!d.scored && !!d.bonus,
    ...(d.scored && d.bonus ? { bonusPoints: Number(d.bonusPoints) > 0 ? Number(d.bonusPoints) : DEFAULT_BONUS_POINTS } : {}),
    schedule: cleanSchedule(d.schedule),
    parts: [],
    partMode: 'each',
    partWeighting: 'target',
  };
  if (!d.parts.length && d.kind !== 'check') {
    for (const [wd, o] of Object.entries(d.dayTargets || {})) {
      if (o == null || o === '') continue;
      if (typeof o === 'object') {
        const lo = numOrNull(o.low), hi = numOrNull(o.high);
        if (lo != null || hi != null) cfg.dayTargets[wd] = { ...(lo != null ? { low: lo } : {}), ...(hi != null ? { high: hi } : {}) };
      } else if (numOrNull(o) != null) cfg.dayTargets[wd] = numOrNull(o);
    }
  }
  if (d.parts.length) {
    const choice = d.partMode === 'best';
    cfg.parts = d.parts.map((p) => ({
      partId: p.partId, ...cleanMeasure(p), weight: Number(p.weight) > 0 ? Number(p.weight) : 2,
      optional: choice ? false : !!p.optional,
      ...(choice ? {
        worth: Math.max(0, Math.min(MAX_OPTION_WORTH, Math.round(p.worth === '' || p.worth == null || Number.isNaN(Number(p.worth)) ? 100 : Number(p.worth)))),
        bonusPoints: Number(p.bonusPoints) > 0 ? Number(p.bonusPoints) : 0,
      } : {}),
    }));
    cfg.partMode = choice ? 'best' : d.partMode === 'total' && totalModeAllowed(cfg.parts) ? 'total' : 'each';
    cfg.partWeighting = d.partWeighting === 'equal' ? 'equal' : 'target';
    if (cfg.partMode === 'total') cfg.credit = d.credit === 'all' ? 'all' : 'partial';
  }
  return cfg;
}

function cleanSchedule(s) {
  switch (s.type) {
    case 'weekdays': return { type: 'weekdays', days: [...new Set(s.days)].map(Number).sort() };
    case 'interval': return { type: 'interval', every: Math.max(1, Number(s.every) || 1), ...(s.anchor ? { anchor: s.anchor } : {}) };
    case 'dates': return { type: 'dates', dates: [...new Set(s.dates)].sort() };
    case 'anytime': return { type: 'anytime' };
    default: return { type: 'daily' };
  }
}

function canonical(cfg) {
  const o = {};
  for (const k of MEANING_KEYS) o[k] = cfg[k];
  return JSON.stringify(o);
}

// ---------- validation ----------

function validateMeasure(m, label) {
  const errs = [];
  if (m.kind === 'check') return errs;
  const t = m.target;
  const n = (k) => numOrNull(t[k]);
  if (t.type === 'atLeast' || t.type === 'atMost' || t.type === 'exact') {
    if (n('value') == null) errs.push(`${label}: enter the target amount.`);
  }
  if (t.type === 'range') {
    if (n('low') == null || n('high') == null) errs.push(`${label}: enter both ends of the range.`);
    else if (n('low') > n('high')) errs.push(`${label}: the lower end must be smaller than the upper end.`);
  }
  if (t.type === 'atLeast' && n('zero') != null && n('value') != null && n('zero') >= n('value')) {
    errs.push(`${label}: "no credit at or below" must be less than the target.`);
  }
  if (t.type === 'atMost' && n('zero') != null && n('value') != null && n('zero') <= n('value')) {
    errs.push(`${label}: "no credit at or above" must be more than the limit.`);
  }
  return errs;
}

function validate(d) {
  const errs = [];
  if (!d.name.trim()) errs.push('Give the goal a name.');
  if (d.partMode === 'best') {
    if (d.parts.length < 2) errs.push('Add at least two options to choose between.');
    d.parts.forEach((p, i) => {
      if (!p.name.trim()) errs.push(`Option ${i + 1}: give it a name.`);
      const w = Number(p.worth);
      if (!(w >= 0 && w <= MAX_OPTION_WORTH) || p.worth === '') errs.push(`${p.name || `Option ${i + 1}`}: worth must be between 1% and ${MAX_OPTION_WORTH}%.`);
      errs.push(...validateMeasure(p, p.name || `Option ${i + 1}`));
    });
  } else if (d.parts.length) {
    d.parts.forEach((p, i) => {
      if (!p.name.trim()) errs.push(`Part ${i + 1}: give it a name.`);
      errs.push(...validateMeasure(p, p.name || `Part ${i + 1}`));
    });
  } else errs.push(...validateMeasure(d, 'Target'));
  if (d.schedule.type === 'weekdays' && !d.schedule.days.length) errs.push('Pick at least one day.');
  if (d.schedule.type === 'dates' && !d.schedule.dates.length) errs.push('Add at least one date.');
  if (d.end && d.start && d.end < d.start) errs.push('The end date is before the start date.');
  return errs;
}

// ---------- rendering helpers ----------

const val = (x) => (x == null ? '' : esc(x));

function numInput(path, value, { placeholder = '', unit = '' } = {}) {
  return `<span class="inline-num"><input type="text" inputmode="decimal" data-bind="${path}" value="${val(value)}" placeholder="${esc(placeholder)}">${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</span>`;
}

function durInput(path, value) {
  const v = numOrNull(value);
  const h = v == null ? '' : Math.floor(v / 60);
  const m = v == null ? '' : Math.round(v % 60);
  return `<span class="inline-dur" data-dur="${path}">
    <input type="number" inputmode="numeric" min="0" value="${h}" placeholder="0" aria-label="hours"><span class="unit">h</span>
    <input type="number" inputmode="numeric" min="0" max="59" value="${m}" placeholder="0" aria-label="minutes"><span class="unit">m</span></span>`;
}

const amountInput = (m, path, value, ph) => (m.kind === 'duration' ? durInput(path, value) : numInput(path, value, { placeholder: ph, unit: m.unit }));

function targetFields(m, prefix) {
  if (m.kind === 'check') return '';
  const t = m.target;
  const p = (k) => `${prefix}target.${k}`;
  let inputs = '';
  if (t.type === 'atLeast' || t.type === 'atMost') inputs = amountInput(m, p('value'), t.value, '20');
  else if (t.type === 'exact') inputs = amountInput(m, p('value'), t.value, '8');
  else if (t.type === 'range') inputs = `${amountInput(m, p('low'), t.low, '7')}<span class="to">to</span>${amountInput(m, p('high'), t.high, '9')}`;
  return `<div class="target-row">
    <select data-bind="${p('type')}" data-rr>${TARGET_TYPES.map((x) => `<option value="${x.id}"${x.id === t.type ? ' selected' : ''}>${x.label}</option>`).join('')}</select>
    ${inputs}</div>`;
}

function creditFields(m, prefix, { allowCap, noZero = false }) {
  if (m.kind === 'check' || m.target.type === 'none') return '';
  const t = m.target;
  const p = (k) => `${prefix}${k}`;
  let zero = '';
  if (noZero) zero = '';
  else if (m.credit !== 'all') {
    if (t.type === 'atLeast') zero = `<label class="field"><span>No credit at or below <em class="muted">(default 0)</em></span>${amountInput(m, p('target.zero'), t.zero, '0')}</label>`;
    if (t.type === 'atMost') zero = `<label class="field"><span>No credit at or above <em class="muted">(default: twice the limit)</em></span>${amountInput(m, p('target.zero'), t.zero, '')}</label>`;
    if (t.type === 'range' || t.type === 'exact') zero = `<label class="field"><span>Too little: no credit at or below <em class="muted">(default 0)</em></span>${amountInput(m, p('target.zeroLow'), t.zeroLow, '0')}</label>
      <label class="field"><span>Too much: no credit at or above <em class="muted">(default: as far above as the range is wide)</em></span>${amountInput(m, p('target.zeroHigh'), t.zeroHigh, '')}</label>`;
    if (t.type === 'exact') zero += `<label class="field"><span>Counts as exact within ±</span>${amountInput(m, p('target.tolerance'), t.tolerance, '0')}</label>`;
  } else if (t.type === 'exact') {
    zero = `<label class="field"><span>Counts as exact within ±</span>${amountInput(m, p('target.tolerance'), t.tolerance, '0')}</label>`;
  }
  const capSel = allowCap && t.type === 'atLeast' && m.credit !== 'all' ? `<label class="field"><span>Going beyond the target</span>
    <select data-bind="cap" data-type="num" data-rr>
      ${[[1, 'Stops at 100% (default)'], [1.25, 'Extra credit up to 125%'], [1.5, 'Extra credit up to 150%'], [2, 'Extra credit up to 200%']]
        .map(([v, l]) => `<option value="${v}"${Number(m.cap || 1) === v ? ' selected' : ''}>${l}</option>`).join('')}
    </select></label>` : '';
  return `<label class="field"><span>Credit for partial progress</span>
      <select data-bind="${p('credit')}" data-rr>
        <option value="partial"${m.credit !== 'all' ? ' selected' : ''}>Partial credit — progress counts</option>
        <option value="all"${m.credit === 'all' ? ' selected' : ''}>All or nothing — only meeting it counts</option>
      </select></label>${zero}${capSel}`;
}

function weightSeg(path, value, small = false) {
  const isCustom = !WEIGHTS.some((w) => w.value === Number(value));
  return `<div class="seg${small ? ' small' : ''}">${WEIGHTS.map((w) => `<button type="button" class="${Number(value) === w.value ? 'on' : ''}" data-a="edSet" data-path="${path}" data-v="${w.value}">${w.label}</button>`).join('')}
    ${isCustom ? `<button type="button" class="on">${esc(value)}</button>` : ''}</div>`;
}

function measureSelect(path, kind) {
  const opts = [['check', 'Done / not done'], ['number', 'Number'], ['duration', 'Time']];
  return `<select data-bind="${path}" data-rr>${opts.map(([v, l]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
}

function scheduleFields(s) {
  let extra = '';
  if (s.type === 'weekdays') {
    const order = app.state.settings.weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    extra = `<div class="daychips">${order.map((d) => `<button type="button" class="daychip${s.days.includes(d) ? ' on' : ''}" data-a="edDay" data-d="${d}">${DAY_SHORT[d]}</button>`).join('')}</div>`;
  } else if (s.type === 'interval') {
    extra = `<div class="inline">Every ${numInput('schedule.every', s.every, { placeholder: '2' })} days, counting from
      <input type="date" data-bind="schedule.anchor" value="${val(s.anchor || app.ui.draft.start)}"></div>`;
  } else if (s.type === 'dates') {
    extra = `<div class="datelist">${s.dates.sort().map((d) => `<span class="tag">${fmtDate(d, { year: true })} <button type="button" data-a="edRemoveDate" data-d="${d}" aria-label="Remove">✕</button></span>`).join('')}</div>
      <div class="inline"><input type="date" id="ed-newdate" value="${app.ui.draft._newDate || app.today}"><button type="button" class="btn small" data-a="edAddDate">Add date</button></div>`;
  } else if (s.type === 'anytime') {
    extra = '<p class="muted small">Never expected, so it is never missed — and it can\'t count toward your score.</p>';
  }
  return `<select data-bind="schedule.type" data-rr>
      ${[['daily', 'Every day'], ['weekdays', 'Specific days of the week'], ['interval', 'Every few days'], ['dates', 'Specific dates'], ['anytime', 'Any time (not scheduled)']]
        .map(([v, l]) => `<option value="${v}"${s.type === v ? ' selected' : ''}>${l}</option>`).join('')}
    </select>${extra}`;
}

function dayTargetFields(d) {
  if (d.kind === 'check' || d.parts.length || d.target.type === 'none') return '';
  const order = app.state.settings.weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  const isRange = d.target.type === 'range';
  return `<details class="sub"${Object.keys(d.dayTargets || {}).length ? ' open' : ''}><summary>Different target on some days</summary>
    <p class="muted small">Leave a day empty to use the normal target.</p>
    <div class="daytargets">${order.map((wd) => {
      const o = d.dayTargets?.[wd];
      return `<div class="dt-row"><span class="dt-day">${DAY_LONG[wd]}</span>${isRange
        ? `${amountInput(d, `dayTargets.${wd}.low`, o?.low, '')}<span class="to">to</span>${amountInput(d, `dayTargets.${wd}.high`, o?.high, '')}`
        : amountInput(d, `dayTargets.${wd}`, typeof o === 'object' ? '' : o, '')}</div>`;
    }).join('')}</div></details>`;
}

function optionCard(p, i, d) {
  const pre = `parts.${i}.`;
  return `<div class="part-card option-card">
    <div class="part-head">
      <span class="opt-num">${i + 1}</span>
      <input type="text" data-bind="${pre}name" value="${val(p.name)}" placeholder="${i === 0 ? 'e.g. Workout' : i === 1 ? 'e.g. Stretch' : 'Option name'}">
      <button type="button" class="icon-btn" data-a="edPartMove" data-i="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="icon-btn danger-text" data-a="edPartRemove" data-i="${i}" aria-label="Remove option" ${d.parts.length <= 2 ? 'disabled' : ''}>✕</button>
    </div>
    <div class="inline">${measureSelect(pre + 'kind', p.kind)}
      ${p.kind === 'number' ? `<input type="text" class="unit-in" data-bind="${pre}unit" value="${val(p.unit)}" placeholder="unit (reps, km…)">` : ''}</div>
    ${p.kind !== 'check' ? targetFields(p, pre) : ''}
    ${p.kind !== 'check' && p.target.type !== 'none' ? `<label class="field compact"><span>Partial progress</span>
      <select data-bind="${pre}credit" data-rr><option value="partial"${p.credit !== 'all' ? ' selected' : ''}>Partial credit</option><option value="all"${p.credit === 'all' ? ' selected' : ''}>All or nothing</option></select></label>` : ''}
    <div class="field compact"><span>Worth if you choose this</span>
      <div class="inline worth-row">
        <span class="inline-num"><input type="text" inputmode="numeric" data-bind="${pre}worth" value="${val(p.worth)}" aria-label="Worth percent"><span class="unit">%</span></span>
        ${[0, 25, 50, 75, 100, 125, 150].map((n) => `<button type="button" class="chip-btn${Number(p.worth) === n ? ' on' : ''}${n > 100 ? ' extra' : ''}" data-a="edSet" data-path="${pre}worth" data-v="${n}">${n}%</button>`).join('')}
      </div>
      ${Number(p.worth) > 100 ? `<p class="muted small">⭐ Extra credit: choosing this earns more than a full goal, which can make up for other goals you missed that day. Your day still tops out at 100%.</p>` : ''}
      ${String(p.worth) === '0' ? `<p class="muted small">0% = this option doesn't complete the goal${Number(p.bonusPoints) > 0 ? '; it only adds its bonus points' : ' (give it bonus points below, or it does nothing)'}.</p>` : ''}</div>
    <div class="field compact"><span>Bonus points if you do it <em class="muted">(optional)</em></span>
      <div class="seg small">${[0, ...BONUS_SIZES].map((n) => `<button type="button" class="${(Number(p.bonusPoints) || 0) === n ? 'on' : ''}" data-a="edSet" data-path="${pre}bonusPoints" data-v="${n}">${n ? `+${n}` : 'None'}</button>`).join('')}</div>
      <p class="muted small">Added on top of the goal's credit, like a bonus goal — counts toward your daily bonus limit.</p></div>
  </div>`;
}

function partCard(p, i, d) {
  const sameUnit = partsShareUnit(d.parts);
  const showWeight = d.partMode !== 'total' && (d.partWeighting === 'equal' || !sameUnit);
  const pre = `parts.${i}.`;
  return `<div class="part-card">
    <div class="part-head">
      <input type="text" data-bind="${pre}name" value="${val(p.name)}" placeholder="Part name (e.g. Fiction)">
      <button type="button" class="icon-btn" data-a="edPartMove" data-i="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="icon-btn danger-text" data-a="edPartRemove" data-i="${i}" aria-label="Remove part">✕</button>
    </div>
    <div class="inline">${measureSelect(pre + 'kind', p.kind)}
      ${p.kind === 'number' ? `<input type="text" class="unit-in" data-bind="${pre}unit" value="${val(p.unit)}" placeholder="unit (pages…)">` : ''}</div>
    ${p.kind !== 'check' ? targetFields(p, pre) : ''}
    ${p.kind !== 'check' && p.target.type !== 'none' && d.partMode !== 'total' ? `<label class="field compact"><span>Partial progress</span>
      <select data-bind="${pre}credit" data-rr><option value="partial"${p.credit !== 'all' ? ' selected' : ''}>Partial credit</option><option value="all"${p.credit === 'all' ? ' selected' : ''}>All or nothing</option></select></label>` : ''}
    <label class="check-field"><input type="checkbox" data-bind="${pre}optional" data-type="bool" data-rr ${p.optional ? 'checked' : ''}> <span>Optional <span class="muted small">(doesn't need to be met; still adds to the total)</span></span></label>
    ${showWeight && !p.optional ? `<div class="field compact"><span>Counts within ${esc(d.name || 'the goal')}</span>${weightSeg(pre + 'weight', p.weight, true)}</div>` : ''}
  </div>`;
}

// The goal's share of a typical scheduled day. For a bonus goal: how much it
// can add on top, relative to the regular goals that day.
function shareOfDay(d, cfg) {
  const temp = { id: d.id || '_draft', state: 'active', start: d.start, end: d.end || null, pauses: [], versions: [{ ...cfg, from: d.start }] };
  for (let k = 0; k < 14; k++) {
    const date = addDays(app.today, k);
    if (!isScheduled(temp, date)) continue;
    let W = cfg.bonus ? 0 : goalPoints(cfg);
    for (const g of app.state.goals) {
      if (g.id === d.id || g.state !== 'active') continue;
      const v = versionFor(g, date);
      const scoredGoal = v.scored && !v.bonus && v.schedule?.type !== 'anytime' &&
        (v.parts?.length ? v.parts.some((p) => !p.optional && hasTarget(p)) : hasTarget(v));
      if (scoredGoal && isScheduled(g, date, v)) W += goalPoints(v);
    }
    return { share: W > 0 ? goalPoints(cfg) / W : null, date };
  }
  return null;
}

function summaryHtml(d) {
  const cfg = configFromDraft(d);
  cfg.parts = cfg.parts.map((p, i) => ({ ...p, name: d.parts[i].name }));
  let html = `<div class="summary-sentence">${esc(describe(cfg))}</div>`;
  const scorable = cfg.scored && cfg.schedule.type !== 'anytime' &&
    (cfg.parts.length ? cfg.parts.some((p) => !p.optional && hasTarget(p)) : hasTarget(cfg));
  if (scorable && validate({ ...d, name: d.name || 'x' }).length === 0) {
    const s = shareOfDay(d, cfg);
    const day = s ? (s.date === app.today ? 'today\'s' : DAY_LONG[weekday(s.date)] + '\'s') : '';
    if (cfg.bonus) {
      const capS = app.state.settings.bonusCap;
      html += `<div class="muted small">Adds +${cfg.bonusPoints} to your day score when done${capS === 'none' ? '' : ` (all bonuses together: at most +${capS ?? DEFAULT_BONUS_CAP} a day)`}. Skipping it costs nothing.</div>`;
    } else if (scoringMode(app.state.settings) === 'points') {
      html += `<div class="muted small">Doing it earns ${goalPoints(cfg)} of your ${dailyTarget(app.state.settings)} daily points.</div>`;
    } else if (s) html += `<div class="muted small">Worth about ${Math.round(s.share * 100)}% of ${day} score.</div>`;
  }
  return html;
}

function previewHtml(d) {
  if (d.parts.length || d.kind === 'check' || d.target.type === 'none') return '';
  const pv = d._preview;
  let out = '';
  if (pv != null && pv !== '' && validateMeasure(d, 't').length === 0) {
    const ev = evaluate(configFromDraft(d), Number(pv), app.today);
    const st = statusLabel({ ...ev, status: 'logged', hasTarget: true });
    out = `→ earns <b>${pct(ev.credit)}</b> <span class="chip ${st.cls}">${st.text}</span>`;
  }
  return `<div class="preview-row"><span>If you log</span>${d.kind === 'duration' ? durInput('_preview', pv) : numInput('_preview', pv, { unit: d.unit })}<span id="ed-preview-out">${out}</span></div>`;
}

export function renderEditor() {
  const d = app.ui.draft;
  if (!d) { go('#goals'); return ''; }
  const isChoice = d.partMode === 'best';
  const hasParts = d.parts.length > 0 && !isChoice;
  const sameUnit = partsShareUnit(d.parts);
  const totalOk = totalModeAllowed(configFromDraft(d).parts);
  return `<div class="topbar">
      <button class="link" data-a="edCancel">Cancel</button>
      <h1>${d.isNew ? 'New goal' : 'Edit goal'}</h1>
      <button class="btn primary small" data-a="edSave">Save</button>
    </div>
    <div class="summary-box" id="ed-summary">${summaryHtml(d)}</div>
    <div id="ed-errors"></div>
    <div class="form">
      <label class="field"><span>Name</span>
        <input type="text" data-bind="name" value="${val(d.name)}" placeholder="e.g. Reading, Sleep, Workout" ${d.isNew ? 'autofocus' : ''}></label>

      ${isChoice ? `<div class="field"><span>How is it measured?</span>
        <select data-bind="preset" data-rr>${PRESETS.map((p) => `<option value="${p.id}"${p.id === 'choice' ? ' selected' : ''}>${p.label}</option>`).join('')}</select></div>
      <div class="field"><span>Options <em class="muted">(do any one)</em></span>
        <p class="muted small">Each day, do whichever option you like. The goal earns the best option you did, times its worth — e.g. Workout 100%, Stretch 75%. Set more than 100% for extra credit.</p>
        ${d.parts.map((p, i) => optionCard(p, i, d)).join('')}
        <button type="button" class="btn block" data-a="edOptAdd">+ Add option</button></div>` : hasParts ? '<div class="field"><span>How is it measured?</span><p class="muted small">By its parts (below).</p></div>' : `
      <div class="field"><span>How is it measured?</span>
        <select data-bind="preset" data-rr>${PRESETS.map((p) => `<option value="${p.id}"${p.id === d.preset ? ' selected' : ''}>${p.label}</option>`).join('')}</select>
        ${d.kind === 'number' ? `<input type="text" class="unit-in" data-bind="unit" value="${val(d.unit)}" placeholder="Unit (optional): pages, glasses, km…">` : ''}
      </div>
      ${d.kind !== 'check' ? `<div class="field"><span>Target</span>${targetFields(d, '')}</div>` : ''}`}

      <div class="field"><span>Which days?</span>${scheduleFields(d.schedule)}</div>

      ${d.scored && d.bonus ? `<div class="field"><span>Bonus worth</span>
        <div class="seg">${BONUS_SIZES.map((n) => `<button type="button" class="${Number(d.bonusPoints) === n ? 'on' : ''}" data-a="edSet" data-path="bonusPoints" data-v="${n}">+${n}</button>`).join('')}</div>
        <p class="muted small">Points added to your day (out of 100) when you do it.</p></div>`
      : pointsFields(d)}

      ${scoreModeField(d)}

      ${categoryField(d)}

      ${previewHtml(d)}

      <details class="more"${d._moreOpen ? ' open' : ''} data-toggle="_moreOpen"><summary>More options</summary>
        <div class="grid2">
          <label class="field"><span>Icon or emoji</span><input type="text" data-bind="icon" value="${val(d.icon)}" maxlength="4" placeholder="📖"></label>
          <label class="field"><span>Color</span><span class="inline"><input type="color" data-bind="color" data-rr value="${val(d.color || PALETTE[app.state.goals.length % PALETTE.length])}">
            ${d.color ? '<button type="button" class="link small" data-a="edSet" data-path="color" data-v="">Auto</button>' : '<span class="muted small">auto</span>'}</span></label>
        </div>
        <label class="field"><span>Short name</span><input type="text" data-bind="shortName" value="${val(d.shortName)}" placeholder="Used in tight spaces"></label>
        <label class="field"><span>Description</span><textarea data-bind="description" rows="2">${esc(d.description)}</textarea></label>
        <label class="check-field"><input type="checkbox" data-bind="pinned" data-type="bool" ${d.pinned ? 'checked' : ''}> Pin to the top</label>
        ${hasParts ? '' : creditFields(d, '', { allowCap: true })}
        ${dayTargetFields(d)}
        <div class="grid2">
          <label class="field"><span>Starts</span><input type="date" data-bind="start" value="${val(d.start)}"></label>
          <label class="field"><span>Ends <em class="muted">(optional)</em></span><input type="date" data-bind="end" value="${val(d.end)}"></label>
        </div>
        ${!hasParts && d.kind === 'number' ? `<div class="grid2">
          <label class="field"><span>Decimal places</span><input type="number" min="0" max="6" data-bind="precision" data-type="num" value="${val(d.precision)}"></label>
          <label class="field"><span>+ / − step</span><input type="text" inputmode="decimal" data-bind="step" value="${val(d.step)}" placeholder="1"></label>
        </div>
        <label class="check-field"><input type="checkbox" data-bind="allowNegative" data-type="bool" ${d.allowNegative ? 'checked' : ''}> Allow negative values</label>` : ''}
        ${!hasParts && d.kind === 'duration' ? `<label class="field"><span>+ / − step (minutes)</span><input type="text" inputmode="numeric" data-bind="step" value="${val(d.step)}" placeholder="15"></label>` : ''}
        <label class="field"><span>Notes about this goal</span><textarea data-bind="notes" rows="2">${esc(d.notes)}</textarea></label>
      </details>

      ${hasParts ? `<details class="more" open data-toggle="_partsOpen"><summary>Split into parts${hasParts ? ` (${d.parts.length})` : ''}</summary>
        <p class="muted small">Break one goal into pieces — e.g. Reading → Fiction 20 pages, History 12 pages. The goal keeps one importance in your day score; the parts decide how it's earned.</p>
        ${d.parts.map((p, i) => partCard(p, i, d)).join('')}
        <button type="button" class="btn block" data-a="edPartAdd">+ Add part</button>
        ${hasParts ? `
          <label class="field"><span>How the parts add up</span>
            <select data-bind="partMode" data-rr>
              <option value="each"${d.partMode !== 'total' ? ' selected' : ''}>Each part counts</option>
              <option value="total"${d.partMode === 'total' ? ' selected' : ''} ${totalOk ? '' : 'disabled'}>Only the total counts</option>
            </select>
            <span class="muted small">${d.partMode === 'total' ? 'Extra in one part makes up for another; only the overall total vs. the overall target matters.' : 'Each part only earns credit up to its own target, so extra in one part doesn\'t cover a missed one.'}${totalOk ? '' : ' "Only the total" needs every part in the same unit with an "at least" target.'}</span></label>
          ${d.partMode === 'total' && totalOk ? creditFields({ kind: 'number', unit: d.parts[0].unit, target: { type: 'atLeast' }, credit: d.credit, cap: d.cap }, '', { allowCap: true, noZero: true }) : ''}
          ${d.partMode !== 'total' && sameUnit ? `<label class="field"><span>Bigger parts count more?</span>
            <select data-bind="partWeighting" data-rr>
              <option value="target"${d.partWeighting !== 'equal' ? ' selected' : ''}>Yes, by target size</option>
              <option value="equal"${d.partWeighting === 'equal' ? ' selected' : ''}>No, I'll set each part's importance</option>
            </select>
            <span class="muted small">${d.partWeighting === 'equal' ? 'Set how much each part counts inside this goal.' : 'A 12-page part counts twice as much as a 6-page part.'}</span></label>` : ''}` : ''}
      </details>` : ''}
    </div>
    ${d.isNew ? '' : `<div class="center"><button class="link" data-a="nav" data-href="#goal/${d.id}">View this goal's history and actions</button></div>`}`;
}

function pointsFields(d) {
  const pts = scoringMode(app.state.settings) === 'points';
  const base = Number(d.points) || 0, extra = Number(d.extraPoints) || 0;
  const baseCustom = !POINT_LEVELS.some((x) => x.value === base);
  const extraCustom = !EXTRA_LEVELS.some((x) => x.value === extra);
  return `<div class="field"><span>${pts ? 'Points for doing it' : 'How much does it count?'}</span>
      <div class="seg">${POINT_LEVELS.map((x) => `<button type="button" class="${base === x.value ? 'on' : ''}" data-a="edSet" data-path="points" data-v="${x.value}">${x.value}<small> ${x.label}</small></button>`).join('')}</div>
      <div class="inline small-row"><span class="muted small">or exactly</span>${numInput('points', baseCustom ? d.points : '', { placeholder: String(base || 10), unit: 'points' })}</div>
      <p class="muted small">${pts ? `What you earn when you do it. Your daily goal is ${dailyTarget(app.state.settings)} points, and skipping a task never takes points away.` : 'Bigger numbers count more in your day.'}</p></div>
    <div class="field"><span>How hard is it? <em class="muted">(optional)</em></span>
      <div class="seg">${EXTRA_LEVELS.map((x) => `<button type="button" class="${extra === x.value ? 'on' : ''}" data-a="edSet" data-path="extraPoints" data-v="${x.value}">${x.label}${x.value ? `<small> +${x.value}</small>` : ''}</button>`).join('')}</div>
      <div class="inline small-row"><span class="muted small">or extra</span>${numInput('extraPoints', extraCustom ? d.extraPoints : '', { placeholder: '0', unit: 'points' })}</div>
      <p class="muted small">Extra points on top of the regular ones${base ? ` — this goal is worth <b>${base + extra} points</b> in total` : ''}.</p></div>`;
}

function scoreModeField(d) {
  const mode = !d.scored ? 'off' : d.bonus ? 'bonus' : 'counts';
  const help = {
    counts: 'Missing it lowers your day score.',
    bonus: 'Doing it adds a few points to your day; skipping it never lowers it. Your day still tops out at 100%.',
    off: 'Tracked only — it shows in your stats but never affects your score.',
  }[mode];
  const btn = (m, l) => `<button type="button" class="${mode === m ? 'on' : ''}" data-a="edScoreMode" data-m="${m}">${l}</button>`;
  return `<div class="field"><span>In your day score</span>
    <div class="seg">${btn('counts', 'Counts')}${btn('bonus', '⭐ Bonus')}${btn('off', 'Not counted')}</div>
    <p class="muted small">${help}</p></div>`;
}

function categoryField(d) {
  const cats = sortedCats();
  const chip = (id, label) => `<button type="button" class="chip-btn${(d.categoryId || '') === id ? ' on' : ''}" data-a="edCat" data-id="${id}">${label}</button>`;
  return `<div class="field"><span>Category <em class="muted">(optional)</em></span>
    <div class="chips wrap">
      ${chip('', 'None')}
      ${cats.map((c) => chip(c.id, catLabel(c))).join('')}
      ${d._newCat ? '' : '<button type="button" class="chip-btn dashed" data-a="edCatNew">+ New</button>'}
    </div>
    ${d._newCat ? `<div class="inline newcat">
      <input type="text" id="ed-newcat" placeholder="New category name" autocomplete="off" autofocus>
      <button type="button" class="btn small primary" data-a="edCatAdd">Add</button>
      <button type="button" class="link small" data-a="edCatCancel">Cancel</button></div>
      <div id="ed-caterr"></div>` : ''}
  </div>`;
}

// ---------- binding ----------

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(keys[i + 1]) && Array.isArray(o) ? [] : {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export const applyChoicePreset = (d) => applyPreset(d, 'choice');

function applyPreset(d, id) {
  if (id === 'choice') {
    d.preset = 'choice';
    d.kind = 'check';
    if (d.partMode !== 'best' || !d.parts.length) d.parts = [newOption(100), newOption(75)];
    d.partMode = 'best';
    return;
  }
  if (d.preset === 'choice' || d.partMode === 'best') { d.parts = []; d.partMode = 'each'; d.preset = 'check'; }
  const prev = PRESETS.find((p) => p.id === d.preset);
  const p = PRESETS.find((x) => x.id === id);
  d.preset = id;
  d.kind = p.kind;
  if (p.kind === 'number') {
    if (!d.unit || PRESET_UNITS.includes(d.unit) || d.unit === prev?.unit) d.unit = p.unit || '';
    d.precision = p.precision ?? 0;
  }
  if (p.kind !== 'check' && d.target.type === 'check') d.target.type = 'atLeast';
  if (p.kind !== prev?.kind) { d.target = { ...blankTarget(), type: d.target.type === 'none' ? 'none' : d.target.type }; d.dayTargets = {}; d.step = ''; }
  if (id === 'percent' && !d.target.value) d.target.type = d.target.type || 'atLeast';
}

function refreshLive() {
  const d = app.ui.draft;
  const s = document.getElementById('ed-summary');
  if (s) s.innerHTML = summaryHtml(d);
  const out = document.getElementById('ed-preview-out');
  if (out) {
    const tmp = document.createElement('div');
    tmp.innerHTML = previewHtml(d);
    const fresh = tmp.querySelector('#ed-preview-out');
    out.innerHTML = fresh ? fresh.innerHTML : '';
  }
}

export function editorBind(el, rerender) {
  const d = app.ui.draft;
  if (!d) return;
  const durWrap = el.closest('[data-dur]');
  if (durWrap) {
    const [h, m] = durWrap.querySelectorAll('input');
    const v = h.value === '' && m.value === '' ? '' : (Number(h.value) || 0) * 60 + (Number(m.value) || 0);
    setPath(d, durWrap.dataset.dur, v);
    refreshLive();
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.type === 'num') v = numOrNull(v) ?? '';
  if (path === 'preset') { applyPreset(d, v); app.render(); return; }
  if (/^parts\.\d+\.kind$/.test(path)) {
    const p = getPath(d, path.replace(/\.kind$/, ''));
    p.kind = v;
    p.target = { ...blankTarget(), type: v === 'check' ? 'atLeast' : 'atLeast' };
    if (v !== 'number') p.unit = '';
    app.render();
    return;
  }
  if (/^(parts\.\d+\.)?target\.type$/.test(path) && v === 'exact') {
    const credPath = path.replace(/target\.type$/, 'credit');
    setPath(d, credPath, 'all');
  }
  setPath(d, path, v);
  if (path === 'target.type') d.dayTargets = {};
  if (rerender && el.hasAttribute('data-rr')) app.render();
  else refreshLive();
}

// ---------- saving ----------

function partsPresentation(goal, d) {
  const keep = new Set(d.parts.map((p) => p.partId));
  const byId = Object.fromEntries((goal.parts || []).map((p) => [p.id, p]));
  for (const p of d.parts) {
    const meta = byId[p.partId] || { id: p.partId };
    meta.name = p.name.trim();
    meta.step = numOrNull(p.step) ?? '';
    meta.archived = false;
    byId[p.partId] = meta;
  }
  for (const id of Object.keys(byId)) if (!keep.has(id)) byId[id].archived = true;
  const ordered = d.parts.map((p) => byId[p.partId]);
  const rest = Object.values(byId).filter((p) => !keep.has(p.id));
  goal.parts = [...ordered, ...rest];
}

function applyPresentation(goal, d) {
  Object.assign(goal, {
    name: d.name.trim(), shortName: d.shortName.trim(), description: d.description, notes: d.notes,
    icon: d.icon.trim(), color: d.color, categoryId: d.categoryId || null, pinned: !!d.pinned,
    step: numOrNull(d.step) ?? '', start: d.start || app.today, end: d.end || null,
  });
  partsPresentation(goal, d);
}

function finish(goal) {
  const back = app.ui.draft?._returnTo;
  app.ui.draft = null;
  app.save();
  go(back || `#goal/${goal.id}`);
}

function doSave() {
  const d = app.ui.draft;
  const errs = validate(d);
  const box = document.getElementById('ed-errors');
  if (errs.length) {
    box.innerHTML = `<div class="errors">${errs.map((e) => `<div>• ${esc(e)}</div>`).join('')}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const cfg = configFromDraft(d);
  if (d.isNew) {
    const goal = {
      id: uid(), state: 'active', createdAt: new Date().toISOString(), pauses: [], parts: [],
      order: Math.max(0, ...app.state.goals.map((g) => g.order ?? 0)) + 1,
      versions: [{ ...cfg, id: uid(), from: d.start || app.today, nameSnapshot: d.name.trim() }],
    };
    applyPresentation(goal, d);
    app.state.goals.push(goal);
    toast('Goal created');
    finish(goal);
    return;
  }
  const goal = app.state.goals.find((g) => g.id === d.id);
  const current = strip(goal.versions[goal.versions.length - 1]);
  applyPresentation(goal, d);
  if (canonical(configFromDraft(draftFromGoal({ ...goal, versions: [{ ...current, from: goal.versions[0].from }] }))) === canonical(cfg)) {
    toast('Saved');
    finish(goal);
    return;
  }
  askApplyFrom(goal, cfg, current);
}

function changedOnlyUnit(a, b) {
  const x = { ...a, unit: '' }, y = { ...b, unit: '' };
  return a.unit !== b.unit && canonical(x) === canonical(y);
}

function askApplyFrom(goal, cfg, current) {
  const todayLogged = Object.keys(app.state.records).some((k) => k.startsWith(app.today + '|' + goal.id + '|'));
  const def = todayLogged ? 'tomorrow' : 'today';
  const unitOnly = changedOnlyUnit(configFromDraft(draftFromGoal({ ...goal, versions: [{ ...current, from: goal.versions[0].from }] })), cfg);
  app.ui.pending = { goalId: goal.id, cfg };
  const opt = (v, label, help) => `<label class="radio"><input type="radio" name="applyFrom" value="${v}"${v === def ? ' checked' : ''}>
    <span><b>${label}</b>${help ? `<br><span class="muted small">${help}</span>` : ''}</span></label>`;
  openSheet(`
    <div class="sheet-head"><h2>Apply this change from…</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted small">Your past days keep the settings they had at the time, so your history stays trustworthy.</p>
    <form data-submit="edApply">
      ${unitOnly ? opt('relabel', 'Just rename the unit everywhere', 'It\'s the same measurement with a new name.') : ''}
      ${opt('today', 'Today', todayLogged ? 'Today\'s entries will be judged by the new settings.' : '')}
      ${opt('tomorrow', 'Tomorrow', '')}
      ${opt('date', 'A specific date', '')}
      <input type="date" name="fromDate" value="${app.today}" class="indent">
      ${opt('all', 'All history', 'Recalculates every past day for this goal with the new settings.')}
      <button class="btn primary block" type="submit">Apply</button>
    </form>`);
}

export const editorActions = {
  edCancel() {
    const d = app.ui.draft;
    app.ui.draft = null;
    go(d?._returnTo || (d && !d.isNew ? `#goal/${d.id}` : '#goals'));
  },
  edSave() { doSave(); },
  edSet(el) {
    const d = app.ui.draft;
    const v = el.dataset.v;
    setPath(d, el.dataset.path, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
    app.render();
  },
  edScoreMode(el) {
    const d = app.ui.draft;
    d.scored = el.dataset.m !== 'off';
    d.bonus = el.dataset.m === 'bonus';
    if (d.bonus && !(Number(d.bonusPoints) > 0)) d.bonusPoints = DEFAULT_BONUS_POINTS;
    app.render();
  },
  edCat(el) {
    const d = app.ui.draft;
    d.categoryId = el.dataset.id || '';
    d._newCat = false;
    app.render();
  },
  edCatNew() {
    app.ui.draft._newCat = true;
    app.render();
    document.getElementById('ed-newcat')?.focus();
  },
  edCatCancel() {
    app.ui.draft._newCat = false;
    app.render();
  },
  edCatAdd() {
    const d = app.ui.draft;
    const inp = document.getElementById('ed-newcat');
    const name = (inp?.value || '').trim();
    if (!name) { inp?.focus(); return; }
    const existing = findCatByName(name);
    const c = existing || createCategory(name);
    if (!existing) app.save();
    d.categoryId = c.id;
    d._newCat = false;
    app.render();
    toast(existing ? `"${existing.name}" already exists — selected it` : `Category "${name}" created`);
  },
  edDay(el) {
    const s = app.ui.draft.schedule;
    const day = Number(el.dataset.d);
    s.days = s.days.includes(day) ? s.days.filter((x) => x !== day) : [...s.days, day];
    app.render();
  },
  edAddDate() {
    const inp = document.getElementById('ed-newdate');
    if (!inp?.value) return;
    const s = app.ui.draft.schedule;
    if (!s.dates.includes(inp.value)) s.dates.push(inp.value);
    app.ui.draft._newDate = addDays(inp.value, 1);
    app.render();
  },
  edRemoveDate(el) {
    const s = app.ui.draft.schedule;
    s.dates = s.dates.filter((x) => x !== el.dataset.d);
    app.render();
  },
  edOptAdd() {
    const d = app.ui.draft;
    d.parts.push(newOption(50));
    app.render();
  },
  edPartAdd() {
    const d = app.ui.draft;
    if (!d.parts.length && d.kind !== 'check') {
      // Seed the first part from the goal's own measurement.
      const p = newPart(d);
      p.kind = d.kind; p.unit = d.unit; p.precision = d.precision;
      d.parts.push(p);
    } else d.parts.push(newPart(d));
    d._partsOpen = true;
    app.render();
  },
  edPartRemove(el) {
    const d = app.ui.draft;
    d.parts.splice(Number(el.dataset.i), 1);
    app.render();
  },
  edPartMove(el) {
    const d = app.ui.draft;
    const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
    if (j < 0 || j >= d.parts.length) return;
    [d.parts[i], d.parts[j]] = [d.parts[j], d.parts[i]];
    app.render();
  },
};

export const editorSubmit = {
  edApply(form) {
    const { goalId, cfg } = app.ui.pending || {};
    const goal = app.state.goals.find((g) => g.id === goalId);
    if (!goal) return closeSheet();
    const choice = form.applyFrom.value;
    if (choice === 'relabel') {
      for (const v of goal.versions) v.unit = cfg.unit;
    } else {
      const from = { today: app.today, tomorrow: addDays(app.today, 1), date: form.fromDate.value || app.today, all: '0000-01-01' }[choice];
      if (choice === 'all' && !confirm('Recalculate all past days for this goal with the new settings?')) return;
      applyVersion(goal, { ...cfg, nameSnapshot: goal.name }, from, uid());
    }
    app.ui.pending = null;
    closeSheet();
    toast(choice === 'all' ? 'Applied to all history' : choice === 'relabel' ? 'Unit renamed' : `Applies from ${fmtDate(goal.versions[goal.versions.length - 1].from)}`);
    finish(goal);
  },
};

