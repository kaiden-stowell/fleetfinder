'use strict';
// Service-schedule engine: works out when each vehicle will next need service,
// based on the dates captured during check-ins.

const db = require('./db');

// Service intervals in days. Adjust to your fleet's policy.
const INTERVALS = [
  { key: 'oil',     label: 'Oil change',    field: 'lastOilChange',    days: 180 },
  { key: 'tires',   label: 'Tire rotation', field: 'lastTireRotation', days: 180 },
  { key: 'wash',    label: 'Wash',          field: 'lastWash',         days: 14  },
  { key: 'checkin', label: 'Inspection',    field: 'lastCheckIn',      days: 30  },
];
const SOON_DAYS = 14;       // due within this many days → "soon"
const DAY = 86400000;

function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
}

function toMs(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;          // epoch ms (lastCheckIn)
  const t = Date.parse(val);                        // 'YYYY-MM-DD'
  return Number.isNaN(t) ? null : t;
}

function statusFor(daysUntil) {
  if (daysUntil == null) return 'unknown';
  if (daysUntil < 0)        return 'overdue';
  if (daysUntil <= SOON_DAYS) return 'soon';
  return 'ok';
}

// Service items for one vehicle.
function vehicleSchedule(v) {
  const now = startOfToday();
  return INTERVALS.map(iv => {
    const lastMs = toMs(v[iv.field]);
    if (lastMs == null) {
      return { key: iv.key, label: iv.label, intervalDays: iv.days,
               last: null, due: null, daysUntil: null, status: 'unknown' };
    }
    const due = lastMs + iv.days * DAY;
    const daysUntil = Math.round((due - now) / DAY);
    return { key: iv.key, label: iv.label, intervalDays: iv.days,
             last: lastMs, due, daysUntil, status: statusFor(daysUntil) };
  });
}

// Whole-fleet schedule: every vehicle + a flat, sorted list of what's due.
function fleetSchedule() {
  const vehicles = db.list('vehicles').map(v => {
    const items = vehicleSchedule(v);
    const ranked = items.filter(i => i.daysUntil != null)
                        .sort((a, b) => a.daysUntil - b.daysUntil);
    return {
      id: v.id, name: v.name, status: v.status, odometer: v.odometer,
      items, next: ranked[0] || null,
    };
  });

  const dueItems = [];
  for (const v of vehicles) {
    for (const it of v.items) {
      if (it.status === 'overdue' || it.status === 'soon') {
        dueItems.push({ vehicleId: v.id, vehicle: v.name, ...it });
      }
    }
  }
  dueItems.sort((a, b) => a.daysUntil - b.daysUntil);

  return {
    vehicles, dueItems,
    summary: {
      vehicles: vehicles.length,
      overdue:  dueItems.filter(d => d.status === 'overdue').length,
      soon:     dueItems.filter(d => d.status === 'soon').length,
    },
  };
}

module.exports = { vehicleSchedule, fleetSchedule, INTERVALS, SOON_DAYS };
