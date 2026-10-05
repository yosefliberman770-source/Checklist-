// Boot, routing and event wiring.

import { app, closeSheet, go } from './ctx.js';
import { loadState, requestPersistence } from './store.js';
import { todayStr, esc } from './util.js';
import { renderToday, todayActions, todayChange, todayInput, todaySubmit } from './views/today.js';
import { renderEditor, editorActions, editorSubmit, editorBind, newDraft, draftFromGoal } from './views/editor.js';
import { renderGoals, renderGoalDetail, goalActions, goalSubmit, goalListRow } from './views/goals.js';
import { categoryActions, categorySubmit, renderCategoryPage } from './views/categories.js';
import { renderStats, statsActions, statsChange } from './views/stats.js';
import { renderHistory, historyActions } from './views/history.js';
import { renderSettings, settingsActions, settingsChange, applySetting, applyTheme } from './views/settings.js';

const views = {
  today: renderToday, history: renderHistory, stats: renderStats, goals: renderGoals,
  goal: renderGoalDetail, cat: () => renderCategoryPage({ goalListRow }), edit: renderEditor, new: renderEditor, settings: renderSettings,
};
const TAB_OF = { today: 'today', history: 'history', stats: 'stats', goals: 'goals', goal: 'goals', cat: 'goals', edit: 'goals', new: 'goals', settings: 'settings' };

const actions = {
  ...todayActions, ...editorActions, ...goalActions, ...categoryActions, ...statsActions, ...historyActions, ...settingsActions,
  nav: (el) => go(el.dataset.href),
  closeSheet: () => closeSheet(),
};
const submits = { ...todaySubmit, ...editorSubmit, ...goalSubmit, ...categorySubmit };
const changes = { ...todayChange, ...statsChange, ...settingsChange };

function render() {
  const view = document.getElementById('view');
  const fn = views[app.ui.route] || renderToday;
  try {
    view.innerHTML = fn();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="errors">Something went wrong showing this screen: ${esc(e.message)}</div>`;
  }
  const tab = TAB_OF[app.ui.route] || 'today';
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  document.body.dataset.route = app.ui.route;
}
app.render = render;

function onRoute() {
  const h = location.hash.replace(/^#/, '') || 'today';
  const [route, param] = h.split('/');
  const prevRoute = app.ui.route;
  if (!views[route]) { go('#today'); return; }
  if (route === 'today') app.ui.date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? (param > app.today ? app.today : param) : app.today;
  if (route === 'new' && !(app.ui.draft?.isNew)) {
    app.ui.draft = newDraft();
    if (param && app.state.categories.some((c) => c.id === param)) app.ui.draft.categoryId = param;
    if (param) app.ui.draft._returnTo = `#cat/${param}`;
  }
  if (route === 'edit') {
    const g = app.state.goals.find((x) => x.id === param);
    if (!g) { go('#goals'); return; }
    if (!app.ui.draft || app.ui.draft.id !== param) app.ui.draft = draftFromGoal(g);
  }
  if (route !== 'edit' && route !== 'new') app.ui.draft = null;
  app.ui.route = route;
  app.ui.param = param || null;
  closeSheet();
  render();
  if (prevRoute !== route || route === 'goal') window.scrollTo(0, 0);
}

function isTextual(el) {
  return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'date', 'color', 'file', 'time'].includes(el.type));
}

function wire() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.a];
    if (!fn) return;
    if (el.tagName === 'A' || el.closest('form')) e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-submit]');
    if (!form) return;
    e.preventDefault();
    submits[form.dataset.submit]?.(form);
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.closest('form[data-submit="entrySave"]')) todayInput.entryLive();
    if (el.dataset.input) todayInput[el.dataset.input]?.(el);
    if ((app.ui.route === 'edit' || app.ui.route === 'new') && isTextual(el) && (el.dataset.bind || el.closest('[data-dur]'))) editorBind(el, false);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.change) { changes[el.dataset.change]?.(el); return; }
    if (el.dataset.setting) { applySetting(el); return; }
    if ((app.ui.route === 'edit' || app.ui.route === 'new') && !isTextual(el) && el.dataset.bind) editorBind(el, true);
  });
  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (el.dataset?.toggle && app.ui.draft) app.ui.draft[el.dataset.toggle] = el.open;
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('sheet').hidden) closeSheet();
    if (e.key === 'Enter' && e.target.id === 'ed-newcat') { e.preventDefault(); editorActions.edCatAdd(); }
  });
  window.addEventListener('hashchange', onRoute);
  // Roll over to the new day when the app comes back after midnight.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const t = todayStr();
    if (t !== app.today) {
      const wasToday = app.ui.date === app.today;
      app.today = t;
      if (wasToday) app.ui.date = t;
      render();
    }
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          const el = document.getElementById('toast');
          el.innerHTML = 'A new version is ready. <button class="link" onclick="location.reload()">Reload</button>';
          el.hidden = false;
        }
      });
    });
  }).catch(() => {});
}

async function boot() {
  app.state = await loadState();
  app.today = todayStr();
  app.ui.date = app.today;
  applyTheme();
  wire();
  onRoute();
  registerSW();
  requestPersistence();
}

boot();

