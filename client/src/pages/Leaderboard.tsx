import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Trophy,
  Clock,
  Upload,
  Share2,
  Eye,
  Medal
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

interface LeaderboardEntry {
  deviceUUID: string;
  deviceIndex: number;
  platform: string;
  value: number;
}

interface LeaderboardData {
  byUptime: LeaderboardEntry[];
  byFilesUploaded: LeaderboardEntry[];
  bySharesCreated: LeaderboardEntry[];
}

export default function Leaderboard() {
  const { data, isLoading, error } = useQuery<LeaderboardData>({
    queryKey: ['/api/admin/leaderboard'],
  });

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h`;
  };

  const getRankStyle = (rank: number) => {
    if (rank === 1) return 'text-yellow-400';
    if (rank === 2) return 'text-gray-300';
    if (rank === 3) return 'text-amber-600';
    return 'text-muted-foreground';
  };

  const getRankIcon = (rank: number) => {
    if (rank <= 3) {
      return <Medal className={`w-5 h-5 ${getRankStyle(rank)}`} />;
    }
    return <span className="w-5 text-center text-muted-foreground">{rank}</span>;
  };

  const LeaderboardList = ({ 
    entries, 
    formatValue 
  }: { 
    entries: LeaderboardEntry[] | undefined;
    formatValue: (val: number) => string;
  }) => {
    if (!entries || entries.length === 0) {
      return (
        <div className="glass-card rounded-xl p-8 text-center">
          <Trophy className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No data yet</p>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div 
            key={entry.deviceUUID}
            className={`glass-card rounded-xl p-4 flex items-center gap-4 ${
              index < 3 ? 'border-l-4' : ''
            } ${
              index === 0 ? 'border-l-yellow-400' : 
              index === 1 ? 'border-l-gray-300' : 
              index === 2 ? 'border-l-amber-600' : ''
            }`}
            data-testid={`leaderboard-entry-${index}`}
          >
            <div className="flex items-center justify-center w-8">
              {getRankIcon(index + 1)}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">
                  Device #{entry.deviceIndex}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {entry.deviceUUID.slice(0, 8)}...
                </span>
              </div>
              <span className="text-xs text-muted-foreground">{entry.platform}</span>
            </div>

            <div className="text-right">
              <span className={`text-lg font-bold ${index < 3 ? 'text-white' : 'text-muted-foreground'}`}>
                {formatValue(entry.value)}
              </span>
            </div>

            <Link href={`/users/${entry.deviceUUID}/analytics`}>
              <Button 
                variant="ghost" 
                size="sm"
                data-testid={`button-view-user-${index}`}
              >
                <Eye className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        ))}
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="glass-card max-w-md p-8 rounded-2xl text-center border-red-500/20">
          <h2 className="text-xl font-bold text-white mb-2">Error Loading Leaderboard</h2>
          <p className="text-muted-foreground">Could not fetch leaderboard data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <Trophy className="w-6 h-6 text-yellow-400" />
          <h1 className="text-2xl font-display font-bold text-white">Leaderboard</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Top users by engagement metrics
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass-card rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 bg-white/10 rounded-full" />
                <div className="flex-1">
                  <div className="h-5 bg-white/10 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-white/5 rounded w-1/4" />
                </div>
                <div className="h-6 bg-white/10 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Tabs defaultValue="uptime" className="w-full">
          <TabsList className="mb-4 w-full justify-start">
            <TabsTrigger value="uptime" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Uptime
            </TabsTrigger>
            <TabsTrigger value="uploads" className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Files Uploaded
            </TabsTrigger>
            <TabsTrigger value="shares" className="flex items-center gap-2">
              <Share2 className="w-4 h-4" />
              Shares Created
            </TabsTrigger>
          </TabsList>

          <TabsContent value="uptime">
            <LeaderboardList 
              entries={data?.byUptime} 
              formatValue={formatUptime}
            />
          </TabsContent>

          <TabsContent value="uploads">
            <LeaderboardList 
              entries={data?.byFilesUploaded} 
              formatValue={(val) => val.toLocaleString()}
            />
          </TabsContent>

          <TabsContent value="shares">
            <LeaderboardList 
              entries={data?.bySharesCreated} 
              formatValue={(val) => val.toLocaleString()}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
