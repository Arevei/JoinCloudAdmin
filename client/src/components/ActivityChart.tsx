import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
} from 'recharts';
import { format } from "date-fns";

interface ActivityData {
  date: string;
  activeUsers: number;
  filesUploaded: number;
  filesDownloaded: number;
  sharesCreated: number;
  avgUptimeHours: number;
  dataProcessedBytes: number;
  uploadBytes: number;
  downloadBytes: number;
}

interface ActivityChartProps {
  data: ActivityData[];
  isLoading?: boolean;
}

export function ActivityChart({ data, isLoading }: ActivityChartProps) {
  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6 h-[400px] animate-pulse">
        <div className="h-6 w-48 bg-white/10 rounded mb-8" />
        <div className="h-[300px] w-full bg-white/5 rounded-lg" />
      </div>
    );
  }

  const sortedData = [...data].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="glass-card rounded-2xl p-6 border border-white/5 h-[400px]">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-display font-semibold text-white">Daily Activity</h3>
        <div className="flex gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-primary" /> Active Users
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-purple-500" /> Files Uploaded
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-emerald-500" /> Files Downloaded
          </div>
        </div>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sortedData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(200, 100%, 59%)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="hsl(200, 100%, 59%)" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorUploads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorDownloads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
            </defs>
            
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            
            <XAxis 
              dataKey="date" 
              stroke="#666" 
              tick={{ fill: '#666', fontSize: 12 }} 
              tickLine={false}
              axisLine={false}
              tickFormatter={(str) => format(new Date(str), 'MMM d')}
              dy={10}
            />
            
            <YAxis 
              stroke="#666" 
              tick={{ fill: '#666', fontSize: 12 }} 
              tickLine={false}
              axisLine={false}
              dx={-10}
            />
            
            <Tooltip
              contentStyle={{ 
                backgroundColor: '#141414', 
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                color: '#fff',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
              }}
              itemStyle={{ color: '#ccc' }}
              labelStyle={{ color: '#666', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}
              labelFormatter={(label) => format(new Date(label), 'MMMM d, yyyy')}
            />
            
            <Area 
              type="monotone" 
              dataKey="activeUsers" 
              name="Active Users"
              stroke="hsl(200, 100%, 59%)" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorUsers)" 
              activeDot={{ r: 6, strokeWidth: 0, fill: "hsl(200, 100%, 59%)" }}
            />
            
            <Area 
              type="monotone" 
              dataKey="filesUploaded" 
              name="Files Uploaded"
              stroke="#a855f7" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorUploads)" 
            />
            
            <Area 
              type="monotone" 
              dataKey="filesDownloaded" 
              name="Files Downloaded"
              stroke="#10b981" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorDownloads)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
