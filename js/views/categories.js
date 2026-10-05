// Categories: optional groups the user creates to organize goals.
// They only organize — they never change scores.

import { app, openSheet, closeSheet, toast } from '../ctx.js';
import { esc, uid } from '../util.js';

export const sortedCats = () => [...app.state.categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const catLabel = (c) => `${c.icon ? `${esc(c.icon)} ` : ''}${esc(c.name)}`;

const goalsIn = (id) => app.state.goals.filter((g) => g.state !== 'trash' && (g.categoryId || '') === (id || ''));

export function findCatByName(name, exceptId = null) {
  const n = name.trim().toLowerCase();
  return app.state.categories.find((c) => c.id !== exceptId && c.name.trim().toLowerCase() === n) || null;
}

export function createCategory(name, icon = '') {
  const c = { id: uid(), name: name.trim(), icon: icon.trim(), order: Math.max(-1, ...app.state.categories.map((x) => x.order ?? 0)) + 1 };
  app.state.categories.push(c);
  return c;
}

export function openCategoryList() {
  const cats = sortedCats();
  openSheet(`
    <div class="sheet-head"><h2>Categories</h2><button class="x" data-a="closeSheet" aria-label="Close">✕</button></div>
    <p class="muted small">Group your goals however you like. Categories only organize — they never change your score.</p>
    <button class="btn primary block" data-a="catNew">+ New category</button>
    <div class="cat-list">
      ${cats.map((c, i) => {
        const n = goalsIn(c.id).length;
        return `<div class="cat-item">
          <button class="cat-open" data-a="catOpen" data-id="${c.id}">
            <span class="cat-name">${catLabel(c)}</span>
            <span class="muted small">${n ? `${n} goal${n === 1 ? '' : 's'}` : 'No goals yet'} · Edit ›</span>
          </button>
          <button class="icon-btn" data-a="catMove" data-id="${c.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="icon-btn" data-a="catMove" data-id="${c.id}" data-d="1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        </div>`;
      }).join('') || '<p class="muted center small">No categories yet. Create one, then pick which goals go in it.</p>'}
    </div>
    ${cats.length > 1 ? '<p class="muted small">Use ↑ ↓ to change the order categories appear in.</p>' : ''}`);
}

export function openCategoryEditor(id = null, { fromList = true } = {}) {
  const c = id ? app.state.categories.find((x) => x.id === id) : null;
  const goals = app.state.goals.filter((g) => g.state !== 'trash').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const catsById = Object.fromEntries(app.state.categories.map((x) => [x.id, x]));
  openSheet(`
    <div class="sheet-head">
      ${fromList ? '<button class="link" data-a="catList">‹ Categories</button>' : '<span></span>'}
      <button class="x" data-a="closeSheet" aria-label="Close">✕</button>
    </div>
    <h2>${c ? 'Edit category' : 'New category'}</h2>
    <form data-submit="catSave" data-id="${c?.id || ''}">
      <div class="cat-fields">
        <label class="field cat-icon-field"><span>Icon</span>
          <input type="text" name="icon" value="${esc(c?.icon || '')}" maxlength="4" placeholder="🙂" aria-label="Icon or emoji (optional)"></label>
        <label class="field"><span>Name</span>
          <input type="text" name="name" value="${esc(c?.name || '')}" placeholder="Name it anything you like" ${c ? '' : 'autofocus'} autocomplete="off"></label>
      </div>
      <div id="cat-err"></div>
      ${goals.length ? `<div class="field"><span>Goals in this category</span>
        <p class="muted small">Tick the goals that belong here. A goal can be in one category at a time.</p>
        <div class="cat-goals">${goals.map((g) => {
          const other = g.categoryId && g.categoryId !== c?.id ? catsById[g.categoryId] : null;
          return `<label class="cat-goal"><input type="checkbox" name="goal" value="${g.id}" ${c && g.categoryId === c.id ? 'checked' : ''}>
            <span class="cat-goal-name">${esc(g.icon || '')} ${esc(g.name)}${g.state === 'archived' ? ' <span class="muted small">(archived)</span>' : ''}</span>
            ${other ? `<span class="muted small">in ${catLabel(other)}</span>` : ''}</label>`;
        }).join('')}</div></div>` : '<p class="muted small">Once you create goals you can add them here — or pick a category while creating a goal.</p>'}
      <button class="btn primary block" type="submit">${c ? 'Save' : 'Create category'}</button>
      ${c ? `<button type="button" class="btn block danger-text" data-a="catDelete" data-id="${c.id}">Delete category</button>
        <p class="muted small center">Deleting a category never deletes goals — they just become uncategorized.</p>` : ''}
    </form>`);
}

export const categoryActions = {
  catList() { openCategoryList(); },
  catNew() { openCategoryEditor(null); },
  catOpen(el) { openCategoryEditor(el.dataset.id, { fromList: el.dataset.list !== '0' }); },
  catMove(el) {
    const cats = sortedCats();
    const i = cats.findIndex((c) => c.id === el.dataset.id), j = i + Number(el.dataset.d);
    if (j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    cats.forEach((c, k) => { c.order = k; });
    app.commit();
    openCategoryList();
  },
  catDelete(el) {
    const c = app.state.categories.find((x) => x.id === el.dataset.id);
    if (!c) return;
    const n = goalsIn(c.id).length;
    if (!confirm(`Delete the category "${c.name}"?${n ? `\n\nIts ${n} goal${n === 1 ? '' : 's'} will move to Uncategorized. Goals and their history are not affected.` : ''}`)) return;
    app.state.categories = app.state.categories.filter((x) => x.id !== c.id);
    for (const g of app.state.goals) if (g.categoryId === c.id) g.categoryId = null;
    app.commit();
    toast('Category deleted');
    openCategoryList();
  },
};

export const categorySubmit = {
  catSave(form) {
    const err = form.querySelector('#cat-err');
    const name = form.name.value.trim();
    const icon = form.icon.value.trim();
    if (!name) { err.innerHTML = '<div class="errors">Give the category a name.</div>'; form.name.focus(); return; }
    const id = form.dataset.id || null;
    const dup = findCatByName(name, id);
    if (dup) { err.innerHTML = `<div class="errors">You already have a category called "${esc(dup.name)}".</div>`; form.name.focus(); return; }
    let c = id ? app.state.categories.find((x) => x.id === id) : null;
    if (c) { c.name = name; c.icon = icon; } else c = createCategory(name, icon);
    const ticked = new Set([...form.querySelectorAll('input[name="goal"]:checked')].map((x) => x.value));
    for (const g of app.state.goals) {
      if (ticked.has(g.id)) g.categoryId = c.id;
      else if (g.categoryId === c.id) g.categoryId = null;
    }
    app.commit();
    toast(id ? 'Category saved' : `Category "${name}" created`);
    closeSheet();
  },
};
