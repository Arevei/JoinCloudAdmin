import React from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import UserDetails from "@/pages/UserDetails";
import UserAnalytics from "@/pages/UserAnalytics";
import Leaderboard from "@/pages/Leaderboard";
import SupportInbox from "@/pages/SupportInbox";
import SupportThread from "@/pages/SupportThread";
import Accounts from "@/pages/Accounts";
import Licenses from "@/pages/Licenses";
import Subscriptions from "@/pages/Subscriptions";
import ManualRequests from "@/pages/ManualRequests";
import Updates from "@/pages/Updates";
import Settings from "@/pages/Settings";
import Unauthorized from "@/pages/Unauthorized";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { Button } from "@/components/ui/button";
import { useCanWrite } from "./auth/usePermission";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/unauthorized" component={Unauthorized} />
      <Route path="/users" component={Users} />
      <Route path="/users/:deviceUUID" component={UserDetails} />
      <Route path="/users/:deviceUUID/analytics" component={UserAnalytics} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/support" component={SupportInbox} />
      <Route path="/support/:deviceUUID" component={SupportThread} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/licenses" component={Licenses} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/manual-requests" component={ManualRequests} />
      <Route path="/updates" component={Updates} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function GoogleSignInButton() {
  return (
    <Button
      size="lg"
      variant="outline"
      className="flex items-center gap-2 mx-auto"
      onClick={() => {
        window.location.href = "/auth/google";
      }}
    >
      <span className="inline-block w-4 h-4 bg-white rounded-full" />
      <span>Sign in with Google</span>
    </Button>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Checking access…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="max-w-md text-center space-y-4">
          <p className="text-red-400 font-medium">Error: {error}</p>
          <GoogleSignInButton />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-display font-bold text-white">Access restricted</h1>
          <p className="text-muted-foreground">
            Sign in with an authorized Google account to access the JoinCloud admin panel.
          </p>
          <GoogleSignInButton />
        </div>
      </div>
    );
  }

  // role="user" gets read-only access with a banner
  return <>{children}</>;
}

function ReadOnlyBanner() {
  const { user } = useAuth();
  const canWrite = useCanWrite();
  if (!user || canWrite) return null;
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-400 text-xs font-medium">
      <span>View-only mode — your account has read-only access. Contact a super admin to request elevated permissions.</span>
    </div>
  );
}

function App() {
  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <AdminGuard>
              <div className="flex h-screen w-full bg-background flex-col">
                <ReadOnlyBanner />
                <div className="flex flex-1 overflow-hidden">
                  <AppSidebar />
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <header className="flex items-center gap-2 p-2 border-b border-white/5 bg-background/50 backdrop-blur-xl md:hidden">
                      <SidebarTrigger data-testid="button-sidebar-toggle" />
                    </header>
                    <main className="flex-1 overflow-y-auto">
                      <Router />
                    </main>
                  </div>
                </div>
              </div>
            </AdminGuard>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
