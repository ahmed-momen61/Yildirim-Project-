import { useState, useEffect, useRef } from 'react'
import { socket } from '../socket';
import {
  Radar,
  AlertTriangle,
  ShieldAlert,
  Skull,
  Activity,
  Wifi,
  WifiOff,
  ChevronDown,
  Crosshair,
  Clock,
  Filter,
} from 'lucide-react'

const severityConfig = {
  CRITICAL: {
    icon: Skull,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/40',
    glow: 'shadow-[0_0_10px_rgba(255,0,64,0.2)]',
    label: 'CRIT',
  },
  HIGH: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    glow: 'shadow-[0_0_10px_rgba(251,191,36,0.2)]',
    label: 'HIGH',
  },
  MEDIUM: {
    icon: ShieldAlert,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/40',
    glow: 'shadow-[0_0_10px_rgba(0,212,255,0.2)]',
    label: 'MED',
  },
  LOW: {
    icon: Activity,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    glow: 'shadow-[0_0_10px_rgba(52,211,153,0.2)]',
    label: 'LOW',
  },
}


const statusColors = {
  ANALYZED: 'text-cyan-400',
  WAITING_FOR_APPROVAL: 'text-amber-400',
  AUTO_ESCALATED: 'text-rose-400',
  FALSE_POSITIVE: 'text-emerald-400',
  RESOLVED_BY_MEMORY: 'text-cyan-400',
  RESOLVED_BY_WAR_ROOM: 'text-cyan-400',
  NEW: 'text-slate-400',
}

