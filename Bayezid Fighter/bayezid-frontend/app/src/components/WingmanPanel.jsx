import { useState, useRef, useEffect, useCallback } from 'react';
import WingmanVoiceButton from './WingmanVoice';

const WingmanPanel = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [activeTools, setActiveTools] = useState([]);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Initialize session
    useEffect(() => {
        const stored = sessionStorage.getItem('wingman_session_id');
        if (stored) {
            setSessionId(stored);
        } else {
            const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            sessionStorage.setItem('wingman_session_id', newId);
            setSessionId(newId);
        }
    }, []);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) inputRef.current?.focus();
    }, [isOpen]);

    const sendMessage = useCallback(async () => {
        if (!input.trim() || isLoading) return;
        const userMessage = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setIsLoading(true);
        setActiveTools([]);

        try {
            const token = localStorage.getItem('bayezid_token') || '';
            const response = await fetch('/api/v1/wingman/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ message: userMessage, sessionId })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line.replace('data: ', ''));

                        if (data.token) {
                            // Check for tool execution markers
                            if (data.token.startsWith('⚙️')) {
                                const toolName = data.token.replace('⚙️ Executing: ', '').replace('...', '').trim();
                                setActiveTools(prev => [...prev, toolName]);
                            } else {
                                fullResponse += data.token;
                                setMessages(prev => {
                                    const updated = [...prev];
                                    const last = updated[updated.length - 1];
                                    if (last?.role === 'assistant') {
                                        last.content = fullResponse;
                                    } else {
                                        updated.push({ role: 'assistant', content: fullResponse });
                                    }
                                    return updated;
                                });
                            }
                        }

                        if (data.done) {
                            if (data.finalResponse) {
                                setMessages(prev => {
                                    const updated = [...prev];
                                    const last = updated[updated.length - 1];
                                    if (last?.role === 'assistant') {
                                        last.content = data.finalResponse;
                                    } else {
                                        updated.push({ role: 'assistant', content: data.finalResponse });
                                    }
                                    return updated;
                                });
                            }
                            if (data.sessionId) {
                                sessionStorage.setItem('wingman_session_id', data.sessionId);
                                setSessionId(data.sessionId);
                            }
                        }

                        if (data.error) {
                            setMessages(prev => [...prev, { role: 'error', content: data.error }]);
                        }
                    } catch (parseErr) { /* ignore partial JSON */ }
                }
            }
        } catch (err) {
            setMessages(prev => [...prev, { role: 'error', content: `Connection error: ${err.message}` }]);
        } finally {
            setIsLoading(false);
            setActiveTools([]);
        }
    }, [input, isLoading, sessionId]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const clearSession = () => {
        const newId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        sessionStorage.setItem('wingman_session_id', newId);
        setSessionId(newId);
        setMessages([]);
    };

    // Voice interaction state
    const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop()?.content || '';

    return (
        <>
            <WingmanVoiceButton 
                onTranscript={(text) => {
                    setInput(text);
                    // Automatically send after a short delay if needed, or let user review.
                    // For now, we just populate the input so they can hit enter or we can trigger send.
                }} 
                lastResponse={lastAssistantMessage} 
            />

            {/* Floating Toggle Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
                    width: '60px', height: '60px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #00d4ff, #7b2ff7)',
                    border: 'none', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,212,255,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                    transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)'
                }}
                onMouseEnter={e => e.target.style.boxShadow = '0 6px 30px rgba(0,212,255,0.6)'}
                onMouseLeave={e => e.target.style.boxShadow = '0 4px 20px rgba(0,212,255,0.4)'}
                title="Toggle Wingman"
            >
                <span style={{ fontSize: '28px', color: '#fff', lineHeight: 1 }}>
                    {isOpen ? '✕' : '🦾'}
                </span>
            </button>

            {/* Chat Panel */}
            {isOpen && (
                <div style={{
                    position: 'fixed', bottom: '96px', right: '24px', zIndex: 9998,
                    width: '420px', maxHeight: '600px',
                    background: 'linear-gradient(180deg, #0f1419 0%, #1a1f2e 100%)',
                    borderRadius: '16px', border: '1px solid rgba(0,212,255,0.2)',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    animation: 'wingmanSlideUp 0.3s ease-out'
                }}>
                    {/* Header */}
                    <div style={{
                        padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'linear-gradient(90deg, rgba(0,212,255,0.1), rgba(123,47,247,0.1))',
                        borderBottom: '1px solid rgba(255,255,255,0.06)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '22px' }}>🦾</span>
                            <div>
                                <div style={{ color: '#e4e8f0', fontWeight: 700, fontSize: '14px', fontFamily: "'Inter', sans-serif" }}>
                                    THE WINGMAN
                                </div>
                                <div style={{ color: '#64748b', fontSize: '11px' }}>
                                    {isLoading ? '⚡ Processing...' : '🟢 Online'}
                                </div>
                            </div>
                        </div>
                        <button onClick={clearSession} style={{
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                            color: '#94a3b8', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
                            fontSize: '11px', fontFamily: "'Inter', sans-serif"
                        }} title="New Session">
                            🔄 New
                        </button>
                    </div>

                    {/* Messages */}
                    <div style={{
                        flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column',
                        gap: '12px', maxHeight: '400px', scrollBehavior: 'smooth'
                    }}>
                        {messages.length === 0 && (
                            <div style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', padding: '40px 20px', fontFamily: "'Inter', sans-serif" }}>
                                <span style={{ fontSize: '36px', display: 'block', marginBottom: '12px' }}>🦾</span>
                                At your service. Ask me anything about the system, or use <code style={{ color: '#00d4ff' }}>/commands</code>.
                            </div>
                        )}
                        {messages.map((msg, i) => (
                            <div key={i} style={{
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                maxWidth: '85%',
                                background: msg.role === 'user'
                                    ? 'linear-gradient(135deg, #7b2ff7, #00d4ff)'
                                    : msg.role === 'error'
                                        ? 'rgba(239,68,68,0.15)'
                                        : 'rgba(255,255,255,0.06)',
                                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                                padding: '10px 14px',
                                color: msg.role === 'error' ? '#fca5a5' : '#e4e8f0',
                                fontSize: '13px', lineHeight: 1.5,
                                fontFamily: "'Inter', sans-serif",
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                border: msg.role === 'error' ? '1px solid rgba(239,68,68,0.3)' : 'none'
                            }}>
                                {msg.content}
                            </div>
                        ))}

                        {/* Active tool badges */}
                        {activeTools.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {activeTools.map((tool, i) => (
                                    <span key={i} style={{
                                        background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.3)',
                                        borderRadius: '20px', padding: '3px 10px', fontSize: '11px', color: '#00d4ff',
                                        fontFamily: "'Inter', sans-serif", animation: 'wingmanPulse 1.5s infinite'
                                    }}>
                                        ⚙️ {tool}
                                    </span>
                                ))}
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div style={{
                        padding: '12px 14px',
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex', gap: '8px'
                    }}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask the Wingman..."
                            disabled={isLoading}
                            style={{
                                flex: 1, background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
                                padding: '10px 14px', color: '#e4e8f0', fontSize: '13px',
                                fontFamily: "'Inter', sans-serif", outline: 'none',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={e => e.target.style.borderColor = 'rgba(0,212,255,0.4)'}
                            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                        />
                        <button
                            onClick={sendMessage}
                            disabled={isLoading || !input.trim()}
                            style={{
                                background: isLoading ? '#334155' : 'linear-gradient(135deg, #00d4ff, #7b2ff7)',
                                border: 'none', borderRadius: '10px', padding: '10px 16px',
                                color: '#fff', cursor: isLoading ? 'not-allowed' : 'pointer',
                                fontSize: '14px', transition: 'opacity 0.2s',
                                opacity: isLoading || !input.trim() ? 0.5 : 1
                            }}
                        >
                            {isLoading ? '⏳' : '▶'}
                        </button>
                    </div>
                </div>
            )}

            {/* Animations */}
            <style>{`
                @keyframes wingmanSlideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes wingmanPulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `}</style>
        </>
    );
};

export default WingmanPanel;
