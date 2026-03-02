import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle, DollarSign, TrendingUp, Users, CreditCard, Calendar, ChevronDown, ChevronUp, Search, BarChart3, Monitor, Globe, Smartphone, Laptop, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface License {
  id: string;
  accountId: string;
  tier: string;
  deviceLimit: number;
  issuedAt: number;
  expiresAt: number;
  state: string;
  planInterval?: string | null;
  graceEndsAt?: number | null;
  renewalAt?: number | null;
  customQuota?: number | null;
  paymentMethod?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
  paymentProvider?: string | null;
  invoiceId?: string | null;
  discountPercent?: number | null;
  notes?: string | null;
}

interface AccountWithBilling {
  id: string;
  email: string;
  trialUsed: boolean;
  createdAt: string;
  updatedAt: string;
  stripeCustomerId?: string | null;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  renewalAt?: string | null;
  graceEndsAt?: string | null;
  razorpayCustomerId?: string | null;
  razorpaySubscriptionId?: string | null;
  license?: License | null;
  teamMembers?: Array<{ accountId: string; email: string; role: string }>;
}

interface BillingSummary {
  totalMonthlyRevenue: number;
  totalYearlyRevenue: number;
  totalActiveSubscriptions: number;
  totalTrialAccounts: number;
  revenueByTier: { tier: string; monthly: number; yearly: number; count: number }[];
  revenueByProvider: { provider: string; amount: number; count: number }[];
}

interface SubscriptionStats {
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  trialUsers: number;
  churnRate: number;
  revenueByPlan: { plan: string; amount: number; count: number }[];
  revenueByDevice: { platform: string; amount: number; count: number }[];
  revenueByCountry: { country: string; amount: number; count: number }[];
}

interface Payment {
  id: string;
  subscriptionId: string;
  accountId: string;
  deviceId: string | null;
  provider: string;
  providerPaymentId: string;
  amount: number;
  currency: string;
  status: string;
  invoiceUrl: string | null;
  createdAt: string;
  accountEmail?: string;
}

