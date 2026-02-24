import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
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
import { Input } from "@/components/ui/input";

interface UsageAggregate {
  id: number;
  hostUuid: string;
  periodStart: string;
  periodEnd: string;
  uptimeSeconds: number;
  storageUsedBytes: number;
  bytesUploaded: number;
  bytesDownloaded: number;
  totalShares: number;
  totalDevices: number;
  createdAt: string;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)} KB`;
  return `${n} B`;
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

export default function UsageAggregates() {
  const [hostFilter, setHostFilter] = useState("");
  const queryParams = new URLSearchParams();
  if (hostFilter.trim()) queryParams.set("host_uuid", hostFilter.trim());
  queryParams.set("limit", "100");

  const { data: aggregates, isLoading, error } = useQuery<UsageAggregate[]>({
    queryKey: ["/api/admin/usage-aggregates", hostFilter],
    queryFn: async () => {
      const res = await fetch(`/api/admin/usage-aggregates?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <Card className="max-w-md border-red-500/20">
          <CardHeader>
            <CardTitle>Error Loading Usage</CardTitle>
            <CardDescription>Could not fetch usage aggregates.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Usage aggregates</h1>
        <p className="text-muted-foreground text-sm">
          Host-level usage (Phase 2) • sent when idle or every 24h
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <label className="text-sm text-muted-foreground">Filter by host UUID</label>
          <Input
            placeholder="host_uuid (optional)"
            value={hostFilter}
            onChange={(e) => setHostFilter(e.target.value)}
            className="mt-1 max-w-md font-mono text-sm"
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 animate-pulse">
            <div className="h-48 bg-muted rounded" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Aggregates
            </CardTitle>
            <CardDescription>
              Uptime, storage, upload/download, shares, devices per period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Uptime</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Upload</TableHead>
                  <TableHead>Download</TableHead>
                  <TableHead>Shares</TableHead>
                  <TableHead>Devices</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(aggregates ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">
                      {a.hostUuid.slice(0, 12)}…
                    </TableCell>
                    <TableCell>
                      {formatDate(a.periodStart)} – {formatDate(a.periodEnd)}
                    </TableCell>
                    <TableCell>{formatUptime(a.uptimeSeconds)}</TableCell>
                    <TableCell>{formatBytes(a.storageUsedBytes)}</TableCell>
                    <TableCell>{formatBytes(a.bytesUploaded)}</TableCell>
                    <TableCell>{formatBytes(a.bytesDownloaded)}</TableCell>
                    <TableCell>{a.totalShares}</TableCell>
                    <TableCell>{a.totalDevices}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(!aggregates || aggregates.length === 0) && (
              <p className="text-center text-muted-foreground py-8">No usage data yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
