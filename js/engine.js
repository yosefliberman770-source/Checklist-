// Scoring engine. Pure functions only: given goals, records and a date, it
// reproduces exactly the same result every time. History is stable because
// each goal keeps immutable versions and the engine always uses the version
// that was in effect on the date being scored.

import { addDays, diffDays, weekday, clamp, mean, median, dateRange, startOfWeek } from './util.js';

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

// Difficulty is opt-in and separate from importance: a goal's points in the
// day are importance × difficulty, so a low-priority but hard goal can be
// worth more than an easy one.
export const DIFFICULTIES = [
  { label: 'Easy', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Hard', value: 1.5 },
  { label: 'Very hard', value: 2 },
];
export const difficultyOf = (v) => (Number(v.difficulty) > 0 ? Number(v.difficulty) : 1);

// Points: every goal is worth its own points, plus extra points for being
// hard. In "points" scoring the day is the points earned toward a daily
// target (default 100) — skipped tasks simply add nothing. In "percent"
// scoring the same points act as relative weights of what was due.
// Goals saved before points existed derive them: importance level × 5
// (Low 5 · Normal 10 · High 20 · Top 40) and the old difficulty multiplier.
export const POINT_LEVELS = [
  { label: 'Low', value: 5 },
  { label: 'Normal', value: 10 },
  { label: 'High', value: 20 },
  { label: 'Top', value: 40 },
];
export const EXTRA_LEVELS = [
  { label: 'Normal', value: 0 },
  { label: 'Hard', value: 5 },
  { label: 'Very hard', value: 10 },
];
export const DEFAULT_DAILY_TARGET = 100;
export const basePoints = (v) => (Number(v.points) > 0 ? Number(v.points) : (Number(v.weight) > 0 ? Number(v.weight) : 2) * 5);
export const extraPoints = (v) => (v.extraPoints !== undefined && v.extraPoints !== '' && v.extraPoints !== null
  ? Math.max(0, Number(v.extraPoints) || 0)
  : (difficultyOf(v) - 1) * basePoints(v));
export const goalPoints = (v) => Math.max(0, basePoints(v) + extraPoints(v));
export const scoringMode = (settings) => (settings?.scoring === 'points' ? 'points' : 'percent');
export const dailyTarget = (settings) => (Number(settings?.dailyTarget) > 0 ? Number(settings.dailyTarget) : DEFAULT_DAILY_TARGET);

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
    // "N days a week, any days": a candidate every day; goalDay decides from
    // what's already been done this week.
    case 'weekly': return true;
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

// An either/or option's worth as a fraction (stored as a percentage). Over
// 100% is extra credit: it can make up for other goals that day, while the
// day itself still tops out at 100%.
export const MAX_OPTION_WORTH = 200;
export const optionWorth = (pc) => (pc.worth === '' || pc.worth == null || Number.isNaN(Number(pc.worth))
  ? 1 : clamp(Number(pc.worth), 0, MAX_OPTION_WORTH) / 100);
// Fixed bonus points an option adds when done (on top of the goal's credit).
export const optionBonus = (pc) => (Number(pc.bonusPoints) > 0 ? Number(pc.bonusPoints) : 0);

// One goal on one day. Weekly-quota goals ("3 days a week, any days") are
// available every day until done N times that week; days they aren't done
// never count against you, and once the quota is met they step aside.
export function goalDay(goal, date, records, today, opts = {}) {
  const res = goalDayBase(goal, date, records, today);
  const sched = res.version.schedule;
  if (sched?.type !== 'weekly' || opts.ignoreWeekly || !res.active) return res;
  const times = Math.max(1, Math.min(7, Number(sched.times) || 1));
  const doneOn = (r) => r.status === 'logged' && (r.credit == null ? r.value != null : r.credit > 0);
  let before = 0;
  for (let d = startOfWeek(date, opts.weekStart ?? 1); d < date; d = addDays(d, 1)) {
    const prev = goalDayBase(goal, d, records, today);
    if (prev.active && doneOn(prev)) before++;
  }
  const doneToday = doneOn(res);
  res.weekly = { times, before, done: before + (doneToday ? 1 : 0) };
  if (before >= times) {
    // Quota already met this week: extra logs are kept but not scored.
    res.scheduled = false;
    res.weekly.complete = true;
    if (!doneToday) { res.status = 'unscheduled'; res.credit = null; }
  } else if (!doneToday) {
    // Still available (today or when logging a past day late) — never "missed".
    res.weeklyOptional = true;
    if (res.status === 'missed') res.status = 'pending';
  }
  return res;
}

function goalDayBase(goal, date, records, today) {
  const v = versionFor(goal, date);
  const active = isActiveOn(goal, date);
  const scheduled = active && matchesSchedule(v.schedule, date, goal);
  const past = date < today;
  const goalRec = records[recKey(date, goal.id)];
  const base = {
    goal, version: v, date, scheduled, active,
    weight: goalPoints(v),
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
      met = counted.some((p) => p.logged && p.ev?.met && optionWorth(p.cfg) > 0);
      exceeded = best > 1;
      // Every option done adds its fixed bonus points (partial progress → part of them).
      base.optionBonuses = counted.filter((p) => p.logged && optionBonus(p.cfg) > 0)
        .map((p) => ({ partId: p.partId, points: optionBonus(p.cfg) * Math.min(1, p.credit || 0) }))
        .filter((b) => b.points > 0);
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

// The day is a checklist: every task due that day counts the same, and the
// day's progress is how many were done (target reached). Partial progress is
// shown on the task but a task only counts once it's done. Tasks not done
// on optional days (weekly "any days" tasks) and excused tasks don't count.
export function dayScore(state, date, today) {
  const day = state.days[date] || {};
  const goals = state.goals.filter((g) => g.state !== 'trash');
  const all = goals.map((g) => goalDay(g, date, state.records, today, { weekStart: state.settings.weekStart }));
  const items = all.filter((i) => i.scheduled);
  const extra = all.filter((i) => !i.scheduled && i.status === 'logged');
  const res = {
    date, all, items, extra, score: null, provisional: date === today, future: date > today,
    skipped: !!day.skipped, untracked: false,
    dueCount: 0, doneCount: 0, scheduledCount: 0, metCount: 0, excusedCount: 0, pendingCount: 0, breakdown: [],
  };
  if (res.future) return res;
  const counting = items.filter((i) => i.scored);
  res.excusedCount = counting.filter((i) => i.status === 'excused').length;
  if (day.skipped) return res;
  if (state.settings.unloggedDays === 'untracked' && date < today && !dayHasData(state, date)) {
    res.untracked = true;
    return res;
  }
  const due = counting.filter((i) => i.status !== 'excused' && !(i.weeklyOptional && !i.met));
  if (!due.length) return res;
  const done = due.filter((i) => i.met);
  res.dueCount = res.scheduledCount = due.length;
  res.doneCount = res.metCount = done.length;
  res.pendingCount = due.filter((i) => !i.met && (i.status === 'pending' || date === today)).length;
  res.score = done.length / due.length;
  res.breakdown = due.map((i) => ({
    goalId: i.goal.id, item: i, done: !!i.met,
    share: 100 / due.length, contribution: i.met ? 100 / due.length : 0, lost: i.met ? 0 : 100 / due.length,
  }));
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
      if (!i.hasTarget || i.weeklyOptional) continue;
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
    perfectDays: scores.filter((s) => s >= 99.999).length,
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
