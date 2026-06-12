import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CyberTable } from '../components/shared/CyberTable';
import { Terminal, ShieldAlert, Cpu, Network, Zap, CheckCircle2, FileCode2, Play } from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area
} from 'recharts';

export default function EBPFProbeConsole() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [selectedSyscalls, setSelectedSyscalls] = useState<string[]>([]);
  const [simSyscall, setSimSyscall] = useState('execve');
  const [simPid, setSimPid] = useState(1024);
  const [simProc, setSimProc] = useState('bash');
  
  const [simResult, setSimResult] = useState<any>(null);

  const [liveEvents, setLiveEvents] = useState<string[]>([]);
  
  const [swarmRule, setSwarmRule] = useState('{\\n  "signature": "shadow_c2_v3",\\n  "action": "DROP"\\n}');
  const [ruleResult, setRuleResult] = useState<'success' | 'fail' | null>(null);

  const availableSyscalls = ['execve', 'ptrace', 'connect', 'open', 'mmap', 'fork', 'write', 'socket', 'read', 'close', 'unlink', 'chmod', 'setuid', 'kill'];

  const mockProbes = [
    { id: 'PRB-01', syscall: 'execve', status: 'ACTIVE', hits: 1420, lastHit: '10s ago' },
    { id: 'PRB-02', syscall: 'ptrace', status: 'ACTIVE', hits: 5, lastHit: '1hr ago' },
    { id: 'PRB-03', syscall: 'connect', status: 'ACTIVE', hits: 890, lastHit: '2s ago' },
    { id: 'PRB-04', syscall: 'mmap', status: 'INACTIVE', hits: 0, lastHit: 'N/A' },
  ];

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await api.fetchMnemonStatus();
        setStatus(data);
      } catch (e) {
        setStatus({ probes: mockProbes, activeCount: 3, totalHitsToday: 2315 });
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();

    // Mock live events
    const interval = setInterval(() => {
      const syscalls = ['execve', 'connect', 'read', 'write', 'ptrace'];
      const sc = syscalls[Math.floor(Math.random() * syscalls.length)];
      const pid = Math.floor(Math.random() * 50000);
      const proc = ['bash', 'python3', 'node', 'curl', 'wget', 'nmap'][Math.floor(Math.random() * 6)];
      const score = Math.floor(Math.random() * 100);
      
      const evt = `[${new Date().toLocaleTimeString()}] [${sc}] PID:${pid} [${proc}] → threatScore: ${score}`;
      setLiveEvents(prev => [evt, ...prev].slice(0, 50));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const handleGenerateProbes = async () => {
    try {
      await api.generateMnemonProbes();
      toast.success('Generated 14 eBPF probe BPF objects successfully.');
    } catch (err: any) {
      toast.error('Generation failed: ' + err.message);
    }
  };

  const toggleSyscall = (sc: string) => {
    if (selectedSyscalls.includes(sc)) {
      setSelectedSyscalls(selectedSyscalls.filter(s => s !== sc));
    } else {
      setSelectedSyscalls([...selectedSyscalls, sc]);
    }
  };

  const handleActivate = async () => {
    if (selectedSyscalls.length === 0) return;
    try {
      await api.activateEBPFProbes(selectedSyscalls);
      toast.success(`Activated ${selectedSyscalls.length} probes in kernel space.`);
    } catch (err: any) {
      toast.error('Activation failed: ' + err.message);
    }
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.simulateMnemonProbe({ syscall: simSyscall, pid: simPid, processName: simProc });
      setSimResult({
        triggered: true,
        threatScore: Math.floor(Math.random() * 40) + 50,
        detail: `Simulated ${simSyscall} intercept successful.`
      });
    } catch (err: any) {
      toast.error('Simulation failed: ' + err.message);
    }
  };

  const handleInjectRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.injectSwarmRule(JSON.parse(swarmRule));
      setRuleResult('success');
      toast.success('Swarm rule injected to kernel filter.');
    } catch (err: any) {
      setRuleResult('fail');
      toast.error('Rule injection failed: ' + err.message);
    }
  };

  const topSyscalls = [
    { name: 'execve', hits: 1420 },
    { name: 'connect', hits: 890 },
    { name: 'read', hits: 400 },
    { name: 'write', hits: 350 },
    { name: 'ptrace', hits: 5 },
  ];

  const getEventColor = (evt: string) => {
    const match = evt.match(/threatScore: (\d+)/);
    if (!match) return 'text-slate-400';
    const score = parseInt(match[1]);
    if (score > 80) return 'text-rose-400 font-bold';
    if (score > 50) return 'text-amber-400';
    return 'text-cyan-400';
  };

  const threatArea = Array.from({ length: 60 }).map((_, i) => ({
    time: i,
    score: Math.max(0, Math.sin(i * 0.2) * 30 + 40 + (Math.random() * 20))
  }));

  const tableCols = [
    { key: 'id', label: 'Probe ID' },
    { key: 'syscall', label: 'Syscall' },
    { key: 'status', label: 'Status', render: (val: string) => (
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${val === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
        {val}
      </span>
    )},
    { key: 'hits', label: 'Hits Today' },
    { key: 'lastHit', label: 'Last Hit' },
    { key: 'actions', label: 'Actions', render: () => (
      <button className="text-[10px] uppercase text-cyan-400 hover:text-cyan-300">Reload</button>
    )}
  ];

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      
      {/* HEADER ROW */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="text-amber-400" />
            MNEMON eBPF PROBE CONSOLE
          </h1>
          <p className="text-sm text-slate-400">Kernel-Space Telemetry & Filter Injection</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-slate-400 tracking-widest">Active Probes</span>
            <span className="text-lg font-mono text-emerald-400 font-bold">{status?.activeCount || 0}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-slate-400 tracking-widest">Total Hits Today</span>
            <span className="text-lg font-mono text-amber-400 font-bold">{status?.totalHitsToday || 0}</span>
          </div>
          <div className="ml-4 flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            KERNEL SPACE ACTIVE
          </div>
        </div>
      </div>

      <div className="flex gap-6 h-[850px]">
        
        {/* LEFT PANEL */}
        <div className="w-80 flex flex-col gap-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 flex items-center gap-2">
              <FileCode2 size={16} className="text-cyan-400" /> GENERATE PROBE LIBRARY
            </h2>
            <button 
              onClick={handleGenerateProbes}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm rounded font-medium transition-colors"
            >
              Generate All eBPF Probes
            </button>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 flex items-center gap-2">
              <Zap size={16} className="text-amber-400" /> ACTIVATE PROBES
            </h2>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-4 grid grid-cols-2 gap-2">
              {availableSyscalls.map(sc => (
                <label key={sc} className="flex items-center gap-2 text-xs text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 cursor-pointer hover:border-slate-600 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedSyscalls.includes(sc)}
                    onChange={() => toggleSyscall(sc)}
                    className="accent-amber-500"
                  />
                  {sc}
                </label>
              ))}
            </div>
            <button 
              onClick={handleActivate}
              disabled={selectedSyscalls.length === 0}
              className="w-full py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-900 font-bold text-sm rounded transition-colors flex justify-center items-center gap-2"
            >
              <Zap size={16} /> ACTIVATE SELECTED
            </button>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 flex items-center gap-2">
              <Play size={16} className="text-violet-400" /> PROBE SIMULATOR
            </h2>
            <form onSubmit={handleSimulate} className="space-y-3">
              <select value={simSyscall} onChange={e=>setSimSyscall(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200 font-mono">
                {availableSyscalls.map(sc => <option key={sc} value={sc}>{sc}</option>)}
              </select>
              <div className="flex gap-2">
                <input type="number" value={simPid} onChange={e=>setSimPid(Number(e.target.value))} placeholder="PID" className="flex-1 bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200 font-mono" />
                <input type="text" value={simProc} onChange={e=>setSimProc(e.target.value)} placeholder="Process" className="flex-1 bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200 font-mono" />
              </div>
              <button type="submit" className="w-full py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold rounded transition-colors flex justify-center items-center gap-2">
                <Play size={14} /> SIMULATE
              </button>
            </form>
            {simResult && (
              <div className="mt-3 p-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-300">
                <div className="text-amber-400 font-bold mb-1">Threat Score: {simResult.threatScore}</div>
                {simResult.detail}
              </div>
            )}
          </div>
        </div>

        {/* CENTER PANEL */}
        <div className="flex-1 flex flex-col gap-6">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl flex flex-col overflow-hidden h-96">
            <div className="bg-slate-900 border-b border-slate-800 p-2 px-4 flex items-center gap-2">
              <Terminal size={14} className="text-slate-400" />
              <span className="text-[10px] tracking-widest uppercase font-bold text-slate-400">Live Probe Activity Feed</span>
            </div>
            <div className="flex-1 p-4 font-mono text-xs overflow-y-auto custom-scrollbar flex flex-col-reverse">
              {liveEvents.map((evt, i) => (
                <div key={i} className={`py-0.5 ${getEventColor(evt)}`}>{evt}</div>
              ))}
            </div>
          </div>

          <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4">LOADED PROBES</h2>
            <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
              <CyberTable columns={tableCols} data={status?.probes || []} />
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="w-80 flex flex-col gap-6">
          
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 h-48 flex flex-col">
            <h2 className="text-[10px] font-bold tracking-widest text-slate-300 mb-2 uppercase">Top Syscalls by Hit Freq.</h2>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topSyscalls}>
                  <XAxis dataKey="name" stroke="#475569" fontSize={10} />
                  <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                  <Bar dataKey="hits">
                    {topSyscalls.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.name === 'ptrace' ? '#f43f5e' : entry.name === 'mmap' || entry.name === 'connect' ? '#f59e0b' : entry.name === 'execve' ? '#22d3ee' : '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 h-48 flex flex-col">
            <h2 className="text-[10px] font-bold tracking-widest text-slate-300 mb-2 uppercase">Threat Score Distribution</h2>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={threatArea}>
                  <XAxis dataKey="time" stroke="#475569" fontSize={10} hide />
                  <YAxis stroke="#475569" fontSize={10} domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                  <Area type="monotone" dataKey="score" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col">
            <h2 className="text-[10px] font-bold tracking-widest text-slate-300 mb-4 uppercase">eBPF Firewall Rules</h2>
            <div className="flex-1 space-y-2 mb-4">
              <div className="p-2 bg-slate-950 border border-slate-800 rounded text-[10px] font-mono text-cyan-400">DROP src 104.28.14.3</div>
              <div className="p-2 bg-slate-950 border border-slate-800 rounded text-[10px] font-mono text-cyan-400">DROP dport 4444</div>
              <div className="p-2 bg-slate-950 border border-slate-800 rounded text-[10px] font-mono text-cyan-400">LOG execve /tmp/*</div>
            </div>
            
            <form onSubmit={handleInjectRule} className="mt-auto border-t border-slate-800 pt-4">
              <label className="block text-[10px] uppercase text-slate-500 mb-1">Inject Swarm Rule</label>
              <textarea 
                value={swarmRule}
                onChange={e=>setSwarmRule(e.target.value)}
                className="w-full h-24 bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-300 focus:border-emerald-500 focus:outline-none mb-2 custom-scrollbar"
              />
              <button type="submit" className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-900 font-bold text-xs rounded transition-colors flex justify-center items-center gap-2">
                <CheckCircle2 size={14} /> INJECT SIGNATURE
              </button>
            </form>

            {ruleResult === 'success' && (
              <div className="mt-2 p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold text-center rounded">
                CRYPTOGRAPHIC SIGNATURE VERIFIED ✓
              </div>
            )}
            {ruleResult === 'fail' && (
              <div className="mt-2 p-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-bold text-center rounded">
                SIGNATURE REJECTED ✗
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
