import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "joincloud-dev-secret-change-in-production";
const JWT_EXPIRES_IN = "7d";

export interface JwtPayload {
  accountId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: { accountId: string; email: string }): string {
  return jwt.sign(
    { accountId: payload.accountId, email: payload.email } as JwtPayload,
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

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
