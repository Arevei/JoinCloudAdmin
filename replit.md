# JoinCloud Admin

## Overview

JoinCloud Admin is a control plane and analytics dashboard for the JoinCloud desktop application. It collects anonymous, aggregated operational telemetry from desktop app instances to provide visibility into product usage, reliability, and adoption metrics. The service explicitly does not collect any personal data, file contents, or identifying information.

The system provides:
- Telemetry ingestion API for desktop clients
- Admin dashboard with usage analytics and visualizations
- CSV export functionality for reporting
- Automatic 12-month data retention enforcement
- Network presence analytics (Phase 3.1/3.2)
- Control plane features (Phase 1): Device registration, heartbeat, health checks, support messaging, logs

## User Preferences

Preferred communication style: Simple, everyday language.

## Network Presence Analytics

### What is Network Presence?

Network presence is a local-only feature in JoinCloud that allows users on the same local network (LAN) to discover each other. This enables seamless file sharing between devices without requiring internet connectivity.

### Data Collection Policy

All network presence metrics are:
- **Anonymous**: No device identifiers, IP addresses, or hardware info collected
- **Aggregated**: Data is summarized at the population level, never user-level
- **Local-only**: Presence detection happens entirely on the local network
- **Privacy-first**: No display names, peer identities, or network topology stored

### Metrics Collected

| Metric | Description | Storage |
|--------|-------------|---------|
| `network_visibility_enabled` | Whether user has visibility toggle ON | Boolean per user per day |
| `network_peers_detected` | Max peers detected on local network that day | Integer (daily max) |
| `display_name_customized` | Whether user changed their display name | Boolean flag only |

### What is NOT Collected

- Display names or custom names users set
- Peer identifiers or device fingerprints
- Network topology or IP addresses
- MAC addresses or hardware identifiers
- Connection history between specific peers
- Any personally identifiable information

### Dashboard Analytics

The admin dashboard displays:
1. **Peer Detection Rate**: % of active users who detected at least one peer
2. **Average Peers per User**: Mean number of peers detected across active users
3. **Visibility Breakdown**: ON vs OFF distribution
4. **Uptime by Visibility**: Comparison of usage patterns
5. **Personalization Rate**: % of users who customized display name (name not stored)

### Privacy Impact

Network presence analytics help understand:
- How often users share files within local networks
- Whether the visibility toggle affects engagement
- General personalization adoption

These insights guide product decisions without compromising user privacy.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight client-side routing)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with custom dark theme (JoinCloud brand colors)
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Charts**: Recharts for data visualization (area charts, pie charts)
- **Build Tool**: Vite with React plugin

The frontend is a single-page dashboard application with sidebar navigation. It uses a dark theme with primary color #2FB7FF (JoinCloud Blue).

### UI Structure
- **Left Sidebar**: Persistent navigation with Dashboard, Users, Leaderboard, Support sections
- **Dashboard** (`/`): Overview stats, charts, CSV export
- **Users** (`/users`): Device cards with heartbeat status, platform info, action buttons
- **User Analytics** (`/users/:deviceUUID`): Per-user metrics (uptime, files, shares, data transfer)
- **Leaderboard** (`/leaderboard`): Tabs ranking users by uptime, files uploaded, shares created
- **Support Inbox** (`/support`): Conversation-centric view showing only threads with messages
- **Support Thread** (`/support/:deviceUUID`): Individual message thread with send capability

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful endpoints with Zod validation
- **Build**: esbuild for production bundling

Key API endpoints:
- `POST /api/v1/telemetry` - Ingests telemetry payloads from desktop clients
- `GET /api/admin/stats` - Returns aggregated dashboard statistics
- `GET /api/admin/export` - CSV export of daily metrics

Phase 1 Host Registration endpoints:
- `POST /api/v1/hosts/register` - Register host (host_uuid, installation_id, version, platform, arch, first_installed_at)
- `POST /api/v1/hosts/heartbeat` - Host heartbeat (host_uuid, version, uptime_seconds)
- `GET /api/admin/hosts` - List hosts (paginated, filterable by platform/version, sortable)
- `GET /api/admin/hosts/filters` - Get distinct platforms and versions for filter dropdowns

Phase 1 Legacy Control Plane endpoints:
- `GET /health` - Health check (returns reachable, serverTime, adminVersion)
- `POST /heartbeat` - Device heartbeat (deviceUUID, uptimeSeconds, backendHealthy, appVersion)
- `POST /install/register` - Explicit device registration (optional, auto-registers on first telemetry/heartbeat)
- `GET /api/admin/devices` - List all registered devices
- `GET /api/messages/:deviceUUID` - Get support messages for device
- `POST /api/messages/:deviceUUID/reply` - Send message (sender: 'device', 'admin', or 'user')
- `POST /logs/batch` - Batch log ingestion with 30-day TTL

Admin UI endpoints:
- `GET /api/admin/users/:deviceUUID/stats` - Per-user analytics (uptime, files, shares, bandwidth)
- `GET /api/admin/leaderboard` - Top users by uptime, files, shares
- `GET /api/admin/support/threads` - Support thread previews for inbox view

### Data Storage
- **Primary Storage**: SQLite via better-sqlite3 (file-based at `data/telemetry.db`)
- **Schema Definition**: Drizzle ORM with PostgreSQL dialect configured (for potential future migration)
- **Tables**: 
  - `users` - Tracks unique client identifiers and metadata (includes device_index, last_heartbeat for Phase 1)
  - `daily_metrics` - Stores per-user daily aggregated metrics (including Phase 3 network fields)
  - `hosts` - Phase 1 host registration (host_uuid, installation_id, version, platform, arch, first_seen/last_seen, registration_status)
  - `support_threads` - Support conversation threads per device
  - `support_messages` - Individual messages in support threads
  - `device_logs` - Time-boxed device logs (30-day TTL)

The schema supports PostgreSQL through Drizzle configuration but currently uses SQLite for simplicity. Database migrations are handled via `drizzle-kit push`.

### Data Retention
Automatic 12-month rolling retention with daily cleanup of old records.

### Shared Code
The `shared/` directory contains:
- `schema.ts` - Database table definitions and Zod validation schemas
- `routes.ts` - API route definitions with input/output types

This enables type-safe API contracts between frontend and backend.

## External Dependencies

### Database
- **SQLite** (better-sqlite3) - Local file-based database for telemetry storage
- **Drizzle ORM** - Database toolkit with PostgreSQL dialect configured for potential migration

### UI/Frontend Libraries
- **Radix UI** - Headless UI component primitives
- **Recharts** - Charting library for dashboard visualizations
- **date-fns** - Date manipulation utilities

### Development Tools
- **Vite** - Frontend build and dev server with HMR
- **esbuild** - Production server bundling
- **TypeScript** - Type checking across the stack

### Replit-Specific
- `@replit/vite-plugin-runtime-error-modal` - Error overlay in development
- `@replit/vite-plugin-cartographer` - Development tooling
- `@replit/vite-plugin-dev-banner` - Development environment indicator

### Environment Requirements
- `DATABASE_URL` - Required for Drizzle configuration (PostgreSQL connection string)
- SQLite database file created at `data/telemetry.db`
