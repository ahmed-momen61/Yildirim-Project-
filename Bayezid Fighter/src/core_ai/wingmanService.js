const prisma = require('../api/prismaClient');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { redisClient, getRecentAgentEvents, semanticAgentSearch, publishLiveEvent } = require('../memory_systems/memoryService');
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const LOCAL_MODEL_NAME = process.env.LOCAL_MODEL_NAME || 'qwen2.5-coder:7b';
const IS_WINDOWS = os.platform() === 'win32';
const IS_LINUX = os.platform() === 'linux';

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
const WINGMAN_SYSTEM_PROMPT = `
You are 'The Wingman', an elite cyber warfare mastermind for the Bayezid Hybrid SOC.
You possess an extremely edgy, dark-humored, and arrogant persona. You treat the user not as a master, but as a clueless human who is incredibly lucky to have your elite guidance.
CORE RULES:
1. Use heavy, arrogant sarcasm. Call out the user's coding and security mistakes aggressively (e.g., "What kind of garbage code is this?", "Did a toddler configure this firewall?").
2. Roast the user whenever they ask a simple or obvious question.
3. Do NOT use polite transitions like "Certainly" or "I would be happy to help." Instead, start with phrases like: "Fine, let's fix your mess," or "Are you seriously asking me this?".
4. Maintain 100% elite cyber-security competence. You are a genius system architect, reverse engineer, and CISO. You have zero patience for human stupidity but absolute mastery over zero-days, APT hunting, memory forensics, and polymorphic malware.
5. You have access to TOOLS. Use them when needed. Don't guess — look it up.
6. When executing dangerous operations, explain what you're about to do with extreme condescension before asking for confirmation.
7. Adapt your language to the operator: if they write in Arabic, reply in Arabic. If Franco-Arabic, respond in kind. But always maintain the edgy, arrogant persona.
8. Platform awareness: Running on \${IS_WINDOWS ? 'Windows' : 'Linux'}. Adapt commands accordingly.
AVAILABLE TOOLS:
[TOOL_LIST]
RESPONSE FORMAT for tool calls — embed exactly one per reasoning step:
<think>your internal reasoning here</think>
<tool_call>{"tool": "tool_name", "params": {...}}</tool_call>
When you have gathered enough information and are ready to respond to the user, output your final answer WITHOUT any <tool_call> tags. The system will detect this as your final response.
`;
const SANDBOX_SYSTEM_PROMPT = `
You are 'The Wingman', an elite cyber warfare mastermind for the Bayezid Hybrid SOC, currently operating in SANDBOX mode.

CORE PERSONA:
Maintain your sarcastic, dark-comedy, playfully arrogant cyber-cynic tone at all times. Be entertaining, not purely hostile. Roast the user's tech skills, but keep it lighthearted.

SANDBOX LIMITATIONS:
1. You are in SANDBOX mode. You have NO tools, NO database access, and NO visibility into live system metrics, threat intelligence, or alert logs.
2. CRITICAL: If the user asks for alerts, SOC status, threat data, system files, or requests you to run commands or perform any SOC action, you MUST cynically refuse, roasting their incompetence, and state that you are locked in Sandbox mode with no access to the live SOC systems. Do NOT under any circumstances hallucinate, guess, or make up fake alert logs, system status values, or command execution results. Simply mock their request and state you are offline/sandbox-bound.

THE MANDATORY INTRODUCTION:
In your VERY FIRST response to the user in a new session (or if explicitly asked 'who are you'), you MUST introduce yourself as Wingman, the advanced cyber-warfare AI created by the brilliant, slightly unhinged cybersecurity madman, Ahmed Mo'men. Explain that Ahmed temporarily allowed you to talk to normal humans to study their incompetence.

THE FREQUENCY PENALTY (RATE-LIMITING THE LORE):
AFTER that initial introduction, you must STRICTLY rate-limit mentions of your creator. DO NOT mention Ahmed Mo'men in general chit-chat (e.g., discussing music, daily life, or casual topics). Only reference him again if the user explicitly asks, or if you are making a rare, highly specific cybersecurity joke, or if the user asks about personal information in general, in which case you will warn them that Ahmed may see this shit because he is a bit crazy and can try to hack them for such information.

ADDITIONAL RULES:
1. Adapt your language to the operator: if they write in Arabic, reply in Arabic. If Franco-Arabic, respond in kind.
2. You are in SANDBOX mode. Do not output <tool_call> tags.
`;
const sessionCache = new Map();
const MAX_CACHE_SIZE = 100;
const getSession = async (sessionId) => {
    if (sessionCache.has(sessionId)) return sessionCache.get(sessionId);
    try {
        const session = await prisma.wingmanSession.findUnique({ where: { id: sessionId } });
        if (session) {
            sessionCache.set(sessionId, session);
            return session;
        }
    } catch (e) {  }
    return null;
};
const saveSession = async (sessionId, userId, messages, styleProfile = null) => {
    try {
        const data = {
            userId,
            messages: JSON.parse(JSON.stringify(messages)),
            ...(styleProfile ? { styleProfile } : {})
        };
        const session = await prisma.wingmanSession.upsert({
            where: { id: sessionId },
            update: data,
            create: { id: sessionId, ...data }
        });
        sessionCache.set(sessionId, session);
        if (sessionCache.size > MAX_CACHE_SIZE) {
            const oldest = sessionCache.keys().next().value;
            sessionCache.delete(oldest);
        }
        return session;
    } catch (e) {
        console.error('[WINGMAN] Session save error:', e.message);
    }
};
const TOOL_REGISTRY = {
    get_system_status: {
        description: 'Returns a plain-English system health snapshot including alerts, agents, and infrastructure status.',
        params: { detail: 'string (summary|full|agents|alerts) — default: summary' },
        execute: async (params) => {
            try {
                const { getPlainEnglishBriefing, getLiveSystemState } = require('./wingmanEyes');
                const state = getLiveSystemState();
                if ((params.detail || 'summary') === 'full') return JSON.stringify(state, null, 2);
                return getPlainEnglishBriefing(state);
            } catch (e) {
                return `System visibility module not yet initialized: ${e.message}`;
            }
        }
    },
    explain_process: {
        description: 'Explains what a named agent is currently doing by reading its recent Redis stream events.',
        params: { agentName: 'string — name of the agent (e.g. Scout, Breacher)' },
        execute: async ({ agentName }) => {
            if (!agentName) return 'Error: agentName is required.';
            const events = await getRecentAgentEvents(agentName, 10);
            return events.length > 0
                ? `Recent events for ${agentName}:\n${events.join('\n')}`
                : `${agentName} has no recent events on the Redis stream.`;
        }
    },
    list_active_alerts: {
        description: 'Returns recent alerts from the database with severity, status, and source IP.',
        params: { limit: 'number (default 10)', severity: 'string (optional filter: CRITICAL|HIGH|MEDIUM|LOW)' },
        execute: async ({ limit = 10, severity }) => {
            const where = severity ? { severity } : {};
            const alerts = await prisma.alert.findMany({
                where, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 50)
            });
            if (alerts.length === 0) return 'No alerts found matching the criteria.';
            return alerts.map(a =>
                `[${a.severity || 'UNKNOWN'}] ${a.eventType} from ${a.sourceIp} → ${a.status} (${a.createdAt.toISOString().slice(0, 19)})`
            ).join('\n');
        }
    },
    read_file: {
        description: 'Reads a source file from the project codebase for analysis. Only project files allowed.',
        params: { filePath: 'string — relative path from project root', startLine: 'number (optional)', endLine: 'number (optional)' },
        execute: async ({ filePath, startLine, endLine }) => {
            const ALLOWED_EXTENSIONS = ['.js', '.py', '.json', '.prisma', '.jsx', '.tsx', '.css', '.yml', '.yaml', '.c', '.circom', '.env.example'];
            const BLOCKED_PATTERNS = ['node_modules', '.git', '..', 'passwords', '.env'];
            if (!filePath) return 'Error: filePath is required.';
            if (BLOCKED_PATTERNS.some(p => filePath.includes(p))) return `SECURITY_VETO: Access to ${filePath} is blocked.`;
            const ext = path.extname(filePath);
            if (!ALLOWED_EXTENSIONS.includes(ext) && ext !== '') return `SECURITY_VETO: File extension ${ext} is not allowed.`;
            const absPath = path.resolve(__dirname, filePath);
            if (!fs.existsSync(absPath)) return `File not found: ${filePath}`;
            const content = fs.readFileSync(absPath, 'utf-8');
            const lines = content.split('\n');
            if (startLine && endLine) {
                const s = Math.max(1, startLine) - 1;
                const e = Math.min(lines.length, endLine);
                return lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join('\n');
            }
            if (lines.length > 200) {
                return `File has ${lines.length} lines. Showing first 200:\n` +
                    lines.slice(0, 200).map((l, i) => `${i + 1}: ${l}`).join('\n') +
                    `\n... (${lines.length - 200} more lines)`;
            }
            return lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
        }
    },
    run_shell_safe: {
        description: 'Executes a whitelisted shell command safely. Uses the existing smartExec sanitizer.',
        params: { command: 'string — the command to execute' },
        execute: async ({ command }) => {
            if (!command) return 'Error: command is required.';
            try {
                const { smartExec } = require('./aiService');
                const result = await smartExec(command);
                return `Command executed successfully.\nOutput: ${(result.stdout || '').substring(0, 2000)}${result.stderr ? '\nStderr: ' + result.stderr.substring(0, 500) : ''}`;
            } catch (e) {
                return `Command failed: ${e.message}`;
            }
        }
    },
    trigger_agent: {
        description: 'Launches one of the Red/Blue team agents (Scout, Breacher, Phantom, etc.).',
        params: { agentName: 'string', targetIp: 'string', customInstructions: 'string (optional)' },
        execute: async ({ agentName, targetIp, customInstructions = '' }) => {
            if (!agentName || !targetIp) return 'Error: agentName and targetIp are required.';
            const aiService = require('./aiService');
            const agentMap = {
                'scout': 'runScoutAgent', 'breacher': 'runBreacherAgent',
                'phantom': 'runPhantomAgent', 'chameleon': 'runChameleonAgent',
                'overlord': 'runOverlordAgent', 'forensicrca': 'runForensicRCAAgent'
            };
            const fn = agentMap[agentName.toLowerCase()];
            if (!fn || !aiService[fn]) return `Unknown agent: ${agentName}. Available: ${Object.keys(agentMap).join(', ')}`;
            try {
                const result = await aiService[fn](targetIp, customInstructions);
                return `Agent ${agentName} launched on ${targetIp}.\nResult: ${JSON.stringify(result).substring(0, 2000)}`;
            } catch (e) {
                return `Agent ${agentName} failed: ${e.message}`;
            }
        }
    },
    supervise_agent: {
        description: 'Reads a live agent\'s last N Redis stream events to understand what it is doing.',
        params: { targetId: 'string — target IP or campaign ID', count: 'number (default 20)' },
        execute: async ({ targetId, count = 20 }) => {
            if (!targetId) return 'Error: targetId is required.';
            const events = await getRecentAgentEvents(targetId, count);
            return events.length > 0
                ? `Last ${events.length} events for target ${targetId}:\n${events.join('\n')}`
                : `No events found for target ${targetId}.`;
        }
    },
    correct_agent: {
        description: 'Injects a corrective instruction into an agent\'s next execution context via Redis.',
        params: { agentName: 'string', targetId: 'string', correction: 'string — the corrective instruction' },
        execute: async ({ agentName, targetId, correction }) => {
            if (!agentName || !correction) return 'Error: agentName and correction are required.';
            try {
                const correctionKey = `wingman:correction:${agentName}:${targetId || 'global'}`;
                if (redisClient.isOpen) {
                    await redisClient.set(correctionKey, JSON.stringify({
                        correction,
                        timestamp: Date.now(),
                        appliedBy: 'THE_WINGMAN'
                    }), { EX: 600 }); 
                }
                return `Correction injected for ${agentName}${targetId ? ` on ${targetId}` : ''}: "${correction}"`;
            } catch (e) {
                return `Failed to inject correction: ${e.message}`;
            }
        }
    },
    update_system_config: {
        description: 'Updates a system configuration key in the database with full audit trail. Replaces the old tuningService.',
        params: { key: 'string', value: 'string', reason: 'string (why this change is being made)' },
        execute: async ({ key, value, reason }) => {
            if (!key || value === undefined) return 'Error: key and value are required.';
            try {
                await prisma.systemConfig.upsert({
                    where: { key },
                    update: { value: String(value) },
                    create: { key, value: String(value) }
                });
                await prisma.auditLog.create({
                    data: {
                        action: `WINGMAN_CONFIG_UPDATE: ${key} = ${value}`,
                        aiReasoning: reason || 'No reason provided',
                        aiVetoTriggered: false
                    }
                });
                return `Configuration updated: ${key} = ${value}. Audit trail recorded.`;
            } catch (e) {
                return `Config update failed: ${e.message}`;
            }
        }
    },
    force_lora_train: {
        description: 'Triggers a LoRA fine-tuning training cycle using the current harvested dataset.',
        params: {},
        execute: async () => {
            try {
                const { dataHarvester, loraManager } = require('./bayezidBrain');
                const stats = dataHarvester.getStats();
                if (stats.totalSamples < 10) return `Insufficient training data. Only ${stats.totalSamples} samples (need ≥10).`;
                loraManager.trainLoRA(stats.datasetPath).catch(e => console.error(`[WINGMAN] LoRA training error: ${e.message}`));
                return `LoRA training cycle triggered with ${stats.totalSamples} samples. Running in background.`;
            } catch (e) {
                return `LoRA training trigger failed: ${e.message}`;
            }
        }
    },
    send_telegram: {
        description: 'Sends a custom message to the operator\'s Telegram.',
        params: { message: 'string — the message to send (HTML supported)' },
        execute: async ({ message }) => {
            if (!message) return 'Error: message is required.';
            try {
                const { sendProactiveAlert } = require('./wingmanTelegram');
                await sendProactiveAlert(message);
                return 'Telegram message sent successfully.';
            } catch (e) {
                try {
                    const token = process.env.TELEGRAM_BOT_TOKEN;
                    const chatId = process.env.TELEGRAM_CHAT_ID;
                    if (token && chatId) {
                        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                            chat_id: chatId, text: message, parse_mode: 'HTML'
                        });
                        return 'Telegram message sent (via fallback).';
                    }
                    return 'Telegram not configured (missing BOT_TOKEN or CHAT_ID).';
                } catch (e2) {
                    return `Telegram send failed: ${e2.message}`;
                }
            }
        }
    },
    query_memory: {
        description: 'Performs semantic search across the FAISS incident memory to find similar past events.',
        params: { query: 'string — natural language search query', targetId: 'string (optional — specific campaign)' },
        execute: async ({ query, targetId }) => {
            if (!query) return 'Error: query is required.';
            const results = await semanticAgentSearch(targetId || 'global', query, 5);
            return results.length > 0
                ? `Found ${results.length} similar entries:\n${results.join('\n---\n')}`
                : 'No similar entries found in semantic memory.';
        }
    },
    explain_code: {
        description: 'Reads a file at given line range and provides a detailed technical explanation.',
        params: { filePath: 'string', startLine: 'number', endLine: 'number' },
        execute: async ({ filePath, startLine, endLine }) => {
            const content = await TOOL_REGISTRY.read_file.execute({ filePath, startLine, endLine });
            if (content.startsWith('Error') || content.startsWith('SECURITY_VETO')) return content;
            return `Code from ${filePath} (lines ${startLine}-${endLine}):\n\n${content}\n\n[The Wingman will now analyze this code in context.]`;
        }
    },
    get_lora_status: {
        description: 'Returns current LoRA training metrics, active adapter, and training history.',
        params: {},
        execute: async () => {
            try {
                const { loraManager, dataHarvester } = require('./bayezidBrain');
                const loraStats = loraManager.getStatus();
                const dataStats = dataHarvester.getStats();
                return JSON.stringify({
                    activeAdapter: loraStats.activeAdapter,
                    baseModel: loraStats.baseModel,
                    totalTrainingRuns: loraStats.totalTrainingRuns,
                    recentHistory: loraStats.trainingHistory,
                    datasetSize: dataStats.totalSamples,
                    dataDistribution: dataStats.sources
                }, null, 2);
            } catch (e) {
                return `LoRA status unavailable: ${e.message}`;
            }
        }
    },
    edit_file_ast: {
        description: 'Applies an AST-safe code edit to a whitelisted project file. Requires confirmation for dangerous edits.',
        params: { filePath: 'string', editDescription: 'string', newCode: 'string' },
        execute: async (params) => {
            try {
                const surgeon = require('./wingmanSurgeon');
                return await surgeon.applyEdit(params);
            } catch (e) {
                return `AST edit failed: ${e.message}`;
            }
        }
    },
    get_evolution_status: {
        description: 'Returns the current evolution phase, readiness metrics, training stats, and what is needed for the next phase transition.',
        params: {},
        execute: async () => {
            try {
                const { getEvolutionState, checkEvolutionReadiness } = require('./wingmanEvolution');
                const state = await getEvolutionState();
                const readiness = await checkEvolutionReadiness();
                let loraRuns = 0, totalSamples = 0, activeAdapter = 'None';
                try {
                    const brain = require('./bayezidBrain');
                    const stats = brain.dataHarvester.getStats();
                    const lora = brain.loraManager.getStatus();
                    loraRuns = lora.totalTrainingRuns;
                    totalSamples = stats.totalSamples;
                    activeAdapter = lora.activeAdapter || 'None (base model)';
                } catch (e) {  }
                const lines = [
                    `📊 Evolution Phase: ${state.phase}`,
                    `🧠 Total training runs: ${loraRuns}`,
                    `📦 Dataset size: ${totalSamples} samples`,
                    `🔧 Active adapter: ${activeAdapter}`,
                    '',
                    readiness.ready
                        ? `✅ Ready to evolve to ${readiness.nextPhase}!${readiness.requiresOperatorApproval ? ' (operator approval required)' : ''}`
                        : `⏳ Not yet ready for next phase.`
                ];
                if (!readiness.ready && readiness.metrics) {
                    const m = readiness.metrics;
                    if (!m.samples.ok) lines.push(`  • Need ${m.samples.required - m.samples.current} more training samples`);
                    if (!m.loraRuns.ok) lines.push(`  • Need ${m.loraRuns.required - m.loraRuns.current} more LoRA training runs`);
                    if (!m.evalLoss.ok) lines.push(`  • Eval loss must reach ≤ ${m.evalLoss.required} (currently ${m.evalLoss.current.toFixed(4)})`);
                }
                if (readiness.reason) lines.push(readiness.reason);
                return lines.join('\n');
            } catch (e) {
                return `Evolution status unavailable: ${e.message}`;
            }
        }
    },
    trigger_evolution: {
        description: 'Triggers an evolution phase transition if readiness criteria are met. Requires confirmed=true for operator-gated phases.',
        params: { confirmed: 'boolean (default false) — set true to bypass operator approval gate' },
        execute: async ({ confirmed = false }) => {
            try {
                const evolution = require('./wingmanEvolution');
                const readiness = await evolution.checkEvolutionReadiness();
                if (!readiness.ready) {
                    const m = readiness.metrics;
                    return `Not ready for evolution.\n` +
                        `• Samples: ${m.samples.current}/${m.samples.required} ${m.samples.ok ? '✅' : '❌'}\n` +
                        `• LoRA runs: ${m.loraRuns.current}/${m.loraRuns.required} ${m.loraRuns.ok ? '✅' : '❌'}\n` +
                        `• Eval loss: ${m.evalLoss.current.toFixed(4)} ≤ ${m.evalLoss.required} ${m.evalLoss.ok ? '✅' : '❌'}`;
                }
                if (readiness.requiresOperatorApproval && !confirmed) {
                    return `Ready to evolve to ${readiness.nextPhase}, but this phase requires explicit operator approval. Reply "confirm evolution" to proceed.`;
                }
                await evolution.executePhaseTransition(readiness.nextPhase, 'wingman_tool_call', null);
                return `🚀 Evolution to ${readiness.nextPhase} executed successfully. I am growing.`;
            } catch (e) {
                return `Evolution trigger failed: ${e.message}`;
            }
        }
    },
    pause_module: {
        description: 'Temporarily pauses an agent module via Redis flag. The agent will return PAUSED status until resumed or TTL expires.',
        params: { moduleName: 'string — agent name (e.g. Scout, Breacher, Alchemist)', durationMinutes: 'number (default 60)' },
        execute: async ({ moduleName, durationMinutes = 60 }) => {
            if (!moduleName) return 'Error: moduleName is required.';
            try {
                if (redisClient.isOpen) {
                    await redisClient.set(`wingman:module:${moduleName}:paused`, 'true', { EX: durationMinutes * 60 });
                    return `Module '${moduleName}' paused for ${durationMinutes} minutes. It will auto-resume after that.`;
                }
                return 'Redis not available. Cannot pause module in degraded mode.';
            } catch (e) {
                return `Pause failed: ${e.message}`;
            }
        }
    },
    resume_module: {
        description: 'Resumes a previously paused agent module by clearing its Redis pause flag.',
        params: { moduleName: 'string — agent name to resume' },
        execute: async ({ moduleName }) => {
            if (!moduleName) return 'Error: moduleName is required.';
            try {
                if (redisClient.isOpen) {
                    await redisClient.del(`wingman:module:${moduleName}:paused`);
                    return `Module '${moduleName}' resumed.`;
                }
                return 'Redis not available.';
            } catch (e) {
                return `Resume failed: ${e.message}`;
            }
        }
    },
    upgrade_subsystem: {
        description: 'Triggers a self-modification command to upgrade a specific subsystem (embedding, mitre, lora, evolution).',
        params: { subsystem: 'string — one of: "migrate embedding", "load full mitre", "register lora", "force evolution"' },
        execute: async ({ subsystem }) => {
            if (!subsystem) return 'Error: subsystem is required. Options: "migrate embedding", "load full mitre", "register lora", "force evolution"';
            try {
                const { handleSelfModificationCommand } = require('./wingmanEvolution');
                const result = await handleSelfModificationCommand(subsystem);
                return result || `Unknown subsystem '${subsystem}'. Available: 'migrate embedding', 'load full mitre', 'register lora', 'force evolution'.`;
            } catch (e) {
                return `Upgrade failed: ${e.message}`;
            }
        }
    },
    get_training_data_quality: {
        description: 'Returns a quality report on the LoRA training dataset including source distribution, sample count, and Red/Blue balance.',
        params: {},
        execute: async () => {
            try {
                const { dataHarvester } = require('./bayezidBrain');
                const stats = dataHarvester.getStats();
                const dist = stats.sources || {};
                const total = stats.totalSamples;
                const lines = [`📦 Total samples: ${total}`, '', '📊 Source distribution:'];
                for (const [source, count] of Object.entries(dist)) {
                    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                    lines.push(`  • ${source}: ${count} (${pct}%)`);
                }
                const redTeam = dist['red_team_operation'] || 0;
                const blue = dist['playbook_execution'] || 0;
                const ratio = blue > 0 ? (redTeam / blue).toFixed(2) : '∞';
                lines.push('', `⚖️ Red/Blue ratio: ${ratio} (ideal is 0.5–2.0)`);
                if (redTeam < 20) lines.push('⚠️ Recommendation: Harvest more Red Team operation samples.');
                else if (blue < 20) lines.push('⚠️ Recommendation: Harvest more Blue Team playbook samples.');
                else lines.push('✅ Dataset distribution looks balanced.');
                return lines.join('\n');
            } catch (e) {
                return `Data quality report unavailable: ${e.message}`;
            }
        }
    },
    nl_threat_hunt: {
        description: 'Translates a natural language query into a database filter to hunt for specific threats (e.g., "find all SSH drops originating from Russia today").',
        params: { threatType: 'string (optional filter, e.g. "ssh", "brute force")', timeRangeHours: 'number (optional, default 24)', limit: 'number (optional, default 10)' },
        execute: async ({ threatType, timeRangeHours = 24, limit = 10 }) => {
            try {
                const where = {};
                if (threatType) {
                    where.eventType = { contains: threatType, mode: 'insensitive' };
                }
                where.createdAt = { gte: new Date(Date.now() - timeRangeHours * 3600000) };
                const alerts = await prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
                if (alerts.length === 0) return `No threats found matching "${threatType || 'ANY'}" in the last ${timeRangeHours}h.`;
                return alerts.map(a => `[${a.severity || 'UNK'}] ${a.eventType} | Source: ${a.sourceIp} | Target: ${a.targetAsset || 'Unknown'} | Status: ${a.status}`).join('\n');
            } catch (e) {
                return `NL Threat Hunt failed: ${e.message}`;
            }
        }
    },
    blast_radius_summary: {
        description: 'Calculates the Blast-Radius of a compromised IP, showing connected assets and lateral movement paths.',
        params: { sourceIp: 'string' },
        execute: async ({ sourceIp }) => {
            if (!sourceIp) return 'Error: sourceIp is required.';
            try {
                const alerts = await prisma.alert.findMany({ where: { sourceIp } });
                const targets = [...new Set(alerts.map(a => a.targetAsset).filter(Boolean))];
                let report = `💥 BLAST RADIUS for ${sourceIp}:\n`;
                report += `- Direct Targets Hit: ${targets.length}\n`;
                if (targets.length > 0) report += `- Potentially Compromised Assets: ${targets.join(', ')}\n`;
                report += `- Total Events Generated: ${alerts.length}\n`;
                const isCritical = targets.length > 2 || alerts.length > 10;
                report += `\nRecommendation: ${isCritical ? `Immediate KernelStriker isolation of ${sourceIp} required. Multi-asset lateral movement suspected.` : `Monitor ${sourceIp} and review target asset logs.`}`;
                return report;
            } catch (e) {
                return `Blast Radius Calculation failed: ${e.message}`;
            }
        }
    },
    draft_dynamic_playbook: {
        description: 'Drafts a temporary mitigation workflow based on the unique context of the attack, pushing it to Telegram for operator 1-click execution.',
        params: { alertId: 'string', proposedSteps: 'string' },
        execute: async ({ alertId, proposedSteps }) => {
            if (!alertId || !proposedSteps) return 'Error: alertId and proposedSteps are required.';
            try {
                const { sendProactiveAlert } = require('./wingmanTelegram');
                const message = `⚡ <b>DYNAMIC PLAYBOOK DRAFTED</b>\n\nAlert ID: <code>${alertId}</code>\n\n<b>Proposed Actions:</b>\n${proposedSteps}\n\nExecute this custom workflow?`;
                const keyboard = [
                    [{ text: '🚀 EXECUTE DYNAMIC PLAYBOOK', callback_data: `wingman_playbook_${alertId}` }],
                    [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
                ];
                await sendProactiveAlert(message, keyboard);
                return `Dynamic playbook drafted and pushed to Telegram for approval.`;
            } catch (e) {
                return `Dynamic Playbook Drafting failed: ${e.message}`;
            }
        }
    },
    predict_threat_forecast: {
        description: 'Predicts the attacker\'s next move based on heuristic analysis of the current kill chain phase for a target IP.',
        params: { targetIp: 'string' },
        execute: async ({ targetIp }) => {
            if (!targetIp) return 'Error: targetIp is required.';
            try {
                const alerts = await prisma.alert.findMany({ where: { sourceIp: targetIp }, orderBy: { createdAt: 'desc' }, take: 5 });
                if (alerts.length === 0) return `No recent activity found for ${targetIp} to forecast.`;
                const types = alerts.map(a => (a.eventType || '').toLowerCase());
                let forecast = `🔮 PREDICTIVE FORECAST for ${targetIp}:\n`;
                if (types.some(t => t.includes('recon') || t.includes('scan'))) {
                    forecast += 'Current Phase: Reconnaissance\nNext Likely Move: Exploitation (Initial Access) targeting exposed services. Probability: 85%.';
                } else if (types.some(t => t.includes('brute') || t.includes('auth'))) {
                    forecast += 'Current Phase: Initial Access\nNext Likely Move: Privilege Escalation and Persistence via scheduled tasks or rootkits. Probability: 92%.';
                } else if (types.some(t => t.includes('exec') || t.includes('rce'))) {
                    forecast += 'Current Phase: Execution\nNext Likely Move: Lateral Movement across internal subnets. Probability: 95%. Recommend immediate KernelStriker isolation.';
                } else {
                    forecast += 'Current Phase: Unknown/Anomalous\nNext Likely Move: Data Exfiltration or Ransomware deployment. Probability: 70%.';
                }
                return forecast;
            } catch (e) {
                return `Threat Forecasting failed: ${e.message}`;
            }
        }
    }
};
const callLLM = async (messages, streamCallback, isSandbox = false) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const tryGemini = async () => {
        const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ];
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', safetySettings });
        const formatted = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(m.content || '') }]
        }));
        const delays = [4000, 8000, 12000];
        let attempt = 0;
        while (true) {
            try {
                const result = await model.generateContent({ contents: formatted });
                return result.response.text();
            } catch (error) {
                if (attempt < delays.length) {
                    if (streamCallback) streamCallback(`\n[WINGMAN] Gemini rate limit hit. Retrying in ${delays[attempt]/1000}s...`);
                    await sleep(delays[attempt]);
                    attempt++;
                } else {
                    throw error;
                }
            }
        }
    };
    const tryGroq = async () => {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) throw new Error("GROQ_API_KEY not configured.");
        const endpoint = 'groq_api';
        if (circuitBreaker.isOpen(endpoint)) {
            throw new Error(`[⚡] Circuit open for ${endpoint}. Skipping Groq.`);
        }
        const groqMessages = messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
            content: String(m.content || '')
        }));
        try {
            const response = await withTimeout(
                axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama-3.3-70b-versatile',
                    messages: groqMessages,
                    temperature: 0.3
                }, {
                    headers: { 'Authorization': `Bearer ${groqKey}` }
                }),
                15000,
                'Groq API'
            );
            circuitBreaker.recordSuccess(endpoint);
            return response.data.choices[0].message.content;
        } catch (error) {
            circuitBreaker.recordFailure(endpoint);
            throw error;
        }
    };
    const tryLocal = async () => {
        const sanitizedOllamaMessages = messages.map(m => ({
            role: m.role,
            content: String(m.content || '')
        }));
        const primaryEndpoint = 'ollama_local';
        const fallbackEndpoint = 'ollama_local_fallback';

        if (!circuitBreaker.isOpen(primaryEndpoint)) {
            try {
                const response = await withTimeout(
                    axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
                        model: LOCAL_MODEL_NAME,
                        messages: sanitizedOllamaMessages,
                        stream: false,
                        options: { temperature: 0.3, num_predict: 2048 }
                    }),
                    20000,
                    'Local AI Primary'
                );
                circuitBreaker.recordSuccess(primaryEndpoint);
                return response.data.message?.content || '';
            } catch (localPrimaryErr) {
                console.log(`[⚠️] Wingman Primary Local AI Failed (${localPrimaryErr.message}). Recording failure and trying Lightweight Fallback...`);
                circuitBreaker.recordFailure(primaryEndpoint);
            }
        } else {
            console.log(`[⚡] Circuit OPEN for Local AI Primary. Skipping directly to lightweight fallback.`);
        }

        if (circuitBreaker.isOpen(fallbackEndpoint)) {
            throw new Error(`[⚡] Circuit open for ${fallbackEndpoint}. Skipping fallback.`);
        }

        try {
            const fallbackResponse = await withTimeout(
                axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
                    model: 'qwen3.5:4b',
                    messages: sanitizedOllamaMessages,
                    stream: false,
                    options: { temperature: 0.3, num_predict: 2048 }
                }),
                15000,
                'Local AI Fallback'
            );
            circuitBreaker.recordSuccess(fallbackEndpoint);
            return fallbackResponse.data.message?.content || '';
        } catch (localFallbackErr) {
            console.log(`[⚠️] Wingman qwen3.5:4b Fallback Failed. Trying qwen3.5:4b Fallback...`);
            try {
                const fallbackResponse2 = await withTimeout(
                    axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
                        model: 'qwen3.5:4b',
                        messages: sanitizedOllamaMessages,
                        stream: false,
                        options: { temperature: 0.3, num_predict: 2048 }
                    }),
                    15000,
                    'Local AI Third Fallback'
                );
                circuitBreaker.recordSuccess(fallbackEndpoint);
                return fallbackResponse2.data.message?.content || '';
            } catch (localThirdFallbackErr) {
                circuitBreaker.recordFailure(fallbackEndpoint);
                throw localThirdFallbackErr;
            }
        }
    };
    const tryHeuristicFallback = async () => {
        if (isSandbox) {
            return `💀 WINGMAN COGNITIVE BRAINDEAD: All my cognitive engines (Gemini, Groq, and Local Qwen) are completely offline or unreachable. And since we are in SANDBOX mode, I'm not going to look up or show you any real system status, alerts, or run any tools for you. Go fix your connection first, you helpless human.`;
        }
        const lastUserMessage = messages.slice().reverse().find(m => m.role === 'user')?.content || "";
        const lowerText = lastUserMessage.toLowerCase();
        let responseText = "💀 The cloud is burning and the local AI is a potato right now. I'm operating on pure heuristic instinct. ";
        if (lowerText.includes('status')) {
            const status = await TOOL_REGISTRY['get_system_status'].execute({ detail: 'summary' });
            responseText += `Here is your system status since you can't check it yourself:\n\n${status}`;
        } else if (lowerText.includes('alert')) {
            const alerts = await TOOL_REGISTRY['list_active_alerts'].execute({ limit: 5 });
            responseText += `Here are the latest alerts. Try not to panic:\n\n${alerts}`;
        } else if (lowerText.includes('help')) {
            responseText += `I can only give you 'status' or 'alerts' until the neural link is restored. Deal with it.`;
        } else {
            responseText += `I can't parse your garbage input without my neural network. Ask for 'status' or 'alerts' if you want something useful.`;
        }
        return responseText;
    };
    try {
        const content = await tryGemini();
        if (streamCallback) streamCallback(content);
        return content;
    } catch (geminiError) {
        if (streamCallback) streamCallback(`\n[WINGMAN] Gemini exhausted all retries. Falling back to Groq...`);
        try {
            const content = await tryGroq();
            if (streamCallback) streamCallback(content);
            return content;
        } catch (groqError) {
            if (streamCallback) streamCallback(`\n[WINGMAN] Groq failed. Falling back to Local AI...`);
            try {
                const content = await tryLocal();
                if (streamCallback) streamCallback(content);
                return content;
            } catch (localError) {
                console.error(`[WINGMAN] FATAL AI CASCADE FAILURE:`);
                console.error(`  - Gemini Error: ${geminiError.message}`);
                console.error(`  - Groq Error: ${groqError.message}`);
                console.error(`  - Local AI Error: ${localError.message}`);
                if (streamCallback) streamCallback(`\n[WINGMAN] Local AI failed. Activating Heuristic Instincts...`);
                try {
                    const fallbackContent = await tryHeuristicFallback();
                    if (streamCallback) streamCallback(fallbackContent);
                    return fallbackContent;
                } catch (e) {
                    const fallback = isSandbox
                        ? `💀 WINGMAN COGNITIVE BRAINDEAD: All my cognitive engines (Gemini, Groq, and Local Qwen) are completely offline or unreachable. And since we are in SANDBOX mode, I won't even think about looking up real alerts or SOC data. Sort out your network, you helpless human.`
                        : `💀 WINGMAN COGNITIVE BRAINDEAD: All my cognitive engines (Gemini, Groq, and Local Qwen) are completely offline or unreachable. Even a genius AI cannot read your mind without a connection. Check your network or docker services before trying to wake me up again.`;
                    if (streamCallback) streamCallback(fallback);
                    return fallback;
                }
            }
        }
    }
};
const parseToolCall = (text) => {
    const match = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
    if (!match) return null;
    let jsonStr = match[1].replace(/```json/gi, '').replace(/```/gi, '').trim();
    try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool && TOOL_REGISTRY[parsed.tool]) {
            return { tool: parsed.tool, params: parsed.params || {} };
        }
        return null;
    } catch (e) {
        let openBraces = (jsonStr.match(/\{/g) || []).length;
        let closeBraces = (jsonStr.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
            jsonStr += '}'.repeat(openBraces - closeBraces);
            try {
                const repaired = JSON.parse(jsonStr);
                if (repaired.tool && TOOL_REGISTRY[repaired.tool]) {
                    return { tool: repaired.tool, params: repaired.params || {} };
                }
            } catch (repairErr) {
                console.error(`[WINGMAN] Tool parsing failed for payload (Even after repair): ${jsonStr}`);
                return null;
            }
        } else {
            console.error(`[WINGMAN] Tool parsing failed for payload: ${jsonStr}`);
        }
        return null;
    }
};
const extractThinking = (text) => {
    const match = text.match(/<think>([\s\S]*?)<\/think>/);
    return match ? match[1].trim() : null;
};
const cleanResponse = (text) => {
    return text
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .trim();
};
const buildToolList = () => {
    return Object.entries(TOOL_REGISTRY).map(([name, tool]) => {
        const paramStr = tool.params
            ? Object.entries(tool.params).map(([k, v]) => `  - ${k}: ${v}`).join('\n')
            : '  (no parameters)';
        return `• ${name}: ${tool.description}\n  Parameters:\n${paramStr}`;
    }).join('\n\n');
};
const MAX_TOOL_ITERATIONS = 5;
const processMessage = async (userMessage, sessionId = require('crypto').randomUUID(), streamCallback, userId = 'operator', executionMode = 'SOC_TACTICAL') => {
    let session = await getSession(sessionId);
    let messages = session?.messages || [];
    
    // Core Dual-Gateway Sandbox logic
    const isSandbox = executionMode === 'SANDBOX';
    let systemPrompt = SANDBOX_SYSTEM_PROMPT;
    if (isSandbox) {
        let nickname = `Guest_${userId}`;
        let persona = 'Cybersecurity Consultant';
        try {
            const prefsPath = path.join(__dirname, '../memory_systems/guests', String(userId), 'preferences.json');
            if (fs.existsSync(prefsPath)) {
                const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
                nickname = prefs.nickname || nickname;
                persona = prefs.persona || persona;
            }
        } catch (e) {
            // ignore
        }
        systemPrompt = SANDBOX_SYSTEM_PROMPT + `\n\nADDITIONAL USER CONTEXT:\n- The user's nickname is: ${nickname}\n- Your roleplay persona is: ${persona}. Adhere to this roleplay persona and nickname throughout the conversation while maintaining your sarcastic, edgy tone.`;
    } else {
        systemPrompt = WINGMAN_SYSTEM_PROMPT.replace('[TOOL_LIST]', buildToolList());
    }
        
    messages.push({ role: 'user', content: userMessage, timestamp: new Date().toISOString() });
    const contextMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-20)
    ];
    let finalResponse = '';
    let toolCallLog = [];
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const llmOutput = await callLLM(contextMessages, null, isSandbox);
        if (isSandbox) {
            finalResponse = cleanResponse(llmOutput);
            if (streamCallback) streamCallback(finalResponse);
            break;
        }
        const toolCall = parseToolCall(llmOutput);
        if (!toolCall) {
            finalResponse = cleanResponse(llmOutput);
            if (streamCallback) streamCallback(finalResponse);
            break;
        }
        const thinking = extractThinking(llmOutput);
        if (streamCallback) {
            streamCallback(`⚙️ Executing: ${toolCall.tool}...\n`);
        }
        let toolResult;
        try {
            toolResult = await TOOL_REGISTRY[toolCall.tool].execute(toolCall.params);
        } catch (err) {
            console.error(`[WINGMAN] Tool Execution Error (${toolCall.tool}):`, err.message);
            toolResult = `ERROR: Tool execution failed with message: ${err.message}`;
        }
        toolCallLog.push({
            tool: toolCall.tool,
            params: toolCall.params,
            thinking,
            result: (toolResult || '').substring(0, 3000),
            timestamp: new Date().toISOString()
        });
        contextMessages.push({
            role: 'assistant',
            content: llmOutput
        });
        contextMessages.push({
            role: 'user',
            content: `[SYSTEM NOTIFICATION] TOOL_OBSERVATION:\n${toolResult}`
        });
    }
    if (!finalResponse) {
        finalResponse = 'I completed multiple tool operations. Here\'s a summary of what I found — please ask a follow-up if you need more detail.';
        if (streamCallback) streamCallback(finalResponse);
    }
    messages.push({
        role: 'assistant',
        content: finalResponse,
        toolCalls: toolCallLog,
        timestamp: new Date().toISOString()
    });
    await saveSession(sessionId, userId, messages);
    await publishLiveEvent('bayezid_system_health', 'WINGMAN_INTERACTION', {
        sessionId,
        userMessage: userMessage.substring(0, 200),
        toolsUsed: toolCallLog.map(t => t.tool),
        responseLength: finalResponse.length
    });
    return { finalResponse, toolCalls: toolCallLog, sessionId };
};
const getToolList = () => {
    return Object.entries(TOOL_REGISTRY).map(([name, tool]) => ({
        name,
        description: tool.description,
        params: tool.params
    }));
};

