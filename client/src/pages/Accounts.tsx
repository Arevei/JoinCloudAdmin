import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  CreditCard, 
  Users, 
  ChevronDown, 
  ChevronUp, 
  Plus, 
  X, 
  Mail, 
  UserPlus,
  Building,
  Wallet,
  Clock,
  Shield,
  Search,
  Gift,
  MessageSquare,
  HeartHandshake,
  Link2
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

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

interface TeamInvitation {
  id: number;
  licenseId: string;
  email: string;
  invitedBy: string;
  invitedAt: string;
  status: string;
}

interface AccountWithBilling {
  id: string;
  email: string;
  username?: string | null;
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
  teamInvitations?: TeamInvitation[];
  referralCode?: string | null;
  referredBy?: string | null;
  referralCount?: number;
  referralDaysEarned?: number;
}

export default function Accounts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<AccountWithBilling | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [billingDialogOpen, setBillingDialogOpen] = useState(false);
  const [billingForm, setBillingForm] = useState({
    paymentMethod: "online" as "online" | "offline" | "offer",
    amountPaid: 0,
    currency: "INR",
    paymentProvider: "razorpay" as "stripe" | "razorpay" | "manual",
    discountPercent: 0,
    notes: "",
  });

  const { data: accounts, isLoading, error } = useQuery<AccountWithBilling[]>({
    queryKey: ["/api/admin/accounts-with-billing"],
    queryFn: async () => {
      const res = await fetch("/api/admin/accounts-with-billing");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ licenseId, email }: { licenseId: string; email: string }) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to send invitation");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts-with-billing"] });
      toast({ title: "Invitation sent", description: "Team invitation email has been recorded." });
      setInviteDialogOpen(false);
      setInviteEmail("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeInvitationMutation = useMutation({
    mutationFn: async (invitationId: number) => {
      const res = await fetch(`/api/admin/invitations/${invitationId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove invitation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts-with-billing"] });
      toast({ title: "Invitation removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove invitation", variant: "destructive" });
    },
  });

  const updateBillingMutation = useMutation({
    mutationFn: async ({ licenseId, data }: { licenseId: string; data: typeof billingForm }) => {
      const res = await fetch(`/api/admin/licenses/${licenseId}/billing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update billing");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/accounts-with-billing"] });
      toast({ title: "Billing updated", description: "Payment information has been saved." });
      setBillingDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
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

  const paymentMethodBadge = (method: string | null | undefined) => {
    if (!method) return <span className="text-muted-foreground">Not set</span>;
    const colors: Record<string, string> = {
      online: "bg-green-500/20 text-green-400 border-green-500/30",
      offline: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      offer: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    };
    const icons: Record<string, React.ReactNode> = {
      online: <CreditCard className="w-3 h-3 mr-1" />,
      offline: <Wallet className="w-3 h-3 mr-1" />,
      offer: <Shield className="w-3 h-3 mr-1" />,
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors[method] ?? "bg-muted"}`}>
        {icons[method]}
        {method.toUpperCase()}
      </span>
    );
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

  const stateBadge = (license: License | null | undefined) => {
    const { label, variant } = getStatusDisplay(license);
    return <Badge variant={variant}>{label}</Badge>;
  };

  const filtered = useMemo(() => {
    let list = accounts ?? [];
    
    // Search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((a) => 
        a.email.toLowerCase().includes(q) ||
        a.username?.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.referralCode?.toLowerCase().includes(q)
      );
    }
    
    // Type filter
    if (filterType !== "all") {
      list = list.filter((a) => {
        if (filterType === "teams") return a.license?.tier === "teams";
        if (filterType === "pro") return a.license?.tier === "pro";
        if (filterType === "trial") return a.license?.state === "trial_active";
        if (filterType === "active") return a.license?.state === "active";
        if (filterType === "online") return a.license?.paymentMethod === "online";
        if (filterType === "offline") return a.license?.paymentMethod === "offline";
        if (filterType === "offer") return a.license?.paymentMethod === "offer";
        if (filterType === "with_referrals") return (a.referralCount ?? 0) > 0;
        if (filterType === "referred") return !!a.referredBy;
        return true;
      });
    }
    
    return list;
  }, [accounts, searchQuery, filterType]);

  const teamsCount = (accounts ?? []).filter(a => a.license?.tier === "teams").length;
  const proCount = (accounts ?? []).filter(a => a.license?.tier === "pro").length;
  const trialCount = (accounts ?? []).filter(a => a.license?.state === "trial_active").length;
  const withReferrals = (accounts ?? []).filter(a => (a.referralCount ?? 0) > 0).length;

  const openInviteDialog = (account: AccountWithBilling) => {
    setSelectedAccount(account);
    setInviteEmail("");
    setInviteDialogOpen(true);
  };

  const openBillingDialog = (account: AccountWithBilling) => {
    setSelectedAccount(account);
    setBillingForm({
      paymentMethod: (account.license?.paymentMethod as any) ?? "online",
      amountPaid: account.license?.amountPaid ?? 0,
      currency: account.license?.currency ?? "INR",
      paymentProvider: (account.license?.paymentProvider as any) ?? "razorpay",
      discountPercent: account.license?.discountPercent ?? 0,
      notes: account.license?.notes ?? "",
    });
    setBillingDialogOpen(true);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <Card className="max-w-md border-red-500/20">
          <CardHeader>
            <CardTitle>Error Loading Accounts</CardTitle>
            <CardDescription>Could not fetch accounts.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Accounts</h1>
        <p className="text-muted-foreground text-sm">
          Account details, payment methods, and team management • {accounts?.length ?? 0} total
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-500" />
              Teams Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "..." : teamsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-500" />
              Pro Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "..." : proCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              In Trial
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "..." : trialCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gift className="w-4 h-4 text-pink-500" />
              With Referrals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "..." : withReferrals}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building className="w-4 h-4 text-muted-foreground" />
              Total Accounts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{isLoading ? "..." : accounts?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
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
              <CreditCard className="w-5 h-5" />
              All Accounts
            </CardTitle>
            <CardDescription>
              Click on an account to see details, payment info, and team members
            </CardDescription>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email, username, or referral code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[280px]"
                />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  <SelectItem value="teams">Teams tier</SelectItem>
                  <SelectItem value="pro">Pro tier</SelectItem>
                  <SelectItem value="trial">In trial</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="online">Online payment</SelectItem>
                  <SelectItem value="offline">Offline payment</SelectItem>
                  <SelectItem value="offer">Offer/Discount</SelectItem>
                  <SelectItem value="with_referrals">Has referrals</SelectItem>
                  <SelectItem value="referred">Was referred</SelectItem>
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
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Created</TableHead>
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
                      <TableCell>{stateBadge(a.license)}</TableCell>
                      <TableCell>{paymentMethodBadge(a.license?.paymentMethod)}</TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(a.license?.amountPaid, a.license?.currency ?? "INR")}
                      </TableCell>
                      <TableCell>
                        {a.license?.tier === "teams" ? (
                          <Badge variant="outline" className="gap-1">
                            <Users className="w-3 h-3" />
                            {(a.teamMembers?.length ?? 0) + 1}/5
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(a.createdAt)}</TableCell>
                    </TableRow>
                    {expandedAccount === a.id && (
                      <TableRow key={`${a.id}-details`}>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
                          <div className="space-y-4">
                            {/* Account Details */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground">Account ID</p>
                                <p className="font-mono text-xs">{a.id.slice(0, 16)}...</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Username</p>
                                <p>{a.username ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Trial Used</p>
                                <p>{a.trialUsed ? "Yes" : "No"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Provider</p>
                                <p className="capitalize">
                                  {a.license?.paymentProvider ?? (a.razorpaySubscriptionId ? "razorpay" : a.stripeCustomerId ? "stripe" : "—")}
                                </p>
                              </div>
                            </div>

                            {/* Referral Section */}
                            <div className="border-t border-border pt-4 mt-4">
                              <h4 className="font-medium flex items-center gap-2 mb-3">
                                <Gift className="w-4 h-4 text-pink-500" />
                                Referral Details
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                <div>
                                  <p className="text-muted-foreground">Referral Code</p>
                                  {a.referralCode ? (
                                    <div className="flex items-center gap-2">
                                      <code className="text-sm bg-muted px-2 py-0.5 rounded font-mono">{a.referralCode}</code>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(a.referralCode!);
                                          toast({ title: "Copied referral code" });
                                        }}
                                        className="text-muted-foreground hover:text-white"
                                      >
                                        <Link2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  ) : (
                                    <p className="text-muted-foreground">—</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Total Referrals</p>
                                  <p className="flex items-center gap-1">
                                    <HeartHandshake className="w-4 h-4 text-emerald-400" />
                                    {a.referralCount ?? 0}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Days Earned</p>
                                  <p className="text-emerald-400">+{a.referralDaysEarned ?? 0} days</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Referred By</p>
                                  {a.referredBy ? (
                                    <code className="text-sm bg-muted px-2 py-0.5 rounded font-mono">{a.referredBy}</code>
                                  ) : (
                                    <p className="text-muted-foreground">—</p>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* License Details */}
                            {a.license && (
                              <div className="border-t border-border pt-4">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="font-medium flex items-center gap-2">
                                    <Shield className="w-4 h-4" />
                                    License Details
                                  </h4>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openBillingDialog(a);
                                    }}
                                  >
                                    <Wallet className="w-4 h-4 mr-2" />
                                    Edit Billing
                                  </Button>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <p className="text-muted-foreground">License ID</p>
                                    <p className="font-mono text-xs">{a.license.id.slice(0, 16)}...</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Device Limit</p>
                                    <p>{a.license.deviceLimit}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Issued</p>
                                    <p>{formatDate(a.license.issuedAt)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Expires</p>
                                    <p>{formatDate(a.license.expiresAt)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Plan Interval</p>
                                    <p className="capitalize">{a.license.planInterval ?? "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Invoice ID</p>
                                    <p className="font-mono text-xs">{a.license.invoiceId ?? "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Discount</p>
                                    <p>{a.license.discountPercent ? `${a.license.discountPercent}%` : "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Renewal</p>
                                    <p>{formatDate(a.license.renewalAt ?? a.renewalAt)}</p>
                                  </div>
                                </div>
                                {a.license.notes && (
                                  <div className="mt-3">
                                    <p className="text-muted-foreground text-sm">Notes</p>
                                    <p className="text-sm bg-muted/50 p-2 rounded mt-1">{a.license.notes}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Team Section (only for teams tier) */}
                            {a.license?.tier === "teams" && (
                              <div className="border-t border-border pt-4">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="font-medium flex items-center gap-2">
                                    <Users className="w-4 h-4" />
                                    Team Members ({(a.teamMembers?.length ?? 0) + 1}/5)
                                  </h4>
                                  {(a.teamMembers?.length ?? 0) < 4 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openInviteDialog(a);
                                      }}
                                    >
                                      <UserPlus className="w-4 h-4 mr-2" />
                                      Invite Member
                                    </Button>
                                  )}
                                </div>

                                {/* Primary Account */}
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between bg-muted/50 p-2 rounded">
                                    <div className="flex items-center gap-2">
                                      <Mail className="w-4 h-4 text-muted-foreground" />
                                      <span className="font-medium">{a.email}</span>
                                      <Badge variant="secondary">Owner</Badge>
                                    </div>
                                  </div>

                                  {/* Team Members */}
                                  {a.teamMembers?.map((member) => (
                                    <div key={member.accountId} className="flex items-center justify-between bg-muted/50 p-2 rounded">
                                      <div className="flex items-center gap-2">
                                        <Mail className="w-4 h-4 text-muted-foreground" />
                                        <span>{member.email}</span>
                                        <Badge variant="outline">{member.role}</Badge>
                                      </div>
                                    </div>
                                  ))}

                                  {/* Pending Invitations */}
                                  {a.teamInvitations && a.teamInvitations.length > 0 && (
                                    <div className="mt-3">
                                      <p className="text-sm text-muted-foreground mb-2">Pending Invitations</p>
                                      {a.teamInvitations.map((inv) => (
                                        <div key={inv.id} className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 p-2 rounded mb-2">
                                          <div className="flex items-center gap-2">
                                            <Mail className="w-4 h-4 text-amber-500" />
                                            <span>{inv.email}</span>
                                            <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                                              Pending
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                              Invited {formatDate(inv.invitedAt)}
                                            </span>
                                          </div>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 w-6 p-0 text-red-500 hover:text-red-400"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeInvitationMutation.mutate(inv.id);
                                            }}
                                          >
                                            <X className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <p className="text-xs text-muted-foreground mt-3">
                                  When invited users sign up with their email, they will automatically be assigned to this team and share the license.
                                </p>
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
              <p className="text-center text-muted-foreground py-8">No accounts match the filter.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invite Team Member Dialog */}
      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>
              Add a team member email. When they sign up with this email, they'll automatically be added to the team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Team Owner</Label>
              <p className="text-sm text-muted-foreground">{selectedAccount?.email}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Member Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="member@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedAccount?.license?.id && inviteEmail) {
                  inviteMutation.mutate({
                    licenseId: selectedAccount.license.id,
                    email: inviteEmail,
                  });
                }
              }}
              disabled={!inviteEmail || inviteMutation.isPending}
            >
              <Plus className="w-4 h-4 mr-2" />
              {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Billing Dialog */}
      <Dialog open={billingDialogOpen} onOpenChange={setBillingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Billing Information</DialogTitle>
            <DialogDescription>
              Update payment method and billing details for {selectedAccount?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select
                value={billingForm.paymentMethod}
                onValueChange={(v) => setBillingForm({ ...billingForm, paymentMethod: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online (Card/UPI/NetBanking)</SelectItem>
                  <SelectItem value="offline">Offline (Bank Transfer/Cash)</SelectItem>
                  <SelectItem value="offer">Offer/Promotional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount (in smallest unit, e.g., paise)</Label>
                <Input
                  type="number"
                  value={billingForm.amountPaid}
                  onChange={(e) => setBillingForm({ ...billingForm, amountPaid: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  Display: {formatCurrency(billingForm.amountPaid, billingForm.currency)}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={billingForm.currency}
                  onValueChange={(v) => setBillingForm({ ...billingForm, currency: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">INR (Indian Rupee)</SelectItem>
                    <SelectItem value="USD">USD (US Dollar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Provider</Label>
                <Select
                  value={billingForm.paymentProvider}
                  onValueChange={(v) => setBillingForm({ ...billingForm, paymentProvider: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="razorpay">Razorpay</SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Discount %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={billingForm.discountPercent}
                  onChange={(e) => setBillingForm({ ...billingForm, discountPercent: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                placeholder="Optional notes about this payment"
                value={billingForm.notes}
                onChange={(e) => setBillingForm({ ...billingForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillingDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedAccount?.license?.id) {
                  updateBillingMutation.mutate({
                    licenseId: selectedAccount.license.id,
                    data: billingForm,
                  });
                }
              }}
              disabled={updateBillingMutation.isPending}
            >
              {updateBillingMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
