import { useEffect, useState } from 'react';
import { useAlertStream } from '../hooks/useSocket';
import { api, PurpleMetrics, VeritasStatus, BrainStatus } from '../lib/api';
import MetricCard from '../components/shared/MetricCard';
import { ShieldAlert, Clock, Activity, Lock, Cpu, Play, RefreshCw, Swords } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import { toast } from 'sonner';

export default function CommandCenter() {
  const { alerts, isConnected, totalCount, criticalCount, highCount } = useAlertStream();
  const [scorecard, setScorecard] = useState<PurpleMetrics | null>(null);
  const [veritas, setVeritas] = useState<VeritasStatus | null>(null);
  const [brain, setBrain] = useState<BrainStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sc, v, b] = await Promise.all([
          api.fetchPurpleScorecard().catch(() => null),
          api.fetchVeritasStatus().catch(() => null),
          api.fetchBrainStatus().catch(() => null)
        ]);
        if (sc) setScorecard(sc);
        if (v) setVeritas(v);
        if (b) setBrain(b);
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleStartSigma = async () => {
    try {
      await api.startSigmaLoop();
      toast.success('Sigma Loop started successfully');
    } catch (e: any) {
      toast.error(`Failed to start Sigma Loop: ${e.message}`);
    }
  };

  const handleEvolveRules = async () => {
    try {
      await api.runKineticEvolver('Manual');
      toast.success('Kinetic Rules evolving');
    } catch (e: any) {
      toast.error(`Evolution failed: ${e.message}`);
    }
  };

  const handleWargaming = async () => {
    const target = prompt('Enter Target Asset IP/Domain for Wargaming:');
    if (!target) return;
    try {
      await api.startWargaming(target);
      toast.success(`Wargaming initiated on ${target}`);
    } catch (e: any) {
      toast.error(`Wargaming failed: ${e.message}`);
    }
  };

  const mockActivityData = [
    { time: '00:00', critical: 2, high: 5, medium: 10, low: 20 },
    { time: '04:00', critical: 1, high: 2, medium: 8, low: 15 },
    { time: '08:00', critical: 5, high: 12, medium: 25, low: 40 },
    { time: '12:00', critical: 8, high: 15, medium: 30, low: 50 },
    { time: '16:00', critical: 3, high: 8, medium: 18, low: 35 },
    { time: '20:00', critical: 4, high: 10, medium: 20, low: 45 },
  ];

  const radarData = scorecard ? [
    { subject: 'Detection', A: scorecard.detectionCoverage * 100, fullMark: 100 },
    { subject: 'Response', A: Math.max(0, 100 - (scorecard.meanTimeToRespond / 10)), fullMark: 100 },
    { subject: 'Evasion', A: scorecard.evasionSuccessRate * 100, fullMark: 100 },
    { subject: 'False Pos', A: scorecard.falsePositiveRate * 100, fullMark: 100 },
    { subject: 'RoE Comp', A: scorecard.roeComplianceRate * 100, fullMark: 100 },
  ] : [];

  if (loading) {
    return <div className="p-8 text-cyan-400">Loading Command Center...</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6 custom-scrollbar">
      
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard icon={ShieldAlert} label="Active Threats" value={criticalCount + highCount} color="rose" />
        <MetricCard icon={Clock} label="MTTD" value={scorecard?.meanTimeToDetect || 0} unit="s" color="amber" />
        <MetricCard icon={Clock} label="MTTR" value={scorecard?.meanTimeToRespond || 0} unit="s" color="cyan" />
        <MetricCard icon={Activity} label="Coverage" value={((scorecard?.detectionCoverage || 0) * 100).toFixed(1)} unit="%" color="emerald" />
        <MetricCard icon={Lock} label="Veritas Blocks" value={veritas?.chainLength || 0} color="violet" />
        <MetricCard icon={Cpu} label="Train Samples" value={brain?.harvester?.totalSamples || 0} color="blue" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-80">
        <div className="lg:col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 tracking-wider">THREAT ACTIVITY — LAST 24H</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mockActivityData}>
                <XAxis dataKey="time" stroke="#475569" fontSize={12} />
                <YAxis stroke="#475569" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                <Area type="monotone" dataKey="critical" stackId="1" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.2} />
                <Area type="monotone" dataKey="high" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                <Area type="monotone" dataKey="medium" stackId="1" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.2} />
                <Area type="monotone" dataKey="low" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 tracking-wider">PURPLE TEAM SCORES</h3>
          <div className="flex-1 min-h-0">
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Radar name="Score" dataKey="A" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-500">No Data Available</div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Alerts */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col overflow-hidden">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 tracking-wider">RECENT ALERTS</h3>
          <div className="overflow-x-auto flex-1 custom-scrollbar">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="text-xs uppercase bg-slate-800/50 text-slate-400">
                <tr>
                  <th className="px-3 py-2 rounded-tl-md">Type</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2 rounded-tr-md">Time</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 5).map(alert => (
                  <tr key={alert.id} className="border-b border-slate-800 hover:bg-slate-800/20">
                    <td className="px-3 py-2 font-mono text-xs">{alert.threatType}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${alert.severity === 'CRITICAL' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-cyan-400">{alert.sourceIp}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{new Date(alert.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* System Health */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 tracking-wider">SYSTEM HEALTH</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Socket Stream</span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                </span>
                <span className="font-mono text-xs">{isConnected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">AI Engine</span>
              <div className="flex items-center gap-2">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                <span className="font-mono text-xs">LOCAL</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Database (PgSQL)</span>
              <div className="flex items-center gap-2">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                <span className="font-mono text-xs">ONLINE</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">eBPF Module</span>
              <div className="flex items-center gap-2">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                <span className="font-mono text-xs text-amber-400">STANDBY</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 tracking-wider">QUICK ACTIONS</h3>
          <div className="flex flex-col gap-3">
            <button onClick={handleStartSigma} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm transition-colors border border-slate-700 hover:border-cyan-500/50">
              <Play size={16} className="text-cyan-400" />
              Start Sigma Loop
            </button>
            <button onClick={handleEvolveRules} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm transition-colors border border-slate-700 hover:border-violet-500/50">
              <RefreshCw size={16} className="text-violet-400" />
              Evolve Kinetic Rules
            </button>
            <button onClick={handleWargaming} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm transition-colors border border-slate-700 hover:border-rose-500/50">
              <Swords size={16} className="text-rose-400" />
              Start Wargaming
            </button>
            <button className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm transition-colors border border-slate-700 hover:border-amber-500/50">
              <Lock size={16} className="text-amber-400" />
              Rotate Crypto Key
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
