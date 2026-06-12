import { useState, useRef, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';
import { Bot, Send, Terminal as TerminalIcon, ShieldAlert } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Message = {
  id: string;
  sender: 'user' | 'wingman' | 'system';
  content: string;
  type: 'text' | 'tool_call';
  timestamp: Date;
};

export default function WingmanTerminal() {
  const { isConnected, on, emit } = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Add initial system message
    setMessages([
      {
        id: 'sys-1',
        sender: 'system',
        content: 'BAYEZID WINGMAN AGI CONNECTED. READY FOR COMMAND.',
        type: 'text',
        timestamp: new Date()
      }
    ]);
  }, []);

  on('wingman_message', (data: { message: string }) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      sender: 'wingman',
      content: data.message,
      type: 'text',
      timestamp: new Date()
    }]);
  });

  on('wingman_tool_call', (data: { tool: string; args: any }) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      sender: 'wingman',
      content: `Executing: ${data.tool}\\nPayload: ${JSON.stringify(data.args, null, 2)}`,
      type: 'tool_call',
      timestamp: new Date()
    }]);
  });

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      sender: 'user',
      content: input.trim(),
      type: 'text',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    emit('chat_message', { message: input.trim() });
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Bot className="text-cyan-400" />
            WINGMAN AGI TERMINAL
          </h1>
          <p className="text-sm text-slate-400">Autonomous Orchestration & Natural Language C2</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-800 rounded-full">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
          <span className="text-xs font-mono text-slate-400">{isConnected ? 'UPLINK ESTABLISHED' : 'NO CARRIER'}</span>
        </div>
      </div>

      <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl flex flex-col overflow-hidden relative shadow-[inset_0_0_50px_rgba(0,0,0,0.5)]">
        {/* Terminal Output */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
              <span className="text-[10px] text-slate-500 font-mono mb-1 px-1">
                {msg.sender.toUpperCase()} // {msg.timestamp.toLocaleTimeString()}
              </span>
              
              {msg.type === 'tool_call' ? (
                <div className="bg-[#0f172a] border border-cyan-500/30 p-3 rounded-lg w-full">
                  <div className="flex items-center gap-2 text-cyan-400 mb-2 border-b border-cyan-500/20 pb-2">
                    <TerminalIcon size={14} />
                    <span className="text-xs font-bold tracking-widest uppercase">System Execution</span>
                  </div>
                  <pre className="text-cyan-400 text-xs font-mono whitespace-pre-wrap">
                    {msg.content}
                  </pre>
                </div>
              ) : msg.sender === 'system' ? (
                <div className="text-center w-full py-4 text-slate-500 font-mono text-xs tracking-widest border-y border-slate-800/50 my-4">
                  {msg.content}
                </div>
              ) : (
                <div className={`p-3 rounded-xl ${
                  msg.sender === 'user' 
                    ? 'bg-slate-800 text-slate-200 rounded-tr-sm border border-slate-700' 
                    : 'bg-cyan-950/30 text-cyan-50 rounded-tl-sm border border-cyan-500/20 shadow-[0_0_15px_rgba(34,211,238,0.05)]'
                }`}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-900 prose-pre:border-slate-800"
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          ))}
          <div ref={endOfMessagesRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-slate-900 border-t border-slate-800">
          <form onSubmit={handleSend} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isConnected ? "Issue command to Wingman AGI..." : "Awaiting uplink connection..."}
              disabled={!isConnected}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 placeholder:text-slate-600 rounded-lg pl-4 pr-12 py-3 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 transition-all font-mono text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || !isConnected}
              className="absolute right-2 p-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md disabled:opacity-50 transition-colors"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
