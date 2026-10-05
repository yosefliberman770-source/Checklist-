// Small shared helpers. Dates are always local calendar dates as 'YYYY-MM-DD'
// strings; date math is done in UTC so daylight-saving never shifts a day.

export const pad = (n) => String(n).padStart(2, '0');

export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fmtUTC(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const addDays = (s, n) => fmtUTC(parseDate(s) + n * 86400000);

// Number of days from a to b (positive when b is later).
export const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

// 0 = Sunday … 6 = Saturday
export const weekday = (s) => new Date(parseDate(s)).getUTCDay();

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfWeek(s, weekStart = 1) {
  const back = (weekday(s) - weekStart + 7) % 7;
  return addDays(s, -back);
}

export const startOfMonth = (s) => s.slice(0, 8) + '01';

export function endOfMonth(s) {
  const [y, m] = s.split('-').map(Number);
  return fmtUTC(Date.UTC(y, m, 0));
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function fmtDate(s, { weekday: wd = true, year = false } = {}) {
  const [y, m, d] = s.split('-').map(Number);
  let out = `${MONTHS[m - 1]} ${d}`;
  if (wd) out = `${DAY_SHORT[weekday(s)]}, ${out}`;
  if (year) out += `, ${y}`;
  return out;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export const deepClone = (x) => JSON.parse(JSON.stringify(x));

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