const AlertItem = ({ alert, isNew }) => {
  const config = severityConfig[alert.severity]
  const Icon = config.icon

  return (
    <div
      className={`relative p-3 rounded-lg border ${config.border} ${config.bg} ${config.glow} transition-all duration-300 ${
        isNew ? 'animate-slide-in-right' : ''
      }`}
    >
      {/* Top Row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${config.color} flex-shrink-0`} />
          <span className={`text-[10px] font-bold tracking-wider ${config.color} font-mono`}>
            {alert.id?.split('-')[0] || 'ALT'}
          </span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border ${config.bg} ${config.color} ${config.border}`}
          >
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-1 text-slate-600">
          <Clock className="w-2.5 h-2.5" />
          <span className="text-[9px] font-mono">{alert.timestamp}</span>
        </div>
      </div>

      {/* Event Type */}
      <div className="text-[11px] font-semibold text-slate-200 mb-1 tracking-wide">
        {alert.threatType || alert.eventType || 'Unknown Threat'}
      </div>

      {/* Details */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <Crosshair className="w-2.5 h-2.5 text-rose-400 flex-shrink-0" />
          <span className="text-[9px] text-slate-400 font-mono truncate">
            {alert.sourceIp}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-2.5 h-2.5 text-cyan-400 flex-shrink-0" />
          <span className="text-[9px] text-slate-400 font-mono truncate">
            {alert.targetServer}
          </span>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/30">
        <span className={`text-[9px] font-bold tracking-wider ${statusColors[alert.status]} font-mono`}>
          {alert.status}
        </span>
        <span className="text-[9px] text-slate-500 font-mono">
          x{alert.attempts}
        </span>
      </div>

      {/* New indicator pulse */}
      {isNew && (
        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-rose-400 animate-pulse shadow-[0_0_6px_rgba(255,0,64,0.6)]" />
      )}
    </div>
  )
}

const TerminalLine = ({ text, type = 'info' }) => {
  const colors = {
    info: 'text-cyan-400/60',
    warn: 'text-amber-400/60',
    error: 'text-rose-400/60',
    success: 'text-emerald-400/60',
  }

  return (
    <div className={`text-[9px] font-mono ${colors[type]} leading-relaxed`}>
      <span className="text-slate-600 mr-2">{'>'}</span>
      {text}
    </div>
  )
}

const AlertRadar = () => {
const [alerts, setAlerts] = useState([])
  const [isConnected, setIsConnected] = useState(socket.connected)
  const [filterSeverity, setFilterSeverity] = useState('ALL')
  const [expandedTerminal, setExpandedTerminal] = useState(false)
  const [terminalLogs, setTerminalLogs] = useState([
    { text: 'System booting...', type: 'info' }
  ])
  
  const scrollRef = useRef(null)
  const terminalRef = useRef(null)

  const addLog = (text, type = 'info') => {
    setTerminalLogs(prev => [...prev.slice(-49), { text, type }])
  }

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true)
      addLog('Socket.io connected successfully', 'success')
      socket.emit('join_war_room') 
    }
    const onDisconnect = () => {
      setIsConnected(false)
      addLog('Connection lost. Retrying...', 'error')
    }
    const onNewAlert = (alertData) => {
      setAlerts(prev => [alertData, ...prev].slice(0, 50)) 
      addLog(`New Alert: ${alertData.sourceIp || 'Unknown'} - ${alertData.threatType || 'Threat'}`, 'warn')
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('new_alert', onNewAlert)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('new_alert', onNewAlert)
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [alerts])

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [expandedTerminal])

  const filteredAlerts =
    filterSeverity === 'ALL'
      ? alerts
      : alerts.filter((a) => a.severity === filterSeverity)

  const severityCounts = {
    ALL: alerts.length,
    CRITICAL: alerts.filter((a) => a.severity === 'CRITICAL').length,
    HIGH: alerts.filter((a) => a.severity === 'HIGH').length,
    MEDIUM: alerts.filter((a) => a.severity === 'MEDIUM').length,
    LOW: alerts.filter((a) => a.severity === 'LOW').length,
  }

  return (
    <aside className="w-80 h-full bg-slate-900/90 border-l border-slate-800 flex flex-col backdrop-blur-md flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-16 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Radar className="w-5 h-5 text-cyan-400" />
            <div className="absolute inset-0 animate-radar-sweep origin-center">
              <div className="w-full h-0.5 bg-cyan-400/30" style={{ transform: 'rotate(0deg)' }} />
            </div>
          </div>
          <div>
            <h2 className="text-xs font-bold tracking-[0.15em] text-slate-100 uppercase">
              Live Alerts Radar
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              {isConnected ? (
                <>
                  <Wifi className="w-2.5 h-2.5 text-emerald-400" />
                  <span className="text-[9px] text-emerald-400 tracking-wider font-mono">
                    STREAM ACTIVE
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="w-2.5 h-2.5 text-rose-400" />
                  <span className="text-[9px] text-rose-400 tracking-wider font-mono">
                    DISCONNECTED
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Filter className="w-3 h-3 text-slate-500" />
          <span className="text-[9px] tracking-[0.15em] text-slate-500 uppercase">
            Filter Severity
          </span>
        </div>
        <div className="flex gap-1">
          {Object.entries(severityConfig).map(([key, config]) => (
            <button
              key={key}
              onClick={() =>
                setFilterSeverity(filterSeverity === key ? 'ALL' : key)
              }
              className={`flex-1 flex flex-col items-center py-1.5 rounded border transition-all ${
                filterSeverity === key
                  ? `${config.border} ${config.bg}`
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <span className={`text-[9px] font-bold ${config.color}`}>
                {config.label}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {severityCounts[key]}
              </span>
            </button>
          ))}
          <button
            onClick={() => setFilterSeverity('ALL')}
            className={`flex-1 flex flex-col items-center py-1.5 rounded border transition-all ${
              filterSeverity === 'ALL'
                ? 'border-slate-400 bg-slate-400/10'
                : 'border-slate-800 hover:border-slate-700'
            }`}
          >
            <span className="text-[9px] font-bold text-slate-300">ALL</span>
            <span className="text-[9px] text-slate-500 font-mono">
              {severityCounts.ALL}
            </span>
          </button>
        </div>
      </div>

      {/* Alerts Feed */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0"
      >
        {filteredAlerts.map((alert, index) => (
          <AlertItem key={alert.id} alert={alert} isNew={index < 2} />
        ))}

        {/* Empty State */}
        {filteredAlerts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldAlert className="w-8 h-8 text-slate-700 mb-3" />
            <span className="text-[10px] tracking-wider text-slate-600 uppercase">
              No alerts match filter
            </span>
          </div>
        )}
      </div>

      {/* Terminal Panel */}
      <div className="border-t border-slate-800 flex-shrink-0">
        <button
          onClick={() => setExpandedTerminal(!expandedTerminal)}
          className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-800/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] tracking-[0.15em] text-slate-400 uppercase">
              System Terminal
            </span>
          </div>
          <ChevronDown
            className={`w-3 h-3 text-slate-500 transition-transform ${
              expandedTerminal ? 'rotate-180' : ''
            }`}
          />
        </button>

        <div
          className={`overflow-hidden transition-all duration-300 ${
            expandedTerminal ? 'max-h-48' : 'max-h-0'
          }`}
        >
          <div
            ref={terminalRef}
            className="px-4 py-2 bg-black/40 space-y-1 overflow-y-auto"
            style={{ maxHeight: '12rem' }}
          >
            {terminalLogs.map((log, index) => (
              <TerminalLine key={index} text={log.text} type={log.type} />
            ))}
            <div className="flex items-center gap-1">
              <span className="text-emerald-400/60 text-[9px] font-mono">{'>'}</span>
              <span className="w-1.5 h-3 bg-cyan-400/60 animate-terminal-blink" />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="px-4 py-2 border-t border-slate-800 bg-slate-900/60 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[9px] tracking-widest text-slate-600 uppercase">
            Total
          </span>
          <span className="text-xs font-bold text-slate-300 font-mono">
            {alerts.length}
          </span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] tracking-widest text-slate-600 uppercase">
            Escalated
          </span>
          <span className="text-[10px] font-bold text-rose-400 font-mono">
            {alerts.filter((a) => a.status === 'AUTO_ESCALATED').length}
          </span>
        </div>
      </div>
    </aside>
  )
}

export default AlertRadar
