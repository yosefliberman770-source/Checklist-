// Scoring engine. Pure functions only: given goals, records and a date, it
// reproduces exactly the same result every time. History is stable because
// each goal keeps immutable versions and the engine always uses the version
// that was in effect on the date being scored.

import { addDays, diffDays, weekday, clamp, mean, median, dateRange } from './util.js';

export const ENGINE_VERSION = 2;

// Bonus goals add a fixed number of points (out of 100) when done, never a
// share of the day — so a bonus is worth the same whether you have 2 goals
// or 20. The total bonus per day is capped by a setting.
export const BONUS_SIZES = [1, 2, 3, 5, 10];
export const DEFAULT_BONUS_POINTS = 2;
export const DEFAULT_BONUS_CAP = 10;

export const WEIGHTS = [
  { label: 'Low', value: 1 },
  { label: 'Normal', value: 2 },
  { label: 'High', value: 4 },
  { label: 'Top', value: 8 },
];

export const recKey = (date, goalId, partId = '') => `${date}|${goalId}|${partId || ''}`;

// ---------- versions & schedules ----------

// Versions are sorted by `from`. A version applies from its `from` date until
// the day before the next version starts. Dates before the first version use
// the first version.
export function versionFor(goal, date) {
  const vs = goal.versions;
  let v = vs[0];
  for (const x of vs) {
    if (x.from <= date) v = x;
    else break;
  }
  return v;
}

// Replace configuration from `from` onward. Earlier versions are untouched,
// later ones are superseded. A `from` on or before the first version rewrites
// all history (only done when the user explicitly asks for it).
export function applyVersion(goal, config, from, id) {
  const first = goal.versions[0].from;
  const v = { ...config, id, from: from <= first ? first : from };
  if (from <= first) goal.versions = [v];
  else goal.versions = [...goal.versions.filter((x) => x.from < from), v];
  return goal;
}

export function inPause(goal, date) {
  return (goal.pauses || []).some((p) => p.start <= date && (!p.end || date <= p.end));
}

// Is the goal alive on this date (lifecycle + active window + pauses)?
export function isActiveOn(goal, date) {
  if (goal.state === 'trash') return false;
  if (goal.start && date < goal.start) return false;
  if (goal.end && date > goal.end) return false;
  if (goal.archivedOn && date >= goal.archivedOn) return false;
  if (inPause(goal, date)) return false;
  return true;
}

export function matchesSchedule(schedule, date, goal) {
  const s = schedule || { type: 'daily' };
  switch (s.type) {
    case 'daily': return true;
    case 'weekdays': return (s.days || []).includes(weekday(date));
    case 'interval': {
      const anchor = s.anchor || goal.start;
      const every = Math.max(1, Number(s.every) || 1);
      const d = diffDays(anchor, date);
      return d >= 0 && d % every === 0;
    }
    case 'dates': return (s.dates || []).includes(date);
    case 'anytime': return false;
    default: return false;
  }
}

export const isScheduled = (goal, date, v = versionFor(goal, date)) =>
  isActiveOn(goal, date) && matchesSchedule(v.schedule, date, goal);

// ---------- single measurement ----------

const num = (x) => (x === '' || x == null || Number.isNaN(Number(x)) ? null : Number(x));

// Apply per-weekday target overrides.
export function effectiveTarget(m, date) {
  const t = { ...(m.target || { type: 'none' }) };
  const o = m.dayTargets && date ? m.dayTargets[weekday(date)] : null;
  if (o != null && o !== '') {
    if (typeof o === 'object') {
      if (num(o.low) != null) t.low = num(o.low);
      if (num(o.high) != null) t.high = num(o.high);
    } else if (num(o) != null) t.value = num(o);
  }
  return t;
}

export function hasTarget(m) {
  return m.kind === 'check' || (m.target && m.target.type && m.target.type !== 'none');
}

