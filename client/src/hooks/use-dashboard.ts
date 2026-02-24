import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";

// GET /api/admin/stats
export function useDashboardStats() {
  return useQuery({
    queryKey: [api.admin.stats.path],
    queryFn: async () => {
      const res = await fetch(api.admin.stats.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      // Use the Zod schema from routes to validate and type-check response
      return api.admin.stats.responses[200].parse(await res.json());
    },
    refetchInterval: 30000, // Refresh every 30s
  });
}
