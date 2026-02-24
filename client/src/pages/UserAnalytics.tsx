import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { 
  ArrowLeft,
  Clock,
  Upload,
  Download,
  Share2,
  Wifi,
  Monitor,
  Activity
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import type { Device } from "@shared/schema";

interface UserStats {
  deviceUUID: string;
  deviceIndex: number;
  platform: string;
  appVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  isOnline: boolean;
  totalUptimeSeconds: number;
  totalFilesUploaded: number;
  totalFilesDownloaded: number;
  totalSharesCreated: number;
  totalBytesUploaded: number;
  totalBytesDownloaded: number;
  lanShares: number;
  publicShares: number;
}

export default function UserAnalytics() {
  const params = useParams<{ deviceUUID: string }>();
  const deviceUUID = params.deviceUUID;

  const { data: stats, isLoading, error } = useQuery<UserStats>({
    queryKey: ['/api/admin/users', deviceUUID, 'stats'],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${deviceUUID}/stats`);
      if (!res.ok) throw new Error('Failed to fetch user stats');
      return res.json();
    },
  });

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <h2 className="text-xl font-bold text-white mb-2">Error Loading Analytics</h2>
          <p className="text-muted-foreground">Could not fetch user statistics.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/users">
          <a className="p-2 hover:bg-white/5 rounded-lg transition-colors" data-testid="link-back-users">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
          </a>
        </Link>
        <div>
          <h1 className="text-2xl font-display font-bold text-white">
            User Analytics
          </h1>
          <p className="text-sm text-muted-foreground font-mono">
            Device #{stats?.deviceIndex || '...'} • {deviceUUID?.slice(0, 8)}...
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-5 animate-pulse">
                <div className="h-4 bg-white/10 rounded w-1/2 mb-3" />
                <div className="h-8 bg-white/5 rounded w-3/4" />
              </div>
            ))}
          </div>
        </div>
      ) : stats ? (
        <div className="space-y-6">
          <div className="glass-card rounded-xl p-5 border border-white/5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Device Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Platform</span>
                <span className="text-white font-medium flex items-center gap-2">
                  <Monitor className="w-4 h-4" />
                  {stats.platform}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">App Version</span>
                <span className="text-white font-medium">v{stats.appVersion}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">First Seen</span>
                <span className="text-white font-medium">{formatDate(stats.firstSeenAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Last Active</span>
                <span className="text-white font-medium">{formatDate(stats.lastSeenAt)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Uptime"
              value={formatUptime(stats.totalUptimeSeconds)}
              icon={<Clock className="w-5 h-5" />}
              isLoading={false}
              className="border-t-4 border-t-cyan-500"
            />
            <StatCard
              title="Files Uploaded"
              value={stats.totalFilesUploaded.toLocaleString()}
              icon={<Upload className="w-5 h-5" />}
              isLoading={false}
              className="border-t-4 border-t-primary"
            />
            <StatCard
              title="Files Downloaded"
              value={stats.totalFilesDownloaded.toLocaleString()}
              icon={<Download className="w-5 h-5" />}
              isLoading={false}
              className="border-t-4 border-t-emerald-500"
            />
            <StatCard
              title="Shares Created"
              value={stats.totalSharesCreated.toLocaleString()}
              icon={<Share2 className="w-5 h-5" />}
              isLoading={false}
              className="border-t-4 border-t-orange-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="glass-card rounded-xl p-5 border border-white/5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Data Transfer</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Upload className="w-4 h-4 text-primary" />
                      <span className="text-sm text-white">Uploaded</span>
                    </div>
                    <span className="text-sm text-primary font-mono">{formatBytes(stats.totalBytesUploaded)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-primary/50 w-[60%]" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Download className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm text-white">Downloaded</span>
                    </div>
                    <span className="text-sm text-emerald-500 font-mono">{formatBytes(stats.totalBytesDownloaded)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500/50 w-[40%]" />
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card rounded-xl p-5 border border-white/5">
              <h3 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Share Distribution</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-primary" />
                    <span className="text-sm text-white">LAN Shares</span>
                  </div>
                  <span className="text-xl font-bold text-white">{stats.lanShares}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-white">Public Shares</span>
                  </div>
                  <span className="text-xl font-bold text-white">{stats.publicShares}</span>
                </div>
                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden flex">
                  <div 
                    className="h-full bg-primary/50" 
                    style={{ width: `${stats.lanShares + stats.publicShares > 0 ? (stats.lanShares / (stats.lanShares + stats.publicShares)) * 100 : 50}%` }}
                  />
                  <div 
                    className="h-full bg-purple-500/50" 
                    style={{ width: `${stats.lanShares + stats.publicShares > 0 ? (stats.publicShares / (stats.lanShares + stats.publicShares)) * 100 : 50}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