// Credit for one value under one measurement config.
// credit: 0..cap (only at-least goals may exceed 1, and only with extra credit on)
// progress: value relative to target (for display; may exceed 1)
export function evaluate(m, value, date) {
  if (m.kind === 'check') {
    const met = !!value;
    return { credit: met ? 1 : 0, met, progress: met ? 1 : 0, exceeded: false, tooMuch: false, hasTarget: true };
  }
  const t = effectiveTarget(m, date);
  const v = Number(value);
  if (!t.type || t.type === 'none') {
    return { credit: null, met: false, progress: null, exceeded: false, tooMuch: false, hasTarget: false };
  }
  const all = m.credit === 'all';
  if (t.type === 'atLeast') {
    const T = num(t.value) ?? 0;
    const met = v >= T;
    const Z = num(t.zero) ?? (T > 0 ? 0 : null);
    const cap = Math.max(1, Number(m.cap) || 1);
    let credit;
    if (all || Z == null || Z >= T) credit = met ? 1 : 0;
    else credit = clamp((v - Z) / (T - Z), 0, cap);
    return { credit, met, progress: T > 0 ? v / T : met ? 1 : 0, exceeded: v > T, tooMuch: false, hasTarget: true, T };
  }
  if (t.type === 'atMost') {
    const M = num(t.value) ?? 0;
    const met = v <= M;
    const Z = num(t.zero) ?? (M > 0 ? 2 * M : null);
    let credit;
    if (all || Z == null || Z <= M) credit = met ? 1 : 0;
    else credit = clamp((Z - v) / (Z - M), 0, 1);
    return { credit, met, progress: credit, exceeded: false, tooMuch: !met, hasTarget: true, T: M };
  }
  // range and exact
  let L, U;
  if (t.type === 'exact') {
    const tol = Math.abs(num(t.tolerance) ?? 0);
    L = (num(t.value) ?? 0) - tol;
    U = (num(t.value) ?? 0) + tol;
  } else {
    L = num(t.low) ?? 0;
    U = num(t.high) ?? L;
    if (U < L) [L, U] = [U, L];
  }
  const met = v >= L && v <= U;
  let credit;
  if (all) credit = met ? 1 : 0;
  else {
    const Zl = num(t.zeroLow) ?? (L > 0 ? 0 : null);
    const Zh = num(t.zeroHigh) ?? (U > L ? U + (U - L) : null);
    const cl = v >= L ? 1 : Zl == null || Zl >= L ? 0 : clamp((v - Zl) / (L - Zl), 0, 1);
    const ch = v <= U ? 1 : Zh == null || Zh <= U ? 0 : clamp((Zh - v) / (Zh - U), 0, 1);
    credit = Math.min(cl, ch);
  }
  return { credit, met, progress: credit, exceeded: false, tooMuch: v > U, tooLittle: v < L, hasTarget: true, L, U };
}

// ---------- one goal on one day ----------

const isLogged = (r) => r && r.status === 'logged' && r.value !== null && r.value !== undefined && r.value !== '';

// Parts can be added up only when they measure the same thing.
export function partsShareUnit(parts) {
  if (!parts.length) return false;
  const k = parts[0].kind;
  const u = (parts[0].unit || '').trim().toLowerCase();
  return parts.every((p) => p.kind === k && k !== 'check' && (p.unit || '').trim().toLowerCase() === u);
}

export function totalModeAllowed(parts) {
  return partsShareUnit(parts) &&
    parts.every((p) => ['atLeast', 'none'].includes(p.target?.type || 'none'));
}

// An either/or option's worth as a fraction (stored as a percentage).
export const optionWorth = (pc) => (Number(pc.worth) > 0 ? Math.min(100, Number(pc.worth)) / 100 : 1);

