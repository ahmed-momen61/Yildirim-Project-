import { useState } from 'react';
import { api } from '../lib/api';
import { Shield, Play, Activity, Network, FileSearch } from 'lucide-react';
import { toast } from 'sonner';

export default function BlueFortress() {
  const [oracleIps, setOracleIps] = useState('');
  const [forensicData, setForensicData] = useState('');
  const [isProcessing, setIsProcessing] = useState<Record<string, boolean>>({});

  const handleAction = async (
    moduleName: string, 
    apiCall: (payload?: any) => Promise<any>, 
    payload?: any
  ) => {
    setIsProcessing(prev => ({ ...prev, [moduleName]: true }));
    try {
      await apiCall(payload);
      toast.success(`${moduleName} executed successfully.`);
    } catch (e: any) {
      toast.error(`${moduleName} failed: ${e.message}`);
    } finally {
      setIsProcessing(prev => ({ ...prev, [moduleName]: false }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Shield className="text-cyan-400" />
          BLUE FORTRESS
        </h1>
        <p className="text-sm text-slate-400">Defensive Shielding, Live Detection, and Forensic Analysis</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl">
        
        {/* Oracle GNN */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-lg hover:border-cyan-500/30 transition-all">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Network size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-200">Oracle GNN</h3>
              <p className="text-sm text-slate-400 mt-1">Graph Neural Network ingestion for anomaly detection across network topology.</p>
            </div>
          </div>
          <div className="mt-auto pt-4 border-t border-slate-800/50 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">INGESTION TARGET (IPs)</label>
              <input 
                type="text" 
                value={oracleIps}
                onChange={(e) => setOracleIps(e.target.value)}
                placeholder="e.g., 10.0.0.5, 10.0.0.6"
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
            <button 
              onClick={() => handleAction('Oracle GNN Ingest', api.ingestGNNTraffic, [{ ip: oracleIps, risk: 50 }])}
              disabled={isProcessing['Oracle GNN Ingest'] || !oracleIps}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
            >
              <Play size={16} />
              INGEST TRAFFIC LOGS
            </button>
          </div>
        </div>

        {/* Sigma Loop */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-lg hover:border-cyan-500/30 transition-all">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Activity size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-200">Sigma Loop Live</h3>
              <p className="text-sm text-slate-400 mt-1">Real-time YARA and Sigma rule execution engine across the entire fleet.</p>
            </div>
          </div>
          <div className="mt-auto pt-4 border-t border-slate-800/50">
            <button 
              onClick={() => handleAction('Sigma Loop', api.startSigmaLoop)}
              disabled={isProcessing['Sigma Loop']}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
            >
              {isProcessing['Sigma Loop'] ? <span className="animate-pulse">STARTING LOOP...</span> : <><Play size={16} /> ACTIVATE LIVE DETECTION</>}
            </button>
          </div>
        </div>

        {/* Kinetic Filter */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-lg hover:border-cyan-500/30 transition-all">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Shield size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-200">Kinetic Filter</h3>
              <p className="text-sm text-slate-400 mt-1">Adaptive firewall module. Evolves iptables rules autonomously based on AI anomaly detection context.</p>
            </div>
          </div>
          <div className="mt-auto pt-4 border-t border-slate-800/50 space-y-3">
            <button 
              onClick={() => handleAction('Kinetic Evolver', api.runKineticEvolver, 'Automated Threat Context')}
              disabled={isProcessing['Kinetic Evolver']}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
            >
              <Play size={16} />
              EVOLVE RULES NOW
            </button>
          </div>
        </div>

        {/* Galileo Forensics */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-lg hover:border-cyan-500/30 transition-all">
          <div className="flex items-start gap-3">
            <div className="p-3 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <FileSearch size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-200">Galileo RCA Agent</h3>
              <p className="text-sm text-slate-400 mt-1">LLM-powered Root Cause Analysis. Generates post-mortem reports and maps attack chains automatically.</p>
            </div>
          </div>
          <div className="mt-auto pt-4 border-t border-slate-800/50 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">INCIDENT DATA / ALERT ID</label>
              <input 
                type="text" 
                value={forensicData}
                onChange={(e) => setForensicData(e.target.value)}
                placeholder="e.g., ALT-8821 or Raw Logs"
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 font-mono"
              />
            </div>
            <button 
              onClick={() => handleAction('Galileo Forensics', api.runGalileoForensics, { context: forensicData })}
              disabled={isProcessing['Galileo Forensics'] || !forensicData}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
            >
              <FileSearch size={16} />
              RUN RCA ANALYSIS
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
