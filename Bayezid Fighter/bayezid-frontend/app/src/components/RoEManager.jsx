import React, { useState, useEffect } from 'react';
import { Key, ShieldAlert, XCircle, Plus, Activity, Clock } from 'lucide-react';

const RoEManager = () => {
  const [tokens, setTokens] = useState([]);
  const [showNewTokenForm, setShowNewTokenForm] = useState(false);
  const [formData, setFormData] = useState({
    targetIp: '',
    targetCidr: '',
    tactics: [],
    modules: [],
    maxOperations: 50,
    validUntil: ''
  });

  // Mock initial data load
  useEffect(() => {
    setTokens([
      {
        id: 'roe-9f8a-4b2c',
        issuedToUserId: 'user-77',
        targetScopeHash: 'a8b9c0...',
        allowedTactics: ['RECON', 'EXPLOIT'],
        allowedModules: ['SCOUT', 'BREACHER'],
        maxOperations: 100,
        operationsUsed: 42,
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        revokedAt: null
      }
    ]);
  }, []);

  const handleCreateToken = (e) => {
    e.preventDefault();
    // Normally this would be a POST to /api/v1/auth/roe/issue
    const newToken = {
      id: `roe-${Math.random().toString(36).substr(2, 9)}`,
      issuedToUserId: 'current-admin',
      targetScopeHash: 'computed-hash',
      allowedTactics: formData.tactics,
      allowedModules: formData.modules,
      maxOperations: formData.maxOperations,
      operationsUsed: 0,
      validUntil: new Date(formData.validUntil).toISOString(),
      revokedAt: null
    };
    setTokens([newToken, ...tokens]);
    setShowNewTokenForm(false);
  };

  const handleRevoke = (id) => {
    setTokens(tokens.map(t => t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t));
  };

  const toggleArrayItem = (field, item) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].includes(item) 
        ? prev[field].filter(i => i !== item)
        : [...prev[field], item]
    }));
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 p-6 overflow-y-auto">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Key className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-slate-100 uppercase">Rules of Engagement (RoE) Manager</h1>
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
        {tokens.map(token => (
          <div key={token.id} className={`p-5 rounded-xl border ${token.revokedAt || new Date(token.validUntil) < new Date() ? 'bg-slate-900/30 border-slate-800' : 'bg-slate-900 border-cyan-500/20'}`}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-lg font-mono text-cyan-400">{token.id}</h3>
                  {token.revokedAt ? (
                    <span className="px-2 py-0.5 text-[9px] bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded uppercase tracking-widest">Revoked</span>
                  ) : new Date(token.validUntil) < new Date() ? (
                    <span className="px-2 py-0.5 text-[9px] bg-slate-800 text-slate-400 border border-slate-700 rounded uppercase tracking-widest">Expired</span>
                  ) : (
                    <span className="px-2 py-0.5 text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded uppercase tracking-widest animate-pulse">Active</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono">Scope Hash: {token.targetScopeHash}</div>
              </div>
              
              {!token.revokedAt && new Date(token.validUntil) > new Date() && (
                <button onClick={() => handleRevoke(token.id)} className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded text-xs tracking-wider transition-colors">
                  <ShieldAlert className="w-3 h-3" /> REVOKE
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Activity className="w-3 h-3" /> Operations Used</div>
                <div className="text-xl font-mono text-slate-200">{token.operationsUsed} <span className="text-slate-600 text-sm">/ {token.maxOperations}</span></div>
                <div className="w-full bg-slate-800 h-1 mt-2 rounded-full overflow-hidden">
                  <div className={`h-full ${token.operationsUsed / token.maxOperations > 0.8 ? 'bg-rose-500' : 'bg-cyan-500'}`} style={{width: `${(token.operationsUsed / token.maxOperations) * 100}%`}}></div>
                </div>
              </div>
              
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Valid Until</div>
                <div className="text-sm font-mono text-slate-300">{new Date(token.validUntil).toLocaleString()}</div>
              </div>

              <div className="col-span-2">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Tactics Granted</div>
                <div className="flex gap-1 flex-wrap">
                  {token.allowedTactics.map(t => (
                    <span key={t} className="px-2 py-0.5 bg-slate-800 text-cyan-300 text-[10px] rounded border border-slate-700">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RoEManager;
