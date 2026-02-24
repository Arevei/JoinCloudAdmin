import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  Legend
} from 'recharts';

interface VersionChartProps {
  data: Record<string, number>;
  isLoading?: boolean;
}

const COLORS = ['#2FB7FF', '#a855f7', '#10b981', '#f59e0b', '#ef4444'];

export function VersionChart({ data, isLoading }: VersionChartProps) {
  const chartData = Object.entries(data).map(([name, value]) => ({ name, value }));

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6 h-[400px] animate-pulse">
        <div className="h-6 w-32 bg-white/10 rounded mb-8" />
        <div className="flex items-center justify-center h-[300px]">
          <div className="w-48 h-48 rounded-full border-8 border-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl p-6 border border-white/5 h-[400px]">
      <h3 className="text-lg font-display font-semibold text-white mb-2">App Versions</h3>
      <p className="text-xs text-muted-foreground mb-4">Distribution of installed versions</p>
      
      <div className="h-[280px] w-full relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={5}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={COLORS[index % COLORS.length]} 
                  style={{ filter: 'drop-shadow(0px 0px 4px rgba(0,0,0,0.5))' }}
                />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#141414', 
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#fff'
              }}
              formatter={(value: number) => [`${value} users`, 'Users']}
            />
            <Legend 
              verticalAlign="bottom" 
              height={36}
              iconType="circle"
              iconSize={8}
            />
          </PieChart>
        </ResponsiveContainer>
        
        {/* Center Text */}
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[60%] text-center pointer-events-none">
          <div className="text-2xl font-bold text-white">{chartData.reduce((a, b) => a + b.value, 0)}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Installs</div>
        </div>
      </div>
    </div>
  );
}
