import { useEffect, useState } from 'react';
import { api, FedStatus } from '../lib/api';
import { Network, Server, RefreshCw, Send, Activity, ShieldCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar
} from 'recharts';

export default function FederationControl() {
  const [status, setStatus] = useState<FedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Registration Form State
  const [regNodeId, setRegNodeId] = useState('');
  const [regEndpoint, setRegEndpoint] = useState('');
  
  // Update Form State
  const [updNodeId, setUpdNodeId] = useState('');
  const [updDataSize, setUpdDataSize] = useState(100);

  const [nodes, setNodes] = useState([
    { id: 'node-alpha', endpoint: 'https://alpha.soc.local', lastSubmit: Date.now() - 300000, rate: '95%', dataSize: 620 },
    { id: 'node-beta', endpoint: 'https://beta.soc.local', lastSubmit: Date.now() - 4000000, rate: '78%', dataSize: 340 },
    { id: 'node-gamma', endpoint: 'https://gamma.soc.local', lastSubmit: Date.now() - 120000, rate: '99%', dataSize: 850 },
  ]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await api.fetchFederationStatus();
        setStatus(data);
      } catch (e) {
        console.error('Failed to fetch federation status', e);
        setStatus({
          round: 42,
          participantCount: 3,
          globalWeights: [],
          loss: 0.32,
          timestamp: new Date().toISOString()
        });
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRegisterNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regNodeId || !regEndpoint) return;
    try {
      await api.registerFederationNode({ nodeId: regNodeId, endpoint: regEndpoint });
      toast.success(`Node ${regNodeId} registered to the swarm.`);
      setNodes(prev => [...prev, { id: regNodeId, endpoint: regEndpoint, lastSubmit: Date.now(), rate: '100%', dataSize: 0 }]);
      setRegNodeId('');
      setRegEndpoint('');
    } catch (err: any) {
      toast.error('Registration failed: ' + err.message);
    }
  };

  const handleSubmitUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updNodeId) return;
    try {
      const mockGradients = Array.from({length: 128}, () => Math.random() - 0.5);
      await api.submitFederationUpdate({ nodeId: updNodeId, dataSize: updDataSize, gradients: mockGradients });
      toast.success(`Gradients submitted for ${updNodeId}`);
    } catch (err: any) {
      toast.error('Submission failed: ' + err.message);
    }
  };

  const handleAggregate = async () => {
    try {
      await api.aggregateFederation();
      toast.success('FedAvg aggregation successful. Global model updated.');
      if (status) setStatus({ ...status, round: status.round + 1, loss: status.loss * 0.95 });
    } catch (err: any) {
      toast.error('Aggregation failed: ' + err.message);
    }
  };

  const handleDistribute = async () => {
    try {
      await api.distributeFederationModel();
      toast.success('Global model distributed to all nodes.');
    } catch (err: any) {
      toast.error('Distribution failed: ' + err.message);
    }
  };

  const mockLossCurve = Array.from({ length: status?.round || 42 }).map((_, i) => ({
    round: i + 1,
    loss: Math.max(0.2, 2.4 * Math.exp(-i * 0.08) + (Math.random() * 0.2))
  }));

  const radarData = nodes.map(n => ({
    subject: n.id,
    A: n.dataSize,
    fullMark: 1000
  }));

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      
      {/* TOP STRIP */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Network className="text-cyan-400" />
            FEDERATED LEARNING
          </h1>
          <p className="text-sm text-slate-400">Swarm Intelligence Network & Distributed Training</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg flex flex-col items-end">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest">Global Round</span>
            <span className="text-lg font-mono text-cyan-400 font-bold">{status?.round || 0}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            FedAvg Protocol Active
          </div>
        </div>
      </div>

      <div className="flex gap-6 h-[800px]">
        
        {/* LEFT PANEL */}
        <div className="w-80 flex flex-col gap-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 border-b border-slate-800 pb-2">NODE REGISTRY</h2>
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
              {nodes.map(n => {
                const isStale = (Date.now() - n.lastSubmit) > 3600000;
                return (
                  <div key={n.id} className="p-3 bg-slate-800/30 border border-slate-700 rounded-lg text-sm relative overflow-hidden">
                    <div className={`absolute top-0 left-0 w-1 h-full ${isStale ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-slate-200">{n.id}</span>
                      <span className="text-xs text-slate-400">{n.rate} ptc</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono truncate">{n.endpoint}</div>
                  </div>
                )
              })}
            </div>
            
            <form onSubmit={handleRegisterNode} className="mt-4 pt-4 border-t border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-400">REGISTER NEW NODE</h3>
              <input type="text" value={regNodeId} onChange={e=>setRegNodeId(e.target.value)} placeholder="Node ID" className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200" />
              <input type="url" value={regEndpoint} onChange={e=>setRegEndpoint(e.target.value)} placeholder="Endpoint URL" className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200" />
              <button type="submit" className="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm rounded font-medium transition-colors">Register Node</button>
            </form>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 border-b border-slate-800 pb-2">SUBMIT UPDATE (TEST)</h2>
            <form onSubmit={handleSubmitUpdate} className="space-y-3">
              <select value={updNodeId} onChange={e=>setUpdNodeId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200">
                <option value="">Select Node...</option>
                {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
              </select>
              <input type="number" value={updDataSize} onChange={e=>setUpdDataSize(Number(e.target.value))} placeholder="Data Size" className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200" />
              <div className="text-[10px] text-slate-500 font-mono italic">(Gradients auto-generated)</div>
              <button type="submit" className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded font-medium transition-colors">Submit Gradients</button>
            </form>
          </div>
        </div>

        {/* CENTER PANEL */}
        <div className="flex-1 flex flex-col gap-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 h-72 flex flex-col">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4">FEDAVG CONVERGENCE CURVE</h2>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockLossCurve}>
                  <XAxis dataKey="round" stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                  <Area type="monotone" dataKey="loss" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 h-64 flex flex-col">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4">GRADIENT CONTRIBUTIONS PER NODE</h2>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={nodes}>
                  <XAxis dataKey="id" stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                  <Bar dataKey="dataSize">
                    {nodes.map((n, i) => (
                      <Cell key={`cell-${i}`} fill={n.dataSize > 500 ? '#10b981' : n.dataSize > 100 ? '#f59e0b' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex-1">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 border-b border-slate-800 pb-2">AGGREGATION CONTROLS</h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
                <div className="text-xs text-slate-500 uppercase">Current Round</div>
                <div className="text-xl text-slate-200 font-mono">{status?.round}</div>
              </div>
              <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
                <div className="text-xs text-slate-500 uppercase">Pending Updates</div>
                <div className="text-xl text-emerald-400 font-mono">{status?.participantCount}</div>
              </div>
              <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
                <div className="text-xs text-slate-500 uppercase">Min Req. Nodes</div>
                <div className="text-xl text-slate-200 font-mono">3</div>
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={handleAggregate} className="flex-1 flex items-center justify-center gap-2 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold transition-colors">
                <RefreshCw size={18} /> RUN FEDAVG AGGREGATION
              </button>
              <button onClick={handleDistribute} className="flex-1 flex items-center justify-center gap-2 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg font-bold transition-colors">
                <Send size={18} /> DISTRIBUTE GLOBAL MODEL
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="w-72 flex flex-col gap-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col">
            <h2 className="text-sm font-bold tracking-widest text-slate-300 mb-4 border-b border-slate-800 pb-2">HEALTH MONITOR</h2>
            
            <div className="grid grid-cols-2 gap-2 mb-6">
              {nodes.map(n => {
                const isStale = (Date.now() - n.lastSubmit) > 3600000;
                return (
                  <div key={n.id} className="bg-slate-950 border border-slate-800 rounded p-2 flex flex-col items-center justify-center gap-1">
                    <Server size={16} className={isStale ? 'text-amber-500' : 'text-emerald-500'} />
                    <span className="text-[10px] text-slate-400 truncate w-full text-center">{n.id}</span>
                  </div>
                )
              })}
            </div>

            <div className="space-y-4 mb-6">
              <div className="bg-slate-950 p-3 rounded border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">Total Params Trained</span>
                <span className="text-sm text-cyan-400 font-mono">47.3M</span>
              </div>
              <div className="bg-slate-950 p-3 rounded border border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">Avg Gradient Norm</span>
                <span className="text-sm text-emerald-400 font-mono">0.0214</span>
              </div>
            </div>

            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 text-center">Node Participation Balance</h3>
            <div className="flex-1 min-h-0 border border-slate-800 rounded bg-slate-950/50 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="60%" data={radarData}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Radar dataKey="A" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-400/90 leading-tight">
                Node-beta has not submitted gradients in &gt;1 hour. Consider pruning from next round if inactive.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
