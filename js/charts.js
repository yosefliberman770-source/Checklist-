// Small hand-made SVG charts. Every chart is drawn from real records.

import { esc, fmtDate } from './util.js';

const W = 340;

function xScale(n, padL, padR) {
  const inner = W - padL - padR;
  return (i) => padL + (n <= 1 ? inner / 2 : (i * inner) / (n - 1));
}

// Day score over time (0–100) with a rolling average and change markers.
export function scoreLine({ points, avg, markers = [], height = 170 }) {
  const padL = 30, padR = 8, padT = 10, padB = 22;
  const n = points.length;
  const x = xScale(n, padL, padR);
  const y = (v) => padT + (1 - v / 100) * (height - padT - padB);
  const idx = Object.fromEntries(points.map((p, i) => [p.x, i]));
  let grid = '';
  for (const g of [0, 50, 100]) {
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(g)}" y2="${y(g)}" class="grid"/>
      <text x="${padL - 6}" y="${y(g) + 3}" class="axis" text-anchor="end">${g}</text>`;
  }
  let marks = '';
  for (const m of markers) {
    if (idx[m.date] == null) continue;
    const mx = x(idx[m.date]);
    marks += `<line x1="${mx}" x2="${mx}" y1="${padT}" y2="${height - padB}" class="marker"><title>${esc(m.label)}</title></line>`;
  }
  const seg = (arr, cls) => {
    let d = '', on = false;
    arr.forEach((p, i) => {
      if (p.y == null) { on = false; return; }
      d += `${on ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`;
      on = true;
    });
    return d ? `<path d="${d}" class="${cls}"/>` : '';
  };
  const dots = n <= 45 ? points.map((p, i) => (p.y == null ? '' :
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="2.6" class="dot${p.note ? ' noted' : ''}"><title>${fmtDate(p.x)}: ${Math.round(p.y)}%</title></circle>`)).join('') : '';
  const labels = n ? [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i)}" y="${height - 6}" class="axis" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${fmtDate(points[i].x, { weekday: false })}</text>`).join('') : '';
  return `<svg viewBox="0 0 ${W} ${height}" class="chart" role="img" aria-label="Day score over time">
    ${grid}${marks}${seg(points, 'line-daily')}${avg ? seg(avg, 'line-avg') : ''}${dots}${labels}</svg>`;
}

// Values per day as bars (stacked when a goal has parts), with the target
// drawn as a step line (or band for ranges).
export function valueBars({ days, fmt, height = 180 }) {
  const padL = 40, padR = 8, padT = 10, padB = 22;
  const n = days.length;
  const inner = W - padL - padR;
  const bw = Math.max(1.5, (inner / Math.max(n, 1)) * 0.7);
  const cx = (i) => padL + (inner / Math.max(n, 1)) * (i + 0.5);
  let max = 0, min = 0;
  for (const d of days) {
    const tot = d.stacks.reduce((a, s) => a + Math.max(0, s.v), 0);
    const neg = d.stacks.reduce((a, s) => a + Math.min(0, s.v), 0);
    max = Math.max(max, tot, d.target?.hi ?? 0, d.target?.lo ?? 0);
    min = Math.min(min, neg, d.target?.lo ?? 0);
  }
  if (max === min) max = min + 1;
  max *= 1.08;
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (height - padT - padB);
  let out = '';
  out += `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="grid"/>`;
  out += `<text x="${padL - 6}" y="${y(max / 1.08) + 3}" class="axis" text-anchor="end">${esc(fmt(max / 1.08))}</text>`;
  // target band / line
  days.forEach((d, i) => {
    if (!d.target) return;
    const x0 = cx(i) - inner / n / 2, x1 = cx(i) + inner / n / 2;
    if (d.target.lo != null && d.target.hi != null && d.target.lo !== d.target.hi) {
      out += `<rect x="${x0}" width="${x1 - x0}" y="${y(d.target.hi)}" height="${Math.max(0.5, y(d.target.lo) - y(d.target.hi))}" class="band"/>`;
    } else {
      const t = d.target.hi ?? d.target.lo;
      out += `<line x1="${x0}" x2="${x1}" y1="${y(t)}" y2="${y(t)}" class="target"/>`;
    }
  });
  days.forEach((d, i) => {
    let base = 0;
    for (const s of d.stacks) {
      if (!s.v) continue;
      const top = base + s.v;
      const y0 = y(Math.max(base, top)), y1 = y(Math.min(base, top));
      out += `<rect x="${cx(i) - bw / 2}" width="${bw}" y="${y0}" height="${Math.max(0.5, y1 - y0)}" fill="${s.color}" rx="1"><title>${fmtDate(d.x)}: ${esc(s.label || '')} ${esc(fmt(s.v))}</title></rect>`;
      base = top;
    }
  });
  if (n) {
    const lab = [0, n - 1].filter((v, i, a) => a.indexOf(v) === i);
    out += lab.map((i) => `<text x="${cx(i)}" y="${height - 6}" class="axis" text-anchor="${i === 0 ? 'start' : 'end'}">${fmtDate(days[i].x, { weekday: false })}</text>`).join('');
  }
  return `<svg viewBox="0 0 ${W} ${height}" class="chart" role="img" aria-label="Logged values over time">${out}</svg>`;
}

// Simple horizontal bars as HTML (labels stay crisp and wrap on phones).
export function hbars(rows, { max, fmt = (v) => v } = {}) {
  const m = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar"${r.href ? ` data-a="nav" data-href="${esc(r.href)}"` : ''}>
      <div class="hbar-label">${r.label}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(0, Math.min(100, (r.value / m) * 100)).toFixed(1)}%;${r.color ? `background:${r.color}` : ''}"></div></div>
      <div class="hbar-val">${esc(fmt(r.value))}</div>
    </div>`).join('')}</div>`;
}
