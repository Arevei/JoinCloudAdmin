import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import UserAnalytics from "@/pages/UserAnalytics";
import Leaderboard from "@/pages/Leaderboard";
import Hosts from "@/pages/Hosts";
import SupportInbox from "@/pages/SupportInbox";
import SupportThread from "@/pages/SupportThread";
import Accounts from "@/pages/Accounts";
import Licenses from "@/pages/Licenses";
import Subscriptions from "@/pages/Subscriptions";
import UsageAggregates from "@/pages/UsageAggregates";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/users" component={Users} />
      <Route path="/users/:deviceUUID/analytics" component={UserAnalytics} />
      <Route path="/hosts" component={Hosts} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/support" component={SupportInbox} />
      <Route path="/support/:deviceUUID" component={SupportThread} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/licenses" component={Licenses} />
      <Route path="/subscriptions" component={Subscriptions} />
      <Route path="/usage" component={UsageAggregates} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full bg-background">
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
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
