# JoinCloud Admin

This service collects anonymous operational telemetry from the JoinCloud desktop app.

## Privacy & Security
- No file data, names, paths, or contents are collected.
- No personal user information (names, emails) is stored.
- IP addresses and request headers are not logged.
- Metrics are aggregated only for product improvement and reliability.

## Data Retention Policy
- Daily metrics are retained for a rolling period of **12 months**.
- Records older than 12 months are automatically purged daily to ensure data privacy and system efficiency.

## Tech Stack
- Backend: Node.js + Express
- Database: SQLite
- UI: React (Dark Dashboard)
