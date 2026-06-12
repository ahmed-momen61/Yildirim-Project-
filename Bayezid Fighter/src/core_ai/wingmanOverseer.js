const { redisClient, getRecentAgentEvents, publishLiveEvent } = require('../memory_systems/memoryService');
const { callLLM } = require('./wingmanService');
const { processTuningCommand } = require('./tuningService');
const agentHealthMap = new Map();
const KNOWN_AGENTS = [
    'Scout', 'Breacher', 'Phantom', 'Chameleon', 'Overlord',
    'Scribe', 'Action', 'StealthScribe', 'Veto', 'ShadowRouter',
    'ForensicRCA', 'Alchemist', 'Mirage', 'Warden', 'ZeroDayForge'
];
const STALL_THRESHOLD_MS = 5 * 60 * 1000;   
const FAILURE_THRESHOLD = 2;                  
const SUPERVISION_INTERVAL_MS = 30 * 1000;    
const initAgentHealth = (name) => ({
    name,
    lastEventTime: null,
    consecutiveFailures: 0,
    currentTarget: null,
    interventionCount: 0,
    status: 'IDLE',             
    lastError: null,
    lastCorrection: null
});
const CORRECTION_STRATEGIES = {
    Scout: {
        emptyResults: 'Retry with alternative scan flags: -sV -sU --top-ports 1000 -T4 -A. Consider the target may be using non-standard ports.',
        timeout: 'The scan timed out. Reduce scope — try specific port ranges (80,443,8080,8443) instead of full scan.',
        parseError: 'The scan output could not be parsed. Ensure nmap is installed and the target is reachable.'
    },
    Breacher: {
        parseError: 'The scan output from Scout was malformed. Reformat it as: IP:PORT SERVICE VERSION before retrying.',
        noExploits: 'No exploits found for the target services. Try manual CVE lookup or switch to credential-based attacks.',
        executionFailed: 'The exploit failed to execute. Check if the target firewall is blocking. Try obfuscated payload.'
    },
    Phantom: {
        privescFailed: 'All privilege escalation attempts failed. Switch to alternative PE vectors: kernel exploits, SUID binaries, or cron job injection.',
        adversarialMLFailed: 'The adversarial ML evasion failed. Increase epsilon or switch to C&W attack method.',
        repeatedFailure: 'Phantom has failed 3+ times on this target. Consider this target as hardened and move to the next.'
    },
    Chameleon: {
        samePayload: 'You are generating the same WAF bypass payload repeatedly. Force mutation diversity: try a completely different encoding (base64, hex, unicode, double-URL-encode).',
        wafDetected: 'The WAF has fingerprinted your payload pattern. Switch to a different evasion technique entirely.',
        repeatedBlock: 'Payload blocked 3+ times. Chameleon needs to analyze the WAF signature and craft a custom bypass.'
    },
    Overlord: {
        wrongTarget: 'The strategy was generated for the wrong IP. Re-inject the correct target context.',
        incompleteStrategy: 'The campaign strategy is incomplete. Ensure all phases (recon, initial access, persistence, exfil) are covered.'
    },
    Alchemist: {
        compilationFailed: 'The generated exploit code has compilation errors. Feed the error message back and ask for a corrected version.',
        invalidPayload: 'The fuzzing payload is not valid for the target protocol. Verify the target service type first.'
    },
    ZeroDayForge: {
        invalidCode: 'The synthesized exploit code has errors. Feed the compilation/runtime error back as a correction prompt.',
        noVulnFound: 'No zero-day vulnerability was found. Expand the attack surface — try adjacent services or different protocol versions.'
    },
    Warden: {
        sandboxCrash: 'The sandbox crashed. Restart with lower resource limits (256MB RAM, 1 CPU) and retry.',
        k8sError: 'Kubernetes sandbox creation failed. Check cluster connectivity and namespace permissions.'
    }
};
const analyzeFailurePattern = (events) => {
    if (!events || events.length === 0) return null;
    let consecutiveFailures = 0;
    let lastError = null;
    let repeatedPattern = false;
    const recentErrors = [];
    for (const event of events) {
        if (event.includes('❌')) {
            consecutiveFailures++;
            const errorMatch = event.match(/Output: (.+)/);
            if (errorMatch) {
                recentErrors.push(errorMatch[1]);
            }
            lastError = event;
        } else if (event.includes('✅')) {
            break; 
        }
    }
    if (recentErrors.length >= 2) {
        const unique = new Set(recentErrors.map(e => e.substring(0, 50)));
        repeatedPattern = unique.size === 1;
    }
    return {
        consecutiveFailures,
        lastError,
        repeatedPattern,
        errorSummary: recentErrors.slice(0, 3).join(' | ')
    };
};
const getCorrectionForAgent = (agentName, failureAnalysis) => {
    const strategies = CORRECTION_STRATEGIES[agentName];
    if (!strategies) return null;
    const errorText = (failureAnalysis.lastError || '').toLowerCase();
    if (errorText.includes('empty') || errorText.includes('no results')) {
        return strategies.emptyResults || strategies.noExploits;
    }
    if (errorText.includes('timeout') || errorText.includes('timed out')) {
        return strategies.timeout;
    }
    if (errorText.includes('parse') || errorText.includes('format')) {
        return strategies.parseError;
    }
    if (errorText.includes('same') || failureAnalysis.repeatedPattern) {
        return strategies.samePayload || strategies.repeatedFailure;
    }
    if (errorText.includes('failed') || errorText.includes('error')) {
        return strategies.executionFailed || strategies.compilationFailed || strategies.invalidCode;
    }
    if (errorText.includes('sandbox') || errorText.includes('crash')) {
        return strategies.sandboxCrash;
    }
    return null;
};
const injectCorrection = async (agentName, targetId, correction) => {
    try {
        const correctionKey = `wingman:correction:${agentName}:${targetId || 'global'}`;
        if (redisClient.isOpen) {
            await redisClient.set(correctionKey, JSON.stringify({
                correction,
                timestamp: Date.now(),
                appliedBy: 'WINGMAN_OVERSEER'
            }), { EX: 600 }); 
            await publishLiveEvent('bayezid_system_health', 'AGENT_CORRECTION', {
                agent: agentName,
                target: targetId,
                correction: correction.substring(0, 200)
            });
        }
        return true;
    } catch (e) {
        console.error(`[🔧] Overseer: Failed to inject correction for ${agentName}: ${e.message}`);
        return false;
    }
};
const generateLLMCorrection = async (agentName, events, failureAnalysis) => {
    try {
        const prompt = [
            { role: 'system', content: 'You are the Wingman Overseer. A SOC agent has failed. Provide a concise, actionable correction in 1-2 sentences.' },
            { role: 'user', content: `Agent ${agentName} has failed ${failureAnalysis.consecutiveFailures} consecutive times.\n\nRecent events:\n${events.slice(0, 5).join('\n')}\n\nError summary: ${failureAnalysis.errorSummary}\n\nProvide a specific correction instruction.` }
        ];
        const correction = await callLLM(prompt, null);
        return correction.trim().substring(0, 500);
    } catch (e) {
        return `Retry with default parameters. Previous error: ${failureAnalysis.errorSummary?.substring(0, 100)}`;
    }
};
const supervisionTick = async () => {
    if (!redisClient.isOpen) return;
    try {
        const keys = [];
        let cursor = '0';
        do {
            const result = await redisClient.scan(cursor, { MATCH: 'redswarm:*:events', COUNT: 100 });
            cursor = result.cursor.toString();
            keys.push(...result.keys);
        } while (cursor !== '0');
        for (const key of keys) {
            const targetId = key.replace('redswarm:', '').replace(':events', '');
            const events = await getRecentAgentEvents(targetId, 10);
            if (events.length === 0) continue;
            const lastEvent = events[0];
            const agentMatch = lastEvent.match(/\[(\w+)/);
            if (!agentMatch) continue;
            const agentName = agentMatch[1];
            if (!agentHealthMap.has(agentName)) {
                agentHealthMap.set(agentName, initAgentHealth(agentName));
            }
            const health = agentHealthMap.get(agentName);
            const failureAnalysis = analyzeFailurePattern(events);
            if (!failureAnalysis) {
                health.status = 'IDLE';
                continue;
            }
            health.currentTarget = targetId;
            health.lastEventTime = Date.now();
            if (failureAnalysis.consecutiveFailures >= FAILURE_THRESHOLD) {
                health.status = 'FAILED';
                health.consecutiveFailures = failureAnalysis.consecutiveFailures;
                health.lastError = failureAnalysis.lastError;
                let correction = getCorrectionForAgent(agentName, failureAnalysis);
                if (!correction) {
                    correction = await generateLLMCorrection(agentName, events, failureAnalysis);
                }
                if (correction) {
                    const injected = await injectCorrection(agentName, targetId, correction);
                    if (injected) {
                        health.status = 'CORRECTED';
                        health.lastCorrection = correction;
                        health.interventionCount++;
                        console.log(`[🔧] Overseer: Corrected ${agentName} on ${targetId}: ${correction.substring(0, 80)}`);
                        console.log(`[🧠] Overseer: Triggering Mini-Evolution for ${agentName} due to win-rate drop...`);
                        const syntheticTuningData = `{"instruction": "Patch intelligence gap for ${agentName}", "input": "Error: ${health.lastError}", "output": "Correction: ${correction}"}`;
                        await processTuningCommand(`tune --target ${agentName} --quick`, null, null).catch(e => console.error(`[⚠️] Mini-Evolution failed: ${e.message}`));
                    }
                }
            } else if (failureAnalysis.consecutiveFailures === 0) {
                health.status = 'RUNNING';
                health.consecutiveFailures = 0;
            }
        }
        for (const [name, health] of agentHealthMap) {
            if (health.status === 'RUNNING' && health.lastEventTime) {
                const elapsed = Date.now() - health.lastEventTime;
                if (elapsed > STALL_THRESHOLD_MS) {
                    health.status = 'STALLED';
                    console.log(`[⚠️] Overseer: ${name} appears STALLED (no events for ${Math.round(elapsed / 1000)}s)`);
                    await publishLiveEvent('bayezid_system_health', 'AGENT_STALLED', {
                        agent: name,
                        target: health.currentTarget,
                        silentSeconds: Math.round(elapsed / 1000)
                    });
                }
            }
        }
        if (global.io) {
            const healthSnapshot = {};
            for (const [name, health] of agentHealthMap) {
                healthSnapshot[name] = {
                    status: health.status,
                    consecutiveFailures: health.consecutiveFailures,
                    interventionCount: health.interventionCount,
                    currentTarget: health.currentTarget,
                    lastCorrection: health.lastCorrection?.substring(0, 100)
                };
            }
            global.io.of('/wingman').emit('agent_health_update', healthSnapshot);
        }
    } catch (e) {
        if (e.code !== 'ECONNREFUSED') {
            console.error('[🔧] Overseer tick error:', e.message);
        }
    }
};
let supervisionInterval = null;
let zmqSubscriber = null;

const startSupervision = () => {
    for (const agent of KNOWN_AGENTS) {
        agentHealthMap.set(agent, initAgentHealth(agent));
    }
    supervisionInterval = setInterval(supervisionTick, SUPERVISION_INTERVAL_MS);
    console.log(`[🔧] Wingman Overseer: Agent supervision active (tick every ${SUPERVISION_INTERVAL_MS / 1000}s).`);
    
    
    const zmq = require('zeromq');
    zmqSubscriber = new zmq.Subscriber();
    zmqSubscriber.connect('tcp://127.0.0.1:5555');
    zmqSubscriber.subscribe('GNN_PREDICTION');
    
    console.log(`[👁️] Wingman Overlord: Bound to ZeroMQ spine. Listening for lateral movement telemetry...`);
    
    (async () => {
        for await (const [topic, msg] of zmqSubscriber) {
            try {
                const payload = JSON.parse(msg.toString());
                if (payload.probability > 0.90) {
                    console.log(`\n[🚨] WINGMAN OVERLORD: CRITICAL LATERAL MOVEMENT PREDICTED (>90%)`);
                    console.log(`[🚨] Target: ${payload.targetIp}`);
                    console.log(`[🚨] Initiating Autonomous Incident Response...`);
                    
                    
                    const zmqPublisher = new zmq.Publisher();
                    await zmqPublisher.bind('tcp://127.0.0.1:5556'); 
                    
                    const blockPayload = { ip: payload.targetIp, source: "WINGMAN_OVERLORD" };
                    await zmqPublisher.send(['BLOCK_IP', JSON.stringify(blockPayload)]);
                    
                    console.log(`[🛑] WINGMAN OVERLORD: Broadcasted BLOCK_IP command to Native Swarm for ${payload.targetIp}`);
                    
                    
                    await publishLiveEvent('bayezid_tactical_feed', 'AUTONOMOUS_ISOLATION', {
                        target: payload.targetIp,
                        probability: payload.probability,
                        action: "NATIVE_WFP_XDP_BLOCK"
                    });
                    
                    zmqPublisher.close();
                }
            } catch (e) {
                console.error(`[⚠️] Wingman Overlord: Failed to process ZMQ message: ${e.message}`);
            }
        }
    })();
};

const stopSupervision = () => {
    if (supervisionInterval) {
        clearInterval(supervisionInterval);
        supervisionInterval = null;
    }
    if (zmqSubscriber) {
        zmqSubscriber.close();
    }
};

const getAgentHealthMap = () => {
    const result = {};
    for (const [name, health] of agentHealthMap) {
        result[name] = { ...health };
    }
    return result;
};

module.exports = {
    startSupervision,
    stopSupervision,
    supervisionTick,
    getAgentHealthMap,
    injectCorrection,
    agentHealthMap,
    KNOWN_AGENTS
};
