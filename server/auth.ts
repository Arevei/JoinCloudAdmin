import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "joincloud-dev-secret-change-in-production";
const REFRESH_SECRET = process.env.REFRESH_SECRET || (JWT_SECRET + "-refresh");

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "30d";

/** Legacy: kept for backward compat with existing 7d session cookies. */
const JWT_EXPIRES_IN = "7d";

export type Role = "super_admin" | "admin" | "user";

export interface JwtPayload {
  accountId: string;
  email: string;
  role?: Role;
  iat?: number;
  exp?: number;
}

// ─── Access Token (15 min) ───────────────────────────────────────────────────

export function signAccessToken(payload: { accountId: string; email: string; role: Role }): string {
  return jwt.sign(
    { accountId: payload.accountId, email: payload.email, role: payload.role } as JwtPayload,
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

// ─── Refresh Token (30 days) ─────────────────────────────────────────────────

export function signRefreshToken(payload: { accountId: string; email: string; role: Role }): string {
  return jwt.sign(
    { accountId: payload.accountId, email: payload.email, role: payload.role } as JwtPayload,
    REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
}

export function verifyRefreshToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, REFRESH_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ─── Legacy helpers (used by v1 user API) ────────────────────────────────────

export function signToken(payload: { accountId: string; email: string }): string {
  return jwt.sign(
    { accountId: payload.accountId, email: payload.email } as JwtPayload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function signAdminToken(payload: { accountId: string; email: string; role: Role }): string {
  return signAccessToken(payload);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

// ─── Middleware: v1 user auth ─────────────────────────────────────────────────

/** Express middleware: require Bearer JWT and set req.auth to payload. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Authorization required" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }
  (req as any).auth = payload;
  next();
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/** In-memory rate limit for auth endpoints: max 20 attempts per IP per 15 minutes. */
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX = 20;

export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry) {
    entry = { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS };
    authAttempts.set(ip, entry);
  }
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + AUTH_RATE_WINDOW_MS;
  }
  entry.count++;
  if (entry.count > AUTH_RATE_MAX) {
    res.status(429).json({ message: "Too many attempts" });
    return;
  }
  next();
}

// ─── Admin session cookie reader ──────────────────────────────────────────────

const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "admin_session";

function getAdminTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...rest] = c.trim().split("=");
      return [k, rest.join("=")];
    })
  );
  return cookies[ADMIN_COOKIE_NAME] ?? null;
}

// ─── Admin auth middleware ────────────────────────────────────────────────────

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.ip || req.socket?.remoteAddress || "unknown").toString();
  const token = getAdminTokenFromRequest(req);
  if (!token) {
    console.warn(`[AUTH WARN] No admin token on ${req.method} ${req.path} from IP ${ip}`);
    res.status(401).json({ message: "Admin authentication required" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload || !payload.accountId || !payload.email) {
    console.warn(`[AUTH WARN] Invalid/expired admin token on ${req.method} ${req.path} from IP ${ip}`);
    res.status(401).json({ message: "Invalid or expired admin session" });
    return;
  }
  const role: Role =
    payload.role === "super_admin" || payload.role === "admin" || payload.role === "user"
      ? payload.role
      : "user";
  (req as any).admin = {
    accountId: payload.accountId,
    email: payload.email,
    role,
  };
  next();
}

// ─── Role enforcement middleware ──────────────────────────────────────────────

export function requireRole(minRole: "admin" | "super_admin") {
  const order: Role[] = ["user", "admin", "super_admin"];
  const minIndex = order.indexOf(minRole);
  return (req: Request, res: Response, next: NextFunction): void => {
    const admin = (req as any).admin as { accountId: string; email: string; role: Role } | undefined;
    if (!admin) {
      res.status(401).json({ message: "Admin authentication required" });
      return;
    }
    const currentIndex = order.indexOf(admin.role);
    if (currentIndex < minIndex) {
      console.warn(`[AUTH WARN] Role violation: ${admin.email} tried ${req.method} ${req.path} (has '${admin.role}', needs '${minRole}')`);
      res.status(403).json({ message: `Insufficient permissions — requires role '${minRole}'` });
      return;
    }
    next();
  };
}
