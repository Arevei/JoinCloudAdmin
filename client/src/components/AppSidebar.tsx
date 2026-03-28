import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { 
  LayoutDashboard, 
  Users, 
  Trophy, 
  MessageSquare,
  Activity,
  Key,
  CreditCard,
  Receipt,
  Download,
  Settings,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SupportThreadPreview {
  deviceUUID: string;
  hasUnread: boolean;
}

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Users",
    url: "/users",
    icon: Users,
  },
  {
    title: "Leaderboard",
    url: "/leaderboard",
    icon: Trophy,
  },
  {
    title: "Support",
    url: "/support",
    icon: MessageSquare,
  },
  {
    title: "Accounts",
    url: "/accounts",
    icon: CreditCard,
  },
  {
    title: "Licenses",
    url: "/licenses",
    icon: Key,
  },
  {
    title: "Subscriptions",
    url: "/subscriptions",
    icon: Receipt,
  },
  {
    title: "Manual Requests",
    url: "/manual-requests",
    icon: ClipboardList,
  },
  {
    title: "Updates",
    url: "/updates",
    icon: Download,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const { data: threads } = useQuery<SupportThreadPreview[]>({
    queryKey: ['/api/admin/support/threads'],
    refetchInterval: 5000,
  });

  const unreadCount = threads?.filter(t => t.hasUnread).length || 0;

  const isActive = (url: string) => {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-white/5 p-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <img src="/favicon.png" alt=""/>
          </div>
          <div>
            <h1 className="text-sm font-display font-bold tracking-tight text-white">
              JoinCloud
            </h1>
            <p className="text-xs text-muted-foreground">Control Plane</p>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={isActive(item.url)}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="w-4 h-4" />
                      <span className="flex-1">{item.title}</span>
                      {item.title === "Support" && unreadCount > 0 && (
                        <Badge 
                          variant="default" 
                          className="ml-auto bg-primary text-primary-foreground text-xs px-1.5 py-0.5 min-w-[20px] text-center"
                          data-testid="badge-unread-count"
                        >
                          {unreadCount}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-white/5 p-4">
        {user ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-white font-medium truncate" title={user.email}>
                  {user.email}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Role: <span className="font-mono">{user.role}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => logout()}
              >
                Logout
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              System Operational
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
            Not signed in
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