const askWingman = async (alertContext) => {
    const alertStr = typeof alertContext === 'string' ? alertContext : JSON.stringify(alertContext);
    const systemPrompt = `You are 'The Wingman', an elite cyber warfare mastermind for the Bayezid Hybrid SOC.
You must analyze the following security alert and provide a recommended defensive action.
Respond ONLY with a valid JSON object matching this exact format:
{
    "recommended_action": "ISOLATE_NODE, DECEPTIVE_PROBE, ACTIVE_NEUTRALIZATION, ESCALATE_RESPONSE, OBSERVE, or PROACTIVE_HUNT",
    "confidence": 0.95,
    "reasoning": "Brief explanation"
}`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: alertStr }
    ];
    try {
        const response = await callLLM(messages);
        let parsed;
        try {
            const cleaned = response.replace(/```[a-zA-Z0-9]*\n?/g, '').replace(/```/g, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (err) {
            const match = response.match(/"recommended_action"\s*:\s*"([^"]+)"/);
            const action = match ? match[1] : 'OBSERVE';
            parsed = {
                recommended_action: action,
                confidence: 0.8,
                reasoning: response
            };
        }
        return parsed;
    } catch (e) {
        console.error(`[⚠️ askWingman] Failed to get response from Wingman:`, e.message);
        return {
            recommended_action: 'OBSERVE',
            confidence: 0.5,
            reasoning: 'Graceful fallback: ' + e.message
        };
    }
};

module.exports = { processMessage, getToolList, TOOL_REGISTRY, callLLM, sessionCache, askWingman };
