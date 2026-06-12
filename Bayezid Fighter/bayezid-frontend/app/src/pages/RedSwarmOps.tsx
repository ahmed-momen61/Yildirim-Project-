import { useState } from 'react';
import { api } from '../lib/api';
import { Bug, Target, Flame, Zap, ShieldOff, Play } from 'lucide-react';
import { toast } from 'sonner';

export default function RedSwarmOps() {
  const [scoutTarget, setScoutTarget] = useState('');
  const [forgeTarget, setForgeTarget] = useState('');
  const [chimeraTarget, setChimeraTarget] = useState('');
  const [hydraTarget, setHydraTarget] = useState('');
  const [isDeploying, setIsDeploying] = useState<Record<string, boolean>>({});

  const handleDeploy = async (
    moduleName: string, 
    apiCall: (data: any) => Promise<any>, 
    payload: any, 
    targetState: string,
    setTargetState: (v: string) => void
  ) => {
    if (!targetState) {
      toast.error(`Please specify a target for ${moduleName}`);
      return;
    }

    setIsDeploying(prev => ({ ...prev, [moduleName]: true }));
    try {
      await apiCall(payload);
      toast.success(`${moduleName} successfully deployed against ${targetState}`);
      setTargetState('');
    } catch (e: any) {
      toast.error(`${moduleName} deployment failed: ${e.message}`);
    } finally {
      setIsDeploying(prev => ({ ...prev, [moduleName]: false }));
    }
  };

  const modules = [
    {
      id: 'scout',
      name: 'Scout Swarm',
      description: 'Distributed reconnaissance. Maps open ports, services, and identifies initial attack vectors silently.',
      icon: Target,
      color: 'rose',
      target: scoutTarget,
      setTarget: setScoutTarget,
      apiCall: api.startRedSwarmScout,
      payload: (t: string) => ({ targetSubnet: t })
    },
    {
      id: 'chimera',
      name: 'Chimera-X Breacher',
      description: 'Autonomous exploitation engine. Leverages LLM chain-of-thought to chain multiple minor vulnerabilities into RCE.',
      icon: Flame,
      color: 'orange',
      target: chimeraTarget,
      setTarget: setChimeraTarget,
      apiCall: api.runChimeraX,
      payload: (t: string) => ({ targetIp: t })
    },
    {
      id: 'forge',
      name: 'Zero-Day Forge',
      description: 'Generates polymorphic, never-before-seen malware payloads tailored to the specific target environment architecture.',
      icon: Zap,
      color: 'purple',
      target: forgeTarget,
      setTarget: setForgeTarget,
      apiCall: api.runForge,
      payload: (t: string) => ({ targetEnvironment: t })
    },
    {
      id: 'hydra',
      name: 'Hydra C2 Protocol Hopper',
      description: 'Establishes resilient C2 communication by dynamically shifting between DNS, ICMP, and HTTPS exfiltration.',
      icon: ShieldOff,
      color: 'red',
      target: hydraTarget,
      setTarget: setHydraTarget,
      apiCall: api.runHydraC2,
      payload: (t: string) => ({ exitNode: t })
    }
  ];

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Bug className="text-rose-500" />
          RED SWARM OPS
        </h1>
        <p className="text-sm text-slate-400">Offensive Capability Matrix & Autonomous Exploit Orchestration</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl">
        {modules.map((mod) => (
          <div key={mod.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-lg hover:border-rose-500/30 transition-all group">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg bg-rose-500/10 text-rose-500 border border-rose-500/20 group-hover:scale-110 transition-transform`}>
                  <mod.icon size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-200">{mod.name}</h3>
                  <span className="text-xs font-mono text-rose-400">STATUS: READY</span>
                </div>
              </div>
            </div>

            <p className="text-sm text-slate-400 flex-1 leading-relaxed">
              {mod.description}
            </p>

            <div className="space-y-3 pt-4 border-t border-slate-800/50 mt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">TARGET IP / RANGE</label>
                <input 
                  type="text" 
                  value={mod.target}
                  onChange={(e) => mod.setTarget(e.target.value)}
                  placeholder="e.g., 10.0.0.0/24 or 192.168.1.50"
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 placeholder:text-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 font-mono"
                />
              </div>
              <button 
                onClick={() => handleDeploy(mod.name, mod.apiCall, mod.payload(mod.target), mod.target, mod.setTarget)}
                disabled={isDeploying[mod.name] || !mod.target}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-lg transition-colors"
              >
                {isDeploying[mod.name] ? (
                  <span className="animate-pulse">DEPLOYING SCRIPT...</span>
                ) : (
                  <>
                    <Play size={16} />
                    EXECUTE MODULE
                  </>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