export function goalDay(goal, date, records, today) {
  const v = versionFor(goal, date);
  const active = isActiveOn(goal, date);
  const scheduled = active && matchesSchedule(v.schedule, date, goal);
  const past = date < today;
  const goalRec = records[recKey(date, goal.id)];
  const base = {
    goal, version: v, date, scheduled, active,
    weight: Number(v.weight) || 0,
    scored: !!v.scored && (v.schedule?.type !== 'anytime'),
    bonus: !!v.scored && !!v.bonus,
    bonusValue: Number(v.bonusPoints) > 0 ? Number(v.bonusPoints) : DEFAULT_BONUS_POINTS,
    note: goalRec?.note || '',
  };

  const partCfgs = v.parts || [];
  if (!partCfgs.length) {
    const r = goalRec;
    const ev = isLogged(r) ? evaluate(v, r.value, date) : null;
    base.scored = base.scored && hasTarget(v);
    base.hasTarget = hasTarget(v);
    base.value = isLogged(r) ? r.value : null;
    let status;
    if (r?.status === 'excused') status = 'excused';
    else if (ev) status = 'logged';
    else status = past ? 'missed' : 'pending';
    if (!scheduled && status !== 'logged') status = 'unscheduled';
    const credit = status === 'logged' ? ev.credit : status === 'missed' || status === 'pending' ? 0 : null;
    return { ...base, ...(ev || {}), status, credit: hasTarget(v) ? credit : null, parts: [] };
  }

  // ----- goal with parts -----
  const parts = partCfgs.map((pc) => {
    const r = records[recKey(date, goal.id, pc.partId)];
    const logged = isLogged(r);
    const ev = logged ? evaluate(pc, r.value, date) : null;
    const counted = !pc.optional && hasTarget(pc);
    return {
      cfg: pc, partId: pc.partId, record: r, logged, excused: r?.status === 'excused',
      value: logged ? r.value : null, ev, counted,
      credit: !counted ? null : r?.status === 'excused' ? null : logged ? ev.credit : 0,
      T: counted && pc.kind !== 'check' ? effectiveTarget(pc, date) : null,
    };
  });
  const counted = parts.filter((p) => p.counted && !p.excused);
  const anyLogged = parts.some((p) => p.logged);
  const sameUnit = partsShareUnit(partCfgs);
  base.hasTarget = parts.some((p) => p.counted);
  base.scored = base.scored && base.hasTarget;
  base.total = sameUnit ? parts.reduce((a, p) => a + (p.logged ? Number(p.value) : 0), 0) : null;
  base.totalTarget = sameUnit ? counted.reduce((a, p) => a + (Number(p.T?.value) || 0), 0) : null;

  let credit = null, met = false, exceeded = false;
  const isChoice = v.partMode === 'best';
  if (isChoice) {
    // Either/or: do any one option; the goal earns the best option's credit
    // times that option's worth (e.g. Workout 100%, Stretch 75%).
    base.total = null;
    base.totalTarget = null;
  }
  if (counted.length) {
    if (isChoice) {
      let best = 0, bestPart = null;
      for (const p of counted) {
        const c = Math.min(1, p.credit || 0) * optionWorth(p.cfg);
        if (c > best || (c === best && !bestPart && p.logged)) { best = c; bestPart = p; }
      }
      credit = best;
      met = counted.some((p) => p.logged && p.ev?.met);
      base.chosen = bestPart && bestPart.logged ? bestPart.partId : null;
    } else if (v.partMode === 'total' && totalModeAllowed(partCfgs)) {
      const ev = evaluate(
        { kind: 'number', target: { type: 'atLeast', value: base.totalTarget }, credit: v.credit, cap: v.cap },
        base.total, null);
      credit = anyLogged ? ev.credit : 0;
      met = ev.met; exceeded = ev.exceeded;
    } else {
      const byTarget = v.partWeighting !== 'equal' && sameUnit &&
        counted.every((p) => p.T?.type === 'atLeast' && Number(p.T.value) > 0);
      let ws = 0, acc = 0;
      for (const p of counted) {
        const w = byTarget ? Number(p.T.value) : Number(p.cfg.weight) || 1;
        ws += w;
        acc += w * Math.min(1, p.credit || 0);
      }
      credit = ws ? acc / ws : 0;
      met = counted.every((p) => p.logged && p.ev.met);
      exceeded = sameUnit && base.totalTarget > 0 && base.total > base.totalTarget;
    }
  }

  let status;
  if (goalRec?.status === 'excused' || (parts.some((p) => p.counted) && !counted.length)) status = 'excused';
  else if (anyLogged) status = 'logged';
  else status = past ? 'missed' : 'pending';
  if (!scheduled && status !== 'logged') status = 'unscheduled';
  if (status === 'excused' || status === 'unscheduled') credit = null;
  const progress = sameUnit && base.totalTarget > 0 ? base.total / base.totalTarget : credit;
  return { ...base, parts, status, credit, met: status === 'logged' && met, exceeded, progress, value: base.total };
}

