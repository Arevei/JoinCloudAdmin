# Control Plane Data and Database

## Where data is stored

The Admin Control Plane uses a **single SQLite database** for all persistence.

- **Default path**: `data/telemetry.db` relative to the server working directory (typically the Control Plane project root), i.e. `Admin-Control-Plane/data/telemetry.db` when you run the server from the repo root.
- **Override**: Set the environment variable `JOINCLOUD_CONTROL_PLANE_DB_PATH` to an absolute or relative path to use a different file (e.g. for separate dev/prod DBs or a custom data directory).

The path is resolved in [server/storage.ts](server/storage.ts) when the server starts.

## Tables

| Table | Purpose |
|-------|---------|
| `users` | JoinCloud devices (telemetry/heartbeat); device_index, os, last_seen, last_heartbeat |
| `daily_metrics` | Per-user, per-day aggregated metrics (uptime, bytes, shares, etc.) |
| `support_threads` | One thread per device (device_uuid) |
| `support_messages` | Messages in support threads (sender: device / admin / user) |
| `hosts` | Registered hosts (Electron app registration and heartbeat) |
| `device_logs` | Ingested device logs with expiry |
| `accounts` | Phase 2 user accounts (email, password hash, trial_used) |
| `licenses` | Licenses (tier, device_limit, state, signature, expires_at) |
| `license_hosts` | Which host_uuid is activated on which license |
| `usage_aggregates` | Usage report data per host and period |

## How to manage the DB

- **Open and inspect**: Use any SQLite client, e.g. [DB Browser for SQLite](https://sqlitebrowser.org/) or the `sqlite3` CLI. Open the file at `data/telemetry.db` (or your `JOINCLOUD_CONTROL_PLANE_DB_PATH`).
- **Backup**: Copy the file (e.g. `cp data/telemetry.db data/telemetry.db.bak`). No special dump is required for SQLite; ensure the server is idle or stopped to avoid corruption.
- **Reset**: To start fresh, stop the server, delete or rename `data/telemetry.db`, and restart; the schema will be recreated on first use.
- **Full reset (Admin + App)**: Run `./scripts/reset-fresh-start.sh` (or `.bat` on Windows) from the project root when both apps are stopped. This deletes the admin DB and JoinCloud app data so both start completely fresh.

## Note on DATABASE_URL

The project `.env` may contain `DATABASE_URL` (e.g. for Postgres/Neon). The **main Control Plane routes use the SQLite storage** in `server/storage.ts`, not Postgres. The Drizzle/Postgres setup in `server/db.ts` is only used if you later switch parts of the app to Postgres. For the current implementation, all Admin data lives in the SQLite file above.
