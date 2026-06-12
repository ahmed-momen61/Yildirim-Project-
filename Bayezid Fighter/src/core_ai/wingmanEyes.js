const prisma = require('../api/prismaClient');
const axios = require('axios');
const { redisClient, getRecentAgentEvents } = require('../memory_systems/memoryService');
const ML_ENGINE_URL = process.env.ML_ENGINE_URL || 'http://localhost:8000';
const liveSystemState = {
    snapshot_time: null,
    system_health: {
        backend: 'ONLINE',
        redis: 'UNKNOWN',
        database: 'UNKNOWN',
        ml_engine: 'UNKNOWN',
        ebpf_striker: 'UNKNOWN'
    },
    alerts: {
        total_open: 0,
        critical: 0,
        high: 0,
        pending_review: 0,
        patch_failed: 0
    },
    active_agents: [],
    active_operations: [],
    recent_events: [],
    lora_training: {
        status: 'IDLE',
        lastRun: null,
        datasetSize: 0
    },
    kinetic_blocks: {
        last_hour: 0,
        top_blocked_ip: null
    }
};
const translateEvent = (channel, event) => {
    const translators = {
        'NEW_THREAT_EMBEDDED': (d) => `🔴 New threat alert #${d.alertId} has been ingested and embedded into semantic memory.`,
        'KINETIC_BLOCK': (d) => `🛡️ KernelStriker blocked ${d.ip} via eBPF/Firewall (reason: ${d.reason || 'automated'}).`,
        'PLAYBOOK_EXECUTED': (d) => `✅ Playbook executed for alert #${d.alertId} — action: ${d.action || 'remediation'}.`,
        'LORA_TRAINING_STARTED': (d) => `🧠 LoRA self-improvement training cycle started with ${d.samples || '?'} samples.`,
        'LORA_TRAINING_COMPLETE': (d) => `🧠 LoRA training complete — eval_loss: ${d.eval_loss || 'N/A'}.`,
        'AGENT_FAILED': (d) => `⚠️ Agent ${d.agent || 'Unknown'} failed task on target ${d.target || 'N/A'}: ${d.error || 'unknown error'}`,
        'RED_TEAM_BYPASS': (d) => `❌ CRITICAL: Red Team bypassed the Blue patch for ${d.threatType || 'unknown threat'}! Escalating...`,
        'PATCH_VERIFIED': (d) => `✅ Patch verified as bulletproof for ${d.threatType || 'threat'}. Immunity signature broadcast to Swarm.`,
        'WINGMAN_INTERACTION': (d) => `🦾 Wingman processed request (tools: ${(d.toolsUsed || []).join(', ') || 'none'}).`,
        'AGENT_CORRECTION': (d) => `🔧 Wingman injected correction for ${d.agent}: "${(d.correction || '').substring(0, 100)}"`
    };
    const fn = translators[event.type];
    const translated = fn ? fn(event.data || {}) : `[${channel}] ${event.type}: ${JSON.stringify(event.data || {}).substring(0, 200)}`;
    return { text: translated, timestamp: event.timestamp || Date.now(), type: event.type };
};
let eyesSubscriber = null;
const CHANNELS = [
    'bayezid_tactical_feed',
    'bayezid_redswarm_events',
    'bayezid_blue_events',
    'bayezid_system_health'
];
const startRedisSubscriber = async () => {
    if (!redisClient.isOpen) {
        console.log('[👁️] Wingman Eyes: Redis not available, running in degraded mode.');
        liveSystemState.system_health.redis = 'OFFLINE';
        return;
    }
    try {
        eyesSubscriber = redisClient.duplicate();
        eyesSubscriber.on('error', (err) => {
            console.error('[-] Redis Eyes Subscriber Error:', err.message);
        });
        await eyesSubscriber.connect();
        for (const channel of CHANNELS) {
            await eyesSubscriber.subscribe(channel, (message) => {
                try {
                    const event = JSON.parse(message);
                    const translated = translateEvent(channel, event);
                    liveSystemState.recent_events.unshift(translated);
                    if (liveSystemState.recent_events.length > 50) {
                        liveSystemState.recent_events = liveSystemState.recent_events.slice(0, 50);
                    }
                    if (event.type === 'KINETIC_BLOCK') {
                        liveSystemState.kinetic_blocks.last_hour++;
                        liveSystemState.kinetic_blocks.top_blocked_ip = event.data?.ip;
                    }
                    if (event.type === 'LORA_TRAINING_STARTED') {
                        liveSystemState.lora_training.status = 'TRAINING';
                    }
                    if (event.type === 'LORA_TRAINING_COMPLETE') {
                        liveSystemState.lora_training.status = 'IDLE';
                        liveSystemState.lora_training.lastRun = new Date().toISOString();
                    }
                } catch (e) {  }
            });
        }
        liveSystemState.system_health.redis = 'ONLINE';
        console.log(`[👁️] Wingman Eyes: Subscribed to ${CHANNELS.length} Redis channels.`);
    } catch (e) {
        liveSystemState.system_health.redis = 'OFFLINE';
        console.log(`[👁️] Wingman Eyes: Redis subscription failed: ${e.message}`);
    }
};
let pollInterval = null;
const pollSystemHealth = async () => {
    liveSystemState.snapshot_time = new Date().toISOString();
    liveSystemState.system_health.backend = 'ONLINE';
    try {
        const alertCounts = await prisma.alert.groupBy({
            by: ['status'],
            _count: true
        });
        const severityCounts = await prisma.alert.groupBy({
            by: ['severity'],
            where: { status: { not: 'RESOLVED' } },
            _count: true
        });
        liveSystemState.alerts.total_open = alertCounts
            .filter(a => a.status !== 'RESOLVED')
            .reduce((sum, a) => sum + a._count, 0);
        liveSystemState.alerts.critical = severityCounts
            .find(s => s.severity === 'CRITICAL')?._count || 0;
        liveSystemState.alerts.high = severityCounts
            .find(s => s.severity === 'HIGH')?._count || 0;
        liveSystemState.alerts.pending_review = alertCounts
            .find(a => a.status === 'PENDING_REVIEW')?._count || 0;
        liveSystemState.alerts.patch_failed = alertCounts
            .find(a => a.status === 'PATCH_FAILED')?._count || 0;
        liveSystemState.system_health.database = 'ONLINE';
    } catch (e) {
        liveSystemState.system_health.database = 'DEGRADED';
    }
    try {
        const mlResp = await axios.get(`${ML_ENGINE_URL}/health`, { timeout: 3000 });
        liveSystemState.system_health.ml_engine = mlResp.status === 200 ? 'ONLINE' : 'DEGRADED';
    } catch (e) {
        liveSystemState.system_health.ml_engine = 'OFFLINE';
    }
    try {
        if (redisClient.isOpen) {
            await redisClient.ping();
            liveSystemState.system_health.redis = 'ONLINE';
        } else {
            liveSystemState.system_health.redis = 'OFFLINE';
        }
    } catch (e) {
        liveSystemState.system_health.redis = 'DEGRADED';
    }
    try {
        const { dataHarvester } = require('./bayezidBrain');
        const stats = dataHarvester.getStats();
        liveSystemState.lora_training.datasetSize = stats.totalSamples;
    } catch (e) {  }
    const now = new Date();
    if (now.getMinutes() === 0 && now.getSeconds() < 15) {
        liveSystemState.kinetic_blocks.last_hour = 0;
    }
    try {
        if (redisClient.isOpen) {
            await redisClient.set('wingman:system_state', JSON.stringify(liveSystemState), { EX: 30 });
        }
    } catch (e) {  }
};
const getPlainEnglishBriefing = (state) => {
    if (!state) state = liveSystemState;
    const health = state.system_health;
    const healthLine = `Backend: ${health.backend} | Redis: ${health.redis} | DB: ${health.database} | ML Engine: ${health.ml_engine}`;
    const alertLine = state.alerts.total_open > 0
        ? `We have ${state.alerts.total_open} open alerts: ${state.alerts.critical} CRITICAL, ${state.alerts.high} HIGH. ${state.alerts.patch_failed > 0 ? `⚠️ ${state.alerts.patch_failed} patches FAILED.` : ''}`
        : 'No open alerts. All quiet on the digital front.';
    const kineticLine = state.kinetic_blocks.last_hour > 0
        ? `KernelStriker blocked ${state.kinetic_blocks.last_hour} IPs this hour${state.kinetic_blocks.top_blocked_ip ? `, most recent: ${state.kinetic_blocks.top_blocked_ip}` : ''}.`
        : 'No IP blocks in the last hour.';
    const loraLine = `LoRA: ${state.lora_training.status} (${state.lora_training.datasetSize} samples)${state.lora_training.lastRun ? `, last run: ${state.lora_training.lastRun}` : ''}.`;
    const recentLine = state.recent_events.length > 0
        ? `Recent activity:\n${state.recent_events.slice(0, 5).map(e => `  • ${e.text}`).join('\n')}`
        : 'No recent system events.';
    return [
        `📊 SYSTEM HEALTH: ${healthLine}`,
        `🔔 ALERTS: ${alertLine}`,
        `🛡️ DEFENSE: ${kineticLine}`,
        `🧠 AI: ${loraLine}`,
        recentLine,
        `\n⏱️ Snapshot: ${state.snapshot_time || 'initializing...'}`
    ].join('\n\n');
};
const initializeEyes = async () => {
    await startRedisSubscriber();
    await pollSystemHealth();
    pollInterval = setInterval(pollSystemHealth, 10000);
    console.log('[👁️] Wingman Eyes: System visibility active (polling every 10s).');
};
const shutdownEyes = async () => {
    if (pollInterval) clearInterval(pollInterval);
    if (eyesSubscriber) {
        try { await eyesSubscriber.unsubscribe(); await eyesSubscriber.quit(); } catch (e) { }
    }
};
module.exports = {
    initializeEyes,
    shutdownEyes,
    getLiveSystemState: () => ({ ...liveSystemState }),
    getPlainEnglishBriefing,
    translateEvent,
    liveSystemState
};
