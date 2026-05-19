# 🚚 FleetFinder

**Self-hosted vehicle fleet management for small operations.**

FleetFinder runs on a Mac at your business and gives you a live dashboard of
every vehicle in your fleet — what shape it's in, when it's next due for
service, where it is right now, and a photo record of any damage. Employees
check vehicles in by scanning a printed QR code with their phone.

It's a single Node.js app with no cloud dependency. Your data stays on your Mac.

---

## Install

One command on the Mac that will host it (macOS, Node.js 18+, git):

```bash
curl -fsSL https://raw.githubusercontent.com/kaiden-stowell/fleetfinder/main/install.sh | bash
```

This installs FleetFinder to `~/fleetfinder`, generates an access PIN, and
registers a background service that runs on port **12792** and starts on boot.
Re-running the command updates in place and keeps your data, photos, and PIN.

Then open the admin dashboard at **http://127.0.0.1:12792**.

---

## What it does

### 🗂 Fleet dashboard
A dark-themed control panel listing every vehicle with its status, odometer,
location, and next service due. Live-updates over WebSocket as things change.

### ✅ Vehicle check-ins
Employees complete a fixed **7-step inspection checklist** per vehicle — the
check-in can't be submitted until every item is done:

1. Record current odometer reading
2. Check oil & record oil-change status
3. Tire rotation — last rotation date
4. Wash — last wash date
5. All fluids checked (coolant, brake, washer, transmission)
6. Tire pressure & tread inspected
7. Lights & turn signals tested

Dates from the previous check-in are remembered and pre-filled. Every check-in
is logged with a full history per vehicle.

### 🔧 Service schedule
From check-in history, FleetFinder projects when each vehicle next needs an
**oil change, tire rotation, wash, and inspection**, and flags each as
`overdue`, `soon`, or `ok`. The dashboard surfaces everything that needs
attention, sorted by urgency.

### 🏷 Printable QR codes
Every vehicle gets a QR code (print one card or a whole sheet). An employee
scans it with any phone camera and lands on that vehicle's mobile service
page — service status, check-in checklist, and damage photos, right there.

### 📷 Damage photos
Upload photos of any damage to a vehicle, from the dashboard or the phone
page. Each report keeps the photos, a description, and a timestamp.

### 🚧 Jobsite dispatch
The office can mark a vehicle **out on a job** and **back at the business**.
The dashboard shows what's out and for how long; every trip is logged.

### 📊 Spreadsheet reports
One-click CSV exports — vehicles, check-ins, service schedule, and jobsite
trips — that open directly in Excel, Numbers, or Google Sheets.

---

## Access & security

FleetFinder binds to the local network so phones can reach it.

- The **admin dashboard** (the hosting Mac, `127.0.0.1`) has full access with
  no login.
- **Phones on the Wi-Fi** must enter a shared **PIN** before using a vehicle
  page. The PIN is generated at install time and stored in `~/fleetfinder/.env`
  (`FLEET_PIN`) — change it there and restart.

> Designed for a trusted shop/Wi-Fi network. There is no per-user login.

---

## API

All endpoints return JSON unless noted. Base URL `http://127.0.0.1:12792`.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/stats` | Fleet summary counts |
| `GET\|POST /api/vehicles` · `GET\|PATCH\|DELETE /api/vehicles/:id` | Vehicle CRUD (also `drivers`, `trips`, `maintenance`, `logs`, `damage`) |
| `POST /api/vehicles/:id/checkin` | Submit a completed inspection checklist |
| `POST /api/vehicles/:id/dispatch` · `POST /api/vehicles/:id/return` | Send a vehicle out / mark it back |
| `POST /api/vehicles/:id/damage` | Upload damage photos (multipart `photos[]`) |
| `GET /api/schedule` | When each vehicle next needs service |
| `GET /api/reports/{vehicles,logs,schedule,trips}.csv` | Spreadsheet CSV exports |
| `GET /v/:id` · `/v/:id/qr.svg` · `/v/:id/print` · `/qr-sheet` | Vehicle service page & printable QR codes |
| `GET /api/sync/pull` · `POST /api/sync/push` | Delta sync hooks for a future cloud webapp |

---

## agent-hub integration

FleetFinder is a sibling **local hub** for [agent-hub](https://github.com/kaiden-stowell/agent-hub).
It serves `GET /api/integration-manifest`, so agent-hub auto-discovers it and
any agent can read or update the fleet — including running CSV reports — via
plain `curl`.

---

## Tech & storage

Node.js · Express · WebSocket · multer · qrcode. No database server.

- Fleet data: JSON file at `data/db.json` (a `.backup.json` is written before
  each save).
- Damage photos: image files in `data/uploads/`.

Both live only on the hosting Mac and are excluded from git.

---

## Managing the service

```bash
# stop
launchctl unload ~/Library/LaunchAgents/com.fleetfinder.server.plist
# restart
launchctl unload ~/Library/LaunchAgents/com.fleetfinder.server.plist && \
launchctl load   ~/Library/LaunchAgents/com.fleetfinder.server.plist
```

Logs: `~/fleetfinder/logs/`.
