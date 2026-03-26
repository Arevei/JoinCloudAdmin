import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Save, Trash2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useIsSuperAdmin } from "@/auth/usePermission";
import { useToast } from "@/hooks/use-toast";

const downloadsSchema = z.object({
  win: z.string().url().optional().or(z.literal("")),
  mac: z.string().url().optional().or(z.literal("")),
  linux: z.string().url().optional().or(z.literal("")),
});

const entrySchema = z.object({
  version: z.string().min(1),
  releaseDate: z.string().min(1),
  channel: z.string().min(1).default("stable"),
  changelogText: z.string().default(""),
  downloads: downloadsSchema,
});

type ManifestRow = {
  id: number;
  version: string;
  releaseDate: string;
  channel: string;
  changelog: string[];
  downloads: { win?: string; mac?: string; linux?: string };
};

export default function Updates() {
  const isSuperAdmin = useIsSuperAdmin();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<{ versions: ManifestRow[] }>({
    queryKey: ["/api/admin/updates/manifest"],
    queryFn: async () => {
      const res = await fetch("/api/admin/updates/manifest", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load manifest");
      return res.json();
    },
  });

  const rows = data?.versions ?? [];

  const [draft, setDraft] = useState({
    version: "",
    releaseDate: "",
    channel: "stable",
    changelogText: "",
    downloads: { win: "", mac: "", linux: "" },
  });

  const selectedPreview = useMemo(() => {
    return rows.map((r) => ({
      version: r.version,
      releaseDate: r.releaseDate,
      channel: r.channel,
      changelog: r.changelog ?? [],
      downloads: r.downloads ?? {},
    }));
  }, [rows]);

  const upsert = useMutation({
    mutationFn: async () => {
      const parsed = entrySchema.parse(draft);
      const changelog = parsed.changelogText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const downloads = {
        win: parsed.downloads.win || undefined,
        mac: parsed.downloads.mac || undefined,
        linux: parsed.downloads.linux || undefined,
      };
      const res = await fetch("/api/admin/updates/manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          version: parsed.version,
          releaseDate: parsed.releaseDate,
          channel: parsed.channel,
          changelog,
          downloads,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/updates/manifest"] });
      toast({ title: "Saved", description: "Update manifest entry saved." });
      setDraft({ version: "", releaseDate: "", channel: "stable", changelogText: "", downloads: { win: "", mac: "", linux: "" } });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  const del = useMutation({
    mutationFn: async (version: string) => {
      const res = await fetch(`/api/admin/updates/manifest/${encodeURIComponent(version)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).message || "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/updates/manifest"] });
      toast({ title: "Deleted" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Delete failed", description: e.message }),
  });

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Updates</h1>
          <p className="text-muted-foreground mt-1">
            Manage the public <span className="font-mono">/versions.json</span> manifest used by desktop apps.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {!isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Read-only</CardTitle>
            <CardDescription>Super admin access is required to edit update versions and download links.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Current manifest</CardTitle>
          <CardDescription>Newest versions should be at the top (desktop UI will also sort and filter).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions added yet.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 border border-white/10 rounded-md px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-sm font-semibold">v{r.version}</div>
                      <Badge variant="outline" className="text-xs">{r.channel}</Badge>
                      <div className="text-xs text-muted-foreground">{r.releaseDate}</div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {(r.changelog?.[0] ?? "").toString()}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraft({
                        version: r.version,
                        releaseDate: r.releaseDate,
                        channel: r.channel || "stable",
                        changelogText: (r.changelog ?? []).join("\n"),
                        downloads: {
                          win: r.downloads?.win ?? "",
                          mac: r.downloads?.mac ?? "",
                          linux: r.downloads?.linux ?? "",
                        },
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10"
                    disabled={!isSuperAdmin || del.isPending}
                    onClick={() => {
                      if (!isSuperAdmin) return;
                      if (window.confirm(`Delete v${r.version}?`)) del.mutate(r.version);
                    }}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{draft.version ? `Edit v${draft.version}` : "Add new version"}</CardTitle>
          <CardDescription>These fields are served to desktop apps as JSON and used for upgrade/downgrade actions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Version</Label>
              <Input value={draft.version} onChange={(e) => setDraft((d) => ({ ...d, version: e.target.value }))} disabled={!isSuperAdmin} />
            </div>
            <div className="space-y-1">
              <Label>Release date</Label>
              <Input value={draft.releaseDate} onChange={(e) => setDraft((d) => ({ ...d, releaseDate: e.target.value }))} placeholder="YYYY-MM-DD" disabled={!isSuperAdmin} />
            </div>
            <div className="space-y-1">
              <Label>Channel</Label>
              <Input value={draft.channel} onChange={(e) => setDraft((d) => ({ ...d, channel: e.target.value }))} disabled={!isSuperAdmin} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Windows download URL</Label>
              <Input value={draft.downloads.win} onChange={(e) => setDraft((d) => ({ ...d, downloads: { ...d.downloads, win: e.target.value } }))} disabled={!isSuperAdmin} />
            </div>
            <div className="space-y-1">
              <Label>macOS download URL</Label>
              <Input value={draft.downloads.mac} onChange={(e) => setDraft((d) => ({ ...d, downloads: { ...d.downloads, mac: e.target.value } }))} disabled={!isSuperAdmin} />
            </div>
            <div className="space-y-1">
              <Label>Linux download URL</Label>
              <Input value={draft.downloads.linux} onChange={(e) => setDraft((d) => ({ ...d, downloads: { ...d.downloads, linux: e.target.value } }))} disabled={!isSuperAdmin} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Changelog (one line per entry)</Label>
            <Textarea
              value={draft.changelogText}
              onChange={(e) => setDraft((d) => ({ ...d, changelogText: e.target.value }))}
              rows={6}
              disabled={!isSuperAdmin}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => upsert.mutate()} disabled={!isSuperAdmin || upsert.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {upsert.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(selectedPreview, null, 2)).then(() => {
                  toast({ title: "Copied", description: "Manifest JSON copied to clipboard." });
                }).catch(() => {
                  toast({ variant: "destructive", title: "Copy failed" });
                });
              }}
            >
              Copy manifest JSON
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

