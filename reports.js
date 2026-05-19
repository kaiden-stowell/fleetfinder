'use strict';
// Spreadsheet-ready CSV reports over the fleet data.
// CSV opens directly in Excel, Apple Numbers, and Google Sheets.

const db       = require('./db');
const schedule = require('./schedule');

// RFC-4180 cell escaping: quote anything with a comma, quote, or newline.
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(columns, rows) {
  const head = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(c.get(r))).join(',')).join('\r\n');
  return head + '\r\n' + body + (body ? '\r\n' : '');
}

const fmtDate = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';
const fmtTime = ms => ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '';

// One row per vehicle — includes the latest check-in values rolled onto it.
function vehiclesCsv() {
  const cols = [
    { label: 'Name',               get: v => v.name },
    { label: 'Make',               get: v => v.make },
    { label: 'Model',              get: v => v.model },
    { label: 'Year',               get: v => v.year },
    { label: 'Plate',              get: v => v.plate },
    { label: 'Status',             get: v => v.status },
    { label: 'Odometer (mi)',      get: v => v.odometer },
    { label: 'Oil Status',         get: v => v.oilStatus },
    { label: 'Last Tire Rotation', get: v => v.lastTireRotation },
    { label: 'Last Wash',          get: v => v.lastWash },
    { label: 'Last Check-In',      get: v => fmtTime(v.lastCheckIn) },
    { label: 'Added',              get: v => fmtDate(v.createdAt) },
  ];
  return toCsv(cols, db.list('vehicles'));
}

// One row per check-in log, newest first, with the vehicle name joined in.
function logsCsv() {
  const vById = Object.fromEntries(db.list('vehicles').map(v => [v.id, v]));
  const rows = db.list('logs').slice().sort((a, b) => b.createdAt - a.createdAt);
  const cols = [
    { label: 'Check-In Time',      get: l => fmtTime(l.createdAt) },
    { label: 'Vehicle',            get: l => (vById[l.vehicleId] || {}).name || l.vehicleId },
    { label: 'Employee',           get: l => l.employee },
    { label: 'Odometer (mi)',      get: l => l.odometer },
    { label: 'Oil Status',         get: l => l.oilStatus },
    { label: 'Last Tire Rotation', get: l => l.lastTireRotation },
    { label: 'Last Wash',          get: l => l.lastWash },
    { label: 'Fluids Checked',     get: l => l.fluidsChecked ? 'Yes' : 'No' },
    { label: 'Tires Inspected',    get: l => l.tiresInspected ? 'Yes' : 'No' },
    { label: 'Lights Tested',      get: l => l.lightsTested ? 'Yes' : 'No' },
    { label: 'Notes',              get: l => l.notes },
  ];
  return toCsv(cols, rows);
}

// One row per (vehicle, service item) — when each service is next due.
function scheduleCsv() {
  const rows = [];
  for (const v of schedule.fleetSchedule().vehicles) {
    for (const it of v.items) rows.push({ vehicle: v.name, ...it });
  }
  const cols = [
    { label: 'Vehicle',    get: r => r.vehicle },
    { label: 'Service',    get: r => r.label },
    { label: 'Interval (days)', get: r => r.intervalDays },
    { label: 'Last Done',  get: r => fmtDate(r.last) },
    { label: 'Next Due',   get: r => fmtDate(r.due) },
    { label: 'Days Until', get: r => r.daysUntil == null ? '' : r.daysUntil },
    { label: 'Status',     get: r => r.status },
  ];
  return toCsv(cols, rows);
}

function fmtDuration(ms) {
  if (ms == null) return '';
  const h = ms / 3600000;
  if (h < 1)  return Math.round(ms / 60000) + 'm';
  if (h < 24) return h.toFixed(1) + 'h';
  return (h / 24).toFixed(1) + 'd';
}

// One row per jobsite trip (vehicle sent out and returned).
function tripsCsv() {
  const vById = Object.fromEntries(db.list('vehicles').map(v => [v.id, v]));
  const rows = db.list('trips').slice().sort((a, b) => (b.outAt || 0) - (a.outAt || 0));
  const cols = [
    { label: 'Vehicle',       get: t => (vById[t.vehicleId] || {}).name || t.vehicleId },
    { label: 'Driver',        get: t => t.driver },
    { label: 'Dispatched By', get: t => t.dispatchedBy },
    { label: 'Out At',        get: t => fmtTime(t.outAt) },
    { label: 'Back At',       get: t => fmtTime(t.backAt) },
    { label: 'Duration',      get: t => t.backAt ? fmtDuration(t.backAt - t.outAt) : '' },
    { label: 'Status',        get: t => t.status },
  ];
  return toCsv(cols, rows);
}

module.exports = { vehiclesCsv, logsCsv, scheduleCsv, tripsCsv };
