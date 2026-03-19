import { Button } from "@/components/ui/button";

export default function Unauthorized() {
  return (
    <div className="flex items-center justify-center h-screen px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-display font-bold text-white">Unauthorized</h1>
        <p className="text-muted-foreground">
          Your Google account is not allowed to access the JoinCloud admin panel.
        </p>
        <Button
          size="lg"
          variant="outline"
          onClick={() => {
            window.location.href = "/auth/google";
          }}
        >
          Try a different Google account
        </Button>
      </div>
    </div>
  );
}

