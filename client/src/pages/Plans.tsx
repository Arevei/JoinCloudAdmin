import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle } from "lucide-react";

// Tier feature matrix — mirrors JoinCloudAdmin/server/entitlements.ts TIER_DEFAULTS
const TIERS = [
  {
    name: "Free",
    color: "secondary" as const,
    shareLimitMonthly: "5 / month",
    fileSizeLimit: "2 GB",
    linkExpiryMax: "24 hours",
    devices: "1 device",
    resumableDownloads: false,
    cdnCache: false,
    teamEnabled: false,
    priceLabel: "₹0",
  },
  {
    name: "Trial",
    color: "default" as const,
    shareLimitMonthly: "20 / month",
    fileSizeLimit: "20 GB",
    linkExpiryMax: "7 days",
    devices: "3 devices",
    resumableDownloads: true,
    cdnCache: false,
    teamEnabled: false,
    priceLabel: "₹0 (14 days)",
  },
  {
    name: "Pro",
    color: "default" as const,
    shareLimitMonthly: "50 / month",
    fileSizeLimit: "20 GB",
    linkExpiryMax: "30 days",
    devices: "3 devices",
    resumableDownloads: true,
    cdnCache: true,
    teamEnabled: false,
    priceLabel: "₹399 / mo",
    highlight: true,
  },
  {
    name: "Pro+",
    color: "default" as const,
    shareLimitMonthly: "Unlimited",
    fileSizeLimit: "Unlimited",
    linkExpiryMax: "90 days",
    devices: "5 users × 5 devices",
    resumableDownloads: true,
    cdnCache: true,
    teamEnabled: true,
    priceLabel: "₹999 / mo",
  },
  {
    name: "Teams (legacy)",
    color: "secondary" as const,
    shareLimitMonthly: "100 / month",
    fileSizeLimit: "Unlimited",
    linkExpiryMax: "90 days",
    devices: "3 users × 3 devices",
    resumableDownloads: true,
    cdnCache: true,
    teamEnabled: true,
    priceLabel: "Custom",
  },
  {
    name: "Custom",
    color: "secondary" as const,
    shareLimitMonthly: "Configurable",
    fileSizeLimit: "Unlimited",
    linkExpiryMax: "365 days",
    devices: "Up to 5 devices",
    resumableDownloads: true,
    cdnCache: true,
    teamEnabled: false,
    priceLabel: "Admin set",
  },
];

const FEATURE_ROWS: { label: string; key: keyof (typeof TIERS)[0] }[] = [
  { label: "Price", key: "priceLabel" },
  { label: "Devices", key: "devices" },
  { label: "Shares / month", key: "shareLimitMonthly" },
  { label: "Max file size", key: "fileSizeLimit" },
  { label: "Max link expiry", key: "linkExpiryMax" },
  { label: "Resumable downloads", key: "resumableDownloads" },
  { label: "CDN cache (R2)", key: "cdnCache" },
  { label: "Team spaces", key: "teamEnabled" },
];

function FeatureCell({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value
      ? <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
      : <XCircle className="w-4 h-4 text-muted-foreground/40 mx-auto" />;
  }
  return <span className="text-sm text-muted-foreground">{value}</span>;
}

export default function Plans() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-white">Plans & Entitlements</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal reference — feature matrix by tier. Mirrors{" "}
          <code className="text-xs font-mono">server/entitlements.ts</code> TIER_DEFAULTS.
        </p>
      </div>

      <Card className="bg-card border-white/10 overflow-x-auto">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium text-white">Feature Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-muted-foreground font-medium w-40">Feature</th>
                {TIERS.map((tier) => (
                  <th key={tier.name} className="text-center py-3 px-3 min-w-[120px]">
                    <div className="flex flex-col items-center gap-1">
                      <span className={`font-semibold ${tier.highlight ? "text-primary" : "text-white"}`}>
                        {tier.name}
                      </span>
                      {tier.highlight && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">Popular</Badge>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row, i) => (
                <tr
                  key={row.key}
                  className={`border-b border-white/5 ${i % 2 === 0 ? "bg-white/[0.02]" : ""}`}
                >
                  <td className="py-3 px-4 text-muted-foreground font-medium">{row.label}</td>
                  {TIERS.map((tier) => (
                    <td key={tier.name} className="py-3 px-3 text-center">
                      <FeatureCell value={tier[row.key] as string | boolean} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white">Hidden / Unbuilt Features</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Do not advertise on pricing pages until implemented:
            </p>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {[
                "Vault (encrypted storage)",
                "Password-protected shares",
                "Custom link names",
                "Remote wipe",
                "Download limit per share",
                "Recipient analytics",
                "Priority tunnel routing",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <XCircle className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-card border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-white">Trial Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Duration</span>
              <span className="text-white font-medium">14 days</span>
            </div>
            <div className="flex justify-between">
              <span>Requires credit card</span>
              <span className="text-white font-medium">No</span>
            </div>
            <div className="flex justify-between">
              <span>After trial expires</span>
              <span className="text-white font-medium">Drops to Free</span>
            </div>
            <div className="flex justify-between">
              <span>CDN cache during trial</span>
              <span className="text-white font-medium">Disabled</span>
            </div>
            <div className="flex justify-between">
              <span>Resumable downloads</span>
              <span className="text-white font-medium">Enabled</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
