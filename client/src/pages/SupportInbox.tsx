import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  MessageSquare,
  Clock,
  ChevronRight,
  Inbox
} from "lucide-react";

interface SupportThreadPreview {
  deviceUUID: string;
  deviceIndex: number;
  lastMessageText: string;
  lastMessageSender: 'device' | 'admin';
  lastActivityAt: string;
  messageCount: number;
  hasUnread: boolean;
}

export default function SupportInbox() {
  const { data: threads, isLoading, error } = useQuery<SupportThreadPreview[]>({
    queryKey: ['/api/admin/support/threads'],
    refetchInterval: 5000,
  });

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const truncateText = (text: string, maxLen: number = 60) => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen).trim() + '...';
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <h2 className="text-xl font-bold text-white mb-2">Error Loading Support</h2>
          <p className="text-muted-foreground">Could not fetch support threads.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <MessageSquare className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-display font-bold text-white">Support</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Conversations with devices • {threads?.length || 0} active
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-white/10 rounded-full" />
                <div className="flex-1">
                  <div className="h-5 bg-white/10 rounded w-1/4 mb-2" />
                  <div className="h-4 bg-white/5 rounded w-3/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !threads || threads.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No Conversations</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Support threads will appear here when users or you start conversations.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <Link 
              key={thread.deviceUUID} 
              href={`/support/${thread.deviceUUID}`}
            >
              <a 
                className="glass-card rounded-xl p-4 flex items-center gap-4 hover:border-white/20 transition-colors block"
                data-testid={`support-thread-${thread.deviceIndex}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  thread.hasUnread 
                    ? 'bg-primary/10 text-primary' 
                    : 'bg-white/5 text-muted-foreground'
                }`}>
                  <MessageSquare className="w-5 h-5" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-white">
                      Device #{thread.deviceIndex}
                    </span>
                    {thread.hasUnread && (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                    <span className="text-xs text-muted-foreground font-mono ml-auto flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getTimeAgo(thread.lastActivityAt)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    <span className="text-white/60">
                      {thread.lastMessageSender === 'admin' ? 'You: ' : 'Device: '}
                    </span>
                    {truncateText(thread.lastMessageText)}
                  </p>
                </div>

                <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              </a>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
