# JoinCloud Admin — Docker image for Coolify, Render, or any container host
# Build: docker build -t joincloud-admin .
# Run:   docker run -p 5000:5000 -e PORT=5000 -v joincloud-data:/app/data joincloud-admin

# ---- Build ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN ./node_modules/.bin/tsx script/build.ts

# ---- Production ----
FROM node:20-alpine AS runner

WORKDIR /app

# Production deps only (better-sqlite3 builds for this image)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Built server + client assets
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
# Platform can override; default for local runs
ENV PORT=5000

EXPOSE 5000

# Persist SQLite DB: mount a volume at /app/data or set JOINCLOUD_CONTROL_PLANE_DB_PATH
CMD ["node", "dist/index.cjs"]
