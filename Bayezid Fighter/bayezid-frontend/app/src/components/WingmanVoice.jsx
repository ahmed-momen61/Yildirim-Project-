import React, { useEffect } from 'react';
import { useWingmanVoice } from '../hooks/useWingmanVoice';

const WingmanVoiceButton = ({ onTranscript, lastResponse }) => {
    const { isListening, startListening, stopListening, speak } = useWingmanVoice(onTranscript);

    // Auto-speak when a new response arrives
    useEffect(() => {
        if (lastResponse && import.meta.env.VITE_WINGMAN_VOICE_ENABLED === 'true') {
            speak(lastResponse);
        }
    }, [lastResponse, speak]);

    const toggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    };

    return (
        <>
            <button
                onClick={toggleListening}
                style={{
                    position: 'fixed', bottom: '24px', right: '100px', zIndex: 9999,
                    width: '60px', height: '60px', borderRadius: '50%',
                    background: isListening ? '#ef4444' : '#1e293b',
                    border: '1px solid rgba(0,212,255,0.2)', cursor: 'pointer',
                    boxShadow: isListening ? '0 0 20px rgba(239,68,68,0.6)' : '0 4px 20px rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    animation: isListening ? 'wingmanPulseRed 1.5s infinite' : 'none'
                }}
                onMouseEnter={e => { if (!isListening) e.target.style.boxShadow = '0 6px 30px rgba(0,212,255,0.4)'; }}
                onMouseLeave={e => { if (!isListening) e.target.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)'; }}
                title={isListening ? "Listening..." : "Voice Command"}
            >
                <span style={{ fontSize: '24px', lineHeight: 1 }}>
                    {isListening ? '🎙️' : '🔇'}
                </span>
            </button>
            <style>{`
                @keyframes wingmanPulseRed {
                    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
            `}</style>
        </>
    );
};

export default WingmanVoiceButton;
