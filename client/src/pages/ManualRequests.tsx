import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useCanWrite } from "@/auth/usePermission";

interface SubscriptionRequest {
  id: string;
  status: "pending" | "approved" | "rejected";
  plan_id: string;
  email: string;
  phone?: string | null;
  account_id?: string | null;
  device_id?: string | null;
  custom_users?: number | null;
  custom_devices?: number | null;
  requested_days?: number | null;
  requested_share_limit?: number | null;
  requested_device_limit?: number | null;
  notes?: string | null;
  license_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
}

export default function ManualRequests() {
  const canWrite = useCanWrite();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tier, setTier] = useState<"pro" | "custom">("pro");
  const [deviceLimit, setDeviceLimit] = useState<string>("5");
  const [expiryDays, setExpiryDays] = useState<string>("365");
  const [shareLimitMonthly, setShareLimitMonthly] = useState<string>("");
  const [customQuota, setCustomQuota] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const requestsQuery = useQuery<SubscriptionRequest[]>({
    queryKey: ["/api/admin/subscription/requests", "pending"],
    queryFn: async () => {
      const res = await fetch("/api/admin/subscription/requests?status=pending");
      if (!res.ok) throw new Error("Failed to load subscription requests");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No request selected");
      const nowSec = Math.floor(Date.now() / 1000);
      const days = parseInt(expiryDays || "365", 10);
      const expires_at = nowSec + Math.max(1, days) * 24 * 60 * 60;
      const body: any = {
        tier,
        device_limit: parseInt(deviceLimit || "5", 10),
        expires_at,
        notes: notes || null,
      };
      const cq = parseInt(customQuota || "0", 10);
      if (tier === "custom" && Number.isFinite(cq) && cq > 0) {
        body.custom_quota = cq;
      }
      const sl = parseInt(shareLimitMonthly || "0", 10);
      if (Number.isFinite(sl) && sl > 0) {
        body.share_limit_monthly = sl;
      }
      const res = await fetch(`/api/admin/subscription/requests/${selectedId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to approve request");
      }
      return res.json();
    },
    onSuccess: () => {
      requestsQuery.refetch();
      setSelectedId(null);
      setNotes("");
      setCustomQuota("");
      setShareLimitMonthly("");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("No request selected");
      const res = await fetch(`/api/admin/subscription/requests/${selectedId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to reject request");
      }
      return res.json();
    },
    onSuccess: () => {
      requestsQuery.refetch();
      setSelectedId(null);
      setNotes("");
      setCustomQuota("");
      setShareLimitMonthly("");
    },
  });

  const pending = requestsQuery.data ?? [];
  const selected = pending.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Manual subscription requests</CardTitle>
          <CardDescription>
            View and approve plan requests created when subscription mode is set to manual.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requestsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading requests…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                {pending.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(r.id);
                      const defaultTier = (r.plan_id === "custom" ? "custom" : "pro") as "pro" | "custom";
                      setTier(defaultTier);
                      setDeviceLimit(
                        r.requested_device_limit != null ? String(r.requested_device_limit) : defaultTier === "pro" ? "5" : "5"
                      );
                      setExpiryDays(r.requested_days != null ? String(r.requested_days) : "365");
                      setShareLimitMonthly(
                        r.requested_share_limit != null ? String(r.requested_share_limit) : defaultTier === "pro" ? "50" : ""
                      );
                      setCustomQuota("");
                      setNotes(r.notes || "");
                    }}
                    className={`w-full text-left border rounded-md px-3 py-2 text-sm ${
                      selectedId === r.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {r.plan_id.toUpperCase()} – {r.email}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}{" "}
                          {r.phone && `· ${r.phone}`}
                        </div>
                      </div>
                      {(r.custom_users != null || r.custom_devices != null || r.requested_days != null || r.requested_share_limit != null || r.requested_device_limit != null) ? (
                        <div className="text-xs text-muted-foreground text-right">
                          {r.requested_days != null && <div>{r.requested_days} days</div>}
                          {r.requested_share_limit != null && <div>share limit {r.requested_share_limit}</div>}
                          {r.requested_device_limit != null && <div>{r.requested_device_limit} devices</div>}
                          {r.custom_users != null && <div>{r.custom_users} users</div>}
                          {r.custom_devices != null && <div>{r.custom_devices} devices</div>}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {selected ? (
                  <>
                    <div className="text-sm">
                      <div className="font-medium mb-1">Selected request</div>
                      <div className="text-muted-foreground">
                        {selected.plan_id.toUpperCase()} for {selected.email}
                        {selected.phone && ` · ${selected.phone}`}
                      </div>
                      {selected.device_id && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Device: {selected.device_id}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs mb-1">Tier</label>
                        <Select value={tier} onValueChange={(v) => setTier(v as "pro" | "custom")}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-xs mb-1">Device limit</label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={deviceLimit}
                          onChange={(e) => setDeviceLimit(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs mb-1">Expiry (days from now)</label>
                        <Input
                          type="number"
                          min={1}
                          value={expiryDays}
                          onChange={(e) => setExpiryDays(e.target.value)}
                          placeholder="e.g. 365"
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1">Share limit (monthly)</label>
                        <Input
                          type="number"
                          min={0}
                          value={shareLimitMonthly}
                          onChange={(e) => setShareLimitMonthly(e.target.value)}
                          placeholder="e.g. 50 for Pro, reset 0 on approve"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs mb-1">Custom quota (users/storage)</label>
                        <Input
                          type="number"
                          min={0}
                          value={customQuota}
                          onChange={(e) => setCustomQuota(e.target.value)}
                          placeholder="Only for custom tier"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs mb-1">Notes</label>
                      <Textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional internal notes about this request"
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => rejectMutation.mutate()}
                        disabled={!canWrite || rejectMutation.isPending}
                      >
                        {rejectMutation.isPending ? "Denying…" : "Deny request"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate()}
                        disabled={!canWrite || approveMutation.isPending}
                      >
                        {approveMutation.isPending ? "Approving…" : "Approve and create license"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Select a request on the left to review and approve.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

