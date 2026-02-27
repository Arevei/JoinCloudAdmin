import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as SettingsIcon, CreditCard, AlertTriangle } from "lucide-react";
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

type PaymentMode = "LIVE" | "DEV";

interface AdminSettings {
  payment_mode: PaymentMode;
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

  const setPaymentMode = useMutation({
    mutationFn: async (payment_mode: PaymentMode) => {
      const res = await fetch("/api/v1/admin/settings/payment-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ payment_mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update payment mode");
      }
      return res.json();
    },
    onSuccess: (_, payment_mode) => {
      queryClient.setQueryData(["/api/v1/admin/settings"], { payment_mode });
      toast({
        title: "Payment mode updated",
        description: `Payment mode is now ${payment_mode}.`,
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

  const paymentMode = settings?.payment_mode ?? "LIVE";

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
            <CreditCard className="w-5 h-5" />
            Payment Mode
          </CardTitle>
          <CardDescription>
            LIVE uses Razorpay checkout. DEV bypasses payments for instant license activation during development.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {paymentMode === "DEV" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>DEV payment mode active</AlertTitle>
              <AlertDescription>
                DEV payment mode bypasses Razorpay. &quot;Get Pro&quot; and &quot;Get Teams&quot; will instantly grant licenses without payment.
              </AlertDescription>
            </Alert>
          )}
          <RadioGroup
            value={paymentMode}
            onValueChange={(v) => setPaymentMode.mutate(v as PaymentMode)}
            disabled={isLoading || setPaymentMode.isPending}
            className="flex gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="LIVE" id="live" />
              <Label htmlFor="live" className="cursor-pointer font-medium">
                LIVE
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="DEV" id="dev" />
              <Label htmlFor="dev" className="cursor-pointer font-medium">
                DEV
              </Label>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
