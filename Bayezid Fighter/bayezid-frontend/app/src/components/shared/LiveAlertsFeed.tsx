import { useState } from 'react';
import { useAlertStream } from '../../hooks/useSocket';
import { Bell, ShieldAlert, X, Activity, AlertTriangle, ChevronRight, ChevronLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export default function LiveAlertsFeed() {
  const { alerts, isConnected } = useAlertStream();
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const handleAlertClick = (alertId: string) => {
    navigate(`/war-room?alertId=${alertId}`);
  };

  const getSeverityColor = (sev: string) => {
    switch(sev) {
      case 'CRITICAL': return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      case 'HIGH': return 'bg-orange-500/10 border-orange-500/30 text-orange-400';
      case 'MEDIUM': return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      default: return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'NEW': return 'text-rose-400 animate-pulse';
      case 'INVESTIGATING': return 'text-amber-400';
      case 'RESOLVED_BY_WAR_ROOM':
      case 'RESOLVED_VERIFIED': return 'text-emerald-400';
      default: return 'text-slate-400';
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-slate-900 border border-slate-700 p-1 rounded-l-md text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors ${isOpen ? 'translate-x-full' : 'translate-x-0'}`}
      >
        <ChevronLeft size={20} />
      </button>

      {/* Slide-out Panel */}
      <div className={`w-80 bg-slate-950 border-l border-slate-800 flex flex-col transition-all duration-300 ${isOpen ? 'mr-0' : '-mr-80'}`}>
        
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 shrink-0">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-cyan-400" />
            <h2 className="text-sm font-bold tracking-widest text-slate-200">LIVE FEED</h2>
            <span className={`ml-2 w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-200">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
          {alerts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
              <ShieldAlert size={32} className="mb-2 opacity-50" />
              <div>No alerts detected.</div>
            </div>
          ) : (
            alerts.map((alert) => (
              <div 
                key={alert.id} 
                onClick={() => handleAlertClick(alert.id)}
                className={`p-3 rounded-lg border cursor-pointer transition-colors hover:border-cyan-500/50 bg-slate-900 ${alert.status === 'NEW' ? 'shadow-[0_0_15px_rgba(244,63,94,0.1)]' : ''}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${getSeverityColor(alert.severity)}`}>
                    {alert.severity}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                  </span>
                </div>
                
                <div className="text-sm font-bold text-slate-200 mb-1 leading-tight">
                  {alert.ruleName || 'Unknown Alert'}
                </div>
                
                <div className="flex justify-between items-end mt-2">
                  <div className="text-[10px] font-mono text-slate-400">
                    {alert.sourceIp} → {alert.destIp}
                  </div>
                  <div className={`text-[10px] font-bold tracking-widest uppercase ${getStatusColor(alert.status)}`}>
                    {alert.status.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
