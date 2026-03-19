import React, { createContext, useContext, useEffect, useState } from "react";

type Role = "super_admin" | "admin" | "user";

interface AuthUser {
  accountId: string;
  email: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as any).message || "Failed to fetch session");
  }
  return res.json() as Promise<AuthUser>;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/auth/refresh", { method: "POST", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        let data = await fetchMe();
        if (!data) {
          // Access token expired — try refresh token
          const refreshed = await tryRefresh();
          if (refreshed) {
            data = await fetchMe();
          }
        }
        if (!cancelled) {
          setUser(data);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setUser(null);
          setError(err?.message || "Failed to fetch session");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = () => setVersion((v) => v + 1);

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setUser(null);
    setError(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
