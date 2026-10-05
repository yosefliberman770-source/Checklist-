import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, goalDay, dayScore, applyVersion, isScheduled, periodStats, recKey } from '../js/engine.js';

const TODAY = '2026-10-05'; // a Monday
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

function goal(id, cfg, extra = {}) {
  return {
    id, name: id, state: 'active', start: '2026-01-01', pauses: [], parts: [],
    versions: [{ id: id + 'v1', from: '2026-01-01', scored: true, weight: 2, credit: 'partial', cap: 1,
      schedule: { type: 'daily' }, ...cfg }],
    ...extra,
  };
}
const st = (goals, records = {}, settings = {}) => ({
  goals, records, days: {}, settings: { goodDay: 80, unloggedDays: 'missed', includeToday: false, ...settings },
});
const rec = (value, status = 'logged') => ({ value, status });

test('missing entry on an at-most goal is a miss, not a perfect zero', () => {
  const g = goal('coffee', { kind: 'number', target: { type: 'atMost', value: 2 } });
  const past = goalDay(g, '2026-10-01', {}, TODAY);
  assert.equal(past.status, 'missed');
  assert.equal(past.credit, 0);
  const today = goalDay(g, TODAY, {}, TODAY);
  assert.equal(today.status, 'pending');
});

test('logged values above and below target', () => {
  const m = { kind: 'number', target: { type: 'atLeast', value: 20 }, credit: 'partial', cap: 1 };
  close(evaluate(m, 10).credit, 0.5);
  assert.equal(evaluate(m, 30).credit, 1);
  assert.equal(evaluate(m, 30).exceeded, true);
  close(evaluate({ ...m, cap: 1.5 }, 25).credit, 1.25);
  close(evaluate({ ...m, cap: 1.5 }, 100).credit, 1.5);
  assert.equal(evaluate({ ...m, credit: 'all' }, 19).credit, 0);
  // workout 10 min, did 20
  const w = { kind: 'duration', target: { type: 'atLeast', value: 10 }, credit: 'partial', cap: 1 };
  assert.equal(evaluate(w, 20).progress, 2);
  assert.equal(evaluate(w, 20).credit, 1);
});

test('sleep: at least 8h vs range 7-9h', () => {
  const atLeast = { kind: 'duration', target: { type: 'atLeast', value: 480 }, credit: 'partial', cap: 1 };
  close(evaluate(atLeast, 390).credit, 390 / 480);
  assert.equal(evaluate(atLeast, 570).exceeded, true);
  const range = { kind: 'duration', target: { type: 'range', low: 420, high: 540, zeroLow: 300 }, credit: 'partial' };
  close(evaluate(range, 390).credit, 0.75);
  const over = evaluate(range, 570);
  close(over.credit, 0.75); // zero credit at 11h by default
  assert.equal(over.tooMuch, true);
  assert.equal(evaluate(range, 480).met, true);
});

test('zero and negative targets', () => {
  assert.equal(evaluate({ kind: 'number', target: { type: 'atMost', value: 0 } }, 0).credit, 1);
  assert.equal(evaluate({ kind: 'number', target: { type: 'atMost', value: 0 } }, 1).credit, 0);
  close(evaluate({ kind: 'number', target: { type: 'atMost', value: 0, zero: 4 } }, 1).credit, 0.75);
  assert.equal(evaluate({ kind: 'number', target: { type: 'atLeast', value: -5 } }, -3).credit, 1);
  assert.equal(evaluate({ kind: 'number', target: { type: 'atLeast', value: -5 } }, -6).credit, 0);
  close(evaluate({ kind: 'number', target: { type: 'atLeast', value: -5, zero: -10 } }, -6).credit, 0.8);
  assert.equal(evaluate({ kind: 'number', target: { type: 'exact', value: 8 }, credit: 'all' }, 8).credit, 1);
});

test('per-weekday target override', () => {
  const m = { kind: 'number', target: { type: 'atLeast', value: 20 }, dayTargets: { 0: 10, 6: 10 } };
  assert.equal(evaluate(m, 10, '2026-10-04').credit, 1); // Sunday
  close(evaluate(m, 10, '2026-10-05').credit, 0.5); // Monday
});

