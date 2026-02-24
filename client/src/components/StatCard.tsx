import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  isLoading?: boolean;
  className?: string;
}

export function StatCard({ title, value, icon, trend, isLoading, className }: StatCardProps) {
  if (isLoading) {
    return (
      <div className={cn("glass-card rounded-2xl p-6 flex flex-col gap-4 animate-pulse", className)}>
        <div className="flex justify-between items-start">
          <div className="h-4 w-24 bg-white/5 rounded" />
          <div className="h-10 w-10 bg-white/5 rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="h-8 w-32 bg-white/10 rounded" />
          <div className="h-4 w-16 bg-white/5 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "glass-card rounded-2xl p-6 transition-all duration-300 hover:border-primary/20 hover:shadow-primary/5 hover:translate-y-[-2px]",
      className
    )}>
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
        <div className="p-2.5 bg-primary/10 rounded-xl text-primary border border-primary/10 shadow-inner shadow-primary/5">
          {icon}
        </div>
      </div>
      
      <div className="space-y-1">
        <div className="text-3xl font-display font-bold text-white tracking-tight">
          {value}
        </div>
        
        {trend && (
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className={cn(
              "px-1.5 py-0.5 rounded text-xs",
              trend.positive 
                ? "bg-green-500/10 text-green-400 border border-green-500/20" 
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            )}>
              {trend.value > 0 ? "+" : ""}{trend.value}%
            </span>
            <span className="text-muted-foreground">{trend.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
