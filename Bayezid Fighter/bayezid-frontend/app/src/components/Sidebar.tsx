import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import {
  LayoutDashboard,
  Swords,
  Crosshair,
  Bug,
  Shield,
  FileText,
  GitBranch,
  Lock,
  Bot,
  Activity,
  Network,
  Cpu,
  Copy,
  Terminal,
  Key,
  FileCheck,
  ChevronLeft,
  ChevronRight,
  Database,
  Cpu as EngineIcon,
  Wifi,
  WifiOff
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, team: 'blue' },
  { path: '/war-room', label: 'War Room', icon: Swords, team: 'blue' },
  { path: '/arena', label: 'Swarm Arena', icon: Crosshair, team: 'red' },
  { path: '/red-ops', label: 'Red Ops', icon: Bug, team: 'red' },
  { path: '/blue-fortress', label: 'Blue Fortress', icon: Shield, team: 'blue' },
  { path: '/intelligence', label: 'Intel Hub', icon: FileText, team: 'blue' },
  { path: '/causal', label: 'Causal DAG', icon: GitBranch, team: 'blue' },
  { path: '/veritas', label: 'Veritas Ledger', icon: Lock, team: 'purple' },
  { path: '/wingman', label: 'Wingman AGI', icon: Bot, team: 'blue' },
  { path: '/purple', label: 'Purple Score', icon: Activity, team: 'purple' },
  { path: '/federation', label: 'Federation', icon: Network, team: 'blue' },
  { path: '/brain', label: 'Brain Trainer', icon: Cpu, team: 'blue' },
  { path: '/mirror', label: 'Shadow Mirror', icon: Copy, team: 'red' },
  { path: '/ebpf', label: 'eBPF Console', icon: Terminal, team: 'blue' },
  { path: '/roe', label: 'RoE Manager', icon: Key, team: 'purple' },
  { path: '/compliance', label: 'Compliance', icon: FileCheck, team: 'purple' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { isConnected } = useSocket();

  const getTeamColors = (team: string | null, isActive: boolean) => {
    let colors = '';
    if (team === 'blue') {
      colors = 'text-cyan-400 hover:bg-cyan-500/10 border-cyan-500/30';
      if (isActive) colors += ' bg-slate-800 border-l-2 border-cyan-400';
    } else if (team === 'red') {
      colors = 'text-rose-400 hover:bg-rose-500/10 border-rose-500/30';
      if (isActive) colors += ' bg-slate-800 border-l-2 border-rose-400';
    } else if (team === 'purple') {
      colors = 'text-violet-400 hover:bg-violet-500/10 border-violet-500/30';
      if (isActive) colors += ' bg-slate-800 border-l-2 border-violet-400';
    } else {
      colors = 'text-slate-300 hover:bg-slate-800';
      if (isActive) colors += ' bg-slate-800 border-l-2 border-slate-300';
    }
    return colors;
  };

  return (
    <div className={`flex flex-col h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 ${collapsed ? 'w-20' : 'w-64'}`}>
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 h-16">
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-100 tracking-widest">BAYEZID HYBRID SOC</span>
            <span className="text-[10px] text-cyan-400 font-mono tracking-widest">v3.5 COPILOT</span>
          </div>
        )}
        {collapsed && (
          <span className="text-xs font-bold text-cyan-400 tracking-widest mx-auto">SOC</span>
        )}
        <button 
          onClick={() => setCollapsed(!collapsed)} 
          className="p-1 hover:bg-slate-800 rounded-md text-slate-400 ml-auto"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
        <nav className="space-y-1 px-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${getTeamColors(item.team, isActive)}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Status Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-900/50 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <EngineIcon size={14} />
            {!collapsed && <span>AI Engine</span>}
          </div>
          {!collapsed && <span className="text-emerald-400 font-mono">LOCAL QWEN</span>}
        </div>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            {isConnected ? <Wifi size={14} className="text-emerald-400" /> : <WifiOff size={14} className="text-rose-400" />}
            {!collapsed && <span>Socket.io</span>}
          </div>
          {!collapsed && (
            <span className={isConnected ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>
              {isConnected ? 'LIVE' : 'OFFLINE'}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Database size={14} />
            {!collapsed && <span>Database</span>}
          </div>
          {!collapsed && <span className="text-emerald-400 font-mono">ONLINE</span>}
        </div>
      </div>
    </div>
  );
}
