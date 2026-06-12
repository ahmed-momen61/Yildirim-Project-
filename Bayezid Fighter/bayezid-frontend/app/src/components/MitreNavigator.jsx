import React, { useState, useEffect } from 'react';
import { Target, Shield, AlertTriangle, Activity } from 'lucide-react';

const MitreNavigator = () => {
  const [coverageData, setCoverageData] = useState({ covered: [], uncovered: [] });
  const [selectedTechnique, setSelectedTechnique] = useState(null);

  useEffect(() => {
    // Fetch data from the Phase 6 endpoint
    fetch('/api/v2/analytics/mitre-coverage')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setCoverageData(data.data);
        }
      })
      .catch(console.error);
  }, []);

  const getHeatmapColor = (count) => {
    if (count > 10) return 'bg-rose-500/80 border-rose-400 text-rose-100';
    if (count > 5) return 'bg-amber-500/80 border-amber-400 text-amber-100';
    if (count > 0) return 'bg-emerald-500/80 border-emerald-400 text-emerald-100';
    return 'bg-slate-800/50 border-slate-700 text-slate-500';
  };

  const renderMatrixCell = (tech, type) => {
    const isSelected = selectedTechnique?.techniqueId === tech.techniqueId;
    return (
      <button
        key={tech.techniqueId}
        onClick={() => setSelectedTechnique({ ...tech, type })}
        className={`relative p-3 rounded-lg border text-left transition-all ${
          type === 'covered' 
            ? getHeatmapColor(tech.alertCount) 
            : 'bg-slate-800/30 border-slate-700/50 text-slate-400 hover:border-cyan-500/50'
        } ${isSelected ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-900 shadow-[0_0_15px_rgba(34,211,238,0.5)]' : ''}`}
      >
        <div className="text-xs font-bold font-mono tracking-wider mb-1">{tech.techniqueId}</div>
        <div className="text-[10px] truncate opacity-90">
          {type === 'covered' ? `${tech.alertCount} Alerts` : 'Uncovered'}
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full bg-slate-950 text-slate-200">
      <div className="flex-1 p-6 flex flex-col min-h-0">
        <header className="flex items-center gap-3 mb-6">
          <Target className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-slate-100 uppercase">MITRE ATT&CK Matrix</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mb-8">
            <h2 className="text-sm font-bold text-emerald-400 mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4" /> Covered Techniques
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {coverageData.covered.map(tech => renderMatrixCell(tech, 'covered'))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-bold text-rose-400 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Uncovered Gaps
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {coverageData.uncovered.map(tech => renderMatrixCell(tech, 'uncovered'))}
            </div>
          </div>
        </div>
      </div>

      {selectedTechnique && (
        <div className="w-80 border-l border-slate-800 bg-slate-900/50 p-6 overflow-y-auto">
          <h2 className="text-lg font-bold text-cyan-400 mb-1">{selectedTechnique.techniqueId}</h2>
          <p className="text-xs text-slate-400 mb-6 uppercase tracking-widest">Technique Details</p>

          <div className="space-y-4">
            {selectedTechnique.type === 'covered' ? (
              <>
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Confirmed Detections</div>
                  <div className="text-2xl font-mono text-emerald-400">{selectedTechnique.alertCount}</div>
                </div>
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">SIGMA Coverage</div>
                  <div className="text-lg font-mono text-cyan-400">{selectedTechnique.sigmaRules} Rules</div>
                </div>
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Last Seen</div>
                  <div className="text-xs font-mono text-slate-300">{new Date(selectedTechnique.lastSeen).toLocaleString()}</div>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 bg-rose-500/10 rounded-lg border border-rose-500/30">
                  <div className="text-[10px] text-rose-400 uppercase tracking-widest mb-1">Coverage Status</div>
                  <div className="text-sm font-bold text-rose-500">BLIND SPOT DETECTED</div>
                </div>
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Description</div>
                  <div className="text-xs text-slate-300">{selectedTechnique.description}</div>
                </div>
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Related Red Ops</div>
                  <div className="text-lg font-mono text-amber-400">{selectedTechnique.relatedRedOps}</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MitreNavigator;
