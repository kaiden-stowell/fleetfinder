# FleetFinder

Local vehicle fleet management hub — tracks **vehicles, drivers, trips, and
maintenance**. Built as a sibling **local hub** for `agent-hub`.

## Run

```bash
npm install
npm start          # → http://127.0.0.1:12792
```

Dashboard: <http://127.0.0.1:12792>

## How it connects to agent-hub

agent-hub's `local-hubs.js` periodically probes known localhost ports for a
`GET /api/integration-manifest` endpoint. FleetFinder runs on **port 12792** and
serves that manifest, so agent-hub auto-discovers it and any agent can read or
modify the fleet via plain `curl`.

Port `12792` is registered in `agent-hub/local-hubs.js` `KNOWN_HUBS`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/integration-manifest` | hub discovery manifest |
| GET | `/api/stats` | fleet summary counts |
| GET/POST | `/api/{collection}` | list / create |
| GET/PATCH/DELETE | `/api/{collection}/:id` | read / update / delete |
| GET | `/api/sync/pull?since=<ms>` | changes since a timestamp |
| POST | `/api/sync/push` | merge inbound records (last-write-wins) |

Collections: `vehicles`, `drivers`, `trips`, `maintenance`.

## Webapp sync (planned)

Every record carries an `updatedAt` timestamp. The `/api/sync/*` endpoints let a
future cloud webapp pull deltas and push changes back — last-write-wins merge on
`updatedAt`. Configure `SYNC_URL` / `SYNC_TOKEN` in `.env` when the webapp ships.

## Storage

JSON file at `data/db.json` (auto-created), with a `data/db.backup.json` written
before each save. Not committed to git.
