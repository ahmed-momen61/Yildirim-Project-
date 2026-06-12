import { useEffect, useState } from 'react';
import { api, PurpleMetrics } from '../lib/api';
import MetricCard from '../components/shared/MetricCard';
import MitreNavigator from '../components/MitreNavigator';
import { Shield, Target, Play, RotateCw } from 'lucide-react';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  LineChart, Line,
  PieChart, Pie, Cell,
  AreaChart, Area
} from 'recharts';
import { toast } from 'sonner';

export default function PurpleScorecard() {
  const [metrics, setMetrics] = useState<PurpleMetrics | null>(null);
  const [wargameTarget, setWargameTarget] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchScorecard = async () => {
    try {
      const data = await api.fetchPurpleScorecard();
      setMetrics(data);
    } catch (e) {
      console.error('Failed to fetch purple scorecard', e);
      // Fallback mock
      setMetrics({
        meanTimeToDetect: 45,
        meanTimeToRespond: 250,
        detectionCoverage: 0.88,
        falsePositiveRate: 0.05,
        evasionSuccessRate: 0.12,
        roeComplianceRate: 1.0,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScorecard();
  }, []);

  const handleStartWargame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wargameTarget) return;
    try {
      await api.startWargaming(wargameTarget);
      toast.success(`Wargame session started against ${wargameTarget}`);
      setWargameTarget('');
    } catch (err: any) {
      toast.error('Wargame failed: ' + err.message);
    }
  };

  const getMetricColor = (val: number, goodCondition: boolean, badCondition: boolean) => {
    if (goodCondition) return 'emerald';
    if (badCondition) return 'rose';
    return 'amber';
  };

  const radarData = metrics ? [
    { subject: 'MTTD', current: Math.max(0, 100 - (metrics.meanTimeToDetect)), target: 90 },
    { subject: 'MTTR', current: Math.max(0, 100 - (metrics.meanTimeToRespond / 10)), target: 80 },
    { subject: 'Coverage', current: metrics.detectionCoverage * 100, target: 95 },
    { subject: 'Precision', current: 100 - (metrics.falsePositiveRate * 100), target: 95 },
    { subject: 'Ev. Resist', current: 100 - (metrics.evasionSuccessRate * 100), target: 90 },
    { subject: 'Compliance', current: metrics.roeComplianceRate * 100, target: 100 },
  ] : [];

  const alertVolumeData = [
    { name: '00:00', CRITICAL: 4, HIGH: 12, MEDIUM: 30, LOW: 50 },
    { name: '04:00', CRITICAL: 2, HIGH: 8, MEDIUM: 25, LOW: 40 },
    { name: '08:00', CRITICAL: 8, HIGH: 22, MEDIUM: 55, LOW: 90 },
    { name: '12:00', CRITICAL: 15, HIGH: 35, MEDIUM: 80, LOW: 120 },
    { name: '16:00', CRITICAL: 10, HIGH: 28, MEDIUM: 60, LOW: 100 },
    { name: '20:00', CRITICAL: 6, HIGH: 18, MEDIUM: 40, LOW: 75 },
  ];

  const mttdTrendData = Array.from({ length: 30 }).map((_, i) => ({
    day: i + 1,
    MTTD: Math.floor(Math.random() * 40) + 20,
    MTTR: Math.floor(Math.random() * 300) + 100
  }));

  const pieData = [
    { name: 'RESOLVED', value: 450, color: '#10b981' },
    { name: 'WAITING', value: 120, color: '#f59e0b' },
    { name: 'FALSE_POS', value: 80, color: '#64748b' },
    { name: 'ESCALATED', value: 50, color: '#f43f5e' },
  ];

  const wargameHistory = [
    { epoch: 42, target: '10.0.0.5', redWins: 12, blueWins: 38, detectRate: '76%', ts: '10 mins ago' },
    { epoch: 41, target: '10.0.0.12', redWins: 15, blueWins: 35, detectRate: '70%', ts: '1 hour ago' },
    { epoch: 40, target: '10.1.5.20', redWins: 8, blueWins: 42, detectRate: '84%', ts: '3 hours ago' },
    { epoch: 39, target: '10.0.0.5', redWins: 20, blueWins: 30, detectRate: '60%', ts: '5 hours ago' },
    { epoch: 38, target: '192.168.1.10', redWins: 5, blueWins: 45, detectRate: '90%', ts: '12 hours ago' },
  ];

  const coevoData = Array.from({ length: 50 }).map((_, i) => ({
    epoch: i + 1,
    redReward: Math.min(100, Math.max(0, 50 + Math.sin(i * 0.5) * 30 + (Math.random() * 10))),
    blueReward: Math.min(100, Math.max(0, 40 + Math.cos(i * 0.5) * 30 + (i * 0.8) + (Math.random() * 10)))
  }));

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Target className="text-violet-400" />
            PURPLE SCORECARD
          </h1>
          <p className="text-sm text-slate-400">Continuous Validation & Adversarial Analytics</p>
        </div>
        <button onClick={fetchScorecard} className="p-2 bg-slate-900 border border-slate-700 hover:border-violet-500 rounded-md transition-colors text-slate-400 hover:text-violet-400">
          <RotateCw size={18} />
        </button>
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <MetricCard 
          icon={Shield} label="MTTD" value={metrics?.meanTimeToDetect || 0} unit="s" 
          color={getMetricColor(metrics?.meanTimeToDetect || 0, (metrics?.meanTimeToDetect || 0) < 30, (metrics?.meanTimeToDetect || 0) > 60)} 
        />
        <MetricCard 
          icon={Shield} label="MTTR" value={metrics?.meanTimeToRespond || 0} unit="s" 
          color={getMetricColor(metrics?.meanTimeToRespond || 0, (metrics?.meanTimeToRespond || 0) < 120, (metrics?.meanTimeToRespond || 0) > 600)} 
        />
        <MetricCard 
          icon={Target} label="Coverage" value={((metrics?.detectionCoverage || 0) * 100).toFixed(1)} unit="%" 
          color={(metrics?.detectionCoverage || 0) > 0.85 ? 'emerald' : 'amber'} 
        />
        <MetricCard 
          icon={Target} label="False Positives" value={((metrics?.falsePositiveRate || 0) * 100).toFixed(1)} unit="%" 
          color={(metrics?.falsePositiveRate || 0) > 0.10 ? 'rose' : 'emerald'} 
        />
        <MetricCard 
          icon={Target} label="Evasion Success" value={((metrics?.evasionSuccessRate || 0) * 100).toFixed(1)} unit="%" 
          color={(metrics?.evasionSuccessRate || 0) > 0.05 ? 'rose' : 'emerald'} 
        />
        <MetricCard 
          icon={Shield} label="RoE Compliance" value={((metrics?.roeComplianceRate || 0) * 100).toFixed(1)} unit="%" 
          color={(metrics?.roeComplianceRate || 0) === 1.0 ? 'emerald' : 'amber'} 
        />
      </div>

      {/* ROW 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6 h-96">
        {/* Radar Chart */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-2">COMBAT EFFECTIVENESS MATRIX</h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                <Radar name="Target" dataKey="target" stroke="#22d3ee" strokeDasharray="3 3" fill="none" />
                <Radar name="Current" dataKey="current" stroke="#a78bfa" fill="#8b5cf6" fillOpacity={0.4} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* MITRE Navigator */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col relative overflow-hidden">
          <div className="flex justify-between items-center mb-4 z-10">
            <h3 className="text-sm font-bold tracking-widest text-slate-300">MITRE ATT&CK COVERAGE</h3>
            <button className="text-xs px-3 py-1 bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 rounded border border-violet-500/30 transition-colors">
              Refresh Coverage
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar -mx-4 px-4">
            <MitreNavigator />
          </div>
        </div>
      </div>

      {/* ROW 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6 h-72">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-2">ALERT VOLUME BY SEVERITY</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={alertVolumeData}>
              <XAxis dataKey="name" stroke="#475569" fontSize={10} />
              <YAxis stroke="#475569" fontSize={10} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
              <Bar dataKey="CRITICAL" stackId="a" fill="#f43f5e" />
              <Bar dataKey="HIGH" stackId="a" fill="#f59e0b" />
              <Bar dataKey="MEDIUM" stackId="a" fill="#0ea5e9" />
              <Bar dataKey="LOW" stackId="a" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-2">MTTD VS MTTR TREND (30D)</h3>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mttdTrendData}>
              <XAxis dataKey="day" stroke="#475569" fontSize={10} />
              <YAxis yAxisId="left" stroke="#475569" fontSize={10} />
              <YAxis yAxisId="right" orientation="right" stroke="#475569" fontSize={10} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
              <Line yAxisId="left" type="monotone" dataKey="MTTD" stroke="#f59e0b" dot={false} strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="MTTR" stroke="#0ea5e9" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col items-center relative">
          <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-2 w-full text-left">ALERT DISPOSITION</h3>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none mt-6">
            <span className="text-2xl font-bold font-mono text-slate-200">700</span>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW - WARGAMING */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-80">
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-4">START NEW WARGAME</h3>
          <form onSubmit={handleStartWargame} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2">TARGET ASSET (IP/Subnet)</label>
              <input 
                type="text" 
                value={wargameTarget}
                onChange={(e) => setWargameTarget(e.target.value)}
                placeholder="10.0.0.0/24"
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 font-mono"
              />
            </div>
            <button 
              type="submit"
              disabled={!wargameTarget}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
            >
              <Play size={16} />
              INITIATE ADVERSARIAL SIMULATION
            </button>
          </form>
          
          <div className="mt-auto pt-4 border-t border-slate-800">
            <div className="text-xs text-slate-400">
              <span className="text-violet-400 font-bold tracking-widest">NOTE:</span> Wargaming involves active exploitation by Red Swarm (Chimera-X). Ensure RoE tokens are valid for the target asset.
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-0 flex overflow-hidden">
          <div className="flex-1 p-4 flex flex-col border-r border-slate-800">
            <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-4">WARGAME HISTORY</h3>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-800/50 text-slate-400 text-[10px] uppercase font-medium">
                  <tr>
                    <th className="px-3 py-2">Epoch</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Red Wins</th>
                    <th className="px-3 py-2">Blue Wins</th>
                    <th className="px-3 py-2">Detect Rate</th>
                    <th className="px-3 py-2">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {wargameHistory.map((row) => (
                    <tr key={row.epoch} className="hover:bg-slate-800/20">
                      <td className="px-3 py-2 font-mono text-violet-400">#{row.epoch}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.target}</td>
                      <td className="px-3 py-2 text-rose-400 font-mono">{row.redWins}</td>
                      <td className="px-3 py-2 text-cyan-400 font-mono">{row.blueWins}</td>
                      <td className="px-3 py-2 text-emerald-400 font-mono">{row.detectRate}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.ts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="w-1/2 p-4 flex flex-col">
            <h3 className="text-sm font-bold tracking-widest text-slate-300 mb-2">CO-EVOLUTIONARY REWARD CURVES</h3>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={coevoData}>
                  <XAxis dataKey="epoch" stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                  <Area type="monotone" dataKey="redReward" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="blueReward" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