// ---------- the day ----------

export function dayHasData(state, date) {
  const prefix = date + '|';
  for (const k in state.records) if (k.startsWith(prefix)) return true;
  return false;
}

export function dayScore(state, date, today) {
  const day = state.days[date] || {};
  const goals = state.goals.filter((g) => g.state !== 'trash');
  const all = goals.map((g) => goalDay(g, date, state.records, today));
  const items = all.filter((i) => i.scheduled);
  const extra = all.filter((i) => !i.scheduled && i.status === 'logged');
  const res = {
    date, all, items, extra, score: null, provisional: date === today, future: date > today,
    skipped: !!day.skipped, untracked: false, weightSum: 0, earned: 0,
    scheduledCount: 0, metCount: 0, excusedCount: 0, pendingCount: 0, breakdown: [],
  };
  if (res.future) return res;
  const scoredItems = items.filter((i) => i.scored);
  const regularItems = scoredItems.filter((i) => !i.bonus);
  res.scheduledCount = regularItems.length;
  res.excusedCount = regularItems.filter((i) => i.status === 'excused').length;
  res.bonusCount = scoredItems.length - regularItems.length;
  res.bonusDone = 0;
  res.bonusPoints = 0;
  if (day.skipped) return res;
  if (state.settings.unloggedDays === 'untracked' && date < today && !dayHasData(state, date)) {
    res.untracked = true;
    return res;
  }
  // Regular goals set the scale (100%). Bonus goals only add on top of what
  // was earned, never enter the denominator, and the day stays capped at 100%.
  const counted = regularItems.filter((i) => i.status !== 'excused');
  const bonus = scoredItems.filter((i) => i.bonus && i.status === 'logged');
  const W = counted.reduce((a, i) => a + i.weight, 0);
  if (!counted.length || W <= 0) return res;
  let earned = 0, bonusRaw = 0;
  for (const i of counted) earned += i.weight * (i.credit || 0);
  for (const i of bonus) bonusRaw += i.bonusValue * Math.min(1, i.credit || 0);
  const capSetting = state.settings.bonusCap;
  const bonusCap = capSetting === 'none' ? Infinity : Number(capSetting ?? DEFAULT_BONUS_CAP);
  res.weightSum = W;
  res.earned = earned;
  res.bonusRaw = bonusRaw;
  res.bonusCap = bonusCap;
  res.bonusPoints = Math.min(bonusRaw, bonusCap);
  res.bonusDone = bonus.filter((i) => (i.credit || 0) > 0).length;
  res.score = Math.min(1, earned / W + res.bonusPoints / 100);
  res.metCount = counted.filter((i) => i.met).length;
  res.pendingCount = counted.filter((i) => i.status === 'pending').length;
  res.breakdown = counted.map((i) => ({
    goalId: i.goal.id, item: i, weight: i.weight, credit: i.credit || 0,
    share: (100 * i.weight) / W,
    contribution: (100 * i.weight * (i.credit || 0)) / W,
    lost: (100 * i.weight * (1 - Math.min(1, i.credit || 0))) / W,
  }));
  for (const i of bonus) {
    res.breakdown.push({
      goalId: i.goal.id, item: i, weight: i.weight, credit: i.credit || 0, bonus: true,
      share: i.bonusValue, contribution: i.bonusValue * Math.min(1, i.credit || 0), lost: 0,
    });
  }
  return res;
}

// ---------- periods ----------