function reading(mode, weighting = 'target') {
  return goal('read', {
    kind: 'number', partMode: mode, partWeighting: weighting,
    parts: [
      { partId: 'f', kind: 'number', unit: 'pages', target: { type: 'atLeast', value: 20 }, credit: 'partial' },
      { partId: 'n', kind: 'number', unit: 'pages', target: { type: 'atLeast', value: 10 }, credit: 'partial' },
      { partId: 'h', kind: 'number', unit: 'pages', target: { type: 'atLeast', value: 12 }, credit: 'partial' },
      { partId: 'r', kind: 'number', unit: 'pages', target: { type: 'atLeast', value: 6 }, credit: 'partial' },
    ],
  });
}
const D = '2026-10-04';
const readRecs = {
  [recKey(D, 'read', 'f')]: rec(30), [recKey(D, 'read', 'n')]: rec(10),
  [recKey(D, 'read', 'h')]: rec(0), [recKey(D, 'read', 'r')]: rec(6),
};

test('parts: each part counts = 75%, total only = 96%', () => {
  const each = goalDay(reading('each'), D, readRecs, TODAY);
  close(each.credit, 36 / 48);
  assert.equal(each.total, 46);
  assert.equal(each.totalTarget, 48);
  const total = goalDay(reading('total'), D, readRecs, TODAY);
  close(total.credit, 46 / 48);
});

test('parts: excusing a part removes it from the calculation', () => {
  const recs = { ...readRecs, [recKey(D, 'read', 'h')]: rec(null, 'excused') };
  const r = goalDay(reading('each'), D, recs, TODAY);
  close(r.credit, 1);
  assert.equal(r.met, true);
});

test('parts: unlogged part counts as zero once any part is logged', () => {
  const recs = { [recKey(D, 'read', 'f')]: rec(20) };
  close(goalDay(reading('each'), D, recs, TODAY).credit, 20 / 48);
  assert.equal(goalDay(reading('each'), D, {}, TODAY).status, 'missed');
});

test('versions keep history stable', () => {
  const g = goal('read', { kind: 'number', target: { type: 'atLeast', value: 20 } });
  const recs = { [recKey('2026-09-01', 'read')]: rec(20), [recKey('2026-10-05', 'read')]: rec(20) };
  const cfg = { ...g.versions[0], target: { type: 'atLeast', value: 40 } };
  delete cfg.id; delete cfg.from;
  applyVersion(g, cfg, '2026-10-05', 'v2');
  assert.equal(g.versions.length, 2);
  assert.equal(goalDay(g, '2026-09-01', recs, TODAY).credit, 1);
  close(goalDay(g, '2026-10-05', recs, '2026-10-06').credit, 0.5);
  applyVersion(g, cfg, '0000-01-01', 'v3'); // all history
  assert.equal(g.versions.length, 1);
  close(goalDay(g, '2026-09-01', recs, TODAY).credit, 0.5);
});

test('schedules, pauses, archive and unscheduled days', () => {
  const g = goal('gym', { kind: 'check', schedule: { type: 'weekdays', days: [1, 3, 5] } });
  assert.equal(isScheduled(g, '2026-10-05'), true); // Mon
  assert.equal(isScheduled(g, '2026-10-06'), false); // Tue
  g.pauses = [{ start: '2026-10-05', end: '2026-10-07' }];
  assert.equal(isScheduled(g, '2026-10-05'), false);
  g.pauses = [];
  g.archivedOn = '2026-10-01';
  assert.equal(isScheduled(g, '2026-10-05'), false);
  assert.equal(isScheduled(g, '2026-09-28'), true);
  const iv = goal('iv', { kind: 'check', schedule: { type: 'interval', every: 3, anchor: '2026-10-01' } });
  assert.equal(isScheduled(iv, '2026-10-04'), true);
  assert.equal(isScheduled(iv, '2026-10-05'), false);
});

