// Local-first persistence. The whole state lives in IndexedDB on the device
// (falling back to localStorage). Nothing is sent anywhere.

import { ENGINE_VERSION, recKey } from './engine.js';
import { todayStr, addDays, uid } from './util.js';

const DB_NAME = 'my-day';
const STORE = 'kv';
const KEY = 'state';
export const SCHEMA_VERSION = 1;

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    settings: {
      weekStart: 1,
      goodDay: 80,
      unloggedDays: 'missed',
      includeToday: false,
      groupByCategory: true,
      theme: 'auto',
      reminderTime: '21:00',
      lastBackup: null,
      bonusCap: 10,
      scoring: 'points',
      dailyTarget: 100,
    },
    categories: [],
    goals: [],
    records: {},
    days: {},
    collapsed: {},
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ||= openDB());

export async function loadState() {
  let raw = null;
  try {
    const d = await db();
    raw = await new Promise((resolve, reject) => {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    try { raw = JSON.parse(localStorage.getItem(DB_NAME) || 'null'); } catch { raw = null; }
  }
  return migrate(raw || defaultState());
}

let writing = Promise.resolve();
export function saveState(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  writing = writing.then(async () => {
    try {
      const d = await db();
      await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(snapshot, KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      try { localStorage.setItem(DB_NAME, JSON.stringify(snapshot)); } catch { /* storage full */ }
    }
  });
  return writing;
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}

export function migrate(s) {
  const base = defaultState();
  s.settings = { ...base.settings, ...(s.settings || {}) };
  s.categories ||= [];
  s.goals ||= [];
  s.records ||= {};
  s.days ||= {};
  s.collapsed ||= {};
  s.schemaVersion = SCHEMA_VERSION;
  s.engineVersion ||= ENGINE_VERSION;
  // Empty the trash after 30 days.
  const cutoff = addDays(todayStr(), -30);
  for (const g of s.goals.filter((g) => g.state === 'trash' && g.trashedOn && g.trashedOn < cutoff)) {
    deleteGoalForever(s, g.id);
  }
  return s;
}

export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('This file is not a backup from this app.');
  if (!Array.isArray(obj.goals) || typeof obj.records !== 'object') throw new Error('This file is missing goals or records.');
  if (obj.schemaVersion > SCHEMA_VERSION) throw new Error('This backup is from a newer version of the app. Update the app first.');
  return migrate(obj);
}

// ---------- records ----------

export function getRec(state, date, goalId, partId) {
  return state.records[recKey(date, goalId, partId)];
}

export function setRec(state, date, goalId, partId, patch) {
  const k = recKey(date, goalId, partId);
  const now = new Date().toISOString();
  const prev = state.records[k];
  const next = { status: 'logged', value: null, note: '', ...(prev || {}), ...patch, updatedAt: now };
  if (!prev) next.createdAt = now;
  const empty = next.status === 'logged' && (next.value == null || next.value === '') && !next.note;
  if (empty) delete state.records[k];
  else state.records[k] = next;
}

export function deleteGoalForever(state, goalId) {
  state.goals = state.goals.filter((g) => g.id !== goalId);
  for (const k of Object.keys(state.records)) if (k.split('|')[1] === goalId) delete state.records[k];
}

export function countRecords(state, goalId) {
  let n = 0;
  for (const k in state.records) if (k.split('|')[1] === goalId) n++;
  return n;
}

export const newId = uid;

// ---------- export ----------

export function toCSV(state) {
  const rows = [['date', 'goal', 'part', 'value', 'unit', 'status', 'note']];
  const goals = Object.fromEntries(state.goals.map((g) => [g.id, g]));
  const keys = Object.keys(state.records).sort();
  for (const k of keys) {
    const [date, gid, pid] = k.split('|');
    const g = goals[gid];
    if (!g) continue;
    const r = state.records[k];
    const part = pid ? g.parts.find((p) => p.id === pid) : null;
    const v = g.versions.filter((x) => x.from <= date).pop() || g.versions[0];
    const pc = pid ? (v.parts || []).find((p) => p.partId === pid) : v;
    const unit = pc ? (pc.kind === 'duration' ? 'minutes' : pc.kind === 'check' ? '' : pc.unit || '') : '';
    rows.push([date, g.name, part?.name || '', r.value ?? '', unit, r.status, r.note || '']);
  }
  for (const [date, d] of Object.entries(state.days)) {
    if (d.note || d.skipped) rows.push([date, '(day)', '', '', '', d.skipped ? 'skipped' : '', d.note || '']);
  }
  return rows.map((r) => r.map((c) => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
