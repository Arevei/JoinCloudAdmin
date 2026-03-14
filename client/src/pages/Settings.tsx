import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, RefreshCw, Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type SubscriptionMode = "manual" | "automatic";

interface AdminSettings {
  subscription_mode: SubscriptionMode;
  payment_mode?: string;
  dev_trial_minutes?: number;
  dev_expiry_warning_minutes?: number;
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

  const setDevTrialMinutes = useMutation({
    mutationFn: async (dev_trial_minutes: number) => {
      const res = await fetch("/api/v1/admin/settings/dev-trial-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dev_trial_minutes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: (_, dev_trial_minutes) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], (prev: AdminSettings | undefined) => ({ ...(prev ?? {}), dev_trial_minutes }));
      toast({ title: "Dev trial duration updated", description: `New trials in dev mode will last ${dev_trial_minutes} minutes.` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed to update", description: err.message }),
  });

  const setDevExpiryWarningMinutes = useMutation({
    mutationFn: async (dev_expiry_warning_minutes: number) => {
      const res = await fetch("/api/v1/admin/settings/dev-expiry-warning-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dev_expiry_warning_minutes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update");
      }
      return res.json();
    },
    onSuccess: (_, dev_expiry_warning_minutes) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], (prev: AdminSettings | undefined) => ({ ...(prev ?? {}), dev_expiry_warning_minutes }));
      toast({ title: "Dev expiry warning updated", description: `Electron will emphasize expiry when under ${dev_expiry_warning_minutes} minutes.` });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed to update", description: err.message }),
  });

  const subscriptionMode = settings?.subscription_mode ?? "automatic";
  const devTrialMinutes = settings?.dev_trial_minutes ?? 7;
  const devExpiryWarningMinutes = settings?.dev_expiry_warning_minutes ?? 2;

  const [localDevTrialMinutes, setLocalDevTrialMinutes] = useState(devTrialMinutes);
  const [localDevExpiryWarningMinutes, setLocalDevExpiryWarningMinutes] = useState(devExpiryWarningMinutes);
  useEffect(() => {
    setLocalDevTrialMinutes(devTrialMinutes);
  }, [devTrialMinutes]);
  useEffect(() => {
    setLocalDevExpiryWarningMinutes(devExpiryWarningMinutes);
  }, [devExpiryWarningMinutes]);

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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Dev Mode Trial Timing
          </CardTitle>
          <CardDescription>
            When LICENSE_TIME_MODE=dev or DEV_MODE=true, trial duration uses minutes instead of days. These settings control how long new trials last in dev and when the Electron app shows an expiry warning.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dev-trial-minutes">Trial duration in dev (minutes)</Label>
            <Input
              id="dev-trial-minutes"
              type="number"
              min={1}
              max={60}
              value={localDevTrialMinutes}
              onChange={(e) => setLocalDevTrialMinutes(Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              onBlur={() => {
                const v = Math.min(60, Math.max(1, localDevTrialMinutes || 7));
                if (v !== devTrialMinutes) setDevTrialMinutes.mutate(v);
              }}
              disabled={isLoading || setDevTrialMinutes.isPending}
            />
            <p className="text-xs text-muted-foreground">New trials in dev mode will last this many minutes (1–60).</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dev-expiry-warning-minutes">Show expiry warning when under (minutes)</Label>
            <Input
              id="dev-expiry-warning-minutes"
              type="number"
              min={0}
              max={60}
              value={localDevExpiryWarningMinutes}
              onChange={(e) => setLocalDevExpiryWarningMinutes(Math.min(60, Math.max(0, parseInt(e.target.value, 10) || 0)))}
              onBlur={() => {
                const v = Math.min(60, Math.max(0, localDevExpiryWarningMinutes ?? 2));
                if (v !== devExpiryWarningMinutes) setDevExpiryWarningMinutes.mutate(v);
              }}
              disabled={isLoading || setDevExpiryWarningMinutes.isPending}
            />
            <p className="text-xs text-muted-foreground">Electron can emphasize the countdown when remaining time is below this (0–60).</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