test('days without scored goals, skipped days and untracked days are null', () => {
  const info = goal('weight', { kind: 'number', target: { type: 'none' } });
  assert.equal(dayScore(st([info]), '2026-10-01', TODAY).score, null);
  const c = goal('c', { kind: 'check' });
  const s = st([c]);
  s.days['2026-10-01'] = { skipped: true };
  assert.equal(dayScore(s, '2026-10-01', TODAY).score, null);
  assert.equal(dayScore(s, '2026-10-02', TODAY).score, 0);
  s.settings.unloggedDays = 'untracked';
  assert.equal(dayScore(s, '2026-10-02', TODAY).score, null);
});

test('excused goals leave both sides of the fraction', () => {
  const a = goal('a', { kind: 'check' });
  const b = goal('b', { kind: 'check' });
  const recs = { [recKey(D, 'a')]: rec(true), [recKey(D, 'b')]: rec(null, 'excused') };
  assert.equal(dayScore(st([a, b], recs), D, TODAY).score, 1);
});

test('period average is the mean of daily scores', () => {
  const a = goal('a', { kind: 'check' });
  const recs = { [recKey('2026-10-01', 'a')]: rec(true), [recKey('2026-10-03', 'a')]: rec(true) };
  const p = periodStats(st([a], recs), '2026-10-01', '2026-10-04', TODAY);
  close(p.average, 50);
  assert.equal(p.goodDays, 2);
  assert.equal(p.scoredDays, 4);
  assert.equal(p.goals[0].completion, 0.5);
});

test('consistency ranking: most to least consistent, with too-little-data last', async () => {
  const { consistencyRanking } = await import('../js/engine.js');
  const a = goal('a', { kind: 'check' });
  const b = goal('b', { kind: 'check' });
  const c = goal('c', { kind: 'check', schedule: { type: 'dates', dates: ['2026-10-02'] } });
  const recs = {};
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']) recs[recKey(d, 'a')] = rec(true);
  recs[recKey('2026-10-01', 'b')] = rec(true);
  recs[recKey('2026-10-02', 'b')] = rec(null, 'excused');
  recs[recKey('2026-10-02', 'c')] = rec(true);
  const s = st([a, b, c], recs);
  const p = periodStats(s, '2026-10-01', '2026-10-04', TODAY);
  const prev = periodStats(s, '2026-09-27', '2026-09-30', TODAY);
  const r = consistencyRanking(p, prev);
  assert.deepEqual(r.rows.map((x) => x.goal.id), ['a', 'b', 'c']);
  assert.equal(r.most.goal.id, 'a');
  assert.equal(r.least.goal.id, 'b');
  close(r.rows[1].rate, 1 / 3); // excused day left out
  assert.equal(r.rows[2].tier, 'few');
  assert.equal(r.rows[0].tier, 'strong');
  close(r.rows[0].delta, 1); // 0% in the previous 4 days → 100% now
});

test('either/or goal: best option times its worth', () => {
  const ex = goal('ex', {
    kind: 'number', partMode: 'best',
    parts: [
      { partId: 'w', kind: 'duration', target: { type: 'atLeast', value: 10 }, credit: 'partial', worth: 100 },
      { partId: 's', kind: 'duration', target: { type: 'atLeast', value: 10 }, credit: 'partial', worth: 75 },
    ],
  });
  const D2 = '2026-10-03';
  close(goalDay(ex, D, { [recKey(D, 'ex', 'w')]: rec(10) }, TODAY).credit, 1);
  const st2 = goalDay(ex, D, { [recKey(D, 'ex', 's')]: rec(10) }, TODAY);
  close(st2.credit, 0.75);
  assert.equal(st2.met, true);
  assert.equal(st2.chosen, 's');
  // half a workout (50%) loses to a full stretch (75%)
  close(goalDay(ex, D, { [recKey(D, 'ex', 'w')]: rec(5), [recKey(D, 'ex', 's')]: rec(10) }, TODAY).credit, 0.75);
  // nothing done on a past day = missed
  const none = goalDay(ex, D2, {}, TODAY);
  assert.equal(none.status, 'missed');
  assert.equal(none.credit, 0);
  // in the checklist, doing any option makes the task done
  const a = goal('a', { kind: 'check' });
  const ds = dayScore(st([a, ex], { [recKey(D, 'a')]: rec(true), [recKey(D, 'ex', 's')]: rec(10) }), D, TODAY);
  assert.equal(ds.doneCount, 2);
  assert.equal(ds.dueCount, 2);
});

