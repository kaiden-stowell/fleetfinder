'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const WebSocket  = require('ws');

const db       = require('./db');
const reports  = require('./reports');
const schedule = require('./schedule');
const qr       = require('./qr');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = parseInt(process.env.PORT || '12792', 10);

function getLocalVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8')).version; }
  catch { return '0.1.0'; }
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ── LAN PIN gate ───────────────────────────────────────────────────────────
// Requests from this Mac (localhost) are trusted — that's the admin console.
// Requests from other devices on the LAN (phones scanning QR codes) must
// supply the shared PIN via the X-Fleet-Pin header.
const FLEET_PIN = process.env.FLEET_PIN || '';

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

app.use('/api', (req, res, next) => {
  if (req.path === '/integration-manifest') return next(); // agent-hub discovery
  if (isLoopback(req)) return next();                       // admin on the Mac
  if (!FLEET_PIN) return next();                            // no PIN configured
  if ((req.get('X-Fleet-Pin') || '') === FLEET_PIN) return next();
  res.status(401).json({ error: 'PIN required' });
});

app.use(express.static(path.join(__dirname, 'public')));

// ── WebSocket: live updates for the dashboard ──────────────────────────────
const server  = http.createServer(app);
const wss     = new WebSocket.Server({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}

// ── Integration manifest ───────────────────────────────────────────────────
// agent-hub's local-hubs.js probes this endpoint to discover FleetFinder and
// inject these instructions into every agent prompt.
app.get('/api/integration-manifest', (req, res) => {
  const baseUrl = `http://127.0.0.1:${PORT}`;
  res.json({
    kind: 'local-hub',
    slug: 'fleetfinder',
    name: 'FleetFinder',
    version: getLocalVersion(),
    base_url: baseUrl,
    mode: 'live',
    status: db.stats(),
    desc: 'Local vehicle fleet management — vehicles, drivers, trips, and maintenance.',
    usage: [
      `FleetFinder is running locally at ${baseUrl}. All endpoints return JSON.`,
      `Use Bash with curl to read or modify the user's vehicle fleet.`,
      ``,
      `READ:`,
      `  curl -s ${baseUrl}/api/stats               # fleet summary counts`,
      `  curl -s ${baseUrl}/api/vehicles            # all vehicles`,
      `  curl -s ${baseUrl}/api/drivers             # all drivers`,
      `  curl -s ${baseUrl}/api/trips               # all trips`,
      `  curl -s ${baseUrl}/api/maintenance         # all maintenance items`,
      `  curl -s "${baseUrl}/api/logs?vehicleId=<id>"  # check-in logs for one vehicle`,
      ``,
      `WRITE (collection = vehicles|drivers|trips|maintenance):`,
      `  curl -s -X POST ${baseUrl}/api/vehicles -H 'Content-Type: application/json' \\`,
      `       -d '{"name":"Truck 1","make":"Ford","model":"F-150","status":"active"}'`,
      `  curl -s -X PATCH ${baseUrl}/api/vehicles/<id> -H 'Content-Type: application/json' \\`,
      `       -d '{"status":"maintenance"}'`,
      `  curl -s -X DELETE ${baseUrl}/api/vehicles/<id>`,
      ``,
      `CHECK-IN (employee vehicle inspection — every checklist field is required):`,
      `  curl -s -X POST ${baseUrl}/api/vehicles/<id>/checkin -H 'Content-Type: application/json' \\`,
      `       -d '{"employee":"Sam","odometer":48210,"oilStatus":"Oil level OK",`,
      `            "lastTireRotation":"2026-04-01","lastWash":"2026-05-15",`,
      `            "fluidsChecked":true,"tiresInspected":true,"lightsTested":true}'`,
      ``,
      `SCHEDULE (when each vehicle next needs service):`,
      `  curl -s ${baseUrl}/api/schedule            # due/overdue items, sorted`,
      ``,
      `REPORTS (spreadsheet-ready CSV — opens in Excel / Numbers / Google Sheets):`,
      `  curl -s ${baseUrl}/api/reports/vehicles.csv -o fleet-vehicles.csv   # one row per vehicle`,
      `  curl -s ${baseUrl}/api/reports/logs.csv     -o fleet-checkins.csv   # one row per check-in`,
      `  curl -s ${baseUrl}/api/reports/schedule.csv -o fleet-schedule.csv   # service due dates`,
    ].join('\n'),
    endpoints: {
      stats:       'GET /api/stats',
      vehicles:    'GET|POST /api/vehicles, GET|PATCH|DELETE /api/vehicles/:id',
      drivers:     'GET|POST /api/drivers, GET|PATCH|DELETE /api/drivers/:id',
      trips:       'GET|POST /api/trips, GET|PATCH|DELETE /api/trips/:id',
      maintenance: 'GET|POST /api/maintenance, GET|PATCH|DELETE /api/maintenance/:id',
      logs:        'GET /api/logs?vehicleId=<id> — vehicle check-in / inspection logs',
      checkin:     'POST /api/vehicles/:id/checkin — submit a completed inspection checklist',
      schedule:    'GET /api/schedule — when each vehicle next needs service',
      reports:     'GET /api/reports/{vehicles,logs,schedule}.csv — spreadsheet CSV exports',
      qr:          'GET /v/:id (service page), /v/:id/qr.svg, /v/:id/print, /qr-sheet (printable QR codes)',
      sync:        'GET /api/sync/pull?since=<ms>, POST /api/sync/push',
    },
  });
});

// ── Stats ──────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => res.json(db.stats()));

// ── Generic REST CRUD for every collection ─────────────────────────────────
for (const coll of db.COLLECTIONS) {
  app.get(`/api/${coll}`, (req, res) => {
    let rows = db.list(coll);
    if (req.query.vehicleId) rows = rows.filter(r => r.vehicleId === req.query.vehicleId);
    res.json(rows);
  });

  app.get(`/api/${coll}/:id`, (req, res) => {
    const rec = db.get(coll, req.params.id);
    if (!rec) return res.status(404).json({ error: 'not found' });
    res.json(rec);
  });

  app.post(`/api/${coll}`, (req, res) => {
    const rec = db.create(coll, req.body || {});
    broadcast(`${coll}:created`, rec);
    res.status(201).json(rec);
  });

  app.patch(`/api/${coll}/:id`, (req, res) => {
    const rec = db.update(coll, req.params.id, req.body || {});
    if (!rec) return res.status(404).json({ error: 'not found' });
    broadcast(`${coll}:updated`, rec);
    res.json(rec);
  });

  app.delete(`/api/${coll}/:id`, (req, res) => {
    const ok = db.remove(coll, req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    broadcast(`${coll}:deleted`, { id: req.params.id });
    res.json({ ok: true });
  });
}

// ── Vehicle check-in ───────────────────────────────────────────────────────
// An employee submits a completed inspection checklist for one vehicle. This
// creates a `logs` record and rolls the latest values onto the vehicle.
const CHECKLIST_FIELDS = [
  'odometer', 'oilStatus', 'lastTireRotation', 'lastWash',
  'fluidsChecked', 'tiresInspected', 'lightsTested',
];

app.post('/api/vehicles/:id/checkin', (req, res) => {
  const vehicle = db.get('vehicles', req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'vehicle not found' });

  const b = req.body || {};
  if (!b.employee || !String(b.employee).trim()) {
    return res.status(400).json({ error: 'employee name is required' });
  }
  // Every checklist item must be completed before a check-in is accepted.
  const missing = CHECKLIST_FIELDS.filter(k => {
    const v = b[k];
    return v === undefined || v === null || v === '' || v === false;
  });
  if (missing.length) {
    return res.status(400).json({ error: 'checklist incomplete', missing });
  }

  const log = db.create('logs', {
    vehicleId:        vehicle.id,
    employee:         String(b.employee).trim(),
    odometer:         Number(b.odometer),
    oilStatus:        b.oilStatus,
    lastTireRotation: b.lastTireRotation,
    lastWash:         b.lastWash,
    fluidsChecked:    !!b.fluidsChecked,
    tiresInspected:   !!b.tiresInspected,
    lightsTested:     !!b.lightsTested,
    notes:            b.notes ? String(b.notes) : '',
  });

  const vehUpdate = {
    odometer:         Number(b.odometer),
    oilStatus:        b.oilStatus,
    lastTireRotation: b.lastTireRotation,
    lastWash:         b.lastWash,
    lastCheckIn:      log.createdAt,
  };
  // Record the oil-change date so the schedule engine can project the next one.
  if (b.oilStatus === 'Oil changed today') {
    vehUpdate.lastOilChange = new Date().toISOString().slice(0, 10);
  }
  const updatedVehicle = db.update('vehicles', vehicle.id, vehUpdate);

  broadcast('logs:created', log);
  broadcast('vehicles:updated', updatedVehicle);
  res.status(201).json({ log, vehicle: updatedVehicle });
});

// ── Spreadsheet reports (CSV) ──────────────────────────────────────────────
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

app.get('/api/reports/vehicles.csv', (req, res) => {
  sendCsv(res, 'fleet-vehicles.csv', reports.vehiclesCsv());
});

app.get('/api/reports/logs.csv', (req, res) => {
  sendCsv(res, 'fleet-checkins.csv', reports.logsCsv());
});

app.get('/api/reports/schedule.csv', (req, res) => {
  sendCsv(res, 'fleet-service-schedule.csv', reports.scheduleCsv());
});

// ── Service schedule ───────────────────────────────────────────────────────
// "When will each vehicle need service again" — drives the dashboard.
app.get('/api/schedule', (req, res) => res.json(schedule.fleetSchedule()));

// ── Per-vehicle QR pages ───────────────────────────────────────────────────
// /v/:id           → that vehicle's mobile service page (the QR target)
// /v/:id/qr.svg    → the QR image encoding the LAN URL of /v/:id
// /v/:id/print     → printable QR card for one vehicle
// /qr-sheet        → printable sheet of QR codes for the whole fleet
app.get('/v/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vehicle.html'));
});

