// Turning numbers and configuration into words the user reads.

import { effectiveTarget, WEIGHTS, DIFFICULTIES } from './engine.js';
import { DAY_SHORT, fmtDate } from './util.js';

export function fmtDur(min) {
  if (min == null || min === '' || Number.isNaN(Number(min))) return '—';
  const neg = min < 0;
  const total = Math.round(Math.abs(Number(min)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const s = h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
  return neg ? '−' + s : s;
}

export function fmtNum(v, precision = 2) {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
  const n = Number(Number(v).toFixed(Math.max(0, Math.min(6, precision ?? 2))));
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'M';
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export const unitOf = (m) => (m.unit || '').trim();

// Value with its unit, e.g. "12 pages", "6h 30m", "Done".
export function fmtValue(v, m, { unit = true } = {}) {
  if (m.kind === 'check') return v ? 'Done' : 'Not done';
  if (v == null || v === '') return '—';
  if (m.kind === 'duration') return fmtDur(v);
  const u = unitOf(m);
  return fmtNum(v, m.precision) + (unit && u ? (u === '%' ? '%' : ' ' + u) : '');
}

export function targetText(m, date) {
  if (m.kind === 'check') return 'Done';
  const t = date ? effectiveTarget(m, date) : (m.target || {});
  const f = (x) => fmtValue(x, m);
  switch (t.type) {
    case 'atLeast': return `at least ${f(t.value)}`;
    case 'atMost': return `no more than ${f(t.value)}`;
    case 'range': return `${f(t.low)} – ${f(t.high)}`;
    case 'exact': return `exactly ${f(t.value)}${Number(t.tolerance) ? ` (± ${fmtValue(t.tolerance, m)})` : ''}`;
    default: return 'no target';
  }
}

// Short target for a goal row: "/ 20 pages", "≤ 2h"
export function targetShort(m, date) {
  if (m.kind === 'check') return '';
  const t = date ? effectiveTarget(m, date) : (m.target || {});
  const f = (x) => fmtValue(x, m);
  switch (t.type) {
    case 'atLeast': return `/ ${f(t.value)}`;
    case 'atMost': return `≤ ${f(t.value)}`;
    case 'range': return `${f(t.low)}–${f(t.high)}`;
    case 'exact': return `= ${f(t.value)}`;
    default: return m.unit ? m.unit : '';
  }
}

export const difficultyLabel = (v) => DIFFICULTIES.find((x) => x.value === Number(v))?.label || `×${v}`;

export function weightLabel(w) {
  const hit = WEIGHTS.find((x) => x.value === Number(w));
  return hit ? hit.label : `Custom (${w})`;
}

export function scheduleText(s) {
  if (!s) return 'every day';
  switch (s.type) {
    case 'daily': return 'every day';
    case 'weekdays': {
      const d = [...(s.days || [])].sort();
      if (d.join() === '1,2,3,4,5') return 'on weekdays';
      if (d.join() === '0,6') return 'on weekends';
      if (!d.length) return 'on no days (pick some days)';
      return 'on ' + d.map((x) => DAY_SHORT[x]).join(', ');
    }
    case 'interval': return Number(s.every) > 1 ? `every ${s.every} days` : 'every day';
    case 'dates': {
      const n = (s.dates || []).length;
      if (n === 1) return `on ${fmtDate(s.dates[0], { year: true })}`;
      return `on ${n} chosen dates`;
    }
    case 'anytime': return 'whenever you log it (not scheduled)';
    default: return '';
  }
}

// The plain-language sentence shown on every goal.
export function describe(cfg, { includeWeight = true } = {}) {
  const parts = cfg.parts || [];
  let what;
  if (parts.length && cfg.partMode === 'best') {
    what = 'Either/or: ' + (parts.map((p) => {
      const tags = [];
      if (p.worth !== undefined && p.worth !== '' && Number(p.worth) !== 100) tags.push(`${p.worth}%`);
      if (Number(p.bonusPoints) > 0) tags.push(`+${p.bonusPoints} bonus`);
      return `${p.name || '…'}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    }).join(' or '));
  } else if (parts.length) {
    const names = parts.map((p) => p.name).filter(Boolean);
    what = `${parts.length} part${parts.length > 1 ? 's' : ''}${names.length ? ` (${names.join(', ')})` : ''}`;
  } else if (cfg.kind === 'check') what = 'Mark it done';
  else {
    const t = targetText(cfg);
    what = t === 'no target' ? `Track ${cfg.kind === 'duration' ? 'time' : unitOf(cfg) || 'a number'} (no target)` : cap(t);
  }
  const bits = [`${what} ${scheduleText(cfg.schedule)}`];
  if (parts.length && cfg.partMode !== 'best') bits.push(cfg.partMode === 'total' ? 'only the total counts' : 'each part counts');
  const overrides = Object.entries(cfg.dayTargets || {}).filter(([, v]) => v !== '' && v != null);
  if (overrides.length && !parts.length) bits.push(`different target on ${overrides.map(([d]) => DAY_SHORT[d]).join(', ')}`);
  if (!parts.length && cfg.kind !== 'check' && cfg.target?.type !== 'none') {
    bits.push(cfg.credit === 'all' ? 'all or nothing' : 'partial credit');
    if (cfg.target?.type === 'atLeast' && Number(cfg.cap) > 1) bits.push(`extra credit up to ${Math.round(cfg.cap * 100)}%`);
  }
  const scoredPossible = cfg.schedule?.type !== 'anytime' &&
    (parts.length ? parts.some((p) => !p.optional && (p.kind === 'check' || p.target?.type !== 'none')) :
      cfg.kind === 'check' || cfg.target?.type !== 'none');
  if (!cfg.scored || !scoredPossible) bits.push('not in score');
  else if (cfg.bonus) bits.push(`⭐ bonus +${Number(cfg.bonusPoints) > 0 ? cfg.bonusPoints : 2}`);
  else if (includeWeight) {
    const dif = Number(cfg.difficulty) > 0 ? Number(cfg.difficulty) : 1;
    bits.push(`importance: ${weightLabel(cfg.weight)}${dif !== 1 ? ` · ${difficultyLabel(dif).toLowerCase()} (×${dif === 0.5 ? '½' : dif})` : ''}`);
  }
  return bits.join(' · ');
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const pct = (x, digits = 0) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`);
export const pct100 = (x, digits = 0) => (x == null ? '—' : `${Number(x).toFixed(digits)}%`);

export function statusLabel(i) {
  if (i.status === 'excused') return { text: 'Excused', cls: 'excused' };
  if (i.status === 'missed') return i.bonus ? { text: 'Skipped', cls: 'pending' } : { text: 'Missed', cls: 'missed' };
  if (i.status === 'pending') return { text: '', cls: 'pending' };
  if (i.status === 'unscheduled') return { text: '', cls: 'pending' };
  if (i.hasTarget === false) return { text: 'Logged', cls: 'logged' };
  if (i.tooMuch) return { text: 'Too much', cls: 'over' };
  if (i.exceeded) return { text: 'Exceeded', cls: 'exceeded' };
  if (i.met) return { text: 'Met', cls: 'met' };
  const c = i.credit ?? 0;
  if (c <= 0) return { text: 'No progress', cls: 'missed' };
  if (c < 0.5) return { text: 'Started', cls: 'partial' };
  if (c < 0.9) return { text: 'Partial', cls: 'partial' };
  return { text: 'Nearly there', cls: 'partial' };
}
