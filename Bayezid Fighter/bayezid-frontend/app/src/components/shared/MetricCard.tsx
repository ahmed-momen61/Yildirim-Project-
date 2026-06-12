import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  color: 'rose' | 'amber' | 'cyan' | 'emerald' | 'violet' | 'blue';
  trend?: string;
}

export default function MetricCard({ icon: Icon, label, value, unit, color, trend }: MetricCardProps) {
  const colorMap = {
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  };

  const glowMap = {
    rose: 'shadow-[0_0_15px_rgba(244,63,94,0.2)]',
    amber: 'shadow-[0_0_15px_rgba(251,191,36,0.2)]',
    cyan: 'shadow-[0_0_15px_rgba(34,211,238,0.2)]',
    emerald: 'shadow-[0_0_15px_rgba(52,211,153,0.2)]',
    violet: 'shadow-[0_0_15px_rgba(139,92,246,0.2)]',
    blue: 'shadow-[0_0_15px_rgba(96,165,250,0.2)]',
  };

  return (
    <div className={`p-4 rounded-xl border bg-slate-900/50 backdrop-blur-sm flex flex-col gap-2 transition-all hover:scale-[1.02] ${colorMap[color]} ${glowMap[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</span>
        <Icon size={16} />
      </div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-2xl font-bold font-mono tracking-tight">{value}</span>
        {unit && <span className="text-sm font-medium opacity-80">{unit}</span>}
      </div>
      {trend && (
        <div className="text-xs font-medium opacity-80 mt-1">
          {trend}
        </div>
      )}
    </div>
  );
}