export default function Subscriptions() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"subscriptions" | "payments">("subscriptions");

  const { data: accounts, isLoading: accountsLoading, error: accountsError } = useQuery<AccountWithBilling[]>({
    queryKey: ["/api/admin/accounts-with-billing"],
    queryFn: async () => {
      const res = await fetch("/api/admin/accounts-with-billing");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: billingSummary, isLoading: summaryLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/admin/billing/summary"],
    queryFn: async () => {
      const res = await fetch("/api/admin/billing/summary");
      if (!res.ok) throw new Error("Failed to fetch billing summary");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: subscriptionStats } = useQuery<SubscriptionStats>({
    queryKey: ["/api/admin/subscription-stats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/subscription-stats");
      if (!res.ok) throw new Error("Failed to fetch subscription stats");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: payments, isLoading: paymentsLoading } = useQuery<Payment[]>({
    queryKey: ["/api/admin/payments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payments");
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
    enabled: activeTab === "payments",
    refetchInterval: 30000,
  });

  const formatDate = (dateStr: string | number | null | undefined) => {
    if (!dateStr) return "—";
    const date = typeof dateStr === "number" ? new Date(dateStr * 1000) : new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (amount: number | null | undefined, currency: string = "INR") => {
    if (amount == null) return "—";
    const value = amount / 100;
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getPlanDisplay = (license: License | null | undefined): { label: string; color: string } => {
    if (!license) return { label: "—", color: "bg-muted text-muted-foreground" };
    
    const tier = license.tier;
    
    const colors: Record<string, string> = {
      trial: "bg-blue-500/20 text-blue-400",
      pro: "bg-emerald-500/20 text-emerald-400",
      teams: "bg-purple-500/20 text-purple-400",
      custom: "bg-amber-500/20 text-amber-400",
    };
    
    // Show the actual tier/plan (Pro, Teams, Custom, or Trial)
    if (tier === "pro" || tier === "teams" || tier === "custom" || tier === "trial") {
      return { label: tier.charAt(0).toUpperCase() + tier.slice(1), color: colors[tier] };
    }
    
    return { label: tier?.toUpperCase() || "—", color: "bg-muted" };
  };

  const planBadge = (license: License | null | undefined) => {
    const { label, color } = getPlanDisplay(license);
    if (label === "—") return <span className="text-muted-foreground">—</span>;
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>
        {label}
      </span>
    );
  };

  const getStatusDisplay = (license: License | null | undefined): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } => {
    if (!license) return { label: "No License", variant: "outline" };
    
    const state = license.state;
    const now = Math.floor(Date.now() / 1000);
    const isExpired = license.expiresAt && license.expiresAt < now;
    
    // Trial state - show "Trial" status
    if (state === "trial_active") {
      return { label: "Trial", variant: "secondary" };
    }
    
    // Active paid state
    if (state === "active") {
      return { label: "Active", variant: "default" };
    }
    
    // Grace period
    if (state === "grace") {
      return { label: "Grace Period", variant: "destructive" };
    }
    
    // Not active states
    if (state === "expired" || state === "revoked" || isExpired) {
      return { label: "Not Active", variant: "outline" };
    }
    
    return { label: "Not Active", variant: "outline" };
  };

  const statusBadge = (license: License | null | undefined) => {
    const { label, variant } = getStatusDisplay(license);
    return <Badge variant={variant}>{label}</Badge>;
  };

  const tierBadge = (tier: string | null | undefined) => {
    if (!tier) return <span className="text-muted-foreground">—</span>;
    const colors: Record<string, string> = {
      trial: "bg-blue-500/20 text-blue-400",
      pro: "bg-emerald-500/20 text-emerald-400",
      teams: "bg-purple-500/20 text-purple-400",
      custom: "bg-amber-500/20 text-amber-400",
    };
    const label = tier.charAt(0).toUpperCase() + tier.slice(1);
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[tier] ?? "bg-muted"}`}>
        {label}
      </span>
    );
  };

  const paymentMethodBadge = (method: string | null | undefined) => {
    if (!method) return <span className="text-muted-foreground">—</span>;
    const colors: Record<string, string> = {
      online: "bg-green-500/20 text-green-400",
      offline: "bg-yellow-500/20 text-yellow-400",
      offer: "bg-pink-500/20 text-pink-400",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[method] ?? "bg-muted"}`}>
        {method.toUpperCase()}
      </span>
    );
  };

  const filtered = useMemo(() => {
    let list = accounts ?? [];
    
    // Search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((a) => 
        a.email.toLowerCase().includes(q) ||
        a.license?.id?.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
      );
    }
    
    // Status filter
    if (statusFilter !== "all") {
      list = list.filter((a) => {
        if (statusFilter === "with_subscription") return !!a.subscriptionId || !!a.razorpaySubscriptionId || (a.license && a.license.state === "active");
        if (statusFilter === "razorpay") return !!a.razorpaySubscriptionId;
        if (statusFilter === "stripe") return !!a.stripeCustomerId;
        if (statusFilter === "grace") return !!a.graceEndsAt || a.license?.state === "grace";
        if (statusFilter === "trial") return a.license?.state === "trial_active";
        if (statusFilter === "teams") return a.license?.tier === "teams";
        if (statusFilter === "pro") return a.license?.tier === "pro";
        if (statusFilter === "suspended") return a.license?.state === "suspended";
        return a.subscriptionStatus === statusFilter || a.license?.state === statusFilter;
      });
    }
    
    return list;
  }, [accounts, searchQuery, statusFilter]);

  const withSub = (accounts ?? []).filter((a) => !!a.subscriptionId || !!a.razorpaySubscriptionId || (a.license && a.license.state === "active")).length;
  const inGrace = (accounts ?? []).filter((a) => !!a.graceEndsAt || a.license?.state === "grace").length;

  const getPlatformIcon = (platform: string) => {
    const p = platform?.toLowerCase() || "";
    if (p.includes("mac") || p.includes("darwin")) return <Laptop className="w-4 h-4" />;
    if (p.includes("win")) return <Monitor className="w-4 h-4" />;
    if (p.includes("linux")) return <Monitor className="w-4 h-4" />;
    if (p.includes("ios") || p.includes("android")) return <Smartphone className="w-4 h-4" />;
    return <Globe className="w-4 h-4" />;
  };

  if (accountsError) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <Card className="max-w-md border-red-500/20">
          <CardHeader>
            <CardTitle>Error Loading Subscriptions</CardTitle>
            <CardDescription>Could not fetch accounts.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const isLoading = accountsLoading || summaryLoading;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Subscriptions & Billing</h1>
        <p className="text-muted-foreground text-sm">
          Revenue summary, billing details, and subscription status by account
        </p>
      </div>

      {/* Revenue Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              MRR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-400">
              {isLoading ? "..." : formatCurrency(subscriptionStats?.mrr ?? billingSummary?.totalMonthlyRevenue ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Monthly Recurring Revenue</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              ARR
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-400">
              {isLoading ? "..." : formatCurrency(subscriptionStats?.arr ?? billingSummary?.totalYearlyRevenue ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">Annual Recurring Revenue</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-500" />
              Active Subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "..." : subscriptionStats?.activeSubscriptions ?? billingSummary?.totalActiveSubscriptions ?? withSub}</p>
            <p className="text-xs text-muted-foreground">Paying customers</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              In Grace / Trial
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {isLoading ? "..." : `${inGrace} / ${subscriptionStats?.trialUsers ?? billingSummary?.totalTrialAccounts ?? 0}`}
            </p>
            <p className="text-xs text-muted-foreground">Grace period / Trial</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-red-500" />
              Churn Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-400">
              {isLoading ? "..." : `${(subscriptionStats?.churnRate ?? 0).toFixed(1)}%`}
            </p>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Tier & Provider */}
      {billingSummary && (billingSummary.revenueByTier.length > 0 || billingSummary.revenueByProvider.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2 mb-6">
          {billingSummary.revenueByTier.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Revenue by Tier</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {billingSummary.revenueByTier.map((t) => (
                    <div key={t.tier} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {tierBadge(t.tier)}
                        <span className="text-sm text-muted-foreground">({t.count} accounts)</span>
                      </div>
                      <span className="font-medium">{formatCurrency(t.monthly)}/mo</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {billingSummary.revenueByProvider.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Revenue by Provider</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {billingSummary.revenueByProvider.map((p) => (
                    <div key={p.provider} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4" />
                        <span className="capitalize">{p.provider}</span>
                        <span className="text-sm text-muted-foreground">({p.count})</span>
                      </div>
                      <span className="font-medium">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tab Buttons */}
      <div className="flex gap-2 mb-6">
        <Button 
          variant={activeTab === "subscriptions" ? "default" : "outline"} 
          onClick={() => setActiveTab("subscriptions")}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Subscriptions
        </Button>
        <Button 
          variant={activeTab === "payments" ? "default" : "outline"} 
          onClick={() => setActiveTab("payments")}
          className="flex items-center gap-2"
        >
          <Receipt className="w-4 h-4" />
          Payment History
        </Button>
      </div>

      {/* Subscriptions Table */}
      {activeTab === "subscriptions" && (isLoading ? (
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-muted rounded w-1/3" />
              <div className="h-32 bg-muted rounded" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Account Billing Details
            </CardTitle>
            <CardDescription>
              Click on a row to see detailed billing information for each account.
            </CardDescription>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[240px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  <SelectItem value="with_subscription">With subscription</SelectItem>
                  <SelectItem value="pro">Pro tier</SelectItem>
                  <SelectItem value="teams">Teams tier</SelectItem>
                  <SelectItem value="trial">In trial</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                  <SelectItem value="razorpay">Razorpay</SelectItem>
                  <SelectItem value="grace">In grace</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">
                Showing {filtered.length} of {accounts?.length || 0}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Renewal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <>
                    <TableRow 
                      key={a.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedAccount(expandedAccount === a.id ? null : a.id)}
                    >
                      <TableCell>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                          {expandedAccount === a.id ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{a.email}</TableCell>
                      <TableCell>{planBadge(a.license)}</TableCell>
                      <TableCell>{statusBadge(a.license)}</TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(a.license?.amountPaid, a.license?.currency ?? "INR")}
                        {a.license?.planInterval && (
                          <span className="text-xs text-muted-foreground ml-1">
                            /{a.license.planInterval === "yearly" ? "yr" : "mo"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{paymentMethodBadge(a.license?.paymentMethod)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(a.license?.renewalAt ?? a.renewalAt)}
                      </TableCell>
                    </TableRow>
                    {expandedAccount === a.id && (
                      <TableRow key={`${a.id}-details`}>
                        <TableCell colSpan={7} className="bg-muted/30 p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">License ID</p>
                              <p className="font-mono text-xs">{a.license?.id?.slice(0, 16) ?? "—"}...</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Provider</p>
                              <p className="capitalize">{a.license?.paymentProvider ?? (a.razorpaySubscriptionId ? "razorpay" : a.stripeCustomerId ? "stripe" : "—")}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Invoice ID</p>
                              <p className="font-mono text-xs">{a.license?.invoiceId ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Discount</p>
                              <p>{a.license?.discountPercent ? `${a.license.discountPercent}%` : "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Issued At</p>
                              <p>{formatDate(a.license?.issuedAt)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Expires At</p>
                              <p>{formatDate(a.license?.expiresAt)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Device Limit</p>
                              <p>{a.license?.deviceLimit ?? "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Grace Ends</p>
                              <p className={a.graceEndsAt || a.license?.graceEndsAt ? "text-amber-500" : ""}>
                                {formatDate(a.license?.graceEndsAt ?? a.graceEndsAt) || "—"}
                              </p>
                            </div>
                            {a.license?.notes && (
                              <div className="col-span-4">
                                <p className="text-muted-foreground">Notes</p>
                                <p className="text-sm">{a.license.notes}</p>
                              </div>
                            )}
                            {a.teamMembers && a.teamMembers.length > 0 && (
                              <div className="col-span-4">
                                <p className="text-muted-foreground mb-2">Team Members ({a.teamMembers.length})</p>
                                <div className="flex flex-wrap gap-2">
                                  {a.teamMembers.map((m) => (
                                    <Badge key={m.accountId} variant="outline">
                                      {m.email} ({m.role})
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No accounts match the filter.</p>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Payments Tab */}
      {activeTab === "payments" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Payment History
            </CardTitle>
            <CardDescription>
              All payment transactions with LTV (Lifetime Value) per customer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {paymentsLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-8 bg-muted rounded w-1/3" />
                <div className="h-32 bg-muted rounded" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(payments ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {p.accountEmail || p.accountId.slice(0, 12) + "..."}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {p.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(p.amount, p.currency)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "captured" ? "default" : p.status === "failed" ? "destructive" : "secondary"}>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {p.invoiceUrl ? (
                          <a 
                            href={p.invoiceUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline text-sm"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!paymentsLoading && (!payments || payments.length === 0) && (
              <p className="text-sm text-muted-foreground py-4 text-center">No payments recorded yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
