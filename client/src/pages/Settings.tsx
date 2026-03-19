import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, RefreshCw, Clock, Users, Shield, Plus, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCanWrite, useIsSuperAdmin } from "@/auth/usePermission";

type SubscriptionMode = "manual" | "automatic";

interface AdminSettings {
  subscription_mode: SubscriptionMode;
  payment_mode?: string;
  dev_trial_minutes?: number;
  dev_expiry_warning_minutes?: number;
}

interface PanelUser {
  id: string;
  email: string;
  adminRole: "user" | "admin" | "super_admin" | null;
  createdAt: string;
}

function AdminUsersSection() {
  const isSuperAdmin = useIsSuperAdmin();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("admin");

  const { data: panelUsers = [], isLoading } = useQuery<PanelUser[]>({
    queryKey: ["/api/admin/panel-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/panel-users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch admin users");
      return res.json();
    },
    enabled: isSuperAdmin,
  });

  const addUserMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: "user" | "admin" }) => {
      const res = await fetch("/api/admin/panel-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to add user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/panel-users"] });
      setNewEmail("");
      toast({ title: "Admin user added", description: `${newEmail} has been granted ${newRole} access.` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed to add user", description: err.message }),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: "user" | "admin" | "super_admin" | null }) => {
      const res = await fetch(`/api/admin/panel-users/${id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to update role");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/panel-users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed to update role", description: err.message }),
  });

  if (!isSuperAdmin) return null;

  const roleColor: Record<string, string> = {
    super_admin: "text-purple-400 border-purple-400/30",
    admin: "text-blue-400 border-blue-400/30",
    user: "text-muted-foreground border-white/10",
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Admin Panel Users
        </CardTitle>
        <CardDescription>
          Manage who can access this admin panel. Only super admins can modify this list.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Add new user */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-admin-email">Email address</Label>
            <Input
              id="new-admin-email"
              type="email"
              placeholder="name@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as "user" | "admin")}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">View-only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => newEmail && addUserMutation.mutate({ email: newEmail, role: newRole })}
            disabled={!newEmail || addUserMutation.isPending}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {addUserMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </div>

        {/* User table */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : panelUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No admin users added yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {panelUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono text-sm">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleColor[u.adminRole ?? "user"]}>
                      {u.adminRole ?? "none"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {u.adminRole !== "super_admin" && (
                        <Select
                          value={u.adminRole ?? "user"}
                          onValueChange={(v) => updateRoleMutation.mutate({ id: u.id, role: v as any })}
                          disabled={updateRoleMutation.isPending}
                        >
                          <SelectTrigger className="w-28 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="super_admin">Super Admin</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="user">View-only</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {u.adminRole !== "super_admin" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          onClick={() => updateRoleMutation.mutate({ id: u.id, role: null })}
                          disabled={updateRoleMutation.isPending}
                          title="Remove access"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {u.adminRole === "super_admin" && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Shield className="w-3 h-3" /> Protected
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canWrite = useCanWrite();
  const isSuperAdmin = useIsSuperAdmin();

  const { data: settings, isLoading } = useQuery<AdminSettings>({
    queryKey: ["/api/v1/admin/settings"],
    queryFn: async () => {
      const res = await fetch("/api/v1/admin/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const setSubscriptionMode = useMutation({
    mutationFn: async (subscription_mode: SubscriptionMode) => {
      const res = await fetch("/api/v1/admin/settings/subscription-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription_mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to update subscription mode");
      }
      return res.json();
    },
    onSuccess: (_, subscription_mode) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], (prev: AdminSettings | undefined) => ({ ...(prev ?? {}), subscription_mode }));
      toast({
        title: "Subscription mode updated",
        description: `Subscription mode is now ${subscription_mode}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to update",
        description: err.message,
      });
    },
  });

  const setDevTrialMinutes = useMutation({
    mutationFn: async (dev_trial_minutes: number) => {
      const res = await fetch("/api/v1/admin/settings/dev-trial-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dev_trial_minutes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: (_, dev_trial_minutes) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], (prev: AdminSettings | undefined) => ({ ...(prev ?? {}), dev_trial_minutes }));
      toast({ title: "Dev trial duration updated", description: `New trials in dev mode will last ${dev_trial_minutes} minutes.` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed to update", description: err.message }),
  });

  const setDevExpiryWarningMinutes = useMutation({
    mutationFn: async (dev_expiry_warning_minutes: number) => {
      const res = await fetch("/api/v1/admin/settings/dev-expiry-warning-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dev_expiry_warning_minutes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: (_, dev_expiry_warning_minutes) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], (prev: AdminSettings | undefined) => ({ ...(prev ?? {}), dev_expiry_warning_minutes }));
      toast({ title: "Dev expiry warning updated", description: `Electron will emphasize expiry when under ${dev_expiry_warning_minutes} minutes.` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed to update", description: err.message }),
  });

  const subscriptionMode = settings?.subscription_mode ?? "automatic";
  const devTrialMinutes = settings?.dev_trial_minutes ?? 7;
  const devExpiryWarningMinutes = settings?.dev_expiry_warning_minutes ?? 2;

  const [localDevTrialMinutes, setLocalDevTrialMinutes] = useState(devTrialMinutes);
  const [localDevExpiryWarningMinutes, setLocalDevExpiryWarningMinutes] = useState(devExpiryWarningMinutes);
  useEffect(() => {
    setLocalDevTrialMinutes(devTrialMinutes);
  }, [devTrialMinutes]);
  useEffect(() => {
    setLocalDevExpiryWarningMinutes(devExpiryWarningMinutes);
  }, [devExpiryWarningMinutes]);

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" />
          System Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Control plane configuration
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Subscription Mode
          </CardTitle>
          <CardDescription>
            Automatic: Stripe/Razorpay handle renewals. Manual: licenses are granted by admin or manual verification; no automatic renewal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={subscriptionMode}
            onValueChange={(v) => isSuperAdmin && setSubscriptionMode.mutate(v as SubscriptionMode)}
            disabled={isLoading || setSubscriptionMode.isPending || !isSuperAdmin}
            className="flex gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="automatic" id="sub-auto" />
              <Label htmlFor="sub-auto" className="cursor-pointer font-medium">
                Automatic
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="manual" id="sub-manual" />
              <Label htmlFor="sub-manual" className="cursor-pointer font-medium">
                Manual
              </Label>
            </div>
          </RadioGroup>
          {!isSuperAdmin && (
            <p className="text-xs text-muted-foreground">Super admin access required to change subscription mode.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Dev Mode Trial Timing
          </CardTitle>
          <CardDescription>
            When LICENSE_TIME_MODE=dev or DEV_MODE=true, trial duration uses minutes instead of days. These settings control how long new trials last in dev and when the Electron app shows an expiry warning.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dev-trial-minutes">Trial duration in dev (minutes)</Label>
            <Input
              id="dev-trial-minutes"
              type="number"
              min={1}
              max={60}
              value={localDevTrialMinutes}
              onChange={(e) => setLocalDevTrialMinutes(Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              onBlur={() => {
                if (!canWrite) return;
                const v = Math.min(60, Math.max(1, localDevTrialMinutes || 7));
                if (v !== devTrialMinutes) setDevTrialMinutes.mutate(v);
              }}
              disabled={isLoading || setDevTrialMinutes.isPending || !canWrite}
            />
            <p className="text-xs text-muted-foreground">New trials in dev mode will last this many minutes (1–60).</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dev-expiry-warning-minutes">Show expiry warning when under (minutes)</Label>
            <Input
              id="dev-expiry-warning-minutes"
              type="number"
              min={0}
              max={60}
              value={localDevExpiryWarningMinutes}
              onChange={(e) => setLocalDevExpiryWarningMinutes(Math.min(60, Math.max(0, parseInt(e.target.value, 10) || 0)))}
              onBlur={() => {
                if (!canWrite) return;
                const v = Math.min(60, Math.max(0, localDevExpiryWarningMinutes ?? 2));
                if (v !== devExpiryWarningMinutes) setDevExpiryWarningMinutes.mutate(v);
              }}
              disabled={isLoading || setDevExpiryWarningMinutes.isPending || !canWrite}
            />
            <p className="text-xs text-muted-foreground">Electron can emphasize the countdown when remaining time is below this (0–60).</p>
          </div>
        </CardContent>
      </Card>

      <AdminUsersSection />
    </div>
  );
}
