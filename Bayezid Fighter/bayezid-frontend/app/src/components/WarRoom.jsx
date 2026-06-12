import { useState, useEffect, useRef } from 'react'
import { Swords, Shield, Bug, Radio, Crosshair, Lock, Zap, Eye, Send, Terminal, AlertTriangle } from 'lucide-react'
import { socket } from '../socket'

const ApprovalModal = ({ op, onApprove, onDeny }) => {
  const [timer, setTimer] = useState(op.countdown || 60);
  
  useEffect(() => {
    const t = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          onDeny(op.operationId);
          clearInterval(t);
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [op, onDeny]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-[500px] border border-rose-500/50 bg-slate-900 rounded-xl overflow-hidden shadow-[0_0_40px_rgba(244,63,94,0.2)]">
        <div className="flex items-center gap-3 px-4 py-3 bg-rose-500/10 border-b border-rose-500/30">
          <AlertTriangle className="w-5 h-5 text-rose-500" />
          <h2 className="text-sm font-bold tracking-widest text-rose-400 uppercase">Operator Approval Required</h2>
        </div>
        <div className="p-6">
          <p className="text-xs text-slate-300 mb-2 font-mono">HIGH-RISK OPERATION DETECTED:</p>
          <pre className="p-4 bg-slate-950 rounded-lg text-xs font-mono text-cyan-400 border border-slate-800 whitespace-pre-wrap">
            {op.preview}
          </pre>
          <div className="mt-6 flex items-center justify-between">
            <span className="text-xs font-mono text-rose-500/80 animate-pulse">
              Auto-DENY in: 00:{timer.toString().padStart(2, '0')}
            </span>
            <div className="flex gap-3">
              <button onClick={() => onDeny(op.operationId)} className="px-4 py-2 text-xs font-bold tracking-wider text-rose-400 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 rounded transition-colors">
                DENY
              </button>
              <button onClick={() => onApprove(op.operationId)} className="px-4 py-2 text-xs font-bold tracking-wider text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 rounded transition-colors">
                APPROVE
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, color, glow }) => (
  <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${color} backdrop-blur-sm`}>
    <div className={`flex items-center justify-center w-8 h-8 rounded-md ${glow}`}>
      <Icon className="w-4 h-4" />
    </div>
    <div className="flex flex-col">
      <span className="text-[9px] tracking-[0.15em] uppercase opacity-70">{label}</span>
      <span className="text-lg font-bold font-mono tracking-wider">{value}</span>
    </div>
  </div>
)

const AgentNode = ({ name, role, status, team }) => {
  const teamColors = {
    blue: {
      border: 'border-cyan-500/40',
      bg: 'bg-cyan-500/5',
      glow: 'shadow-[0_0_10px_rgba(0,212,255,0.15)]',
      icon: 'text-cyan-400',
      status: 'bg-cyan-400',
    },
    red: {
      border: 'border-rose-500/40',
      bg: 'bg-rose-500/5',
      glow: 'shadow-[0_0_10px_rgba(255,0,64,0.15)]',
      icon: 'text-rose-400',
      status: 'bg-rose-500',
    },
  }

  const colors = teamColors[team]

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${colors.border} ${colors.bg} ${colors.glow}`}>
      <div className="relative">
        <Shield className={`w-5 h-5 ${colors.icon}`} />
        <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${colors.status} ${status === 'active' ? 'animate-pulse' : ''}`} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-bold tracking-wider truncate">{name}</span>
        <span className="text-[9px] tracking-wide opacity-50 truncate">{role}</span>
      </div>
      <span className={`text-[9px] px-2 py-0.5 rounded border ${team === 'red' ? 'border-rose-500/30 text-rose-400 bg-rose-500/10' : 'border-cyan-500/30 text-cyan-400 bg-cyan-500/10'}`}>
        {status.toUpperCase()}
      </span>
    </div>
  )
}

const WarRoom = () => {
  // --- Socket & Chat States ---
  const [chatLog, setChatLog] = useState([
    { sender: 'System', text: 'Bayezid Cognitive Engine initialized.', type: 'system' }
  ])
  const [inputCommand, setInputCommand] = useState('')
  const [approvalModal, setApprovalModal] = useState({ show: false, operationId: null, preview: '', countdown: 60 })
  const chatEndRef = useRef(null)

  useEffect(() => {
    const handleNewMessage = (data) => {
      setChatLog(prev => [...prev, data])
    }
    
    const handleApprovalRequest = (data) => {
      setApprovalModal({ show: true, ...data })
    }
    
    socket.on('chat_message', handleNewMessage)
    socket.on('agent_action', handleNewMessage)
    socket.on('awaiting_operator_approval', handleApprovalRequest)
    
    return () => {
      socket.off('chat_message', handleNewMessage)
      socket.off('agent_action', handleNewMessage)
      socket.off('awaiting_operator_approval', handleApprovalRequest)
    }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatLog])

  const sendCommand = (e) => {
    e.preventDefault()
    if (!inputCommand.trim()) return

    const newMsg = { sender: 'Analyst', text: inputCommand, type: 'user' }
    setChatLog(prev => [...prev, newMsg])
    socket.emit('chat_message', newMsg)
    setInputCommand('')
  }

  const approveOperation = async (operationId) => {
    setApprovalModal({ show: false, operationId: null, preview: '', countdown: 0 })
    setChatLog(prev => [...prev, { sender: 'Operator', text: `Approved operation ${operationId}`, type: 'user' }])
    try {
      await fetch('/api/v2/socket/operator-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId, approvalJWT: 'mock-operator-jwt' })
      })
    } catch (e) {
      console.error(e)
    }
  }

  const denyOperation = (operationId) => {
    setApprovalModal({ show: false, operationId: null, preview: '', countdown: 0 })
    setChatLog(prev => [...prev, { sender: 'Operator', text: `Denied operation ${operationId}`, type: 'system' }])
  }

  const stats = [
    { icon: Crosshair, label: 'Active Threats', value: '0', color: 'border-rose-500/30 text-rose-400 bg-rose-500/5', glow: 'bg-rose-500/10 text-rose-400' },
    { icon: Shield, label: 'Defended', value: '847', color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5', glow: 'bg-cyan-500/10 text-cyan-400' },
    { icon: Eye, label: 'Monitoring', value: 'LIVE', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5', glow: 'bg-emerald-500/10 text-emerald-400' },
    { icon: Zap, label: 'Auto-Resolved', value: '94%', color: 'border-amber-500/30 text-amber-400 bg-amber-500/5', glow: 'bg-amber-500/10 text-amber-400' },
  ]

  const agents = [
    { name: 'Bayezid-Core', role: 'Orchestrator AI', status: 'active', team: 'blue' },
    { name: 'Scout', role: 'Reconnaissance', status: 'idle', team: 'red' },
    { name: 'Breacher', role: 'Penetration', status: 'standby', team: 'red' },
    { name: 'Phantom', role: 'Privilege Escalation', status: 'idle', team: 'red' },
    { name: 'Chameleon', role: 'WAF Bypass', status: 'standby', team: 'red' },
    { name: 'Overlord', role: 'Campaign Director', status: 'active', team: 'red' },
  ]

  return (
    <main className="flex-1 h-full flex flex-col min-w-0 bg-slate-950/50 relative">
      {approvalModal.show && (
        <ApprovalModal 
          op={approvalModal} 
          onApprove={approveOperation} 
          onDeny={denyOperation} 
        />
      )}
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg border border-cyan-500/30 bg-cyan-500/10 shadow-[0_0_12px_rgba(0,212,255,0.2)]">
            <Swords className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-[0.15em] text-slate-100 cyber-glow-blue uppercase">
              Bayezid War Room
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] tracking-wider text-emerald-400 font-mono">
                LIVE INTERROGATION
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/50">
            <Lock className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] tracking-wider text-slate-300 font-mono">ENCRYPTED</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span className="text-[10px] tracking-wider text-emerald-400 font-mono">ONLINE</span>
          </div>
        </div>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 flex-shrink-0">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 px-6 pb-4 min-h-0 overflow-y-auto">
        <div className="h-full flex gap-4">
          
          {/* Left Column: Radar + Chat */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            
            {/* 1. Radar UI (Fixed smaller height) */}
            <div className="h-48 relative rounded-xl border border-cyan-500/20 bg-slate-900/60 backdrop-blur-sm overflow-hidden flex-shrink-0">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-cyan-400/60 rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400/60 rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-cyan-400/60 rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-cyan-400/60 rounded-br-lg" />

              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute left-0 right-0 h-px bg-cyan-400/20" style={{ animation: 'scanline 4s linear infinite', boxShadow: '0 0 10px rgba(0, 212, 255, 0.3)' }} />
              </div>

              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-full border-2 border-cyan-400/30 bg-cyan-400/5 mb-2 animate-pulse">
                  <Crosshair className="w-5 h-5 text-cyan-400" />
                </div>
                <h2 className="text-sm font-bold tracking-[0.2em] text-slate-200 cyber-glow-blue">WAR ROOM ACTIVE</h2>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-[9px] text-cyan-400 tracking-widest font-mono">SOC ENGINE ONLINE</span>
                </div>
              </div>
            </div>

            {/* 2. Chat/Terminal Section (Takes remaining space) */}
            <div className="flex-1 flex flex-col min-w-0 rounded-xl border border-cyan-500/20 bg-slate-900/60 backdrop-blur-sm overflow-hidden relative">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatLog.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'}`}>
                    <span className={`text-[9px] font-mono mb-1 ${msg.type === 'user' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                      {msg.sender}
                    </span>
                    <div className={`px-4 py-2 rounded-lg max-w-[80%] border ${
                      msg.type === 'user' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100' : 
                      msg.type === 'system' ? 'bg-slate-800/50 border-slate-700 text-slate-300 text-xs font-mono' :
                      'bg-cyan-500/10 border-cyan-500/30 text-cyan-100'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendCommand} className="p-3 border-t border-cyan-500/20 bg-slate-950/80 flex gap-2">
                <div className="flex items-center justify-center w-10 bg-slate-800 rounded-lg border border-slate-700">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                </div>
                <input
                  type="text"
                  value={inputCommand}
                  onChange={(e) => setInputCommand(e.target.value)}
                  placeholder="Type @Bayezid-Action to execute..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-cyan-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all font-mono"
                />
                <button type="submit" className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors">
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* Right: Agent Squad Panel */}
          <div className="w-64 flex-shrink-0 flex flex-col gap-3">
            <div className="flex items-center gap-2 px-1">
              <Bug className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-[10px] tracking-[0.15em] text-slate-400 uppercase">
                RedSwarm Squad
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {agents.map((agent) => (
                <AgentNode key={agent.name} {...agent} />
              ))}
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}

export default WarRoom