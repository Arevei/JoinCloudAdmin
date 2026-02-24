import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Monitor, 
  Smartphone, 
  Laptop,
  Clock,
  MessageSquare,
  BarChart3,
  Search,
  LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Device } from "@shared/schema";

export type DeviceWithAccount = Device & { accountEmail?: string | null; licenseId?: string | null; tier?: string | null };

export default function Users() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { toast } = useToast();

  const { data: devices, isLoading, error } = useQuery<DeviceWithAccount[]>({
    queryKey: ['/api/admin/devices'],
  });

  const logoutDevice = useMutation({
    mutationFn: async (hostUuid: string) => {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(hostUuid)}/logout`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to sign out device");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Device signed out", description: "The device will be signed out on its next check." });
    },
    onError: (err: Error) => {
      toast({ title: "Sign out failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredDevices = useMemo(() => {
    let list = devices ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          (d.deviceUUID && d.deviceUUID.toLowerCase().includes(q)) ||
          (d.platform && d.platform.toLowerCase().includes(q)) ||
          (typeof (d as any).deviceIndex === "number" && String((d as any).deviceIndex).includes(q)) ||
          (d.accountEmail && d.accountEmail.toLowerCase().includes(q))
      );
    }
    if (statusFilter === "active") {
      list = list.filter((d) => getHeartbeatStatus(d).label === "Active");
    } else if (statusFilter === "idle") {
      list = list.filter((d) => getHeartbeatStatus(d).label === "Idle");
    } else if (statusFilter === "offline") {
      list = list.filter((d) => getHeartbeatStatus(d).label === "Offline" || getHeartbeatStatus(d).label === "Never");
    }
    return list;
  }, [devices, search, statusFilter]);

  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('mac')) return <Laptop className="w-5 h-5" />;
    if (p.includes('windows')) return <Monitor className="w-5 h-5" />;
    if (p.includes('linux')) return <Monitor className="w-5 h-5" />;
    if (p.includes('ios') || p.includes('android')) return <Smartphone className="w-5 h-5" />;
    return <Monitor className="w-5 h-5" />;
  };

  const getTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  function getHeartbeatStatus(device: Device | DeviceWithAccount) {
    const lastActivity = device.lastHeartbeat || device.lastSeenAt;
    if (!lastActivity) {
      return { color: 'bg-gray-500', label: 'Never', dotColor: 'bg-gray-400' };
    }
    const diff = Date.now() - new Date(lastActivity).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes <= 5) return { color: 'bg-green-500', label: 'Active', dotColor: 'bg-green-400' };
    if (minutes <= 15) return { color: 'bg-yellow-500', label: 'Idle', dotColor: 'bg-yellow-400' };
    return { color: 'bg-red-500', label: 'Offline', dotColor: 'bg-red-400' };
  }

  const shortenUUID = (uuid: string) => {
    return `${uuid.slice(0, 8)}...${uuid.slice(-4)}`;
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <h2 className="text-xl font-bold text-white mb-2">Error Loading Users</h2>
          <p className="text-muted-foreground">Could not fetch device list.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-white mb-1">Users</h1>
          <p className="text-muted-foreground text-sm">
            JoinCloud devices • {devices?.length || 0} registered
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by UUID, platform, or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-[240px]"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="idle">Idle</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-5 animate-pulse">
              <div className="h-6 bg-white/10 rounded w-1/2 mb-3" />
              <div className="h-4 bg-white/5 rounded w-3/4 mb-4" />
              <div className="flex gap-2">
                <div className="h-9 bg-white/5 rounded flex-1" />
                <div className="h-9 bg-white/5 rounded flex-1" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Monitor className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">
            {devices?.length === 0 ? "No Users Yet" : "No matching devices"}
          </h3>
          <p className="text-muted-foreground text-sm">
            {devices?.length === 0
              ? "Devices will appear here once they start sending telemetry."
              : "Try a different search or filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDevices.map((device) => {
            const heartbeat = getHeartbeatStatus(device);
            return (
              <div 
                key={device.deviceUUID} 
                className="glass-card rounded-xl p-5 hover:border-white/20 transition-colors"
                data-testid={`user-card-${device.deviceIndex}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      device.isOnline 
                        ? 'bg-green-500/10 text-green-500' 
                        : 'bg-white/5 text-muted-foreground'
                    }`}>
                      {getPlatformIcon(device.platform)}
                    </div>
                    <div>
                      <h3 className="font-display font-semibold text-white">
                        Device #{device.deviceIndex}
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono">
                        {shortenUUID(device.deviceUUID)}
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                    heartbeat.color === 'bg-green-500' 
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : heartbeat.color === 'bg-yellow-500'
                      ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                      : 'bg-white/5 text-muted-foreground border border-white/10'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${heartbeat.dotColor}`} />
                    {heartbeat.label}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2">
                  <span className="flex items-center gap-1">
                    {getPlatformIcon(device.platform)}
                    {device.platform}
                  </span>
                  <span>v{device.appVersion}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {getTimeAgo(device.lastSeenAt)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mb-4">
                  <span className="text-muted-foreground/80">Account: </span>
                  <span className={device.accountEmail ? "text-white" : "text-muted-foreground"}>
                    {device.accountEmail ?? "— No license"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link href={`/users/${device.deviceUUID}/analytics`} className="flex-1 min-w-[100px]">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      data-testid={`button-analytics-${device.deviceIndex}`}
                    >
                      <BarChart3 className="w-4 h-4 mr-1.5" />
                      User Analytics
                    </Button>
                  </Link>
                  <Link href={`/support/${device.deviceUUID}`} className="flex-1 min-w-[100px]">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      data-testid={`button-support-${device.deviceIndex}`}
                    >
                      <MessageSquare className="w-4 h-4 mr-1.5" />
                      Support
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => logoutDevice.mutate(device.deviceUUID)}
                    disabled={logoutDevice.isPending}
                    title="Sign out this device (it will show the sign-in screen on next load)"
                    data-testid={`button-logout-${device.deviceIndex}`}
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
