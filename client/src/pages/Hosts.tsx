import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Server, 
  Monitor, 
  Laptop,
  Smartphone,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Wifi,
  WifiOff,
  Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Host } from "@shared/schema";

interface HostsResponse {
  hosts: Host[];
  total: number;
}

interface FiltersResponse {
  platforms: string[];
  versions: string[];
}

type SortField = 'last_seen_at' | 'first_seen_at' | 'first_installed_at' | 'version' | 'platform' | 'host_uuid';

export default function Hosts() {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortField>('last_seen_at');
  const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [versionFilter, setVersionFilter] = useState<string>('all');
  const limit = 20;

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortBy,
    sortOrder,
  });
  if (platformFilter && platformFilter !== 'all') queryParams.set('platform', platformFilter);
  if (versionFilter && versionFilter !== 'all') queryParams.set('version', versionFilter);

  const { data, isLoading, error } = useQuery<HostsResponse>({
    queryKey: ['/api/admin/hosts', page, sortBy, sortOrder, platformFilter, versionFilter],
    queryFn: async () => {
      const res = await fetch(`/api/admin/hosts?${queryParams.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch hosts');
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: filtersData } = useQuery<FiltersResponse>({
    queryKey: ['/api/admin/hosts/filters'],
    queryFn: async () => {
      const res = await fetch('/api/admin/hosts/filters');
      if (!res.ok) throw new Error('Failed to fetch filters');
      return res.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const hosts = data?.hosts || [];

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'DESC' ? 'ASC' : 'DESC');
    } else {
      setSortBy(field);
      setSortOrder('DESC');
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 text-muted-foreground/40" />;
    return sortOrder === 'DESC' 
      ? <ArrowDown className="w-3 h-3 text-primary" /> 
      : <ArrowUp className="w-3 h-3 text-primary" />;
  };

  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('mac')) return <Laptop className="w-4 h-4" />;
    if (p.includes('windows')) return <Monitor className="w-4 h-4" />;
    if (p.includes('linux')) return <Monitor className="w-4 h-4" />;
    if (p.includes('ios') || p.includes('android')) return <Smartphone className="w-4 h-4" />;
    return <Monitor className="w-4 h-4" />;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const shortenUUID = (uuid: string) => {
    if (uuid.length <= 16) return uuid;
    return `${uuid.slice(0, 8)}...${uuid.slice(-4)}`;
  };

  const onlineCount = hosts.filter(h => h.isOnline).length;

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <h2 className="text-xl font-bold text-white mb-2" data-testid="text-error-title">Error Loading Hosts</h2>
          <p className="text-muted-foreground">Could not fetch host list.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Server className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-display font-bold text-white" data-testid="text-hosts-title">Hosts</h1>
        </div>
        <p className="text-muted-foreground text-sm" data-testid="text-hosts-subtitle">
          Registered installations {data ? `\u2022 ${data.total} total \u2022 ${onlineCount} online` : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filters:</span>
        </div>
        <Select value={platformFilter} onValueChange={(v) => { setPlatformFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] bg-white/5 border-white/10" data-testid="select-platform-filter">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            {filtersData?.platforms.map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={versionFilter} onValueChange={(v) => { setVersionFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] bg-white/5 border-white/10" data-testid="select-version-filter">
            <SelectValue placeholder="Version" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Versions</SelectItem>
            {filtersData?.versions.map(v => (
              <SelectItem key={v} value={v}>v{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="w-full h-12 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : hosts.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Server className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2" data-testid="text-no-hosts">No Hosts Registered</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Hosts will appear here once JoinCloud desktop apps register with the control plane.
          </p>
        </div>
      ) : (
        <>
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-hosts">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left p-3 text-xs text-muted-foreground font-medium">Status</th>
                    <th className="text-left p-3">
                      <button 
                        className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-white transition-colors"
                        onClick={() => toggleSort('host_uuid')}
                        data-testid="button-sort-host-uuid"
                      >
                        Host UUID <SortIcon field="host_uuid" />
                      </button>
                    </th>
                    <th className="text-left p-3">
                      <button 
                        className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-white transition-colors"
                        onClick={() => toggleSort('version')}
                        data-testid="button-sort-version"
                      >
                        Version <SortIcon field="version" />
                      </button>
                    </th>
                    <th className="text-left p-3">
                      <button 
                        className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-white transition-colors"
                        onClick={() => toggleSort('platform')}
                        data-testid="button-sort-platform"
                      >
                        Platform <SortIcon field="platform" />
                      </button>
                    </th>
                    <th className="text-left p-3 hidden lg:table-cell">
                      <button 
                        className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-white transition-colors"
                        onClick={() => toggleSort('first_installed_at')}
                        data-testid="button-sort-installed"
                      >
                        First Installed <SortIcon field="first_installed_at" />
                      </button>
                    </th>
                    <th className="text-left p-3 hidden md:table-cell">
                      <button 
                        className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-white transition-colors"
                        onClick={() => toggleSort('first_seen_at')}
                        data-testid="button-sort-first-seen"
                      >
                        First Seen <SortIcon field="first_seen_at" />
                      </button>
                    </th>
                    <th className="text-left p-3">
                      <button 
                        className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium hover:text-white transition-colors"
                        onClick={() => toggleSort('last_seen_at')}
                        data-testid="button-sort-last-seen"
                      >
                        Last Seen <SortIcon field="last_seen_at" />
                      </button>
                    </th>
                    <th className="text-left p-3 hidden lg:table-cell text-xs text-muted-foreground font-medium">
                      Registration
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hosts.map((host) => (
                    <tr 
                      key={host.hostUUID} 
                      className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                      data-testid={`row-host-${host.id}`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          {host.isOnline ? (
                            <>
                              <Wifi className="w-4 h-4 text-green-400" />
                              <Badge variant="default" className="bg-green-600 text-xs">Active</Badge>
                            </>
                          ) : (
                            <>
                              <WifiOff className="w-4 h-4 text-muted-foreground/40" />
                              <Badge variant="secondary" className="text-xs">Offline</Badge>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-white text-xs" data-testid={`text-host-uuid-${host.id}`}>
                          {shortenUUID(host.hostUUID)}
                        </span>
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary" className="font-mono text-xs no-default-active-elevate" data-testid={`badge-version-${host.id}`}>
                          v{host.version}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          {getPlatformIcon(host.platform)}
                          <span className="text-xs">{host.platform}</span>
                          <span className="text-xs text-muted-foreground/60">
                            <Cpu className="w-3 h-3 inline mr-0.5" />
                            {host.arch}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground" data-testid={`text-installed-${host.id}`}>
                          {formatDate(host.firstInstalledAt)}
                        </span>
                      </td>
                      <td className="p-3 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground" data-testid={`text-first-seen-${host.id}`}>
                          {formatDate(host.firstSeenAt)}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid={`text-last-seen-${host.id}`}>
                          <Clock className="w-3 h-3" />
                          {getTimeAgo(host.lastSeenAt)}
                        </span>
                      </td>
                      <td className="p-3 hidden lg:table-cell">
                        <Badge 
                          variant="outline" 
                          className="text-xs capitalize no-default-active-elevate"
                          data-testid={`badge-status-${host.id}`}
                        >
                          {host.registrationStatus}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-muted-foreground" data-testid="text-pagination-info">
                Page {page} of {totalPages} ({data?.total} hosts)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
