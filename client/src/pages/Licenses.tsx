import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Ban, CalendarPlus, ChevronDown, ChevronRight, UserMinus, UserPlus, Settings, Share2, HardDrive, Users, Clock, ShieldAlert, ShieldCheck, FileText, Plus, UserCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

interface License {
  id: string;
  accountId: string;
  accountEmail?: string | null;
  tier: string;
  deviceLimit: number;
  issuedAt: number;
  expiresAt: number;
  state: string;
  hostCount: number;
  firstDeviceId?: string | null;
  createdAt: string;
  updatedAt: string;
  planInterval?: string | null;
  graceEndsAt?: number | null;
  renewalAt?: number | null;
  customQuota?: number | null;
  overridesJson?: string | null;
  isDeviceOnly?: boolean;
}

export default function Licenses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grantDeviceId, setGrantDeviceId] = useState("");
  const [grantTier, setGrantTier] = useState<"pro" | "teams" | "custom">("pro");
  const [customUsersOrStorage, setCustomUsersOrStorage] = useState(5);
  const [customPairingDevices, setCustomPairingDevices] = useState(5);
  const [replaceModal, setReplaceModal] = useState<{
    deviceId: string;
    tier: "pro" | "teams" | "custom";
    licenseId: string;
    existingTier: string;
    expiresAt: number;
    customUsersOrStorage?: number;
    customPairingDevices?: number;
  } | null>(null);

  const [modifyLicense, setModifyLicense] = useState<License | null>(null);
  const [modifyForm, setModifyForm] = useState({
    tier: "pro" as "trial" | "pro" | "teams" | "custom",
    state: "active" as "active" | "trial_active" | "suspended" | "revoked",
    deviceLimit: 5,
    shareLimit: 200,
    userLimit: 1,
    teamLimit: 0,
    devicesPerUser: 5,
    teamEnabled: false,
    extendDuration: "none" as "none" | "7d" | "30d" | "90d" | "180d" | "365d",
    customDays: 30,
    additionalDeviceIds: "",
    notes: "",
  });

  const { data: licenses, isLoading, error } = useQuery<License[]>({
    queryKey: ["/api/admin/licenses"],
    queryFn: async () => {
      const res = await fetch("/api/admin/licenses");
      if (!res.ok) throw new Error("Failed to fetch licenses");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const expandedLicense = licenses?.find((l) => l.id === expandedId);
  const { data: licenseHosts, isLoading: hostsLoading } = useQuery<{ hosts: Array<{ host_uuid: string; activated_at: string; last_seen_at: string | null; isOnline: boolean }> }>({
    queryKey: ["/api/admin/licenses", expandedId, "hosts"],
    queryFn: async () => {
      if (!expandedId) return { hosts: [] };
      const res = await fetch(`/api/admin/licenses/${expandedId}/hosts`);
      if (!res.ok) throw new Error("Failed to fetch hosts");
      return res.json();
    },
    enabled: !!expandedId,
  });
  const { data: licenseMembers, refetch: refetchMembers } = useQuery<{ primary: { accountId: string; email: string } | null; members: Array<{ accountId: string; email: string; role: string }> }>({
    queryKey: ["/api/admin/licenses", expandedId, "members"],
    queryFn: async () => {
      if (!expandedId) return { primary: null, members: [] };
      const res = await fetch(`/api/admin/licenses/${expandedId}/members`);
      if (!res.ok) throw new Error("Failed to fetch members");
      return res.json();
    },
    enabled: !!expandedId && expandedLicense?.tier === "teams",
  });
  const [addMemberEmail, setAddMemberEmail] = useState("");

  const revokeMutation = useMutation({
    mutationFn: async (licenseId: string) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/revoke`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to revoke");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setRevokeId(null);
      toast({ title: "License revoked" });
    },
    onError: () => toast({ title: "Failed to revoke", variant: "destructive" }),
  });

  const unrevokeMutation = useMutation({
    mutationFn: async (licenseId: string) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/unrevoke`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to unrevoke");
      return data as { state?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      toast({ title: `License restored${data.state ? ` as ${data.state}` : ""}` });
    },
    onError: (err: Error) => toast({ title: err.message || "Failed to unrevoke", variant: "destructive" }),
  });

  const extendMutation = useMutation({
    mutationFn: async ({ licenseId, expiresAt }: { licenseId: string; expiresAt: number }) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expires_at: expiresAt }),
      });
      if (!res.ok) throw new Error("Failed to extend");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setExtendId(null);
      toast({ title: "License extended" });
    },
    onError: () => toast({ title: "Failed to extend", variant: "destructive" }),
  });

  const grantMutation = useMutation({
    mutationFn: async ({ deviceId, tier }: { deviceId: string; tier: "pro" | "teams" }) => {
      const res = await fetch("/api/admin/licenses/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to grant license");
      return data as { success?: boolean; alreadyHasLicense?: boolean; licenseId?: string; tier?: string; expiresAt?: number };
    },
    onSuccess: (data, { deviceId, tier }) => {
      if (data.alreadyHasLicense) {
        setReplaceModal({ deviceId, tier, licenseId: data.licenseId!, existingTier: data.tier!, expiresAt: data.expiresAt! });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setGrantDeviceId("");
      toast({ title: `Granted ${tier} license to ${deviceId}` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const grantReplaceMutation = useMutation({
    mutationFn: async ({ deviceId, tier }: { deviceId: string; tier: "pro" | "teams" | "custom" }) => {
      const res = await fetch("/api/admin/licenses/grant-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, tier }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to replace license");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setReplaceModal(null);
      setGrantDeviceId("");
      toast({ title: `Replaced with ${variables.tier} license for ${variables.deviceId}` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const grantCustomMutation = useMutation({
    mutationFn: async ({ deviceId, usersOrStorage, pairingDevices }: { deviceId: string; usersOrStorage: number; pairingDevices: number }) => {
      const res = await fetch("/api/admin/licenses/grant-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, usersOrStorage, pairingDevices }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to grant custom license");
      return data as { success?: boolean; alreadyHasLicense?: boolean; licenseId?: string; tier?: string; expiresAt?: number };
    },
    onSuccess: (data, { deviceId, usersOrStorage, pairingDevices }) => {
      if (data.alreadyHasLicense) {
        setReplaceModal({ deviceId, tier: "custom", licenseId: data.licenseId!, existingTier: data.tier!, expiresAt: data.expiresAt!, customUsersOrStorage: usersOrStorage, customPairingDevices: pairingDevices });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setGrantDeviceId("");
      toast({ title: `Granted custom license (${usersOrStorage} users/storage, ${pairingDevices} devices) to ${deviceId}.` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const grantCustomReplaceMutation = useMutation({
    mutationFn: async ({ deviceId, usersOrStorage, pairingDevices }: { deviceId: string; usersOrStorage: number; pairingDevices: number }) => {
      const res = await fetch("/api/admin/licenses/grant-custom-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, usersOrStorage, pairingDevices }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to replace with custom license");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setReplaceModal(null);
      setGrantDeviceId("");
      toast({ title: "Replaced with custom license." });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const removeHostMutation = useMutation({
    mutationFn: async ({ licenseId, hostUuid }: { licenseId: string; hostUuid: string }) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/hosts/${encodeURIComponent(hostUuid)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to remove device");
      }
    },
    onSuccess: (_, { licenseId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses", licenseId, "hosts"] });
      toast({ title: "Device removed" });
    },
    onError: (err: Error) => toast({ title: err.message || "Failed to remove device", variant: "destructive" }),
  });

  const addTeamMemberMutation = useMutation({
    mutationFn: async ({ primaryEmail, memberEmail }: { primaryEmail: string; memberEmail: string }) => {
      const res = await fetch("/api/admin/licenses/teams/add-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryEmail, memberEmail }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to add member");
      }
      return res.json();
    },
    onSuccess: (_, { primaryEmail }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses", expandedId, "members"] });
      refetchMembers();
      setAddMemberEmail("");
      toast({ title: "Team member added" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const removeTeamMemberMutation = useMutation({
    mutationFn: async ({ licenseId, accountId }: { licenseId: string; accountId: string }) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/members/${encodeURIComponent(accountId)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to remove member");
      }
    },
    onSuccess: (_, { licenseId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses", licenseId, "members"] });
      refetchMembers();
      toast({ title: "Team member removed" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const modifyMutation = useMutation({
    mutationFn: async ({ licenseId, updates }: { 
      licenseId: string; 
      updates: {
        tier?: string;
        deviceLimit?: number;
        customQuota?: number;
        extendDuration?: string;
        extendTrialDays?: number;
      }
    }) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to modify license");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setModifyLicense(null);
      toast({ title: "License updated successfully" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const openModifyDialog = (license: License) => {
    setModifyLicense(license);
    
    // Parse overrides if available
    let overrides: Record<string, any> = {};
    if (license.overridesJson) {
      try {
        overrides = JSON.parse(license.overridesJson);
      } catch (e) {
        // ignore
      }
    }
    
    setModifyForm({
      tier: license.tier as "trial" | "pro" | "teams" | "custom",
      state: license.state as "active" | "trial_active" | "suspended" | "revoked",
      deviceLimit: license.deviceLimit,
      shareLimit: overrides.shareLimitMonthly ?? license.customQuota ?? (license.tier === "pro" ? 200 : license.tier === "teams" ? 1000 : 10),
      userLimit: overrides.userLimit ?? (license.tier === "teams" ? 5 : 1),
      teamLimit: overrides.teamLimit ?? (license.tier === "teams" ? 3 : 0),
      devicesPerUser: overrides.devicesPerUser ?? 5,
      teamEnabled: license.tier === "teams" || license.tier === "custom",
      extendDuration: "none",
      customDays: 30,
      additionalDeviceIds: overrides.additionalDeviceIds?.join(", ") ?? "",
      notes: overrides.notes ?? "",
    });
  };

  const handleModifySave = () => {
    if (!modifyLicense) return;
    const updates: {
      tier?: string;
      state?: string;
      deviceLimit?: number;
      customQuota?: number;
      extendDuration?: string;
      extendTrialDays?: number;
      shareLimitMonthly?: number;
      userLimit?: number;
      teamLimit?: number;
      devicesPerUser?: number;
      additionalDeviceIds?: string[];
      notes?: string;
    } = {};

    if (modifyForm.tier !== modifyLicense.tier) {
      updates.tier = modifyForm.tier;
    }
    if (modifyForm.state !== modifyLicense.state) {
      updates.state = modifyForm.state;
    }
    if (modifyForm.deviceLimit !== modifyLicense.deviceLimit) {
      updates.deviceLimit = modifyForm.deviceLimit;
    }
    
    // Always send quota fields so they can be stored in overrides_json
    updates.shareLimitMonthly = modifyForm.shareLimit;
    updates.userLimit = modifyForm.userLimit;
    updates.teamLimit = modifyForm.teamLimit;
    updates.devicesPerUser = modifyForm.devicesPerUser;
    updates.notes = modifyForm.notes;
    
    // Parse additional device IDs
    if (modifyForm.additionalDeviceIds.trim()) {
      updates.additionalDeviceIds = modifyForm.additionalDeviceIds
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    }
    
    if (modifyForm.extendDuration && modifyForm.extendDuration !== "none") {
      updates.extendDuration = modifyForm.extendDuration;
    }

    modifyMutation.mutate({ licenseId: modifyLicense.id, updates });
  };

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const getPlanDisplay = (tier: string): { label: string; color: string } => {
    const colors: Record<string, string> = {
      trial: "bg-blue-500/20 text-blue-400",
      pro: "bg-emerald-500/20 text-emerald-400",
      teams: "bg-purple-500/20 text-purple-400",
      custom: "bg-amber-500/20 text-amber-400",
    };
    
    if (tier === "pro" || tier === "teams" || tier === "custom" || tier === "trial") {
      return { label: tier.charAt(0).toUpperCase() + tier.slice(1), color: colors[tier] };
    }
    
    return { label: tier?.toUpperCase() || "—", color: "bg-muted" };
  };

  const planBadge = (tier: string) => {
    const { label, color } = getPlanDisplay(tier);
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
        {label}
      </span>
    );
  };

  const getStatusDisplay = (state: string): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    // Trial state - show "Trial" status
    if (state === "trial_active") {
      return { label: "Trial", variant: "secondary" };
    }
    
    // Active paid state
    if (state === "active") {
      return { label: "Active", variant: "default" };
    }
    
    // Grace period
    if (state === "grace") {
      return { label: "Grace Period", variant: "destructive" };
    }
    
    // Not active states
    if (state === "expired" || state === "revoked") {
      return { label: "Not Active", variant: "outline" };
    }
    
    return { label: "Not Active", variant: "outline" };
  };

  const stateBadge = (state: string) => {
    const { label, variant } = getStatusDisplay(state);
    return <Badge variant={variant}>{label}</Badge>;
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <Card className="max-w-md border-red-500/20">
          <CardHeader>
            <CardTitle>Error Loading Licenses</CardTitle>
            <CardDescription>Could not fetch licenses.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Licenses</h1>
        <p className="text-muted-foreground text-sm">
          Grant Pro or Teams access to a device • {licenses?.length ?? 0} total
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Grant license
          </CardTitle>
          <CardDescription>Grant Pro, Teams, or Custom plan by device ID. If the device already has a license, you can replace the current plan.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm text-muted-foreground block mb-1">Device ID</label>
            <input
              type="text"
              value={grantDeviceId}
              onChange={(e) => setGrantDeviceId(e.target.value)}
              placeholder="paste device UUID"
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="w-[160px]">
            <label className="text-sm text-muted-foreground block mb-1">Plan</label>
            <select
              value={grantTier}
              onChange={(e) => setGrantTier(e.target.value as "pro" | "teams" | "custom")}
              className="w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="pro">Pro (1 user, 5 devices)</option>
              <option value="teams">Teams (5 users, 5 devices)</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {grantTier === "custom" && (
            <>
              <div className="w-[100px]">
                <label className="text-sm text-muted-foreground block mb-1">Users/Storage</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={customUsersOrStorage}
                  onChange={(e) => setCustomUsersOrStorage(parseInt(e.target.value, 10) || 1)}
                  className="w-full rounded border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="w-[100px]">
                <label className="text-sm text-muted-foreground block mb-1">Pairing devices</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customPairingDevices}
                  onChange={(e) => setCustomPairingDevices(parseInt(e.target.value, 10) || 1)}
                  className="w-full rounded border bg-background px-3 py-2 text-sm"
                />
              </div>
            </>
          )}
          <Button
            onClick={() => {
              const deviceId = grantDeviceId.trim();
              if (!deviceId) return;
              if (grantTier === "custom") {
                grantCustomMutation.mutate({ deviceId, usersOrStorage: customUsersOrStorage, pairingDevices: customPairingDevices });
              } else {
                grantMutation.mutate({ deviceId, tier: grantTier });
              }
            }}
            disabled={
              (grantTier === "custom" ? grantCustomMutation.isPending : grantMutation.isPending) ||
              !grantDeviceId.trim()
            }
          >
            {grantTier === "custom" ? (grantCustomMutation.isPending ? "Granting…" : "Grant custom") : grantMutation.isPending ? "Granting…" : "Grant license"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 animate-pulse">
            <div className="h-32 bg-muted rounded" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              All licenses
            </CardTitle>
            <CardDescription>State, device count, revoke and extend</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Device ID</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Devices</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Renewal / Grace</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(licenses ?? []).map((l) => (
                  <Fragment key={l.id}>
                    <TableRow>
                      <TableCell className="w-8 p-1">
                        {l.hostCount > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                          >
                            {expandedId === l.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{l.id}</TableCell>
                      <TableCell className="text-sm">
                        {l.accountEmail && !l.accountEmail.endsWith("@device.local")
                          ? l.accountEmail
                          : "Anonymous Device"}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px]">
                        {l.firstDeviceId ? (
                          <span
                            title={l.firstDeviceId}
                            className="truncate block cursor-pointer hover:text-primary"
                            onClick={() => {
                              navigator.clipboard.writeText(l.firstDeviceId!);
                              toast({ title: "Device ID copied" });
                            }}
                          >
                            {l.firstDeviceId}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{planBadge(l.tier)}</TableCell>
                      <TableCell>{stateBadge(l.state)}</TableCell>
                      <TableCell>
                        {l.hostCount} / {l.deviceLimit}
                      </TableCell>
                      <TableCell>{formatDate(l.expiresAt)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {l.renewalAt ? `Renewal: ${formatDate(l.renewalAt)}` : null}
                        {l.graceEndsAt ? (
                          <span className="text-amber-500 block">Grace ends: {formatDate(l.graceEndsAt)}</span>
                        ) : null}
                        {!l.renewalAt && !l.graceEndsAt ? "—" : null}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => openModifyDialog(l)}
                        >
                          <Settings className="w-3 h-3 mr-1" />
                          Modify
                        </Button>
                        {l.state !== "revoked" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRevokeId(l.id)}
                          >
                            <Ban className="w-3 h-3 mr-1" />
                            Revoke
                          </Button>
                        )}
                        {l.state === "revoked" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => unrevokeMutation.mutate(l.id)}
                            disabled={unrevokeMutation.isPending}
                          >
                            <ShieldCheck className="w-3 h-3 mr-1" />
                            {unrevokeMutation.isPending ? "Restoring..." : "Unrevoke"}
                          </Button>
                        )}
                        {(l.state === "active" || l.state === "trial_active" || l.state === "grace") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExtendId(l.id)}
                          >
                            <CalendarPlus className="w-3 h-3 mr-1" />
                            Extend
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedId === l.id && (
                      <TableRow key={`${l.id}-hosts`}>
                        <TableCell colSpan={10} className="bg-white/5 p-4">
                          {l.tier === "teams" && (
                            <div className="mb-4">
                              <h4 className="text-sm font-medium text-white mb-2">Team members (max 5)</h4>
                              <ul className="space-y-1.5 text-sm mb-3">
                                {licenseMembers?.primary && (
                                  <li className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">{licenseMembers.primary.email}</span>
                                    <Badge variant="outline" className="text-xs">Primary</Badge>
                                  </li>
                                )}
                                {licenseMembers?.members?.map((m) => (
                                  <li key={m.accountId} className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground">{m.email}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:bg-destructive/10 h-7 text-xs"
                                      onClick={() => removeTeamMemberMutation.mutate({ licenseId: l.id, accountId: m.accountId })}
                                      disabled={removeTeamMemberMutation.isPending}
                                    >
                                      Remove
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                              {(licenseMembers?.members?.length ?? 0) + 1 < 5 && (
                                <div className="flex gap-2 items-center">
                                  <input
                                    type="email"
                                    placeholder="Member email"
                                    value={expandedId === l.id ? addMemberEmail : ""}
                                    onChange={(e) => setAddMemberEmail(e.target.value)}
                                    className="rounded border bg-background px-3 py-1.5 text-sm w-48"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      const email = addMemberEmail.trim();
                                      if (!email || !l.accountEmail) return;
                                      addTeamMemberMutation.mutate({ primaryEmail: l.accountEmail, memberEmail: email });
                                    }}
                                    disabled={addTeamMemberMutation.isPending || !addMemberEmail.trim() || !l.accountEmail}
                                  >
                                    <UserPlus className="w-3 h-3 mr-1" />
                                    Add user
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                          {hostsLoading ? (
                            <p className="text-sm text-muted-foreground">Loading devices…</p>
                          ) : (licenseHosts?.hosts?.length ?? 0) === 0 ? (
                            <p className="text-sm text-muted-foreground">No devices on this license.</p>
                          ) : (
                            <ul className="space-y-2">
                              {licenseHosts!.hosts.map((h) => (
                                <li key={h.host_uuid} className="flex items-center justify-between gap-2 text-sm">
                                  <span
                                    title={h.host_uuid}
                                    className="font-mono text-muted-foreground truncate max-w-[200px] cursor-pointer hover:text-primary"
                                    onClick={() => {
                                      navigator.clipboard.writeText(h.host_uuid);
                                      toast({ title: "Device ID copied" });
                                    }}
                                  >
                                    {h.host_uuid}
                                  </span>
                                  <span className="flex items-center gap-2">
                                    {h.isOnline ? (
                                      <Badge variant="default" className="bg-green-600">Active</Badge>
                                    ) : (
                                      <Badge variant="secondary">Offline</Badge>
                                    )}
                                    {(l.tier === "pro" || l.tier === "teams") && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-destructive border-destructive/50 hover:bg-destructive/10"
                                        onClick={() => removeHostMutation.mutate({ licenseId: l.id, hostUuid: h.host_uuid })}
                                        disabled={removeHostMutation.isPending}
                                      >
                                        <UserMinus className="w-3 h-3 mr-1" />
                                        Remove
                                      </Button>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            {(!licenses || licenses.length === 0) && (
              <p className="text-center text-muted-foreground py-8">No licenses yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!revokeId} onOpenChange={() => setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke license?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate the license. Devices using it will lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeId && revokeMutation.mutate(revokeId)}
              className="bg-destructive text-destructive-foreground"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!extendId} onOpenChange={() => setExtendId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Extend license</AlertDialogTitle>
            <AlertDialogDescription>
              Add days from today to the license expiration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <label className="text-sm text-muted-foreground">Days to add</label>
            <input
              type="number"
              min={1}
              max={365}
              value={extendDays}
              onChange={(e) => setExtendDays(parseInt(e.target.value, 10) || 30)}
              className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!extendId) return;
                const now = Math.floor(Date.now() / 1000);
                const license = licenses?.find((l) => l.id === extendId);
                const currentExpires = license?.expiresAt ?? now;
                const newExpires = Math.max(currentExpires, now) + extendDays * 86400;
                extendMutation.mutate({ licenseId: extendId, expiresAt: newExpires });
              }}
            >
              Extend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!replaceModal} onOpenChange={(open) => !open && setReplaceModal(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This device already has a license</AlertDialogTitle>
            <AlertDialogDescription>
              {replaceModal && (
                <>
                  <strong>{replaceModal.deviceId}</strong> already has an active license: <strong>{replaceModal.existingTier}</strong> (expires {formatDate(replaceModal.expiresAt)}).
                  Do you want to replace it with a new license?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReplaceModal(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!replaceModal) return;
                if (replaceModal.tier === "custom" && replaceModal.customUsersOrStorage != null && replaceModal.customPairingDevices != null) {
                  grantCustomReplaceMutation.mutate({
                    deviceId: replaceModal.deviceId,
                    usersOrStorage: replaceModal.customUsersOrStorage,
                    pairingDevices: replaceModal.customPairingDevices,
                  });
                } else if (replaceModal.tier !== "custom") {
                  grantReplaceMutation.mutate({ deviceId: replaceModal.deviceId, tier: replaceModal.tier });
                }
              }}
              disabled={
                grantReplaceMutation.isPending ||
                grantCustomReplaceMutation.isPending ||
                (replaceModal?.tier === "custom" && (replaceModal.customUsersOrStorage == null || replaceModal.customPairingDevices == null))
              }
            >
              {grantReplaceMutation.isPending || grantCustomReplaceMutation.isPending ? "Replacing…" : "Replace existing license"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modify License Dialog */}
      <Dialog open={!!modifyLicense} onOpenChange={(open) => !open && setModifyLicense(null)}>
        <DialogContent className="w-[min(56rem,calc(100vw-2rem))] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Modify License
            </DialogTitle>
            <DialogDescription>
              {modifyLicense && (
                <>
                  Modify settings for <strong>{modifyLicense.accountEmail || "Anonymous Device"}</strong>
                  <br />
                  <span className="text-xs font-mono text-muted-foreground line-clamp-1">ID: {modifyLicense.id}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {modifyLicense && (
            <div className="space-y-5 py-4 max-h-[70vh] overflow-y-auto pr-2">
              {/* License State */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  {modifyForm.state === "suspended" ? <ShieldAlert className="w-4 h-4 text-red-500" /> : <ShieldCheck className="w-4 h-4" />}
                  License State
                </Label>
                <Select
                  value={modifyForm.state}
                  onValueChange={(v) => setModifyForm((f) => ({ ...f, state: v as typeof f.state }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="trial_active">Trial Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                  </SelectContent>
                </Select>
                {modifyForm.state === "suspended" && (
                  <p className="text-xs text-yellow-500">
                    Suspending will block all devices linked to this license.
                  </p>
                )}
              </div>

              {/* Plan Tier */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Plan Tier
                </Label>
                <Select
                  value={modifyForm.tier}
                  onValueChange={(v) => setModifyForm((f) => ({ ...f, tier: v as typeof f.tier }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(modifyLicense.state === "trial_active" || modifyForm.tier === "trial") && (
                      <SelectItem value="trial">Trial</SelectItem>
                    )}
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="teams">Teams</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Device Limit */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    Device Limit
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={modifyForm.deviceLimit}
                    onChange={(e) => setModifyForm((f) => ({ ...f, deviceLimit: parseInt(e.target.value, 10) || 1 }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Usage: {modifyLicense.hostCount} / {modifyLicense.deviceLimit}
                  </p>
                </div>

                {/* Devices Per User */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    Devices/User
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={modifyForm.devicesPerUser}
                    onChange={(e) => setModifyForm((f) => ({ ...f, devicesPerUser: parseInt(e.target.value, 10) || 1 }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Share Limit */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Share2 className="w-4 h-4" />
                    Monthly Shares
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100000}
                    value={modifyForm.shareLimit}
                    onChange={(e) => setModifyForm((f) => ({ ...f, shareLimit: parseInt(e.target.value, 10) || 0 }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    0 = unlimited
                  </p>
                </div>

                {/* User Limit (for teams) */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4" />
                    User Limit
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={modifyForm.userLimit}
                    onChange={(e) => setModifyForm((f) => ({ ...f, userLimit: parseInt(e.target.value, 10) || 1 }))}
                  />
                </div>
              </div>

              {/* Team Limit */}
              {(modifyForm.tier === "teams" || modifyForm.tier === "custom") && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Team Spaces
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={modifyForm.teamLimit}
                      onChange={(e) => setModifyForm((f) => ({ ...f, teamLimit: parseInt(e.target.value, 10) || 0 }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Max team workspaces
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-6">
                    <Label className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Team Enabled
                    </Label>
                    <Switch
                      checked={modifyForm.teamEnabled}
                      onCheckedChange={(checked) => setModifyForm((f) => ({ ...f, teamEnabled: checked }))}
                    />
                  </div>
                </div>
              )}

              {/* Additional Device IDs */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Additional Device IDs
                </Label>
                <Input
                  value={modifyForm.additionalDeviceIds}
                  onChange={(e) => setModifyForm((f) => ({ ...f, additionalDeviceIds: e.target.value }))}
                  placeholder="uuid-1, uuid-2, uuid-3"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated list of extra allowed device UUIDs
                </p>
              </div>

              {/* Extend Duration */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {modifyLicense.state === "trial_active" ? "Extend Trial" : "Extend License"}
                </Label>
                <Select
                  value={modifyForm.extendDuration}
                  onValueChange={(v) => setModifyForm((f) => ({ ...f, extendDuration: v as typeof f.extendDuration }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select duration..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No extension</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days (1 month)</SelectItem>
                    <SelectItem value="90d">90 days (3 months)</SelectItem>
                    <SelectItem value="180d">180 days (6 months)</SelectItem>
                    <SelectItem value="365d">365 days (1 year)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Current expiry: {formatDate(modifyLicense.expiresAt)}
                </p>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Admin Notes
                </Label>
                <Textarea
                  value={modifyForm.notes}
                  onChange={(e) => setModifyForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Internal notes about this license..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setModifyLicense(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleModifySave}
              disabled={modifyMutation.isPending}
            >
              {modifyMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
