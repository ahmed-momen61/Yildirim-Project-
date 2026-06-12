import { useRef, useState, useCallback } from 'react';
export const useWingmanVoice = (onTranscript) => {
    const recognitionRef = useRef(null);
    const [isListening, setIsListening] = useState(false);
    const startListening = useCallback(() => {
        if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
            console.warn('[Voice] SpeechRecognition not supported in this browser.');
            return;
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SR();
        recognition.lang = 'en-US'; 
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.continuous = false;
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            onTranscript(transcript);
        };
        recognition.onend = () => setIsListening(false);
        recognition.onerror = () => setIsListening(false);
        recognitionRef.current = recognition;
        recognition.start();
        setIsListening(true);
    }, [onTranscript]);
    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    }, []);
    const speak = useCallback((text) => {
        if (!text) return;
        const clean = text.replace(/<[^>]+>/g, '').replace(/<think>[\s\S]*?<\/think>/g, '');
        const utterance = new SpeechSynthesisUtterance(clean.substring(0, 500));
        utterance.rate = 1.0;
        utterance.pitch = 0.9;
        const voices = speechSynthesis.getVoices();
        utterance.voice = voices.find(v => v.name.includes('Google UK English Male')) || voices[0];
        speechSynthesis.speak(utterance);
    }, []);
    return { isListening, startListening, stopListening, speak };
};
