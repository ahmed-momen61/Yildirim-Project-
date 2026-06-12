const axios = require('axios');

const OracleReverser = {
    tryBase64: (payload) => {
        try {
            if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload) && payload.length > 10) {
                const decoded = Buffer.from(payload, 'base64').toString('utf8');
                if (/[a-zA-Z0-9 ]{5,}/.test(decoded)) return decoded;
            }
        } catch (e) {}
        return null;
    },
    
    tryHex: (payload) => {
        try {
            const cleanHex = payload.replace(/\\x/g, '').replace(/0x/g, '').replace(/\s/g, '');
            if (/^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length % 2 === 0 && cleanHex.length > 10) {
                const decoded = Buffer.from(cleanHex, 'hex').toString('utf8');
                if (/[a-zA-Z0-9 ]{5,}/.test(decoded)) return decoded;
            }
        } catch (e) {}
        return null;
    },
    
    tryUrlDecode: (payload) => {
        try {
            if (payload.includes('%')) {
                let decoded = decodeURIComponent(payload);
                if (decoded.includes('%')) {
                    decoded = decodeURIComponent(decoded);
                }
                if (decoded !== payload) return decoded;
            }
        } catch (e) {}
        return null;
    },
    
    analyzePayload: async(rawPayload) => {
        console.log(`\n[🧠] The Oracle Agent activated. Attempting automated reverse engineering...`);
        let clearTextPayload = rawPayload;
        let obfuscationMethod = 'None/ClearText';
        const decodedUrl = OracleReverser.tryUrlDecode(rawPayload);
        
        if (decodedUrl) {
            clearTextPayload = decodedUrl;
            obfuscationMethod = 'URL Encoded';
        }
        
        const decodedB64 = OracleReverser.tryBase64(clearTextPayload);
        if (decodedB64) {
            clearTextPayload = decodedB64;
            obfuscationMethod = 'Base64 Encoded';
        }
        
        const decodedHex = OracleReverser.tryHex(clearTextPayload);
        if (decodedHex) {
            clearTextPayload = decodedHex;
            obfuscationMethod = 'Hex Encoded';
        }
        
        console.log(`[🔓] Oracle Verdict: Payload is [${obfuscationMethod}]. Clear text extracted: ${clearTextPayload.substring(0, 50)}...`);
        
        const oraclePrompt = `You are an expert reverse engineer. Analyze this malicious payload and explain its goal in ONE short sentence. Mention any specific tools, OS commands, or intent. Do not give mitigation advice. The payload is: "${clearTextPayload}"`;
        
        try {
            console.log(`[🤖] Oracle querying Local AI (Ollama/Qwen) for intent analysis...`);
            let response;
            try {
                response = await axios.post('http://localhost:11434/api/generate', {
                    model: process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b',
                    prompt: oraclePrompt,
                    stream: false
                }, { timeout: 90000 });
            } catch (oraclePrimaryErr) {
                console.log(`[⚠️] Oracle Primary Local AI Failed. Trying Lightweight Fallback...`);
                response = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: oraclePrompt,
                    stream: false
                }, { timeout: 90000 });
            }
            return {
                obfuscation: obfuscationMethod,
                clearText: clearTextPayload,
                aiAnalysis: response.data.response.trim()
            };
        } catch (error) {
            console.log(`[⚠️] Oracle AI Analysis failed (Is Ollama running?): ${error.message}`);
            return {
                obfuscation: obfuscationMethod,
                clearText: clearTextPayload,
                aiAnalysis: "AI Reverse Engineering Offline (Using Local Heuristics only)."
            };
        }
    }
};

module.exports = OracleReverser;
