import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";

type SubscriptionMode = "manual" | "automatic";

interface AdminSettings {
  subscription_mode: SubscriptionMode;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<AdminSettings>({
    queryKey: ["/api/v1/admin/settings"],
    queryFn: async () => {
      const res = await fetch("/api/v1/admin/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  const setSubscriptionMode = useMutation({
    mutationFn: async (subscription_mode: SubscriptionMode) => {
      const res = await fetch("/api/v1/admin/settings/subscription-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription_mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update subscription mode");
      }
      return res.json();
    },
    onSuccess: (_, subscription_mode) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], (prev: AdminSettings | undefined) => ({ ...(prev ?? {}), subscription_mode }));
      toast({
        title: "Subscription mode updated",
        description: `Subscription mode is now ${subscription_mode}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Failed to update",
        description: err.message,
      });
    },
  });

  const subscriptionMode = settings?.subscription_mode ?? "automatic";

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" />
          System Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Control plane configuration
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Subscription Mode
          </CardTitle>
          <CardDescription>
            Automatic: Stripe/Razorpay handle renewals. Manual: licenses are granted by admin or manual verification; no automatic renewal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={subscriptionMode}
            onValueChange={(v) => setSubscriptionMode.mutate(v as SubscriptionMode)}
            disabled={isLoading || setSubscriptionMode.isPending}
            className="flex gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="automatic" id="sub-auto" />
              <Label htmlFor="sub-auto" className="cursor-pointer font-medium">
                Automatic
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="manual" id="sub-manual" />
              <Label htmlFor="sub-manual" className="cursor-pointer font-medium">
                Manual
              </Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
