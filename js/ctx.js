// Shared app context: the current state, UI state and a few UI primitives.

import { saveState } from './store.js';
import { todayStr, esc } from './util.js';

export const app = {
  state: null,
  today: todayStr(),
  ui: {
    route: 'today',
    param: null,
    date: todayStr(),
    histMonth: todayStr().slice(0, 7),
    histRange: 30,
    period: '30d',
    customFrom: null,
    customTo: null,
    expanded: {},
    draft: null,
  },
  render: () => {},
  save() { return saveState(this.state); },
  commit() { this.save(); this.render(); },
};

export function openSheet(html) {
  const el = document.getElementById('sheet');
  el.innerHTML = `<div class="sheet-backdrop" data-a="closeSheet"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true">${html}</div>`;
  el.hidden = false;
  document.body.classList.add('sheet-open');
  const first = el.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 50);
}

export function closeSheet() {
  const el = document.getElementById('sheet');
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('sheet-open');
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = esc(msg);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

export function go(hash) {
  if (location.hash === hash) app.render();
  else location.hash = hash;
}

export const PALETTE = ['#2a78d6', '#e0763a', '#2f9e7a', '#c2489b', '#8a6bd1', '#c79a1e', '#4aa3c7', '#d1504b'];
export const goalColor = (g, i = 0) => g.color || PALETTE[i % PALETTE.length];
