import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Ban, CalendarPlus, ChevronDown, ChevronRight, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  createdAt: string;
  updatedAt: string;
  planInterval?: string | null;
  graceEndsAt?: number | null;
  renewalAt?: number | null;
  customQuota?: number | null;
}

export default function Licenses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantTier, setGrantTier] = useState<"pro" | "teams" | "custom">("pro");
  const [customUsersOrStorage, setCustomUsersOrStorage] = useState(5);
  const [customPairingDevices, setCustomPairingDevices] = useState(5);
  const [replaceModal, setReplaceModal] = useState<{
    email: string;
    tier: "pro" | "teams" | "custom";
    licenseId: string;
    existingTier: string;
    expiresAt: number;
    customUsersOrStorage?: number;
    customPairingDevices?: number;
  } | null>(null);

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
    mutationFn: async ({ email, tier }: { email: string; tier: "pro" | "teams" }) => {
      const res = await fetch("/api/admin/licenses/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tier }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to grant license");
      return data as { success?: boolean; alreadyHasLicense?: boolean; licenseId?: string; tier?: string; expiresAt?: number };
    },
    onSuccess: (data, { email, tier }) => {
      if (data.alreadyHasLicense) {
        setReplaceModal({ email, tier, licenseId: data.licenseId!, existingTier: data.tier!, expiresAt: data.expiresAt! });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setGrantEmail("");
      toast({ title: `Granted ${tier} license to ${email}` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const grantReplaceMutation = useMutation({
    mutationFn: async ({ email, tier }: { email: string; tier: "pro" | "teams" | "custom" }) => {
      const res = await fetch("/api/admin/licenses/grant-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tier }),
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
      setGrantEmail("");
      toast({ title: `Replaced with ${variables.tier} license for ${variables.email}` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const grantCustomMutation = useMutation({
    mutationFn: async ({ email, usersOrStorage, pairingDevices }: { email: string; usersOrStorage: number; pairingDevices: number }) => {
      const res = await fetch("/api/admin/licenses/grant-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, usersOrStorage, pairingDevices }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to grant custom license");
      return data as { success?: boolean; alreadyHasLicense?: boolean; licenseId?: string; tier?: string; expiresAt?: number };
    },
    onSuccess: (data, { email, usersOrStorage, pairingDevices }) => {
      if (data.alreadyHasLicense) {
        setReplaceModal({ email, tier: "custom", licenseId: data.licenseId!, existingTier: data.tier!, expiresAt: data.expiresAt!, customUsersOrStorage: usersOrStorage, customPairingDevices: pairingDevices });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/licenses"] });
      setGrantEmail("");
      toast({ title: `Granted custom license (${usersOrStorage} users/storage, ${pairingDevices} devices) to ${email}. Email sent.` });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const grantCustomReplaceMutation = useMutation({
    mutationFn: async ({ email, usersOrStorage, pairingDevices }: { email: string; usersOrStorage: number; pairingDevices: number }) => {
      const res = await fetch("/api/admin/licenses/grant-custom-replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, usersOrStorage, pairingDevices }),
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
      setGrantEmail("");
      toast({ title: "Replaced with custom license. Email sent." });
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

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const stateBadge = (state: string) => {
    const v: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      trial_active: "default",
      active: "secondary",
      grace: "outline",
      expired: "destructive",
      revoked: "outline",
    };
    return <Badge variant={v[state] ?? "outline"}>{state}</Badge>;
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
          Grant Pro or Teams access to an account • {licenses?.length ?? 0} total
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Grant license
          </CardTitle>
          <CardDescription>Grant Pro, Teams, or Custom plan by email. Account is created if it does not exist. Pro/ Custom grants send license data by email when SMTP is configured.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm text-muted-foreground block mb-1">Email</label>
            <input
              type="email"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              placeholder="user@example.com"
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
              const email = grantEmail.trim();
              if (!email) return;
              if (grantTier === "custom") {
                grantCustomMutation.mutate({ email, usersOrStorage: customUsersOrStorage, pairingDevices: customPairingDevices });
              } else {
                grantMutation.mutate({ email, tier: grantTier });
              }
            }}
            disabled={
              (grantTier === "custom" ? grantCustomMutation.isPending : grantMutation.isPending) ||
              !grantEmail.trim()
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
                  <TableHead>Account (email)</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Tier</TableHead>
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
                      <TableCell className="text-sm">{l.accountEmail ?? l.accountId?.slice(0, 12) + "…" ?? "—"}</TableCell>
                      <TableCell>{stateBadge(l.state)}</TableCell>
                      <TableCell>{l.tier}</TableCell>
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
                        <TableCell colSpan={9} className="bg-white/5 p-4">
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
                                  <span className="font-mono text-muted-foreground">{h.host_uuid.slice(0, 8)}…{h.host_uuid.slice(-4)}</span>
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
            <AlertDialogTitle>This email already has a license</AlertDialogTitle>
            <AlertDialogDescription>
              {replaceModal && (
                <>
                  <strong>{replaceModal.email}</strong> already has an active license: <strong>{replaceModal.existingTier}</strong> (expires {formatDate(replaceModal.expiresAt)}).
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
                    email: replaceModal.email,
                    usersOrStorage: replaceModal.customUsersOrStorage,
                    pairingDevices: replaceModal.customPairingDevices,
                  });
                } else if (replaceModal.tier !== "custom") {
                  grantReplaceMutation.mutate({ email: replaceModal.email, tier: replaceModal.tier });
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
    </div>
  );
}
