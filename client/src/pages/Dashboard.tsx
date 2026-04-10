import { useDashboardStats } from "@/hooks/use-dashboard";
import { StatCard } from "@/components/StatCard";
import { ActivityChart } from "@/components/ActivityChart";
import { VersionChart } from "@/components/VersionChart";
import { 
  Users, 
  HardDrive, 
  Share2, 
  Zap,
  Download,
  Upload,
  Clock,
  Activity,
  Smartphone,
  Monitor
} from "lucide-react";

export default function Dashboard() {
  const { data, isLoading, error } = useDashboardStats();

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Zap className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Connection Error</h2>
          <p className="text-muted-foreground mb-6">Could not fetch dashboard analytics. Please check your connection or try again later.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors font-medium text-sm"
            data-testid="button-reload"
          >
            Reload Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Format bytes to readable string
  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  // Format total uptime seconds — days/hours for large values
  const formatUptime = (seconds: number) => {
    if (seconds >= 86400) {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      return `${days}d ${hours}h`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Format seconds to hours with decimal
  const formatHours = (seconds: number) => {
    const hours = seconds / 3600;
    return `${hours.toFixed(1)}h`;
  };

  const handleExport = () => {
    window.open('/api/admin/export', '_blank');
  };

  const advancedTelemetry = data?.advancedTelemetry;

  return (
    <div className="bg-background text-foreground pb-12 font-body selection:bg-primary/30 selection:text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-display font-bold text-white mb-2 glow-text">Overview</h2>
            <p className="text-muted-foreground">
              Real-time analytics across your deployed infrastructure.
            </p>
          </div>
          <div className="text-sm text-muted-foreground font-mono bg-white/5 px-3 py-1 rounded border border-white/5">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          <StatCard
            title="Total Installs"
            value={data?.totalUsers.toLocaleString() || "0"}
            icon={<Users className="w-5 h-5" />}
            isLoading={isLoading}
            className="border-t-4 border-t-primary"
          />
          <StatCard
            title="Active Users (7d)"
            value={data?.activeUsers7d.toLocaleString() || "0"}
            icon={<Zap className="w-5 h-5" />}
            isLoading={isLoading}
            className="border-t-4 border-t-purple-500"
          />
          <StatCard
            title="Total Uptime"
            value={formatUptime(data?.totalUptimeSeconds || 0)}
            icon={<Clock className="w-5 h-5" />}
            isLoading={isLoading}
            className="border-t-4 border-t-cyan-500"
          />
          <StatCard
            title="Data Processed"
            value={formatBytes(data?.totalDataProcessedBytes || 0)}
            icon={<HardDrive className="w-5 h-5" />}
            isLoading={isLoading}
            className="border-t-4 border-t-emerald-500"
          />
          <StatCard
            title="Total Shares"
            value={data?.totalShares.toLocaleString() || "0"}
            icon={<Share2 className="w-5 h-5" />}
            isLoading={isLoading}
            className="border-t-4 border-t-orange-500"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ActivityChart 
              data={data?.dailyActivity || []} 
              isLoading={isLoading} 
            />
          </div>
          <div className="lg:col-span-1">
            <VersionChart 
              data={data?.versionDistribution || {}} 
              isLoading={isLoading} 
            />
          </div>
        </div>

        {/* Advanced Telemetry */}
        <div className="space-y-4">
          <h3 className="text-lg font-display font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Advanced Telemetry
          </h3>
          <p className="text-sm text-muted-foreground">
            App health and device reporting. Devices that sent heartbeat or telemetry in the given window.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-card p-6 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Last 1 hour</h4>
                <div className="p-2 bg-primary/10 rounded-lg text-primary">
                  <Zap className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-display font-bold text-white mb-1">
                {isLoading ? "..." : advancedTelemetry?.devicesReportingLast1h ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Devices reporting</div>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Last 24 hours</h4>
                <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-400">
                  <Clock className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-display font-bold text-white mb-1">
                {isLoading ? "..." : advancedTelemetry?.devicesReportingLast24h ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Devices reporting</div>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Last 7 days</h4>
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                  <Activity className="w-4 h-4" />
                </div>
              </div>
              <div className="text-3xl font-display font-bold text-white mb-1">
                {isLoading ? "..." : advancedTelemetry?.devicesReportingLast7d ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Devices reporting</div>
            </div>
            <div className="glass-card p-6 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Top versions</h4>
                <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
                  <Monitor className="w-4 h-4" />
                </div>
              </div>
              <div className="space-y-1.5 max-h-24 overflow-y-auto">
                {isLoading ? (
                  <span className="text-muted-foreground text-sm">...</span>
                ) : (
                  (advancedTelemetry?.topVersions ?? []).slice(0, 5).map((v) => (
                    <div key={v.version} className="flex justify-between text-sm">
                      <span className="text-muted-foreground font-mono truncate">{v.version}</span>
                      <span className="text-white font-medium">{v.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="glass-card p-6 rounded-2xl border border-white/5">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Data transfer (7d)</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Upload className="w-3 h-3" />
                  Uploaded
                </div>
                <div className="text-lg font-mono text-primary">
                  {isLoading ? "..." : formatBytes(advancedTelemetry?.totalUploadBytes7d ?? 0)}
                </div>
              </div>
              {/* <div>
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Download className="w-3 h-3" />
                  Downloaded
                </div>
                <div className="text-lg font-mono text-emerald-400">
                  {isLoading ? "..." : formatBytes(advancedTelemetry?.totalDownloadBytes7d ?? 0)}
                </div>
              </div> */}
              <div>
                <span className="text-muted-foreground text-xs">Files uploaded (7d)</span>
                <div className="text-lg font-medium text-white">
                  {isLoading ? "..." : (advancedTelemetry?.totalFilesUploaded7d ?? 0).toLocaleString()}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Files downloaded (7d)</span>
                <div className="text-lg font-medium text-white">
                  {isLoading ? "..." : (advancedTelemetry?.totalFilesDownloaded7d ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
          {(advancedTelemetry?.topPlatforms?.length ?? 0) > 0 && (
            <div className="glass-card p-6 rounded-2xl border border-white/5">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Smartphone className="w-4 h-4" />
                Platform distribution
              </h4>
              <div className="flex flex-wrap gap-3">
                {advancedTelemetry!.topPlatforms.map((p) => (
                  <div key={p.platform} className="bg-white/5 rounded-lg px-4 py-2 border border-white/5">
                    <span className="text-white font-medium">{p.count}</span>
                    <span className="text-muted-foreground text-sm ml-2">{p.platform}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Transfer Health & Export */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          

          <div className="glass-card p-6 rounded-2xl border border-white/5 md:col-span-2 flex flex-col justify-center">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <Download className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white">Export Report</h3>
                <p className="text-sm text-muted-foreground">Download daily aggregates as CSV for analysis.</p>
              </div>
              <button 
                onClick={handleExport}
                className="ml-auto px-4 py-2 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors text-sm"
                data-testid="button-export-csv"
              >
                Download CSV
              </button>
            </div>
            <div className="h-px w-full bg-white/5 my-2" />
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <span>Data Retention: 12 months</span>
              <span className="mx-1">|</span>
              <span>Total data transferred via JoinCloud (uploads + downloads)</span>
            </div>
          </div>
        </div>

      </div>
      
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 text-center">
        <p className="text-xs text-muted-foreground/50">
          &copy; {new Date().getFullYear()} JoinCloud Inc. All rights reserved. Admin Control Plane.
        </p>
      </footer>
    </div>
  );
}
