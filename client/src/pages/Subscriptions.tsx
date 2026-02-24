import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertTriangle } from "lucide-react";
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

interface Account {
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
}

export default function Subscriptions() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: accounts, isLoading, error } = useQuery<Account[]>({
    queryKey: ["/api/admin/accounts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const statusBadge = (status: string | null | undefined) => {
    if (!status) return <Badge variant="outline">None</Badge>;
    const v: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "default",
      trialing: "secondary",
      past_due: "destructive",
      unpaid: "destructive",
      canceled: "outline",
    };
    return <Badge variant={v[status] ?? "outline"}>{status}</Badge>;
  };

  const filtered = (accounts ?? []).filter((a) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "with_subscription") return !!a.subscriptionId || !!a.razorpaySubscriptionId;
    if (statusFilter === "razorpay") return !!a.razorpaySubscriptionId;
    if (statusFilter === "grace") return !!a.graceEndsAt;
    return a.subscriptionStatus === statusFilter;
  });

  const withSub = (accounts ?? []).filter((a) => !!a.subscriptionId || !!a.razorpaySubscriptionId).length;
  const inGrace = (accounts ?? []).filter((a) => !!a.graceEndsAt).length;

  if (error) {
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Subscriptions</h1>
        <p className="text-muted-foreground text-sm">
          Subscription status and renewal by account
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">With subscription</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{withSub}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              In grace
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{inGrace}</p>
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
              <RefreshCw className="w-5 h-5" />
              Subscription status by account
            </CardTitle>
            <CardDescription>
              Filter by status. Renewal and grace dates from payment webhooks.
            </CardDescription>
            <div className="pt-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  <SelectItem value="with_subscription">With subscription</SelectItem>
                  <SelectItem value="razorpay">Razorpay only</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trialing">Trialing</SelectItem>
                  <SelectItem value="past_due">Past due</SelectItem>
                  <SelectItem value="grace">In grace</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Renewal</TableHead>
                  <TableHead>Grace ends</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.email}</TableCell>
                    <TableCell>{statusBadge(a.subscriptionStatus)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(a.renewalAt)}</TableCell>
                    <TableCell>
                      {a.graceEndsAt ? (
                        <span className="text-amber-500">{formatDate(a.graceEndsAt)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-4">No accounts match the filter.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
