import { Search, Bell, Shield, User, Bot, Server, Settings } from 'lucide-react';
import { useState } from 'react';

export default function TopBar() {
  const [aiEnabled, setAiEnabled] = useState(true);

  return (
    <div className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
      
      {/* Left: Global Search */}
      <div className="flex-1 max-w-md">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
          <input 
            type="text" 
            placeholder="Search alerts, IPs, playbooks..." 
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all placeholder-slate-600 font-mono"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <kbd className="hidden sm:inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 rounded border border-slate-700">Ctrl</kbd>
            <kbd className="hidden sm:inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-slate-800 rounded border border-slate-700">K</kbd>
          </div>
        </div>
      </div>

      {/* Right: Actions & Status */}
      <div className="flex items-center gap-4 ml-4">
        
        {/* System Status */}
        <div className="hidden md:flex items-center gap-3 px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg">
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] uppercase font-bold text-slate-400">CORE API</span>
          </div>
          <div className="w-px h-3 bg-slate-700"></div>
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] uppercase font-bold text-slate-400">WINGMAN AI</span>
          </div>
        </div>

        {/* AI Copilot Toggle */}
        <button 
          onClick={() => setAiEnabled(!aiEnabled)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${
            aiEnabled 
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20' 
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
          }`}
        >
          <Bot size={14} className={aiEnabled ? 'animate-pulse' : ''} />
          {aiEnabled ? 'AI AUTO-PILOT ON' : 'AI STANDBY'}
        </button>

        <div className="w-px h-6 bg-slate-800 mx-1"></div>

        <button className="relative p-2 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full animate-pulse"></span>
        </button>

        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
          <Settings size={18} />
        </button>

        <div className="flex items-center gap-2 pl-2 border-l border-slate-800 cursor-pointer group">
          <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center group-hover:border-cyan-500 transition-colors">
            <User size={16} className="text-slate-300" />
          </div>
          <div className="hidden lg:block">
            <div className="text-xs font-bold text-slate-200 leading-tight">Admin Principal</div>
            <div className="text-[10px] text-cyan-500 uppercase tracking-widest leading-tight">L5 Clearance</div>
          </div>
        </div>

      </div>
    </div>
  );
}
