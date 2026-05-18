'use strict';
// JSON-file data store for FleetFinder.
// Mirrors agent-hub's db.js approach: single db.json + a backup, validated on load.
// Every record carries `updatedAt` (ms epoch) so a future webapp can sync deltas.

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR  = path.join(__dirname, 'data');
const DB_FILE   = path.join(DATA_DIR, 'db.json');
const DB_BACKUP = path.join(DATA_DIR, 'db.backup.json');

const COLLECTIONS = ['vehicles', 'drivers', 'trips', 'maintenance', 'logs'];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function emptyDb() {
  const d = { syncedAt: 0 };
  for (const c of COLLECTIONS) d[c] = [];
  return d;
}

function load() {
  for (const file of [DB_FILE, DB_BACKUP]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) continue;
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') continue;
      for (const c of COLLECTIONS) if (!Array.isArray(d[c])) d[c] = [];
      if (typeof d.syncedAt !== 'number') d.syncedAt = 0;
      return d;
    } catch { /* try backup */ }
  }
  return emptyDb();
}

let _db = load();

function save() {
  try {
    if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_BACKUP);
    fs.writeFileSync(DB_FILE, JSON.stringify(_db, null, 2));
  } catch (e) {
    console.error('[db] save failed:', e.message);
  }
}

// ── Generic collection CRUD ────────────────────────────────────────────────
function list(coll)        { return _db[coll] || []; }
function get(coll, id)     { return (_db[coll] || []).find(r => r.id === id) || null; }

function create(coll, data) {
  const now = Date.now();
  const rec = { id: uuidv4(), ...data, createdAt: now, updatedAt: now };
  _db[coll].push(rec);
  save();
  return rec;
}

function update(coll, id, patch) {
  const rec = get(coll, id);
  if (!rec) return null;
  Object.assign(rec, patch, { id: rec.id, updatedAt: Date.now() });
  save();
  return rec;
}

function remove(coll, id) {
  const before = _db[coll].length;
  _db[coll] = _db[coll].filter(r => r.id !== id);
  if (_db[coll].length === before) return false;
  save();
  return true;
}

// ── Sync helpers (for the future cloud webapp) ─────────────────────────────
// Records changed since `since` (ms epoch). Used to push deltas upstream.
function changedSince(since = 0) {
  const out = {};
  for (const c of COLLECTIONS) out[c] = _db[c].filter(r => (r.updatedAt || 0) > since);
  return out;
}

function markSynced(ts = Date.now()) { _db.syncedAt = ts; save(); }

// Merge inbound records from the webapp (last-write-wins on updatedAt).
function mergeInbound(payload = {}) {
  let applied = 0;
  for (const c of COLLECTIONS) {
    for (const inc of payload[c] || []) {
      if (!inc || !inc.id) continue;
      const existing = get(c, inc.id);
      if (!existing) { _db[c].push(inc); applied++; }
      else if ((inc.updatedAt || 0) > (existing.updatedAt || 0)) {
        Object.assign(existing, inc); applied++;
      }
    }
  }
  if (applied) save();
  return applied;
}

function stats() {
  const v = _db.vehicles;
  return {
    vehicles: v.length,
    active:      v.filter(x => x.status === 'active').length,
    maintenance: v.filter(x => x.status === 'maintenance').length,
    idle:        v.filter(x => x.status === 'idle').length,
    drivers: _db.drivers.length,
    trips:   _db.trips.length,
    openMaintenance: _db.maintenance.filter(m => m.status !== 'done').length,
  };
}

module.exports = {
  COLLECTIONS,
  list, get, create, update, remove,
  changedSince, markSynced, mergeInbound, stats,
  raw: () => _db,
};