export function periodStats(state, from, to, today) {
  const end = state.settings.includeToday ? (to > today ? today : to) : (to >= today ? addDays(today, -1) : to);
  const dates = end >= from ? dateRange(from, end) : [];
  const days = dates.map((d) => dayScore(state, d, today));
  const scored = days.filter((d) => d.score != null);
  const scores = scored.map((d) => d.score * 100);
  const threshold = Number(state.settings.goodDay) || 80;
  const perGoal = {};
  const lostTotals = {};
  for (const d of days) {
    for (const i of d.items) {
      if (!i.hasTarget) continue;
      const g = (perGoal[i.goal.id] ||= { goal: i.goal, scheduled: 0, met: 0, excused: 0, credits: [], values: [] });
      if (i.status === 'excused') { g.excused++; continue; }
      if (d.skipped || d.untracked) continue;
      g.scheduled++;
      if (i.met) g.met++;
      g.credits.push(Math.min(1, i.credit || 0));
    }
    for (const b of d.breakdown) lostTotals[b.goalId] = (lostTotals[b.goalId] || 0) + b.lost;
    for (const i of [...d.items, ...d.extra]) {
      if (i.value != null && i.status === 'logged') {
        const g = (perGoal[i.goal.id] ||= { goal: i.goal, scheduled: 0, met: 0, excused: 0, credits: [], values: [] });
        g.values.push(Number(i.value));
      }
    }
  }
  const goals = Object.values(perGoal).map((g) => ({
    ...g,
    completion: g.scheduled ? g.met / g.scheduled : null,
    avgCredit: mean(g.credits),
    lost: scored.length ? (lostTotals[g.goal.id] || 0) / scored.length : 0,
    total: g.values.reduce((a, b) => a + b, 0),
    avgValue: mean(g.values),
  }));
  const weekdayAvg = [0, 1, 2, 3, 4, 5, 6].map((wd) =>
    mean(scored.filter((d) => weekday(d.date) === wd).map((d) => d.score * 100)));
  const changes = [];
  for (const g of state.goals) {
    if (g.state === 'trash') continue;
    for (const v of g.versions.slice(1)) if (v.from >= from && v.from <= to) changes.push({ date: v.from, goal: g });
  }
  return {
    from, to, end, days,
    average: mean(scores),
    median: median(scores),
    goodDays: scores.filter((s) => s >= threshold).length,
    scoredDays: scored.length,
    totalDays: dates.length,
    skippedDays: days.filter((d) => d.skipped).length,
    untrackedDays: days.filter((d) => d.untracked).length,
    emptyDays: days.filter((d) => d.score == null && !d.skipped && !d.untracked).length,
    excusedItems: days.reduce((a, d) => a + d.excusedCount, 0),
    goals, weekdayAvg, changes,
  };
}

// Rank goals by how often they were met on the days they were scheduled
// (excused days left out). Goals with fewer than `minDays` scheduled days are
// listed last as "not enough data" rather than judged.
export function consistencyRanking(ps, prevPs = null, minDays = 3) {
  const prevById = Object.fromEntries((prevPs?.goals || []).map((g) => [g.goal.id, g]));
  const tier = (r) => (r >= 0.8 ? 'strong' : r >= 0.5 ? 'mixed' : 'weak');
  const rows = ps.goals.filter((g) => g.scheduled > 0).map((g) => {
    const p = prevById[g.goal.id];
    const enough = g.scheduled >= minDays;
    const prevRate = p && p.scheduled >= minDays ? p.met / p.scheduled : null;
    return {
      goal: g.goal, met: g.met, scheduled: g.scheduled, rate: g.met / g.scheduled, avgCredit: g.avgCredit,
      enough, tier: enough ? tier(g.met / g.scheduled) : 'few',
      prevRate, delta: enough && prevRate != null ? g.met / g.scheduled - prevRate : null,
    };
  });
  rows.sort((a, b) => (b.enough - a.enough) || (b.rate - a.rate) || ((b.avgCredit ?? 0) - (a.avgCredit ?? 0)) || (b.scheduled - a.scheduled));
  const ranked = rows.filter((r) => r.enough);
  return { rows, most: ranked[0] || null, least: ranked.length > 1 ? ranked[ranked.length - 1] : null };
}

// Rolling average over the previous n days that have a score.
export function rolling(points, n = 7) {
  return points.map((p, idx) => {
    const win = points.slice(Math.max(0, idx - n + 1), idx + 1).map((x) => x.y).filter((y) => y != null);
    return { x: p.x, y: win.length ? mean(win) : null };
  });
}
