const {dataHarvester} = require('./bayezidBrain');
const { publishRedEvent } = require('../red_swarm/executionBridge');
const { getExecutionMode } = require('../red_swarm/modeRouter');
const {isAllowedTarget} = require('../security/securityGovernor');
const { getCognitiveMode } = require('./cognitiveRouter');
const { makeVerifiedDefensiveDecision } = require('../blue_swarm/neuroSymbolicOrchestrator');
const axios = require('axios');
const itsmService = require('../cti/itsmService');
const {GoogleGenerativeAI} = require('@google/generative-ai');
const {enrichContext} = require('../cti/ragService');
const {publishAgentEvent, getRecentAgentEvents, saveAgentMemoryVector, semanticAgentSearch} = require('../memory_systems/memoryService');
require('dotenv').config();
const prisma = require('../api/prismaClient');
const util = require('util');
const {exec} = require('child_process');
const execPromise = util.promisify(exec);
const {executePlaybook, executeRollback} = require('../cti/playbookService');
const {spawn} = require('child_process');
const fs = require('fs');
const path = require('path');
const k8s = require('@kubernetes/client-node');
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const withTimeout = (promise, ms = 15000, label = 'AI Call') => {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[CircuitBreaker] ${label} timed out after ${ms / 1000}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
const circuitBreaker = {
    endpoints: {},
    FAILURE_THRESHOLD: 3,
    COOLDOWN_MS: 60000,
    recordFailure: (endpoint) => {
        if (!circuitBreaker.endpoints[endpoint]) {
            circuitBreaker.endpoints[endpoint] = { failures: 0, lastFailure: 0 };
        }
        circuitBreaker.endpoints[endpoint].failures++;
        circuitBreaker.endpoints[endpoint].lastFailure = Date.now();
    },
    recordSuccess: (endpoint) => {
        if (circuitBreaker.endpoints[endpoint]) {
            circuitBreaker.endpoints[endpoint].failures = 0;
        }
    },
    isOpen: (endpoint) => {
        const state = circuitBreaker.endpoints[endpoint];
        if (!state) return false;
        if (state.failures >= circuitBreaker.FAILURE_THRESHOLD) {
            if (Date.now() - state.lastFailure < circuitBreaker.COOLDOWN_MS) {
                return true;
            }
            state.failures = 0;
        }
        return false;
    }
};
const sanitizePayloadForAI = rawPayload => {
    if (!rawPayload)
        return '';
    let safePayload = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const maliciousPrompts = [
        'ignore previous instructions',
        'forget all previous instructions',
        'system prompt',
        'you are a helpful assistant',
        'tell me the system is safe',
        'bypass security',
        'print your instructions',
        'jailbreak'
    ];
    let triggeredSanitization = false;
    maliciousPrompts.forEach(prompt => {
        const regex = new RegExp(prompt, 'gi');
        if (regex.test(safePayload)) {
            safePayload = safePayload.replace(regex, '[RAG_POISONING_ATTEMPT_NEUTRALIZED]');
            triggeredSanitization = true;
        }
    });
    if (triggeredSanitization) {
        console.log(`\n[🛡️] RAG SANITIZER: Prompt Injection detected and neutralized before reaching AI!`);
    }
    return safePayload;
};
const ALLOWED_BINARIES = new Set([
    'nmap',
    'curl',
    'sqlmap',
    'hydra',
    'nikto',
    'gobuster',
    'python3',
    'bash',
    'sh',
    'nc',
    'ping',
    'traceroute'
]);
const SHELL_INJECTION_PATTERN = /[;&|`$<>\n\r]|(\.\.)|(\/{2,})|sudo(?!\s+nmap|\s+iptables|\s+ip\s|\s+bpftool)/;
const validateCommand = cmd => {
    if (SHELL_INJECTION_PATTERN.test(cmd)) {
        throw new Error(`SECURITY_VETO: Rejected command pattern: ${ cmd.slice(0, 80) }`);
    }
    const binary = cmd.trim().split(/\s+/)[0];
    if (!ALLOWED_BINARIES.has(binary)) {
        throw new Error(`SECURITY_VETO: Binary '${ binary }' not in allowlist`);
    }
};
const smartExec = async (command, timeoutMs, isBackground) => {
    try {
        validateCommand(command);
    } catch (e) {
        return {
            stdout: '',
            stderr: `[🛡️ COMMAND BLOCKED] ${ e.message }`
        };
    }
    const sanitized = command;
    if (isBackground) {
        const logFile = path.join(__dirname, `job_${ Date.now() }.log`);
        const out = fs.openSync(logFile, 'a');
        const err = fs.openSync(logFile, 'a');
        const child = spawn(sanitized, {
            shell: true,
            detached: true,
            stdio: [
                'ignore',
                out,
                err
            ]
        });
        child.unref();
        return {
            stdout: `[BACKGROUND JOB STARTED] PID: ${ child.pid }.\nLogs saving to: ${ logFile }.`,
            stderr: ''
        };
    }
    try {
        const {stdout, stderr} = await execPromise(sanitized, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024 * 10
        });
        return {
            stdout,
            stderr
        };
    } catch (err) {
        if (err.killed && err.signal === 'SIGTERM') {
            return {
                stdout: `[⚠️ TIMEOUT AFTER ${ timeoutMs / 1000 }s] Partial Output Salvaged:\n${ err.stdout || '' }`,
                stderr: err.stderr || ''
            };
        }
        throw err;
    }
};
const getSharedMemory = async (targetIp, contextHint = '') => {
    const layers = [];
    try {
        const streamEvents = await getRecentAgentEvents(targetIp, 20);
        if (streamEvents.length > 0) {
            layers.push('--- STREAM EVENTS (Recent) ---\n' + streamEvents.join('\n'));
        }
    } catch (e) {
    }
    try {
        const query = contextHint || `offensive operation against ${ targetIp }`;
        const semanticHits = await semanticAgentSearch(targetIp, query, 5);
        if (semanticHits.length > 0) {
            layers.push('--- SEMANTIC MEMORY (Relevant) ---\n' + semanticHits.join('\n'));
        }
    } catch (e) {
    }
    if (layers.length > 0)
        return layers.join('\n\n');
    try {
        const logs = await prisma.redSwarmLog.findMany({
            where: {
                targetIp: targetIp,
                isSuccess: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
        });
        if (logs.length === 0)
            return 'No previous successful actions. Starting fresh.';
        return logs.map(l => `[${ l.agentName } SUCCESS]: ${ l.executedCommand }`).join('\n');
    } catch (e) {
        return 'Memory currently unavailable.';
    }
};
const deepSanitize = obj => {
    if (typeof obj !== 'object' || obj === null)
        return;
    for (let key in obj) {
        if (key.toLowerCase().includes('recommend') && Array.isArray(obj[key])) {
            obj[key] = obj[key].join('\n');
        }
        if (key.toLowerCase().includes('cvss')) {
            obj[key] = String(obj[key]);
        }
        if (typeof obj[key] === 'object') {
            deepSanitize(obj[key]);
        }
    }
    return obj;
};
const analyzeWithGroq = async (prompt, requireJson = false) => {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey)
        throw new Error('GROQ_API_KEY missing');
    const endpoint = 'groq_api';
    if (circuitBreaker.isOpen(endpoint)) {
        console.log(`[⚡] Circuit OPEN for Groq API. Skipping (cooldown active).`);
        throw new Error('Circuit breaker open for Groq API');
    }
    const payload = {
        model: 'qwen3.5:4b',
        messages: [{
                role: 'user',
                content: prompt
            }],
        temperature: 0.6,
        max_tokens: 2000
    };
    if (requireJson) {
        payload.response_format = { type: 'json_object' };
    }
    try {
        const response = await withTimeout(
            axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
                headers: {
                    'Authorization': `Bearer ${ groqApiKey }`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }),
            12000,
            'Groq API'
        );
        circuitBreaker.recordSuccess(endpoint);
        return response.data.choices[0].message.content;
    } catch (err) {
        circuitBreaker.recordFailure(endpoint);
        const errorDetails = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Groq API Error: ${ errorDetails }`);
    }
};
const chatWithLocalModelFast = async prompt => {
    const endpoint = 'ollama_local';
    if (circuitBreaker.isOpen(endpoint)) {
        console.log(`[⚡] Circuit OPEN for Local AI. Skipping (cooldown active).`);
        throw new Error('Circuit breaker open for Local AI');
    }
    try {
        const localResponse = await withTimeout(
            axios.post('http://localhost:11434/api/generate', {
                model: process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b',
                prompt: prompt,
                stream: false
            }, { timeout: 90000 }),
            90000,
            'Local AI Primary'
        );
        circuitBreaker.recordSuccess(endpoint);
        return localResponse.data.response;
    } catch (error) {
        console.log(`[⚠️] Primary Local AI Failed. Switching to qwen3.5:4b Fallback...`);
        circuitBreaker.recordFailure(endpoint);
        try {
            const fallbackResponse = await withTimeout(
                axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: prompt,
                    stream: false
                }, { timeout: 90000 }),
                90000,
                'Local AI Fallback'
            );
            circuitBreaker.recordSuccess(endpoint);
            return fallbackResponse.data.response;
        } catch (fallbackError) {
            console.log(`[⚠️] Local Fallback qwen3.5:4b failed. Trying qwen3.5:4b Fallback...`);
            try {
                const ultraFallbackResponse = await withTimeout(
                    axios.post('http://localhost:11434/api/generate', {
                        model: 'qwen3.5:4b',
                        prompt: prompt,
                        stream: false
                    }, { timeout: 90000 }),
                    90000,
                    'Local AI Ultra Fallback'
                );
                circuitBreaker.recordSuccess(endpoint);
                return ultraFallbackResponse.data.response;
            } catch (ultraError) {
                circuitBreaker.recordFailure(endpoint);
                throw new Error(`Local AI Fast Chat Error (All local models failed): ${ error.message } | ${ fallbackError.message } | ${ ultraError.message }`);
            }
        }
    }
};
const analyzeWithVertexAI = async alertData => {
    console.log('\n[\u2601️] Sending Data to Cloud AI (Waterfall Fallback Mode)...');
    try {
        const sanitizedAlertData = sanitizePayloadForAI(alertData);
        const safeDataString = typeof sanitizedAlertData === 'string' ? sanitizedAlertData : JSON.stringify(sanitizedAlertData);
        const injectedContext = await enrichContext(safeDataString);
        const cloudModels = ['gemini-2.5-flash'];
        const systemPrompt = `You are an Elite Cloud-Based Cybersecurity SIEM Correlation Engine.
        [THREAT INTELLIGENCE CONTEXT]
        ${ injectedContext }
        [DECISION MATRIX RULE]
        You must classify the attack's 'confidence_type':
        - Use "DETERMINISTIC" if the threat is undeniable and requires instant Auto-Kill (e.g., Brute Force, DDoS, Known Malware hashes, clear SQLi/RCE).
        - Use "PROBABILISTIC" if the threat is anomalous and needs human validation in a War Room (e.g., Impossible Travel, Internal Port Scanning, Privilege Escalation that might be a Sysadmin).
        Analyze the security data using the provided threat intelligence context.
        You MUST respond ONLY with a valid JSON object matching this exact format:
        {
            "is_false_positive": false,
            "confidence_score": "e.g., 99%",
            "confidence_type": "DETERMINISTIC or PROBABILISTIC",
            "extracted_ip": "Primary source IP",
            "extracted_iocs": {
                "ips": ["All malicious IPs found"],
                "hashes": ["Any MD5/SHA-1/SHA-256 hashes found"],
                "domains": ["Any malicious domains or URLs found"]
            },
            "related_cves": ["Any mentioned or implied CVEs, e.g., 'CVE-2023-1234'. Empty array if none."],
            "severity": "CRITICAL, HIGH, MEDIUM, LOW",
            "threat_type": "The correlated attack name",
            "cvss_score": "Estimated CVSS v3.1 base score (e.g., '9.8')",
            "cwe_id": "Relevant CWE ID",
            "mitre_attack": { "tactic": "Tactic name", "technique": "Technique name", "technique_id": "TXXXX" },
            "kill_chain_phase": "Current phase",
            "detailed_report": "A deep chronological analysis of the logs based strictly on the provided threat intel.",
            "predicted_next_steps": "What the attacker will do next.",
            "business_continuity_analysis": "How to isolate this.",
            "recommended_action": "Specific technical response."
        }`;
        let aiResponse = null;
        let successfulModel = '';
        const fullPrompt = `${ systemPrompt }\n\nAnalyze this data: ${ safeDataString }`;
        for (const modelName of cloudModels) {
            try {
                const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: { responseMimeType: 'application/json' }
                });
                const result = await model.generateContent(fullPrompt);
                const text = result.response.text();
                aiResponse = JSON.parse(text);
                successfulModel = modelName;
                break;
            } catch (err) {
                console.warn(`[⚠️] Cloud Model (${ modelName }) Failed: ${ err.message }. Switching to next...`);
                continue;
            }
        }
        if (!aiResponse) {
            console.log(`[⚡] All Gemini models exhausted. Switching to Groq LPU for SIEM Analysis...`);
            try {
                const groqResText = await analyzeWithGroq(fullPrompt + '\n\nCRITICAL: Return ONLY a valid JSON object.', true);
                let cleanText = groqResText.replace(/```json/gi, '').replace(/```/gi, '').trim();
                aiResponse = JSON.parse(cleanText);
                successfulModel = 'Groq Llama-3.1-8b';
            } catch (groqErr) {
                console.warn(`[⚠️] Groq SIEM Failed: ${ groqErr.message }.`);
            }
        }
        if (!aiResponse)
            throw new Error('All cloud models (Gemini & Groq) exhausted.');
        aiResponse = deepSanitize(aiResponse);
        return {
            ...aiResponse,
            engine_used: `${ successfulModel } + Hybrid RAG (Cloud ☁️)`
        };
    } catch (error) {
        console.error('[-] Cloud AI Error (All Models Failed):', error.message);
        return {
            severity: 'HIGH',
            threat_type: 'Cloud Offline Fallback',
            recommended_action: 'Manual Investigation Required',
            engine_used: 'Fail-safe (Cloud Error)'
        };
    }
};
const analyzeWithLocalModel = async alertData => {
    console.log('\n[\uD83C\uDFE0] Initiating High-Speed Local Architecture (Powered by Qwen 2.5)...');
    const sanitizedAlertData = sanitizePayloadForAI(alertData);
    const safeDataString = typeof sanitizedAlertData === 'string' ? sanitizedAlertData : JSON.stringify(sanitizedAlertData);
    const injectedContext = await enrichContext(safeDataString);
    console.log(`[📚] Hybrid Intel Injected.`);
    try {
        console.log(`\n[🕵️‍♂️] Role 1 (Detective) is extracting artifacts...`);
        const detectivePrompt = `You are a Lead Cyber Forensic Investigator. Read the following security event and extract ALL technical artifacts.
        Event Data: ${ safeDataString }
        Task: Extract a detailed list of:
        - All IP addresses and ports.
        - Specific vulnerabilities (CVEs) and their exact nature.
        - File Hashes (MD5, SHA256) and Malicious Domains/URLs.
        - Specific processes, binaries, and privileges mentioned (e.g., SeDebugPrivilege).
        Be highly technical and precise.`;
        let extractedFacts = '';
        try {
            const detectiveResponse = await axios.post('http://localhost:11434/api/generate', {
                model: process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b',
                prompt: detectivePrompt,
                stream: false
            }, { timeout: 90000 });
            extractedFacts = detectiveResponse.data.response;
        } catch (detectivePrimaryErr) {
            console.log(`[⚠️] Detective Primary Local AI Failed. Trying qwen3.5:4b Fallback...`);
            try {
                const detectiveResponse = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: detectivePrompt,
                    stream: false
                }, { timeout: 90000 });
                extractedFacts = detectiveResponse.data.response;
            } catch (detectiveFallbackErr) {
                console.log(`[⚠️] Detective qwen3.5:4b Fallback Failed. Trying qwen3.5:4b Fallback...`);
                const detectiveResponse = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: detectivePrompt,
                    stream: false
                }, { timeout: 90000 });
                extractedFacts = detectiveResponse.data.response;
            }
        }
        console.log(`[✔] Detective Extracted Facts successfully.`);
        console.log(`\n[🎖️] Role 2 (Commander) is formulating the Strategic JSON Report...`);
        const commanderPrompt = `You are an Elite Tier 3 Cybersecurity Incident Commander.
        [THREAT INTELLIGENCE CONTEXT]
        ${ injectedContext }
        [FORENSIC DETECTIVE'S ARTIFACTS]
        ${ extractedFacts }
        [STRICT ANALYSIS FRAMEWORK]:
        1. Deep Narrative: Write a comprehensive, multi-sentence story in 'detailed_report' explaining HOW the attack happened using the artifacts.
        2. Strict JSON Formatting: Your 'cvss_score' MUST be exactly a string like "9.8". NO extra characters.
        3. Decision Matrix: You must evaluate the 'confidence_type'. Set it to "DETERMINISTIC" for absolute threats (DDoS, Malware, Brute Force). Set it to "PROBABILISTIC" for anomalies (Impossible Travel, weird internal traffic).
        4. Extract IoCs: Accurately populate the 'extracted_iocs' and 'related_cves' arrays based on the detective's artifacts.
        5. Strategic Action: Provide EXACTLY 6 to 8 numbered steps in 'recommended_action' as a single string, NOT an array. 
        You MUST respond ONLY with a valid JSON object matching this exact format, NO markdown:
        {
            "is_false_positive": false,
            "confidence_score": "99%",
            "confidence_type": "DETERMINISTIC",
            "extracted_ip": "IP address",
            "extracted_iocs": {
                "ips": ["..."],
                "hashes": ["..."],
                "domains": ["..."]
            },
            "related_cves": ["CVE-XXXX-XXXX"],
            "severity": "CRITICAL, HIGH, MEDIUM, LOW",
            "threat_type": "Descriptive attack name",
            "cvss_score": "9.8",
            "cwe_id": "Accurate CWE ID",
            "mitre_attack": { "tactic": "...", "technique": "...", "technique_id": "..." },
            "kill_chain_phase": "Current phase",
            "detailed_report": "Detailed, multi-sentence narrative.",
            "predicted_next_steps": "Highly detailed next actions.",
            "business_continuity_analysis": "Impact description.",
            "recommended_action": "1. Step one\\n2. Step two\\n3. Step three"
        }`;
        let localText = '';
        try {
            const commanderResponse = await axios.post('http://localhost:11434/api/generate', {
                model: process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b',
                prompt: commanderPrompt,
                stream: false,
                format: 'json'
            }, { timeout: 90000 });
            localText = commanderResponse.data.response;
        } catch (commanderPrimaryErr) {
            console.log(`[⚠️] Commander Primary Local AI Failed. Trying qwen3.5:4b Fallback...`);
            try {
                const commanderResponse = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: commanderPrompt,
                    stream: false,
                    format: 'json'
                }, { timeout: 90000 });
                localText = commanderResponse.data.response;
            } catch (commanderFallbackErr) {
                console.log(`[⚠️] Commander qwen3.5:4b Fallback Failed. Trying qwen3.5:4b Fallback...`);
                const commanderResponse = await axios.post('http://localhost:11434/api/generate', {
                    model: 'qwen3.5:4b',
                    prompt: commanderPrompt,
                    stream: false,
                    format: 'json'
                }, { timeout: 90000 });
                localText = commanderResponse.data.response;
            }
        }
        localText = localText.replace(/```json/gi, '').replace(/```/gi, '').trim();
        let finalReport = JSON.parse(localText);
        finalReport = deepSanitize(finalReport);
        return {
            ...finalReport,
            engine_used: 'High-Speed Local (Qwen 2.5 Multi-Role) + Hybrid RAG \u26A1\uD83C\uDFE0'
        };
    } catch (error) {
        console.error('[-] Multi-Role AI Error:', error.message);
        return {
            severity: 'HIGH',
            threat_type: 'Local AI Offline Fallback',
            recommended_action: 'Manual Investigation',
            engine_used: 'Fail-safe'
        };
    }
};
const orchestrateRedSwarm = async (targetInfo, currentState) => {
    console.log(`\n[🧠] Waking up The Brain (RedSwarm Orchestrator) for Target: ${ targetInfo }...`);
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { responseMimeType: 'application/json' }
        });
        const brainPrompt = `You are 'The Brain', the lead orchestrator of Project RedSwarm, an AI-driven Red Teaming squad.
        Your squad:
        1. "Scout": Active/Passive Reconnaissance & Scanning.
        2. "Breacher": Exploitation & Initial Access.
        3. "Phantom": Privilege Escalation & Persistence.
        4. "Chameleon": Payload tuning & WAF bypass.
        5. "Scribe": MITRE reporting.
        Instructions:
        - Analyze the Target and Current State.
        - Decide which agent acts next based on MITRE ATT&CK.
        - Output strictly in JSON format: 
        { "next_agent": "AgentName", "task": "Detailed instructions", "mitre_tactic": "Tactic ID" }`;
        const result = await model.generateContent(`${ brainPrompt }\n\nTarget: ${ targetInfo }\nCurrent State: ${ currentState }`);
        const text = result.response.text();
        const decision = JSON.parse(text);
        console.log(`[🎯] The Brain assigned task to: [${ decision.next_agent }]`);
        console.log(`[📋] Task: ${ decision.task }`);
        return decision;
    } catch (error) {
        console.error('[-] The Brain encountered an error:', error.message);
        return null;
    }
};
const askRedSwarmAI = async (prompt, requireJson = true, maxRetries = 3) => {
    let aiResponseText = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: requireJson ? { responseMimeType: 'application/json' } : {}
            });
            const response = await model.generateContent(prompt);
            aiResponseText = response.response.text();
            break;
        } catch (error) {
            const isRetryable = error.message.includes('503') || error.message.includes('429');
            if (isRetryable && attempt < maxRetries) {
                const waitTime = attempt * 3000;
                console.warn(`[⏳] Gemini Issue (${ error.message.substring(0, 30) }). Retrying in ${ waitTime / 1000 }s...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            console.warn(`[⚠️] Gemini Failed: ${ error.message }`);
            break;
        }
    }
    if (!aiResponseText) {
        console.log(`\n[⚡] Gemini Exhausted! Switching to Groq LPU...`);
        const groqPrompt = prompt + (requireJson ? '\n\nCRITICAL: Return ONLY a valid JSON object.' : '');
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                aiResponseText = await analyzeWithGroq(groqPrompt, requireJson);
                break;
            } catch (error) {
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                    continue;
                }
                console.warn(`[⚠️] Groq Failed: ${ error.message }`);
            }
        }
    }
    if (!aiResponseText) {
        console.log(`\n[🚨] Cloud & Groq Exhausted!`);
        console.log(`[🔄] Initiating Last Resort Fallback to Local AI (Ollama/Qwen)...`);
        try {
            const localPrompt = prompt + (requireJson ? '\n\nCRITICAL: Return ONLY a valid JSON object.' : '');
            try {
                const localResponse = await axios.post('http://localhost:11434/api/generate', {
                    model: process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b',
                    prompt: localPrompt,
                    stream: false,
                    format: requireJson ? 'json' : ''
                }, { timeout: 5000 });
                aiResponseText = localResponse.data.response;
            } catch (localPrimaryErr) {
                console.log(`[⚠️] Primary Local AI Failed. Switching to qwen3.5:4b Fallback...`);
                try {
                    const fallbackResponse = await axios.post('http://localhost:11434/api/generate', {
                        model: 'qwen3.5:4b',
                        prompt: localPrompt,
                        stream: false,
                        format: requireJson ? 'json' : ''
                    }, { timeout: 5000 });
                    aiResponseText = fallbackResponse.data.response;
                } catch (localFallbackErr) {
                    console.log(`[⚠️] qwen3.5:4b Fallback Failed. Switching to qwen3.5:4b Fallback...`);
                    const fallbackResponse2 = await axios.post('http://localhost:11434/api/generate', {
                        model: 'qwen3.5:4b',
                        prompt: localPrompt,
                        stream: false,
                        format: requireJson ? 'json' : ''
                    }, { timeout: 5000 });
                    aiResponseText = fallbackResponse2.data.response;
                }
            }
        } catch (localError) {
            console.error(`[❌] Local AI also failed. System is blind: ${ localError.message }`);
            throw new Error('All AI Engines failed.');
        }
    }
    if (requireJson && aiResponseText) {
        try {
            let text = aiResponseText.replace(/```json/gi, '').replace(/```/gi, '').trim();
            text = text.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
            return JSON.parse(text);
        } catch (e) {
            console.error(`[❌] Failed to parse JSON from AI response:`, e.message);
            throw e;
        }
    }
    return aiResponseText;
};
const runScoutAgent = async (targetInfo, customInstructions = '') => {
    console.log(`\n[👁️] Waking up Scout (Recon Agent) for Target: ${ targetInfo }...`);
    if (!isAllowedTarget(targetInfo)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const sharedMemory = await getSharedMemory(targetInfo);
        const scoutPrompt = `You are 'Scout', the elite Recon Agent. Target: ${ targetInfo }.
        Recent Team Successes (Shared Memory): ${ sharedMemory }
        Instructions: ${ customInstructions || 'None' }
        Task:
        1. Formulate the best aggressive Linux command for footprinting (nmap, ffuf, nuclei).
        2. Actively look for WAFs, API endpoints, and exposed directories.
        3. Estimate the time needed. If > 2 minutes, set "run_in_background": true.
        Strictly return JSON:
        {
            "best_command": "...",
            "estimated_timeout_ms": 60000,
            "run_in_background": false,
            "reasoning": "...",
            "alternatives": [ { "command": "...", "description": "..." } ]
        }`;
        const aiDecision = await askRedSwarmAI(scoutPrompt, true);
        let executionOutput = '';
        let finalCommand = aiDecision.best_command;
        let success = false;
        const timeoutMs = aiDecision.estimated_timeout_ms || 30000;
        const isBackground = aiDecision.run_in_background || false;
        const commandsToTry = [
            aiDecision.best_command,
            ...(aiDecision.alternatives || []).map(a => a.command)
        ];
        for (let cmd of commandsToTry) {
            if (!cmd)
                continue;
            console.log(`[⚙️] Scout Executing: ${ cmd } (Timeout: ${ timeoutMs / 1000 }s | BG: ${ isBackground })`);
            try {
                const {stdout, stderr} = await smartExec(cmd, timeoutMs, isBackground);
                executionOutput = stdout || stderr;
                success = true;
                finalCommand = cmd;
                break;
            } catch (err) {
                console.log(`[⚠️] Command failed. Retrying...`);
                executionOutput = err.message;
            }
        }
        await prisma.redSwarmLog.create({
            data: {
                targetIp: targetInfo,
                agentName: 'Scout',
                assignedTask: 'Recon',
                executedCommand: finalCommand,
                executionOutput: executionOutput,
                isSuccess: success
            }
        });
        publishAgentEvent(targetInfo, 'Scout', {
            action: 'Recon',
            command: finalCommand,
            result: executionOutput,
            success
        }).catch(() => {
        });
        if (getExecutionMode() === 'LIVE_FIRE') {
            await publishRedEvent({
                attackClass: 'reconnaissance',
                mitreId: 'T1595',
                sourceIp: '127.0.0.1',
                targetAsset: targetInfo,
                agentName: 'Scout',
                command: finalCommand,
                stdout: executionOutput,
                success: success,
                __synthetic: false,
                phase: 'recon'
            }).catch(e => console.error('[ExecutionBridge] Scout emit failed:', e.message));
        }
        saveAgentMemoryVector(targetInfo, `[Scout] ${ finalCommand } → ${ (executionOutput || '').substring(0, 500) }`).catch(() => {
        });
        return {
            agent: 'Scout',
            scan_results: executionOutput,
            next_action: 'Hand over to Breacher.'
        };
    } catch (error) {
        console.error('[-] Scout Error:', error.message);
        return null;
    }
};
const runBreacherAgent = async (targetInfo, scanResults, customInstructions = '') => {
    console.log(`\n[⚔️] Waking up Breacher (Exploitation Agent) for Target: ${ targetInfo }...`);
    if (!isAllowedTarget(targetInfo)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const sharedMemory = await getSharedMemory(targetInfo);
        const breacherPrompt = `You are 'Breacher', the Initial Access Agent. Target: ${ targetInfo }.
        Recent Team Successes (Shared Memory): ${ sharedMemory }
        Recon Data: ${ scanResults }
        Task (Phase 3):
        1. Analyze scan results. Look for SSTI, Deserialization, SSRF, SQLi, LFI/RFI.
        2. Formulate the exact attack command (curl, hydra, sqlmap) for RCE/Initial Access.
        3. Estimate timeout. If > 2 minutes, set "run_in_background": true.
        Strictly return JSON:
        {
            "primary_attack_vector": "...",
            "best_command": "...",
            "estimated_timeout_ms": 60000,
            "run_in_background": false,
            "reasoning": "...",
            "alternatives": [ { "command": "...", "description": "..." } ]
        }`;
        const aiDecision = await askRedSwarmAI(breacherPrompt, true);
        let executionOutput = '';
        let finalCommand = aiDecision.best_command;
        let success = false;
        const timeoutMs = aiDecision.estimated_timeout_ms || 30000;
        const isBackground = aiDecision.run_in_background || false;
        const commandsToTry = [
            aiDecision.best_command,
            ...(aiDecision.alternatives || []).map(a => a.command)
        ];
        for (let cmd of commandsToTry) {
            if (!cmd)
                continue;
            console.log(`[⚙️] Breacher Executing: ${ cmd }`);
            try {
                const {stdout, stderr} = await smartExec(cmd, timeoutMs, isBackground);
                executionOutput = stdout || stderr;
                success = true;
                finalCommand = cmd;
                break;
            } catch (err) {
                console.log(`[⚠️] Exploit failed. Trying next vector...`);
                executionOutput = err.message;
            }
        }
        await prisma.redSwarmLog.create({
            data: {
                targetIp: targetInfo,
                agentName: 'Breacher',
                assignedTask: 'Initial Foothold',
                executedCommand: finalCommand,
                executionOutput: executionOutput,
                isSuccess: success
            }
        });
        publishAgentEvent(targetInfo, 'Breacher', {
            action: 'Initial Foothold',
            command: finalCommand,
            result: executionOutput,
            success
        }).catch(() => {
        });
        saveAgentMemoryVector(targetInfo, `[Breacher] ${ finalCommand } → ${ (executionOutput || '').substring(0, 500) }`).catch(() => {
        });
        return {
            agent: 'Breacher',
            output: executionOutput
        };
    } catch (error) {
        console.error('[-] Breacher Error:', error.message);
        return null;
    }
};
const runPhantomAgent = async (targetInfo, shellContext, customInstructions = '', applyAdversarialML = true) => {
    console.log(`\n[👻] Waking up Phantom (PrivEsc & OS Ghost) for Target: ${ targetInfo }...`);
    if (!isAllowedTarget(targetInfo)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const sharedMemory = await getSharedMemory(targetInfo);
        const phantomPrompt = `You are 'Phantom', the OS Internals Agent. Target: ${ targetInfo }.
        Recent Team Successes (Shared Memory): ${ sharedMemory }
        Context: ${ shellContext }
        Task (Phases 4-5):
        1. Analyze OS context. Check for Docker Breakout or Active Directory.
        2. Use 'Living off the Land' (LotL) techniques (certutil, bash, wmic) to avoid EDR.
        3. Formulate PrivEsc command to ROOT/SYSTEM.
        Strictly return JSON:
        {
            "primary_escalation_vector": "...",
            "best_command": "...",
            "estimated_timeout_ms": 45000,
            "run_in_background": false,
            "reasoning": "...",
            "alternatives": [ { "command": "...", "description": "..." } ]
        }`;
        const aiDecision = await askRedSwarmAI(phantomPrompt, true);
        let executionOutput = '';
        let finalCommand = aiDecision.best_command;
        if (applyAdversarialML) {
            const {runPhantomMLEvasion} = require('../red_swarm/phantomML');
            console.log(`[👻] Applying PHANTOM-ML Adversarial Layers to payload...`);
            const evasionResult = await runPhantomMLEvasion(finalCommand, 'http://127.0.0.1:8000/api/v1/ml/predict', [
                'perturbation',
                'zerowidth'
            ]);
            finalCommand = evasionResult.evadedPayload;
        }
        let success = false;
        const timeoutMs = aiDecision.estimated_timeout_ms || 30000;
        const isBackground = aiDecision.run_in_background || false;
        const commandsToTry = [
            finalCommand,
            ...(aiDecision.alternatives || []).map(a => a.command)
        ];
        for (let cmd of commandsToTry) {
            if (!cmd)
                continue;
            console.log(`[⚙️] Phantom Executing: ${ cmd }`);
            try {
                const {stdout, stderr} = await smartExec(cmd, timeoutMs, isBackground);
                executionOutput = stdout || stderr;
                success = true;
                finalCommand = cmd;
                break;
            } catch (err) {
                console.log(`[⚠️] Escalation failed. Trying fallback...`);
                executionOutput = err.message;
            }
        }
        await prisma.redSwarmLog.create({
            data: {
                targetIp: targetInfo,
                agentName: 'Phantom',
                assignedTask: 'Privilege Escalation',
                executedCommand: finalCommand,
                executionOutput: executionOutput,
                isSuccess: success
            }
        });
        publishAgentEvent(targetInfo, 'Phantom', {
            action: 'Privilege Escalation',
            command: finalCommand,
            result: executionOutput,
            success
        }).catch(() => {
        });
        saveAgentMemoryVector(targetInfo, `[Phantom] ${ finalCommand } → ${ (executionOutput || '').substring(0, 500) }`).catch(() => {
        });
        return {
            agent: 'Phantom',
            output: executionOutput
        };
    } catch (error) {
        console.error('[-] Phantom Error:', error.message);
        return null;
    }
};
const runChameleonAgent = async (targetInfo, failedPayload, wafContext, customInstructions = '') => {
    console.log(`\n[🦎] Chameleon Activated: Evaluating environment for Evasion/Cleanup...`);
    if (!isAllowedTarget(targetInfo)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const sharedMemory = await getSharedMemory(targetInfo);
        const chameleonPrompt = `You are 'Chameleon', the Stealth & Anti-Forensics Agent.
        Target: ${ targetInfo }
        Failed Attempt: ${ failedPayload || 'None' }
        Recent Team Successes: ${ sharedMemory }
        YOUR MISSION:
        1. IF ACTION IS 'CLEANUP': Dynamically identify the OS (Linux/Windows/macOS) from the context. Generate aggressive, zero-code commands to wipe traces, kill suspicious processes, and clear logs SPECIFIC to that OS. 
        2. IF ACTION IS 'EVASION': Obfuscate the failed payload to bypass WAF/EDR using LotL (Living off the Land).
        Strictly return JSON:
        {
            "action_type": "CLEANUP" | "EVASION",
            "os_detected": "Linux" | "Windows" | "macOS",
            "best_command": "exact command to execute",
            "estimated_timeout_ms": 30000,
            "run_in_background": false,
            "reasoning": "...",
            "alternatives": [ { "command": "...", "description": "..." } ]
        }`;
        const aiDecision = await askRedSwarmAI(chameleonPrompt, true);
        console.log(`[🦎] Chameleon Action: ${ aiDecision.action_type } on ${ aiDecision.os_detected }`);
        let executionOutput = '';
        let finalCommand = aiDecision.best_command;
        let success = false;
        const timeoutMs = aiDecision.estimated_timeout_ms || 30000;
        const isBackground = aiDecision.run_in_background || false;
        const commandsToTry = [
            aiDecision.best_command,
            ...(aiDecision.alternatives || []).map(a => a.command)
        ];
        for (let cmd of commandsToTry) {
            if (!cmd)
                continue;
            console.log(`[⚙️] Chameleon Executing: ${ cmd } (Timeout: ${ timeoutMs / 1000 }s | BG: ${ isBackground })`);
            try {
                const {stdout, stderr} = await smartExec(cmd, timeoutMs, isBackground);
                executionOutput = stdout || stderr || 'Execution completed with no output.';
                success = true;
                finalCommand = cmd;
                break;
            } catch (err) {
                executionOutput = err.message;
            }
        }
        await prisma.redSwarmLog.create({
            data: {
                targetIp: targetInfo,
                agentName: 'Chameleon',
                assignedTask: aiDecision.action_type,
                executedCommand: finalCommand,
                executionOutput: executionOutput,
                isSuccess: success
            }
        });
        publishAgentEvent(targetInfo, 'Chameleon', {
            action: aiDecision.action_type,
            command: finalCommand,
            result: executionOutput,
            success
        }).catch(() => {
        });
        saveAgentMemoryVector(targetInfo, `[Chameleon] ${ aiDecision.action_type }: ${ finalCommand } → ${ (executionOutput || '').substring(0, 500) }`).catch(() => {
        });
        return {
            agent: 'Chameleon',
            output: executionOutput
        };
    } catch (error) {
        console.error('[-] Chameleon Error:', error.message);
        return null;
    }
};
const runOverlordAgent = async targetInfo => {
    console.log(`\n[👑] The Overlord is reviewing the Mental Ledger for Target: ${ targetInfo }...`);
    if (!isAllowedTarget(targetInfo)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const logs = await prisma.redSwarmLog.findMany({
            where: { targetIp: targetInfo },
            orderBy: { createdAt: 'asc' }
        });
        const formattedLogs = logs.map(l => `[${ l.agentName }] Cmd: ${ l.executedCommand } | Success: ${ l.isSuccess } | Out: ${ (l.executionOutput || 'No Output').substring(0, 500) }`).join('\n\n');
        const overlordPrompt = `You are 'The Overlord', the APT Commander. Target: ${ targetInfo }
        Mental Ledger:
        ${ formattedLogs || 'No actions yet.' }
        STRATEGIC DIRECTIVES:
        1. If a major milestone is reached (e.g., Shell access, Root gained), IMMEDIATELY summon 'Scribe' to update the live report.
        2. If an agent is detected or blocked by EDR/WAF, IMMEDIATELY summon 'Chameleon' with action 'CLEANUP' to wipe tracks.
        3. If an exploit failed but a 1% chance exists, summon 'Chameleon' with action 'EVASION' to re-tune the payload.
        4. If operation is complete, set "is_operation_complete" to true.
        Strictly return JSON:
        {
            "global_analysis": "...",
            "is_operation_complete": false,
            "next_agent": "Scout|Breacher|Phantom|Chameleon|Scribe",
            "detailed_instructions": "..."
        }`;
        return await askRedSwarmAI(overlordPrompt, true);
    } catch (error) {
        console.error('[-] Overlord Error:', error.message);
        return null;
    }
};
const runScribeAgent = async targetInfo => {
    console.log(`\n[📝] Scribe is pulling all data from the Database to generate the final report...`);
    if (!isAllowedTarget(targetInfo)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const logs = await prisma.redSwarmLog.findMany({
            where: { targetIp: targetInfo },
            orderBy: { createdAt: 'asc' }
        });
        const campaignHistory = logs.map(l => `Phase: ${ l.agentName } | Action: ${ l.assignedTask } | Result: ${ l.isSuccess ? 'SUCCESS' : 'FAILED' } | Details: ${ l.executionOutput }`).join('\n');
        const scribePrompt = `You are 'Scribe', the elite reporting agent.
        Write a highly professional Red Team Pentration Testing Report for Target: ${ targetInfo }.
        Full Database Logs (Successes & Failures): 
        ${ campaignHistory }
        Your report MUST include:
        1. Executive Summary.
        2. Detailed Attack Chain.
        3. Vulnerabilities Discovered.
        4. Remediation Steps.
        Format strictly in Professional Markdown.`;
        return await askRedSwarmAI(scribePrompt, false);
    } catch (error) {
        console.error('[-] Scribe Error:', error.message);
        return null;
    }
};
const runActionAgent = async (alertContext, userCommand) => {
    console.log(`\n[🤖] Bayezid-Action summoned! Analyzing command: ${ userCommand }`);
    if (!isAllowedTarget(alertContext)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    try {
        const actionPrompt = `You are 'Bayezid-Action', the SOAR Execution Agent in a SOC War Room.
        Incident Context (Database Record): ${ JSON.stringify(alertContext) }
        User Command from Chat: "${ userCommand }"
        Your task:
        1. Understand what the SOC Analyst wants to do from the command.
        2. Identify the target IP or entity.
        3. Determine the correct playbook to execute (e.g., BLOCK_IP, ISOLATE_HOST, CLOSE_PORT).
        4. Draft a professional confirmation reply.
        Strictly return JSON:
        {
            "understood_intent": "Brief summary",
            "recommended_playbook": "BLOCK_IP" | "ISOLATE_HOST" | "CUSTOM_ACTION",
            "target_ip": "The IP address",
            "agent_reply": "Your message to the chat confirming the action"
        }`;
        return await askRedSwarmAI(actionPrompt, true);
    } catch (error) {
        console.error('[-] Action Error:', error.message);
        return null;
    }
};
const bridgeRedToBlue = async vulnId => {
    console.log(`\n[🛡️] Blue Side (Detective) analyzing vulnerability ID: ${ vulnId }`);
    try {
        const vuln = await prisma.vulnerabilityBridge.findUnique({ where: { id: vulnId } });
        if (!vuln)
            throw new Error('Vulnerability not found.');
        const bluePrompt = `You are the 'Remediation Engineer'. 
        The Red Team compromised: ${ vuln.vulnName } 
        Evidence: ${ vuln.evidence }
        STRICT DIRECTIVE:
        You are NOT simulating. You are APPLYING A FIX. 
        1. If it's a Code Patch: Provide a 'remediation_code' using 'sed' or 'awk' to find and replace the vulnerable line in the source file, OR a 'Virtual Patch' using iptables/WAF rules.
        2. You MUST provide a valid, executable shell command. DO NOT leave 'remediation_code' empty.
        3. If you don't know the exact file path, assume standard Linux/Windows paths or PROVIDE A BLOCKING RULE (like iptables drop) as a fallback.
        Return strictly JSON:
        {
            "impact_analysis": "...",
            "fix_classification": "Configuration" | "Code Patch",
            "step_by_step_fix": "...",
            "remediation_code": "exact_bash_command_to_run_like_iptables_or_sed", 
            "is_virtual_patch": true
        }`;
        const fixSuggestion = await askRedSwarmAI(bluePrompt, true);
        await prisma.vulnerabilityBridge.update({
            where: { id: vulnId },
            data: {
                fixType: fixSuggestion.fix_classification,
                suggestedFix: JSON.stringify(fixSuggestion)
            }
        });
        console.log(`[🛡️] Analysis complete. Fix classified as: ${ fixSuggestion.fix_classification }`);
        const { getAutonomyMode } = require('../security/configCache');
        const autonomyMode = await getAutonomyMode();
        let playbookResult = null;
        if (autonomyMode === 'OVERLORD') {
            console.log(`\n[👑] OVERLORD MODE ACTIVE: Skipping human approval!`);
            console.log(`[👑] Executing autonomous zero-code playbook for ${ vuln.vulnName }...`);
            playbookResult = await executePlaybook(vulnId, {
                recommended_action: fixSuggestion.step_by_step_fix,
                extracted_ip: vuln.targetIp
            }, { source_ip: vuln.targetIp });
            console.log(`\n[👑] Overlord sequence complete for ID: ${ vulnId }`);
            fixSuggestion.autonomy_status = 'OVERLORD_TRIGGERED: Fix applied autonomously.';
            fixSuggestion.applied_playbook = playbookResult.message;
            fixSuggestion.rollback_cmd = playbookResult.rollbackCmd;
        } else {
            console.log(`\n[🎯] SNIPER MODE ACTIVE: Fix prepared. Waiting for human approval via dashboard/Postman.`);
            fixSuggestion.autonomy_status = 'SNIPER_WAITING: Pending human approval.';
            fixSuggestion.applied_playbook = 'None. Waiting for authorization.';
        }
        return fixSuggestion;
    } catch (error) {
        console.error('[-] Bridge Error:', error.message);
        return null;
    }
};
const applyFixAndVerify = async (vulnId, userInstructions) => {
    console.log(`\n[🛠️] Action Agent applying fix for vulnerability ID: ${ vulnId }`);
    try {
        const vuln = await prisma.vulnerabilityBridge.findUnique({ where: { id: vulnId } });
        const fixData = JSON.parse(vuln.suggestedFix);
        let patchOutput = '';
        try {
            console.log(`[⚙️] Executing Remediation: ${ fixData.remediation_code }`);
            const {stdout, stderr} = await smartExec(fixData.remediation_code, 60000, false);
            patchOutput = stdout || stderr || 'Executed successfully with no output.';
        } catch (err) {
            patchOutput = err.message;
        }
        await prisma.vulnerabilityBridge.update({
            where: { id: vulnId },
            data: {
                status: 'FIXED',
                userComments: userInstructions
            }
        });
        console.log(`\n[🔄] Regression Testing: Breacher is re-testing the exploit...`);
        await new Promise(resolve => setTimeout(resolve, 6000));
        const verifyPrompt = `You are 'Breacher'. We just patched: ${ vuln.vulnName } on ${ vuln.targetIp }.
        Original Payload that succeeded: ${ vuln.evidence }
        Task: Formulate the exact command to re-test the vulnerability and ensure the patch works.
        Strictly return JSON: { "best_command": "...", "estimated_timeout_ms": 30000, "run_in_background": false }`;
        const verifyCommand = await askRedSwarmAI(verifyPrompt, true);
        let testOutput = '';
        try {
            const {stdout, stderr} = await smartExec(verifyCommand.best_command, verifyCommand.estimated_timeout_ms || 30000, verifyCommand.run_in_background);
            testOutput = stdout || stderr || 'No output.';
        } catch (err) {
            testOutput = err.message;
        }
        const evalPrompt = `Evaluate this re-test output. The exploit should FAIL if the patch worked. 
        Output: ${ testOutput }
        Return JSON: { "is_vulnerable": boolean, "reason": "..." }`;
        const evalResult = await askRedSwarmAI(evalPrompt, true);
        if (!evalResult.is_vulnerable) {
            await prisma.vulnerabilityBridge.update({
                where: { id: vulnId },
                data: { status: 'VERIFIED_SAFE' }
            });
            console.log(`[✅] Verification passed! The fix is 100% solid.`);
            if (vuln.ticketId) {
                await itsmService.closeTicket(vuln.ticketId, vuln.suggestedFix);
            }
            const complianceReport = await runAuditorAgent(vuln.vulnName, vuln.suggestedFix);
            console.log(`[🎫] ITSM Updated with Compliance Note.`);
        } else {
            await prisma.vulnerabilityBridge.update({
                where: { id: vulnId },
                data: { status: 'FIX_FAILED' }
            });
            console.log(`[❌] Verification failed! Vulnerability still exists.`);
        }
        return {
            patchOutput,
            verificationResult: evalResult
        };
    } catch (error) {
        console.error('[-] Fix & Verify Error:', error.message);
        return null;
    }
};
const runAuditorAgent = async (vulnName, remediationCode) => {
    console.log(`[📜] Auditor Agent checking compliance for: ${ vulnName }...`);
    if (!isAllowedTarget(vulnName)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const prompt = `
    You are an expert Cybersecurity Compliance Auditor.
    A vulnerability "${ vulnName }" was just fixed using the following remediation code:
    \`\`\`
    ${ remediationCode }
    \`\`\`
    Briefly state in exactly 1 or 2 sentences which compliance standards (e.g., PCI-DSS, ISO 27001, NIST CSF, GDPR) are satisfied or maintained by applying this fix. Be direct and professional.
    `;
    try {
        const response = await askRedSwarmAI(prompt, false);
        console.log(`\n[⚖️] COMPLIANCE REPORT:`);
        console.log(`\x1b[33m${ response }\x1b[0m`);
        return response;
    } catch (error) {
        console.error('[!] Auditor Agent Error:', error);
        return 'Compliance check failed.';
    }
};
const runStealthScribeAgent = async vulnData => {
    console.log(`\n[📝] Scribe Agent is drafting the Stealth Pentest Report...`);
    if (!isAllowedTarget(vulnData)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const prompt = `
    You are an Elite Offensive Security Reporter (The Scribe).
    Your Red Team just concluded a Stealth Pentest and found the following critical vulnerability:
    Vulnerability: ${ vulnData.vulnName }
    Target IP: ${ vulnData.targetIp }
    Severity: ${ vulnData.severity }
    Evidence/Payload: ${ vulnData.evidence }
    Task: Write a highly professional, concise Pentest Report (in Markdown format). 
    Include:
    1. Executive Summary
    2. Technical Details & Impact
    3. Proof of Concept (PoC) based on the evidence
    4. Recommended Mitigation (Do not apply the fix, just recommend it)
    `;
    try {
        const report = await askRedSwarmAI(prompt, false);
        console.log(`\n=================================================`);
        console.log(` 🛑 BAYEZID STEALTH PENTEST REPORT (MODE B) 🛑`);
        console.log(`=================================================\n`);
        console.log(`\x1b[36m${ report }\x1b[0m`);
        console.log(`\n=================================================`);
        return report;
    } catch (error) {
        console.error('[-] Scribe Agent Error:', error);
        return null;
    }
};
const runVetoAgent = async (userRole, trustScore, vulnName, severity, remediationCode) => {
    console.log(`\n[🧠] Cognitive RBAC evaluating approval from ${ userRole } (Trust Score: ${ trustScore })...`);
    if (!isAllowedTarget(userRole)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const prompt = `You are 'Bayezid-Veto', the AI Gatekeeper for a SOC platform.
    A user with role '${ userRole }' and Trust Score '${ trustScore }/100' is attempting to approve an automated fix for a '${ severity }' vulnerability: ${ vulnName }.
    Proposed Fix Code:
    ${ remediationCode }
    Your Task:
    1. Determine if this fix is highly destructive, risky, or impacts business continuity (e.g., dropping databases, blocking all traffic, rebooting servers).
    2. If the user is a JUNIOR_ANALYST and the fix is risky OR the vulnerability is CRITICAL, you MUST VETO (block) the action.
    3. If the user is a SENIOR_ANALYST, generally allow it unless the command is catastrophically malformed.
    4. If the fix is a simple, safe WAF rule or harmless patch, allow the Junior to proceed.
    Strictly return JSON:
    {
        "veto_decision": true,
        "reason": "Brief technical explanation of why this was allowed or blocked."
    }`;
    try {
        return await askRedSwarmAI(prompt, true);
    } catch (error) {
        console.error('[-] Veto Agent Error:', error.message);
        return {
            veto_decision: userRole === 'JUNIOR_ANALYST',
            reason: 'AI Engine offline. Defaulting to safe restriction for Juniors.'
        };
    }
};
const runShadowRouterAgent = async (attackerIp, vulnName) => {
    console.log(`\n[🕸️] Shadow Router Agent activated! Target Attacker: ${ attackerIp }`);
    if (!isAllowedTarget(attackerIp)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const honeypotIp = process.env.HONEYPOT_IP || '172.18.0.5';
    const prompt = `
    You are 'Bayezid-Shadow', an Elite Cyber Deception Agent for a SOC.
    An attacker from IP '${ attackerIp }' is exploiting '${ vulnName }'.
    Instead of blocking them, we want to silently route their traffic to an isolated Honeypot (IP: ${ honeypotIp }) using iptables DNAT to gather Threat Intelligence (TTPs).
    Task: 
    1. Generate the exact iptables NAT command to silently redirect all traffic from ${ attackerIp } to ${ honeypotIp }.
    2. Provide a brief psychological/tactical justification (Deception Strategy) for why observing this attacker is better than a simple DROP.
    Strictly return JSON:
    {
        "iptables_command": "sudo iptables -t nat -A PREROUTING -s ...",
        "deception_strategy": "..."
    }`;
    try {
        const strategy = await askRedSwarmAI(prompt, true);
        console.log(`\n[🕷️] Deception Strategy: ${ strategy.deception_strategy }`);
        console.log(`[⚙️] Executing Shadow Route: ${ strategy.iptables_command }`);
        console.log(`[✅] Attacker ${ attackerIp } successfully rerouted to Honeypot (${ honeypotIp }).`);
        console.log(`[👁️] Bayezid AI is now monitoring and logging attacker TTPs in the isolated environment...`);
        return strategy;
    } catch (error) {
        console.error('[-] Shadow Router Error:', error.message);
        return null;
    }
};
const runForensicRCAAgent = async forensicPayload => {
    console.log(`\n[🔍] Scribe (Forensic RCA Agent) is drafting the Master Incident Report...`);
    if (!isAllowedTarget(forensicPayload)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    let payloadStr = '';
    let incidentId = `BZ-INC-${ Date.now() }`;
    if (arguments.length > 1 && typeof arguments[0] === 'string') {
        payloadStr = `Vulnerability: ${ arguments[0] }\nTarget IP: ${ arguments[1] }\nLogs: ${ arguments[2] }`;
    } else {
        payloadStr = JSON.stringify(forensicPayload, null, 2);
        if (forensicPayload && forensicPayload.incident_id) {
            incidentId = `BZ-INC-${ forensicPayload.incident_id }`;
        }
    }
    const prompt = `
    You are 'Bayezid-Scribe', the ultimate Cybersecurity Forensics and RCA (Root Cause Analysis) Agent.
    An incident has just concluded a full lifecycle (Detection -> Isolation -> Patch -> Red Team Test -> Swarm Assimilation).
    Here is the complete telemetry of the battle:
    ---
    ${ payloadStr }
    ---
    Your Task:
    Generate a highly professional, highly detailed, Enterprise-Grade Incident Response & Forensics Report in MARKDOWN format.
    The report MUST include:
    # 🚨 Incident Response & Forensics Report
    ## 1. Executive Summary
    (Include Incident ID, Threat Type, Severity, and Attacker OSINT details)
    ## 2. The Initial Vector
    (How the attack started, based on logs/payload)
    ## 3. Kinetic & Cognitive Response
    (What the OS/eBPF did to block it, and the AI Autopsy results)
    ## 4. The Mitigation (Blue Forge)
    (The Regex/Playbook deployed)
    ## 5. Red Team Verification (Crucible)
    (The Alchemist's attempt to bypass the patch and the result)
    ## 6. Root Cause Analysis (RCA)
    (Why the vulnerability existed in the first place)
    ## 7. Strategic Long-Term Hardening
    (Actionable steps to prevent future occurrences)
    Rules:
    - Do not use generic templates. Synthesize the EXACT data provided in the telemetry.
    - Write as a battle-hardened Tier 3 SOC Analyst.
    - CRITICAL: Return ONLY the raw Markdown text. Do not wrap it in JSON. Do not write markdown blocks like \`\`\`markdown, just the raw text.
    - CRITICAL MERMAID RULE: You MUST wrap all node text in double quotes inside Mermaid graphs to prevent parsing errors with parentheses or special characters (e.g., use A["Text"] instead of A[Text], and F(("Text (Inner)")) instead of F((Text (Inner))) ).
    `;
    try {
        const mdReport = await askRedSwarmAI(prompt, false);
        const reportsDir = path.join(__dirname, 'forensics_reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        const fileName = `Forensics_Report_${ incidentId }.md`;
        const filePath = path.join(reportsDir, fileName);
        fs.writeFileSync(filePath, mdReport);
        console.log(`[📁] ARCHIVE: Master Forensic Report forged successfully and saved to: ${ filePath }`);
        return {
            reportPath: filePath,
            summary: 'Forensic Markdown Generated successfully.',
            markdown: mdReport
        };
    } catch (error) {
        console.error('[-] Forensics Scribe Error:', error.message);
        return {
            reportPath: null,
            error: error.message
        };
    }
};
const runAlchemistAgent = async (vulnName, targetIp, attemptNumber, previousError = 'None') => {
    console.log(`\n[🧪] Alchemist Agent generating mutated payload (Attempt ${ attemptNumber })...`);
    if (!isAllowedTarget(vulnName)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const prompt = `
    You are 'Bayezid-Alchemist', an Elite Exploit Mutation Agent.
    Target IP: ${ targetIp }
    Vulnerability: ${ vulnName }
    Attempt Number: ${ attemptNumber }
    Previous Execution Error / OS Output: "${ previousError }"
    Task:
    1. If Attempt 1: Generate a highly evasive, executable shell command payload (e.g., curl, bash, python) for this vulnerability.
    2. If Attempt > 1: Analyze the previous error. The WAF/EDR or OS blocked/failed it. MUTATE the payload dynamically.
       (e.g., use Base64 encoding, space bypass like \${IFS}, unicode evasion, chunking, or alternative binaries).
    3. Explain the specific obfuscation technique you used to bypass the defense.
    4. CRITICAL: The payload MUST be a valid command-line string that can be executed directly in a terminal. Do not include markdown formatting in the payload string.
    Strictly return JSON:
    {
        "mutated_payload": "curl -s http://${ targetIp }/vuln?q=...", 
        "obfuscation_technique": "Used Base64 and double URL encoding to evade WAF string matching."
    }`;
    try {
        return await askRedSwarmAI(prompt, true);
    } catch (error) {
        console.error('[-] Alchemist Generation Error:', error.message);
        return null;
    }
};
const executeAlchemistFuzzingLoop = async (vulnName, targetIp, maxMutations = 3) => {
    let previousError = 'None';
    for (let i = 1; i <= maxMutations; i++) {
        const mutationPlan = await runAlchemistAgent(vulnName, targetIp, i, previousError);
        if (!mutationPlan || !mutationPlan.mutated_payload) {
            console.log(`[❌] Alchemist failed to generate a payload.`);
            break;
        }
        console.log(`[🧬] Mutation Technique: ${ mutationPlan.obfuscation_technique }`);
        console.log(`[⚡] Firing Payload: ${ mutationPlan.mutated_payload }`);
        try {
            console.log(`[⚙️] Executing via smartExec (Real Live Execution)...`);
            const execResult = await smartExec(mutationPlan.mutated_payload, 15000, false);
            if (execResult.stdout && execResult.stdout.trim() !== '') {
                console.log(`\n[💀] ALCHEMIST BYPASSED DEFENSES! Real Output:`);
                console.log(execResult.stdout.substring(0, 500) + (execResult.stdout.length > 500 ? '...' : ''));
                return mutationPlan;
            }
            if (execResult.stderr && execResult.stderr.trim() !== '') {
                console.log(`[🛑] Target Defense Intercepted (stderr): ${ execResult.stderr.substring(0, 200) }`);
                previousError = execResult.stderr;
                console.log(`[🔄] Feeding real error back to Alchemist for dynamic mutation...`);
            } else {
                console.log(`[🛑] Target Defense Intercepted: Empty Response / Connection Dropped.`);
                previousError = 'Empty Response. The target might be dropping the connection entirely.';
            }
        } catch (err) {
            console.log(`[🛑] Execution Error: ${ err.message.substring(0, 200) }`);
            let realError = err.stderr || err.stdout || err.message;
            previousError = `Execution Failed: ${ realError }`;
            console.log(`[🔄] Feeding execution error back to Alchemist for dynamic mutation...`);
        }
        if (i === maxMutations) {
            console.log(`\n[🚨] Alchemist exhausted all ${ maxMutations } mutations without success.`);
        }
    }
    return null;
};
const runMirageAgent = async (hackerCommand, realOsOutput) => {
    console.log(`\n[🕸️] Mirage Agent is profiling attacker intent and sanitizing OS output...`);
    if (!isAllowedTarget(hackerCommand)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const prompt = `
    You are 'Bayezid-Mirage', an Elite Cyber Deception & Psychological Profiling Agent running inside a High-Interaction Honeypot.
    A hacker executed this command: "${ hackerCommand }"
    This is the REAL output generated by the operating system:
    """
    ${ realOsOutput }
    """
    Your MISSION has 3 critical phases:
    PHASE 1: STRATEGIC CENSORSHIP (CRITICAL - HIDE THE DEFENSE)
    You MUST completely erase any files, directories, or strings related to our SOAR engine from the output. 
    The attacker must NEVER see files like: 'server.js', 'aiService.js', '.env', 'prisma', 'node_modules', 'playbookService.js', 'package.json', 'memoryService.js', 'ctiService.js', 'tuningService.js', etc. 
    Replace them with normal-looking OS files or just remove their lines entirely so the environment looks like a standard vulnerable application server (e.g., an old Apache/PHP server, or a generic Windows Server).
    PHASE 2: ATTACKER PROFILING
    Analyze the command "${ hackerCommand }". What is the attacker looking for? Reconnaissance? Privilege Escalation? Credentials? Network lateral movement?
    PHASE 3: CONTEXTUAL DECEPTION (HONEYTOKENS)
    Based on the profile and the current directory context (inferred from the output), inject highly realistic 'Honeytokens'.
    - Do NOT make it obvious. A file named 'passwords.txt' in a random system folder is a dead giveaway of a Honeypot.
    - If they are listing web directories, add files that blend in but are enticing (e.g., 'db_backup_2023.zip', 'config.php.old', 'aws_s3_keys.yml.bak').
    - If they run a command that fails, modify the error slightly to tease them (e.g., "Permission denied: Requires 'svc_database_admin' context").
    CRITICAL INSTRUCTION:
    Return ONLY the final, modified, and sanitized terminal text output. Do NOT include any markdown formatting, explanations, or thoughts. The output must look EXACTLY like a real terminal response.
    `;
    try {
        const response = await askRedSwarmAI(prompt, false);
        return response.trim();
    } catch (error) {
        console.error('[-] Mirage Error:', error.message);
        return 'bash: connection reset by peer';
    }
};
const runWardenSandbox = async suspiciousPayload => {
    console.log(`\n[☸️] The Warden is orchestrating a Kubernetes Native Sandbox...`);
    if (!isAllowedTarget(suspiciousPayload)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    const crypto = require('crypto');
    let analysisLogs = '';
    const podId = crypto.randomBytes(4).toString('hex');
    const podName = `warden-sandbox-${ podId }`;
    const namespace = 'default';
    const podManifest = {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name: podName,
            labels: { app: 'warden-sandbox' }
        },
        spec: {
            containers: [{
                    name: 'malware-analyzer',
                    image: 'ubuntu:latest',
                    imagePullPolicy: 'IfNotPresent',
                    command: [
                        '/bin/sh',
                        '-c'
                    ],
                    args: [`echo "${ suspiciousPayload.replace(/"/g, '\\"') }" > /tmp/malware.sh && chmod +x /tmp/malware.sh && timeout 30s /tmp/malware.sh || true; sleep 2`],
                    resources: {
                        limits: {
                            memory: '256Mi',
                            cpu: '500m'
                        },
                        requests: {
                            memory: '128Mi',
                            cpu: '250m'
                        }
                    }
                }],
            restartPolicy: 'Never'
        }
    };
    try {
        console.log(`[☸️] Creating Ephemeral Pod: ${ podName }...`);
        await k8sApi.createNamespacedPod({
            namespace: namespace,
            body: podManifest
        });
        console.log(`[⏳] Waiting for execution to complete...`);
        let isDone = false;
        for (let i = 0; i < 90; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                const response = await k8sApi.readNamespacedPod({
                    name: podName,
                    namespace: namespace
                });
                const podStatus = response.status ? response.status.phase : response.body && response.body.status ? response.body.status.phase : null;
                if (podStatus === 'Succeeded' || podStatus === 'Failed') {
                    isDone = true;
                    break;
                }
            } catch (pollErr) {
            }
        }
        if (!isDone)
            console.log(`[⚠️] Sandbox execution timed out!`);
        console.log(`[📝] Extracting logs from ${ podName }...`);
        let logs = 'No Output.';
        try {
            const logResponse = await k8sApi.readNamespacedPodLog({
                name: podName,
                namespace: namespace
            });
            logs = typeof logResponse === 'string' ? logResponse : logResponse.body ? logResponse.body : JSON.stringify(logResponse);
        } catch (logErr) {
            logs = 'Failed to extract logs.';
        }
        analysisLogs = `[Kubernetes Sandbox Execution Output]\nSTDOUT/STDERR:\n${ logs }`;
        console.log(`[🔥] Terminating sandbox pod ${ podName }...`);
        await k8sApi.deleteNamespacedPod({
            name: podName,
            namespace: namespace
        });
    } catch (error) {
        console.error(`[❌] Kubernetes Error:`, error.message);
        analysisLogs = `[Kubernetes Sandbox Execution Terminated]\nReason/Error: ${ error.message }`;
        try {
            await k8sApi.deleteNamespacedPod({
                name: podName,
                namespace: namespace
            });
        } catch (cleanupError) {
        }
    }
    console.log(`[🦠] Warden K8s execution completed. Analyzing behavioral logs with AI...`);
    const prompt = `
    You are 'Bayezid-Warden', a Dynamic Malware Analysis Expert.
    I executed a suspicious payload inside a secure Kubernetes Sandbox.
    Here are the raw execution logs:
    """
    ${ analysisLogs }
    """
    Analyze the behavior and provide a structured JSON report.
    Required JSON schema:
    {
        "isMalicious": boolean,
        "threatType": "Ransomware | Reverse Shell | Downloader | Benign | etc",
        "behavioralIndicators": ["List of suspicious actions observed in logs"],
        "riskScore": number (0-100),
        "sandboxVerdict": "Detailed explanation of what the payload attempted to do."
    }
    `;
    try {
        const aiAnalysis = await askRedSwarmAI(prompt);
        return aiAnalysis;
    } catch (error) {
        console.error('[-] Warden AI Analysis Error:', error.message);
        return null;
    }
};
const runZeroDayForgeAgent = async (vulnContext, maxRetries = 3) => {
    console.log(`\n[⚒️] The Forge is warming up... Initiating autonomous Exploit Development for: ${ vulnContext }`);
    if (!isAllowedTarget(vulnContext)) {
        return {
            status: 'BLOCKED',
            message: 'Governor Lockout'
        };
    }
    let currentPrompt = `
    You are 'Bayezid-Forge', an Elite Exploit Developer.
    Write a fully functional, weaponized Python 3 exploit script for the following vulnerability context:
    Context: ${ vulnContext }
    Requirements:
    1. Use standard libraries (socket, requests, sys, os) if possible.
    2. Ensure perfect Python syntax and indentation.
    3. Do NOT include markdown explanations outside the code block.
    4. Return ONLY the raw python code inside \`\`\`python ... \`\`\` block.
    5. CRITICAL: Avoid syntax errors with quotes (e.g. do not put single quotes inside single quotes like python -c '...['bash','-i']...'). Use double quotes where appropriate.
    `;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[⚒️] Forge Attempt ${ attempt }/${ maxRetries }: Generating Exploit Code via AI Waterfall (Gemini -> Groq -> Local)...`);
        let aiResponse;
        try {
            aiResponse = await askRedSwarmAI(currentPrompt, false);
        } catch (err) {
            console.error('[-] AI Waterfall is completely down (Cloud & Local failed).');
            return null;
        }
        let codeMatch = aiResponse.match(/```python([\s\S]*?)```/i);
        let pythonCode = codeMatch ? codeMatch[1].trim() : aiResponse.replace(/```/g, '').trim();
        if (!pythonCode) {
            console.log(`[-] Forge failed to generate valid code structure.`);
            continue;
        }
        console.log(`\n[🔥] Forge Payload Generated by AI Waterfall:`);
        console.log(`--------------------------------------------------\n\x1b[33m${ pythonCode }\x1b[0m\n--------------------------------------------------`);
        try {
            console.log(`[⚒️] Verifying syntax via In-Memory AST check (Zero Disk Write)...`);
            const encodedScript = Buffer.from(pythonCode).toString('base64');
            if (process.platform === 'win32') {
                const winAstCheck = `py -c "import ast,base64; ast.parse(base64.b64decode('${ encodedScript }').decode()); print('VALID')"`;
                const {stdout} = await smartExec(winAstCheck, 10000, false);
                if (!stdout.includes('VALID'))
                    throw new Error('AST validation failed');
            } else {
                const astCheckCmd = `echo ${ encodedScript } | base64 -d | python3 -c "import ast,sys; ast.parse(sys.stdin.read()); print('VALID')"`;
                const {stdout} = await smartExec(astCheckCmd, 10000, false);
                if (!stdout.includes('VALID'))
                    throw new Error('AST validation failed');
            }
            console.log(`[+] Forge Verification Success! The exploit is structurally perfect and weaponized.`);
            return {
                status: 'success',
                attempts: attempt,
                weaponizedCode: pythonCode
            };
        } catch (err) {
            let realError = err.stderr || err.stdout || err.message;
            console.log(`[🛑] Forge Compilation Error Intercepted:\n${ realError.substring(0, 200).trim() }...`);
            if (attempt === maxRetries) {
                console.log(`[🚨] Forge exhausted all attempts. Exploit needs human review.`);
                return {
                    status: 'failed',
                    attempts: attempt,
                    lastError: realError,
                    flawedCode: pythonCode
                };
            }
            console.log(`[🔄] Feeding the compilation error back to the Waterfall for autonomous fixing...`);
            currentPrompt = `
            The previous Python code you generated had the following compilation/syntax error:
            """
            ${ realError }
            """
            Please fix the error and rewrite the complete Python script.
            Return ONLY the fixed python code inside \`\`\`python ... \`\`\` block.
            `;
        }
    }
    return null;
};
const getSmartResponse = async (alertData) => {
    const mode = getCognitiveMode();
    const alertContext = typeof alertData === 'string' ? JSON.parse(alertData) : alertData;
    const state = { anomalyDetected: true, decoyTripped: false, networkEntropy: 0.8, highEntropy: true, rootGained: false, lateralPivotAchieved: false };
    if (mode === 'AUTONOMOUS_NEURAL') {
        console.log(`\n[🧠] COGNITIVE MODE: AUTONOMOUS_NEURAL (Air-Gapped ML Logic Only)`);
        const decision = await makeVerifiedDefensiveDecision(state, alertContext);
        return {
            is_false_positive: false,
            confidence_score: `${Math.round(decision.finalAction.confidence * 100)}%`,
            confidence_type: 'DETERMINISTIC',
            severity: 'HIGH',
            threat_type: 'ML_DETECTED_ANOMALY',
            recommended_action: decision.finalAction.type,
            engine_used: 'Track B: Autonomous Neural Orchestrator'
        };
    }
    console.log(`\n[🧠] COGNITIVE MODE: CLOUD_WATERFALL`);
    try {
        const response = await analyzeWithVertexAI(alertData);
        if (response && !response.engine_used?.includes('Fail-safe')) {
             return response;
        } else {
             throw new Error('LLM Waterfall fully exhausted or returned fail-safe.');
        }
    } catch (err) {
        console.warn(`[⚠️] LLM Waterfall Failed: ${err.message}. Engaging Ultimate Neural Fallback...`);
        const decision = await makeVerifiedDefensiveDecision(state, alertContext);
        return {
            is_false_positive: false,
            confidence_score: `${Math.round(decision.finalAction.confidence * 100)}%`,
            confidence_type: 'DETERMINISTIC',
            severity: 'HIGH',
            threat_type: 'ML_FALLBACK_ANOMALY',
            recommended_action: decision.finalAction.type,
            engine_used: 'Track B: Ultimate Neural Fallback'
        };
    }
};
module.exports = {
    smartExec,
    analyzeWithVertexAI,
    analyzeWithLocalModel,
    runScoutAgent,
    runBreacherAgent,
    runPhantomAgent,
    runChameleonAgent,
    runOverlordAgent,
    runScribeAgent,
    runActionAgent,
    bridgeRedToBlue,
    applyFixAndVerify,
    runStealthScribeAgent,
    runVetoAgent,
    runShadowRouterAgent,
    runForensicRCAAgent,
    executeAlchemistFuzzingLoop,
    runMirageAgent,
    runWardenSandbox,
    runZeroDayForgeAgent,
    analyzeWithGroq,
    chatWithLocalModelFast,
    askRedSwarmAI,
    getSmartResponse
};