test('weekly quota: available until done N times, missed days never count', () => {
  // week of Mon 2026-09-28 .. Sun 2026-10-04; today is Mon 2026-10-05
  const gym = goal('gym', { kind: 'check', points: 10, schedule: { type: 'weekly', times: 2 } });
  const recs = { [recKey('2026-09-29', 'gym')]: rec(true), [recKey('2026-10-01', 'gym')]: rec(true), [recKey('2026-10-02', 'gym')]: rec(true) };
  const o = { weekStart: 1 };
  const mon = goalDay(gym, '2026-09-28', recs, TODAY, o);                          // not done, past: available, no penalty
  assert.equal(mon.weeklyOptional, true);
  assert.equal(mon.status, 'pending');
  assert.equal(goalDay(gym, '2026-09-29', recs, TODAY, o).scheduled, true);       // 1st
  assert.equal(goalDay(gym, '2026-10-01', recs, TODAY, o).scheduled, true);       // 2nd
  const third = goalDay(gym, '2026-10-02', recs, TODAY, o);                        // quota met: extra, not scored
  assert.equal(third.scheduled, false);
  assert.equal(third.weekly.complete, true);
  assert.equal(goalDay(gym, '2026-10-03', recs, TODAY, o).status, 'unscheduled');
  // new week: available again today
  const today = goalDay(gym, TODAY, recs, TODAY, o);
  assert.equal(today.scheduled, true);
  assert.equal(today.weeklyOptional, true);
  // checklist: counts on the days it's done; skipped days and extras don't count
  const s = st([gym], recs, { weekStart: 1 });
  assert.equal(dayScore(s, '2026-09-29', TODAY).doneCount, 1);
  assert.equal(dayScore(s, '2026-09-28', TODAY).score, null);
  assert.equal(dayScore(s, '2026-10-02', TODAY).score, null);
  // an undone weekly task doesn't count against today
  const a = goal('a', { kind: 'check' });
  const s2 = st([a, gym], { ...recs, [recKey(TODAY, 'a')]: rec(true) }, { weekStart: 1 });
  assert.equal(dayScore(s2, TODAY, TODAY).score, 1);
});

test('weekly quota: optional days are not counted as misses in stats', () => {
  const gym = goal('gym', { kind: 'check', schedule: { type: 'weekly', times: 2 } });
  const recs = { [recKey('2026-09-29', 'gym')]: rec(true), [recKey('2026-10-01', 'gym')]: rec(true) };
  const p = periodStats(st([gym], recs, { weekStart: 1 }), '2026-09-28', '2026-10-04', TODAY);
  const g = p.goals.find((x) => x.goal.id === 'gym');
  assert.equal(g.scheduled, 2);
  assert.equal(g.met, 2);
});

test('checklist: the day is how many due tasks were done, each counts the same', () => {
  const a = goal('a', { kind: 'check', weight: 8 });
  const b = goal('b', { kind: 'check', weight: 1 });
  const c = goal('c', { kind: 'number', target: { type: 'atLeast', value: 20 } });
  const recs = { [recKey(D, 'a')]: rec(true), [recKey(D, 'c')]: rec(10) }; // c only halfway
  const ds = dayScore(st([a, b, c], recs), D, TODAY);
  assert.equal(ds.dueCount, 3);
  assert.equal(ds.doneCount, 1);          // partial progress isn't "done"
  close(ds.score, 1 / 3);
  recs[recKey(D, 'c')] = rec(25);
  assert.equal(dayScore(st([a, b, c], recs), D, TODAY).doneCount, 2);
  // old bonus goals now count as ordinary tasks
  const x = goal('x', { kind: 'check', bonus: true });
  assert.equal(dayScore(st([a, x], recs), D, TODAY).dueCount, 2);
  // "not counted" goals stay out
  const t = goal('t', { kind: 'check', scored: false });
  assert.equal(dayScore(st([a, t], recs), D, TODAY).dueCount, 1);
});