app.get('/v/:id/qr.svg', async (req, res) => {
  if (!db.get('vehicles', req.params.id)) return res.status(404).send('not found');
  try {
    res.type('image/svg+xml').send(await qr.vehicleQrSvg(req.params.id));
  } catch {
    res.status(500).send('qr generation failed');
  }
});

app.get('/v/:id/print', (req, res) => {
  const v = db.get('vehicles', req.params.id);
  if (!v) return res.status(404).send('vehicle not found');
  res.type('html').send(qr.printCardHtml(v));
});

app.get('/qr-sheet', (req, res) => {
  res.type('html').send(qr.sheetHtml(db.list('vehicles')));
});

// ── Sync API (for the future cloud webapp) ─────────────────────────────────
// Pull: webapp asks for everything changed since a timestamp.
app.get('/api/sync/pull', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  res.json({ since, now: Date.now(), changes: db.changedSince(since) });
});

// Push: webapp sends records to merge here (last-write-wins on updatedAt).
app.post('/api/sync/push', (req, res) => {
  const applied = db.mergeInbound(req.body || {});
  db.markSynced();
  if (applied) broadcast('sync:applied', { applied });
  res.json({ ok: true, applied });
});

server.listen(PORT, HOST, () => {
  console.log(`\n  FleetFinder`);
  console.log(`    admin    → http://127.0.0.1:${PORT}`);
  console.log(`    LAN/QR   → ${qr.baseUrl()}`);
  console.log(`    PIN gate → ${FLEET_PIN ? 'on' : 'OFF'}\n`);
});
