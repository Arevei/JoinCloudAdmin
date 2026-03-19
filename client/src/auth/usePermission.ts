import { useAuth } from "./AuthContext";

/** True if the current admin can perform write/mutation actions (admin or super_admin). */
export function useCanWrite(): boolean {
  const { user } = useAuth();
  return user?.role === "admin" || user?.role === "super_admin";
}

/** True if the current admin is a super_admin. */
export function useIsSuperAdmin(): boolean {
  const { user } = useAuth();
  return user?.role === "super_admin";
}

/** True if the current admin has at least the given role. */
export function useHasRole(minRole: "user" | "admin" | "super_admin"): boolean {
  const { user } = useAuth();
  if (!user) return false;
  const order = ["user", "admin", "super_admin"] as const;
  return order.indexOf(user.role) >= order.indexOf(minRole);
}
