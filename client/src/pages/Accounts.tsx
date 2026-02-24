import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

export default function Accounts() {
  const { data: accounts, isLoading, error } = useQuery<Account[]>({
    queryKey: ["/api/admin/accounts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/accounts");
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
    refetchInterval: 30000,
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
            <CardTitle>Error Loading Accounts</CardTitle>
            <CardDescription>Could not fetch accounts.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold text-white mb-1">Accounts</h1>
        <p className="text-muted-foreground text-sm">
          User accounts (Phase 2) • {accounts?.length ?? 0} total
        </p>
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
              All accounts
            </CardTitle>
            <CardDescription>Email, trial and subscription status (Stripe + Razorpay)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Trial used</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Renewal</TableHead>
                  <TableHead>Grace ends</TableHead>
                  <TableHead>Razorpay sub</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Account ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts ?? []).map((a) => {
                  const provider = a.razorpaySubscriptionId
                    ? "Razorpay"
                    : a.stripeCustomerId
                    ? "Stripe"
                    : "—";
                  return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.email}</TableCell>
                    <TableCell>{a.trialUsed ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-muted-foreground">{provider}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.subscriptionStatus ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.renewalAt ? formatDate(a.renewalAt) : "—"}
                    </TableCell>
                    <TableCell>
                      {a.graceEndsAt ? (
                        <span className="text-amber-500">{formatDate(a.graceEndsAt)}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.razorpaySubscriptionId ? a.razorpaySubscriptionId.slice(0, 12) + "…" : "—"}
                    </TableCell>
                    <TableCell>{formatDate(a.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {a.id.slice(0, 8)}…
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(!accounts || accounts.length === 0) && (
              <p className="text-center text-muted-foreground py-8">No accounts yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
