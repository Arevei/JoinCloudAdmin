# JoinCloud Admin — Project Configuration (for agents / onboarding)

This doc summarizes how the project is structured, built, and configured so another agent or developer can work on it without guessing.

---

## Stack

- **Backend:** Node.js 20, Express 5, TypeScript (ESM in source; production server is bundled as CJS).
- **Frontend:** React 18, Vite 7, Tailwind, Radix UI, Wouter, TanStack Query. Lives under `client/`.
- **Data:** Primary runtime DB is **SQLite** via `better-sqlite3` (single file, no Postgres required for app runtime). Optional **Postgres** via Drizzle (`server/db.ts`) — used if you run Drizzle migrations/scripts; main app logic uses **SQLite** only (`server/storage.ts`).

---

## Repo layout

| Path | Purpose |
|------|--------|
| `server/` | Express app: routes, auth, storage (SQLite), Stripe/Razorpay webhooks, mailer, static serving. |
| `client/` | Vite root; React SPA source. |
| `shared/` | Shared types/schemas (Zod, API contract). Import as `@shared/`. |
| `script/build.ts` | Build script: runs Vite (client) + esbuild (server bundle). |
| `dist/` | Build output: `dist/index.cjs` (server), `dist/public/` (client assets). Not in git. |
| `data/` | Default SQLite DB dir (`data/telemetry.db`). Create locally or mount in Docker. Not in git. |

---

## Scripts (package.json)

| Script | Command | Use |
|--------|---------|-----|
| `dev` | `cross-env NODE_ENV=development tsx server/index.ts` | Local dev: Express + Vite HMR. |
| `build` | `tsx script/build.ts` | Production build: Vite → `dist/public/`, esbuild server → `dist/index.cjs`. |
| `start` | `cross-env NODE_ENV=production node dist/index.cjs` | Run production server. |
| `check` | `tsc` | Type-check only. |
| `db:push` | `drizzle-kit push` | Push Drizzle schema (Postgres); optional. |

---

## Environment variables (.env)

Copy from `.env.example` if present, or use these. **Do not commit real secrets.**

| Variable | Required | Default / notes |
|----------|----------|------------------|
| `PORT` | No | `5000`. Server listens on `0.0.0.0:PORT`. |
| `NODE_ENV` | No | Set by scripts; `production` in prod. |
| `JWT_SECRET` | Yes (prod) | Change from default in production. |
| **SQLite** | | |
| `JOINCLOUD_CONTROL_PLANE_DB_PATH` | No | `process.cwd() + '/data/telemetry.db'`. Override for Docker volume path. |
| **License** | | |
| `JOINCLOUD_LICENSE_PRIVATE_KEY` | No | Ed25519 private key (base64 PEM). If unset, dev in-memory key is used. |
| **Payments** | | |
| `STRIPE_SECRET_KEY` | If using Stripe | Legacy; Razorpay is primary. |
| `STRIPE_WEBHOOK_SECRET` | If using Stripe webhooks | |
| `RAZORPAY_KEY_ID` | If using Razorpay | |
| `RAZORPAY_KEY_SECRET` | If using Razorpay | |
| `RAZORPAY_WEBHOOK_SECRET` | If using Razorpay webhooks | |
| **App / limits** | | |
| `JOINCLOUD_WEB_URL` | No | Front-end origin (e.g. `https://app.example.com`) for redirects. |
| `JOINCLOUD_PRO_DEVICE_LIMIT` | No | e.g. `5`. |
| `JOINCLOUD_TEAM_DEVICE_LIMIT` | No | e.g. `5`. |
| `JOINCLOUD_UPGRADE_URL` | No | Billing/upgrade link; fallback used if unset. |
| **SMTP (license emails)** | | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | No | If set, license grant/replace emails are sent. |
| **Postgres (optional)** | | |
| `DATABASE_URL` | Only if using `server/db.ts` | Postgres connection string. **Not used by main app runtime** (app uses SQLite). Required only when something imports `server/db.ts` (e.g. Drizzle tooling). |

---

## Build details

- **Vite** (`vite.config.ts`): Root `client/`, aliases `@` → `client/src`, `@shared` → `shared`, `@assets` → `attached_assets`. Build output: `dist/public/`. Replit plugins are optional (loaded only when packages exist and `REPL_ID` is set).
- **Server bundle** (`script/build.ts`): Entry `server/index.ts` → `dist/index.cjs` (CJS, Node). Many deps are external (see allowlist in script); only allowlisted deps are bundled. Ensures `process.env.NODE_ENV === 'production'` in bundle.
- **Production static:** In prod, `server/static.ts` serves `path.resolve(__dirname, 'public')` (i.e. `dist/public/` when run from `dist/index.cjs`). SPA fallback: unknown paths → `index.html`.

---

## Deployment (Coolify / Render / Docker)

- **Dockerfile:** Multi-stage: builder runs `npm ci` + `npm run build`; runner runs `npm ci --omit=dev`, copies `dist/` from builder, `CMD ["node", "dist/index.cjs"]`. Uses `node:20-alpine`. Expects `PORT` (default 5000). For SQLite persistence, mount a volume at `/app/data` or set `JOINCLOUD_CONTROL_PLANE_DB_PATH`.
- **render.yaml:** Blueprint for Render (Node runtime: `npm ci && npm run build`, start `npm start`). Optional disk for `data/`.
- **Coolify:** Use Dockerfile; set port 5000; add volume for `/app/data` for SQLite.
- **Lock file:** Keep `package-lock.json` in sync with `package.json` (run `npm install` after changing deps); `npm ci` is used in Docker and fails if lock is out of sync.

---

## Important files for behavior

| Concern | File(s) |
|--------|---------|
| API routes, auth, webhooks | `server/routes.ts` |
| All persistence (SQLite) | `server/storage.ts` |
| Stripe webhooks | `server/stripe-webhook.ts` |
| Razorpay webhooks | `server/razorpay-webhook.ts` |
| License signing | `server/license-sign.ts` |
| Email (SMTP) | `server/mailer.ts` |
| Static serving (prod) | `server/static.ts` (serves `__dirname/public` → `dist/public`) |
| Server entry, PORT, Vite vs static | `server/index.ts` |
| Client build, aliases | `vite.config.ts` |
| Server bundle, externals | `script/build.ts` |

---

## Quick local run

```bash
npm install
npm run dev   # http://localhost:5000
```

Production (after build):

```bash
npm run build
npm start     # expects PORT, serves from dist/
```

---

## Notes for agents

1. **Database:** App uses **SQLite** only at runtime (`server/storage.ts`). `server/db.ts` is Postgres/Drizzle; it’s optional unless you run Drizzle or code that imports it. Don’t assume `DATABASE_URL` is required for the main app.
2. **Port:** Server reads `process.env.PORT || "5000"` and binds `0.0.0.0`.
3. **Replit:** Replit-specific Vite plugins are optional; build works without them (e.g. on Coolify/Render).
4. **Secrets:** Never commit `.env` or real keys; document required env in this file or `.env.example`.
