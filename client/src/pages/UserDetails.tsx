import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import {
  User,
  Monitor,
  CreditCard,
  Key,
  Clock,
  ArrowLeft,
  Settings,
  Mail,
  Calendar,
  Smartphone,
  Laptop,
  HardDrive,
  Share2,
  Users,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Device } from "@shared/schema";

interface DeviceWithAccount extends Device {
  accountEmail?: string | null;
  licenseId?: string | null;
  tier?: string | null;
}

interface LicenseDetails {
  id: string;
  accountId: string;
  accountEmail?: string | null;
  tier: string;
  deviceLimit: number;
  issuedAt: number;
  expiresAt: number;
  state: string;
  hostCount: number;
  planInterval?: string | null;
  graceEndsAt?: number | null;
  renewalAt?: number | null;
  customQuota?: number | null;
  shareLimit?: number | null;
  teamEnabled?: boolean;
  maxTeams?: number;
}

interface AccountDetails {
  id: string;
  email: string;
  username?: string | null;
  provider?: string | null;
  trialEndsAt?: string | null;
  stripeCustomerId?: string | null;
  razorpayCustomerId?: string | null;
  createdAt: string;
}

export default function UserDetails() {
  const { deviceUUID } = useParams<{ deviceUUID: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: device, isLoading: deviceLoading } = useQuery<DeviceWithAccount>({
    queryKey: ["/api/admin/devices", deviceUUID],
    queryFn: async () => {
      const res = await fetch(`/api/admin/devices/${deviceUUID}`);
      if (!res.ok) throw new Error("Failed to fetch device");
      return res.json();
    },
  });

  const { data: license, isLoading: licenseLoading } = useQuery<LicenseDetails | null>({
    queryKey: ["/api/admin/devices", deviceUUID, "license"],
    queryFn: async () => {
      if (!device?.licenseId) return null;
      const res = await fetch(`/api/admin/licenses`);
      if (!res.ok) return null;
      const licenses: LicenseDetails[] = await res.json();
      return licenses.find((l) => l.id === device.licenseId) || null;
    },
    enabled: !!device?.licenseId,
  });

  const { data: account, isLoading: accountLoading } = useQuery<AccountDetails | null>({
    queryKey: ["/api/admin/devices", deviceUUID, "account"],
    queryFn: async () => {
      if (!device?.accountEmail) return null;
      const res = await fetch(`/api/admin/accounts`);
      if (!res.ok) return null;
      const accounts: AccountDetails[] = await res.json();
      return accounts.find((a) => a.email === device.accountEmail) || null;
    },
    enabled: !!device?.accountEmail,
  });

  const getPlatformIcon = (platform: string) => {
    const p = platform?.toLowerCase() || "";
    if (p.includes("mac")) return <Laptop className="w-5 h-5" />;
    if (p.includes("windows")) return <Monitor className="w-5 h-5" />;
    if (p.includes("ios") || p.includes("android")) return <Smartphone className="w-5 h-5" />;
    return <Monitor className="w-5 h-5" />;
  };

  const formatDate = (ts: number | string | null) => {
    if (!ts) return "—";
    const date = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const stateBadge = (state: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      trial_active: "default",
      active: "secondary",
      grace: "outline",
      expired: "destructive",
      revoked: "outline",
    };
    return <Badge variant={variants[state] ?? "outline"}>{state}</Badge>;
  };

  const tierBadge = (tier: string) => {
    const colors: Record<string, string> = {
      pro: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      teams: "bg-purple-500/10 text-purple-400 border-purple-500/20",
      custom: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      trial: "bg-green-500/10 text-green-400 border-green-500/20",
    };
    return (
      <Badge variant="outline" className={colors[tier?.toLowerCase()] || ""}>
        {tier}
      </Badge>
    );
  };

  if (deviceLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-white/10 rounded w-1/3" />
          <div className="h-64 bg-white/5 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card className="border-red-500/20">
          <CardHeader>
            <CardTitle>Device Not Found</CardTitle>
            <CardDescription>Could not find device with UUID: {deviceUUID}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/users">
              <Button variant="outline">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Users
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/users">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-display font-bold text-white">User Details</h1>
          <p className="text-muted-foreground text-sm">Device #{device.deviceIndex}</p>
        </div>
      </div>

      <div className="grid gap-6">
        {/* User/Account Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {account ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Email</p>
                  <p className="text-sm text-white flex items-center gap-2">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                    {account.email}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Username</p>
                  <p className="text-sm text-white">{account.username || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Provider</p>
                  <p className="text-sm text-white">{account.provider || "Email"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Account Created</p>
                  <p className="text-sm text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    {formatDate(account.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Trial Ends</p>
                  <p className="text-sm text-white">
                    {account.trialEndsAt ? formatDate(account.trialEndsAt) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Provider</p>
                  <p className="text-sm text-white">
                    {account.stripeCustomerId ? "Stripe" : account.razorpayCustomerId ? "Razorpay" : "None"}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No account linked to this device.</p>
            )}
          </CardContent>
        </Card>

        {/* Device Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Device Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Device UUID</p>
                <p className="text-sm text-white font-mono break-all">{device.deviceUUID}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Platform</p>
                <p className="text-sm text-white flex items-center gap-2">
                  {getPlatformIcon(device.platform)}
                  {device.platform}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">App Version</p>
                <p className="text-sm text-white">v{device.appVersion}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <Badge variant={device.isOnline ? "default" : "secondary"}>
                  {device.isOnline ? "Online" : "Offline"}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Last Seen</p>
                <p className="text-sm text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  {getTimeAgo(device.lastSeenAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">First Seen</p>
                <p className="text-sm text-white">{formatDate(device.createdAt)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription/License Details */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Subscription Details
            </CardTitle>
            {license && (
              <Link href="/licenses">
                <Button variant="outline" size="sm">
                  <Settings className="w-4 h-4 mr-2" />
                  Manage License
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            )}
          </CardHeader>
          <CardContent>
            {license ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">License ID</p>
                    <p className="text-sm text-white font-mono">{license.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Plan</p>
                    {tierBadge(license.tier)}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">State</p>
                    {stateBadge(license.state)}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Expires</p>
                    <p className="text-sm text-white">{formatDate(license.expiresAt)}</p>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <h4 className="text-sm font-medium text-white mb-3">Plan Limits</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                      <HardDrive className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Devices</p>
                        <p className="text-sm text-white font-medium">
                          {license.hostCount} / {license.deviceLimit}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                      <Share2 className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Share Limit</p>
                        <p className="text-sm text-white font-medium">
                          {license.shareLimit ?? "Unlimited"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Teams</p>
                        <p className="text-sm text-white font-medium">
                          {license.teamEnabled ? `${license.maxTeams ?? 0} teams` : "Disabled"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-white/5">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Billing</p>
                        <p className="text-sm text-white font-medium">
                          {license.planInterval || "One-time"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {(license.renewalAt || license.graceEndsAt) && (
                  <div className="border-t border-white/10 pt-4">
                    <div className="grid grid-cols-2 gap-4">
                      {license.renewalAt && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Next Renewal</p>
                          <p className="text-sm text-white">{formatDate(license.renewalAt)}</p>
                        </div>
                      )}
                      {license.graceEndsAt && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Grace Period Ends</p>
                          <p className="text-sm text-amber-400">{formatDate(license.graceEndsAt)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6">
                <Key className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No active subscription</p>
                <Link href="/licenses">
                  <Button variant="outline" size="sm">
                    <CreditCard className="w-4 h-4 mr-2" />
                    Grant License
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Link href={`/users/${deviceUUID}/analytics`}>
                <Button variant="outline">View Analytics</Button>
              </Link>
              <Link href={`/support/${deviceUUID}`}>
                <Button variant="outline">Support Thread</Button>
              </Link>
              <Link href="/licenses">
                <Button variant="outline">
                  {license ? "Modify License" : "Grant License"}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
