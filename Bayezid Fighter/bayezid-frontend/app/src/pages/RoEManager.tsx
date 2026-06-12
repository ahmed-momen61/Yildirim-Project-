import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { Key, ShieldAlert, XCircle, Plus, Activity, Clock, ChevronRight, X } from 'lucide-react';
import { toast } from 'sonner';

export default function RoEManager() {
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTokenForm, setShowNewTokenForm] = useState(false);
  const { on } = useSocket();

  const [formData, setFormData] = useState({
    targetIp: '',
    targetCidr: '',
    tactics: [] as string[],
    modules: [] as string[],
    maxOperations: 50,
    validUntil: ''
  });

  const [selectedToken, setSelectedToken] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const loadTokens = async () => {
      try {
        const storedIds = JSON.parse(localStorage.getItem('roe_token_ids') || '[]');
        if (storedIds.length === 0) {
          // Mock data if no stored IDs for demonstration
          setTokens([{
            id: 'roe-9f8a-4b2c',
            issuedToUserId: 'admin',
            targetScopeHash: 'a8b9c0...',
            allowedTactics: ['RECON', 'EXPLOIT'],
            allowedModules: ['SCOUT'],
            maxOperations: 100,
            operationsUsed: 42,
            validUntil: new Date(Date.now() + 86400000).toISOString(),
            revokedAt: null,
            ledger: []
          }]);
        } else {
          const loaded = await Promise.all(
            storedIds.map((id: string) => api.getRoEStatus(id).catch(() => null))
          );
          setTokens(loaded.filter(t => t !== null));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    loadTokens();

    const interval = setInterval(() => {
      setTokens(prev => [...prev]); // trigger re-render for expiry checks
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    on('roe_issued', (data: any) => {
      toast.success(`New RoE Token Issued: ${data.tokenId}`);
      if (data.token) {
        setTokens(prev => [data.token, ...prev]);
        const storedIds = JSON.parse(localStorage.getItem('roe_token_ids') || '[]');
        localStorage.setItem('roe_token_ids', JSON.stringify([...new Set([data.tokenId, ...storedIds])]));
      }
    });

    on('roe_revoked', (data: any) => {
      toast.error(`RoE Token Revoked: ${data.tokenId}`);
      setTokens(prev => prev.map(t => t.id === data.tokenId ? { ...t, revokedAt: new Date().toISOString() } : t));
    });
  }, [on]);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const mins = Math.round((new Date(formData.validUntil).getTime() - Date.now()) / 60000);
      const res = await api.issueRoEToken({
        targetIp: formData.targetIp,
        targetCidr: formData.targetCidr,
        allowedTactics: formData.tactics,
        allowedModules: formData.modules,
        maxOperations: formData.maxOperations,
        validForMinutes: mins > 0 ? mins : 60,
        operatorUserId: 'current-admin'
      });
      
      const newToken = {
        id: res.roeTokenId,
        issuedToUserId: 'current-admin',
        targetScopeHash: res.scopeHash || 'computed-hash',
        allowedTactics: formData.tactics,
        allowedModules: formData.modules,
        maxOperations: formData.maxOperations,
        operationsUsed: 0,
        validUntil: new Date(formData.validUntil).toISOString(),
        revokedAt: null,
        ledger: []
      };

      setTokens([newToken, ...tokens]);
      const storedIds = JSON.parse(localStorage.getItem('roe_token_ids') || '[]');
      localStorage.setItem('roe_token_ids', JSON.stringify([res.roeTokenId, ...storedIds]));
      
      setShowNewTokenForm(false);
      toast.success('RoE Token generated successfully.');
    } catch (err: any) {
      toast.error('Failed to issue token: ' + err.message);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeRoEToken(id);
      setTokens(tokens.map(t => t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t));
      toast.success('Token revoked.');
    } catch (err: any) {
      toast.error('Revocation failed: ' + err.message);
    }
  };

  const toggleArrayItem = (field: 'tactics' | 'modules', item: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].includes(item) 
        ? prev[field].filter(i => i !== item)
        : [...prev[field], item]
    }));
  };

  const openDrawer = (token: any) => {
    setSelectedToken(token);
    setDrawerOpen(true);
  };

  if (loading) return <div className="p-8 text-cyan-400">Loading RoE Manager...</div>;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 p-6 overflow-hidden relative">
      
      {/* DRAWER */}
      {drawerOpen && selectedToken && (
        <div className="absolute inset-y-0 right-0 w-[500px] bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col transform transition-transform">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
            <h2 className="text-sm font-bold tracking-widest text-slate-200">TOKEN DETAILS: {selectedToken.id}</h2>
            <button onClick={() => setDrawerOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
          </div>
          <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
            <div className="space-y-6">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Scope Hash</div>
                <div className="font-mono text-cyan-400 text-sm break-all bg-slate-950 p-2 rounded border border-slate-800 mt-1">{selectedToken.targetScopeHash}</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Issued To</div>
                  <div className="font-mono text-sm">{selectedToken.issuedToUserId}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Status</div>
                  <div className="font-bold text-sm">
                    {selectedToken.revokedAt ? <span className="text-rose-500">REVOKED</span> : new Date(selectedToken.validUntil) < new Date() ? <span className="text-slate-500">EXPIRED</span> : <span className="text-emerald-500">ACTIVE</span>}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-300 mb-2 border-b border-slate-800 pb-1">OPERATION LEDGER</h3>
                {selectedToken.ledger && selectedToken.ledger.length > 0 ? (
                  <div className="space-y-2">
                    {selectedToken.ledger.map((l: any, i: number) => (
                      <div key={i} className="bg-slate-950 p-3 rounded border border-slate-800 text-xs">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-cyan-400">{l.type}</span>
                          <span className="text-slate-500">{new Date(l.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-slate-300">Target: {l.target}</div>
                        <div className={`mt-1 font-bold ${l.outcome === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>{l.outcome}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 italic p-4 text-center bg-slate-950 rounded border border-slate-800">No operations recorded yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-4">
        <header className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <Key className="w-6 h-6 text-cyan-400" />
            <h1 className="text-xl font-bold tracking-widest text-slate-100 uppercase">Rules of Engagement (RoE)</h1>
          </div>
          <button 
            onClick={() => setShowNewTokenForm(!showNewTokenForm)}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold tracking-wider text-xs transition-colors"
          >
            {showNewTokenForm ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showNewTokenForm ? 'CANCEL' : 'ISSUE NEW TOKEN'}
          </button>
        </header>

        {showNewTokenForm && (
          <form onSubmit={handleCreateToken} className="mb-8 p-6 bg-slate-900 border border-cyan-500/30 rounded-xl">
            <h2 className="text-sm font-bold text-cyan-400 mb-4 uppercase tracking-widest">Cryptographic Authorization Gate Config</h2>
            
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-xs text-slate-400 mb-2">Target IP Scope</label>
                <input type="text" value={formData.targetIp} onChange={e => setFormData({...formData, targetIp: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-cyan-100 focus:border-cyan-500 outline-none font-mono" placeholder="10.0.0.5" required />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">Target CIDR (Optional)</label>
                <input type="text" value={formData.targetCidr} onChange={e => setFormData({...formData, targetCidr: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-cyan-100 focus:border-cyan-500 outline-none font-mono" placeholder="10.0.0.0/24" />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs text-slate-400 mb-2">Allowed Tactics</label>
              <div className="flex gap-2 flex-wrap">
                {['RECON', 'EXPLOIT', 'PRIVESC', 'LATERAL', 'C2'].map(tactic => (
                  <button type="button" key={tactic} onClick={() => toggleArrayItem('tactics', tactic)} className={`px-3 py-1 text-xs rounded border ${formData.tactics.includes(tactic) ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                    {tactic}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-xs text-slate-400 mb-2">Max Operations (Budget)</label>
                <input type="number" value={formData.maxOperations} onChange={e => setFormData({...formData, maxOperations: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-cyan-100 focus:border-cyan-500 outline-none" min="1" required />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-2">Expiry Time</label>
                <input type="datetime-local" value={formData.validUntil} onChange={e => setFormData({...formData, validUntil: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-cyan-100 focus:border-cyan-500 outline-none" required />
              </div>
            </div>

            <button type="submit" className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold tracking-widest text-xs transition-colors">
              GENERATE CRYPTO-TOKEN
            </button>
          </form>
        )}

        <div className="space-y-4">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Active & Historical Engagements</h2>
          {tokens.map(token => {
            const isExpired = new Date(token.validUntil) < new Date();
            const usagePct = token.maxOperations > 0 ? (token.operationsUsed / token.maxOperations) * 100 : 0;
            const progressColor = usagePct > 80 ? 'bg-rose-500' : usagePct > 50 ? 'bg-amber-500' : 'bg-emerald-500';

            const msLeft = new Date(token.validUntil).getTime() - Date.now();
            const hoursLeft = msLeft / (1000 * 60 * 60);

            return (
              <div key={token.id} className={`p-5 rounded-xl border ${token.revokedAt || isExpired ? 'bg-slate-900/30 border-slate-800' : 'bg-slate-900 border-cyan-500/20 shadow-lg'}`}>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-mono text-cyan-400">{token.id}</h3>
                      {token.revokedAt ? (
                        <span className="px-2 py-0.5 text-[9px] bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded uppercase tracking-widest">Revoked</span>
                      ) : isExpired ? (
                        <span className="px-2 py-0.5 text-[9px] bg-slate-800 text-slate-400 border border-slate-700 rounded uppercase tracking-widest">Expired</span>
                      ) : (
                        <span className="px-2 py-0.5 text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded uppercase tracking-widest animate-pulse">Active</span>
                      )}
                      
                      {!token.revokedAt && !isExpired && hoursLeft <= 1 && (
                        <span className="px-2 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded uppercase tracking-widest font-mono">
                          Expiring: {Math.max(0, Math.round(msLeft / 60000))}m
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">Scope Hash: {token.targetScopeHash.substring(0, 16)}...</div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button onClick={() => openDrawer(token)} className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-xs tracking-wider transition-colors">
                      Ledger <ChevronRight size={14} />
                    </button>
                    {!token.revokedAt && !isExpired && (
                      <button onClick={() => handleRevoke(token.id)} className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-xs tracking-wider transition-colors">
                        <ShieldAlert className="w-3 h-3" /> REVOKE
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Activity className="w-3 h-3" /> Operations Used</div>
                    <div className="text-xl font-mono text-slate-200">{token.operationsUsed} <span className="text-slate-600 text-sm">/ {token.maxOperations}</span></div>
                    <div className="w-full bg-slate-800 h-1.5 mt-2 rounded-full overflow-hidden">
                      <div className={`h-full ${progressColor} transition-all duration-500`} style={{width: `${usagePct}%`}}></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Valid Until</div>
                    <div className="text-sm font-mono text-slate-300">{new Date(token.validUntil).toLocaleString()}</div>
                  </div>

                  <div className="col-span-2">
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Tactics Granted</div>
                    <div className="flex gap-1 flex-wrap">
                      {token.allowedTactics.map((t: string) => (
                        <span key={t} className="px-2 py-0.5 bg-slate-800 text-cyan-300 text-[10px] rounded border border-slate-700">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
