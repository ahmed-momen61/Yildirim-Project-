const crypto = require('crypto');
const { publishLiveEvent } = require('../memory_systems/memoryService');
const REQUIRED_FIELDS = ['attackClass', 'mitreId', 'sourceIp'];
const VALID_ATTACK_CLASSES = [
    'sqli', 'xss', 'auth_bruteforce', 'ssrf', 'lfi',
    'privilege_escalation', 'lateral_movement', 'persistence',
    'reconnaissance', 'polymorphic_mutation', 'c2_protocol_hop',
    'warden_sandbox', 'alchemist_fuzz', 'phantom_escalation',
    'chameleon_stealth', 'wargaming_round', 'custom'
];
const normaliseEvent = (raw) => {
    for (const field of REQUIRED_FIELDS) {
        if (!raw[field]) {
            throw new Error(`[ExecutionBridge] Missing required field: "${field}"`);
        }
    }
    if (!VALID_ATTACK_CLASSES.includes(raw.attackClass)) {
        console.warn(`[ExecutionBridge] Unknown attackClass "${raw.attackClass}", allowing as custom.`);
    }
    const event = {
        eventId: raw.eventId || `evt-${crypto.randomBytes(8).toString('hex')}`,
        timestamp: raw.timestamp || new Date().toISOString(),
        attackClass: raw.attackClass,
        mitreId: raw.mitreId,
        severity: raw.severity || 'MEDIUM',
        sourceIp: raw.sourceIp,
        targetAsset: raw.targetAsset || 'unknown',
        agentName: raw.agentName || 'unknown',
        payload: raw.payload || null,
        command: raw.command || null,
        stdout: raw.stdout || null,
        stderr: raw.stderr || null,
        exitCode: raw.exitCode !== undefined ? raw.exitCode : null,
        result: raw.result || null,
        success: typeof raw.success === 'boolean' ? raw.success : null,
        mode: raw.mode || process.env.BAYEZID_EXECUTION_MODE || 'SIMULATED',
        __synthetic: raw.__synthetic === true,
        phase: raw.phase || null,
        wargamingRound: raw.wargamingRound || null,
        campaignId: raw.campaignId || null,
        raw: raw.raw || null
    };
    return event;
};
const publishRedEvent = async (rawEvent) => {
    const event = normaliseEvent(rawEvent);
    try {
        await publishLiveEvent('bayezid_tactical_feed', 'RED_TEAM_EVENT', event);
    } catch (e) {
        console.error(`[ExecutionBridge] Redis publish failed: ${e.message}`);
    }
    const modeTag = event.__synthetic ? '🧪 SIM' : '🔥 LIVE';
    console.log(`[${modeTag}] ${event.agentName}::${event.attackClass} → ${event.success === true ? '✅' : event.success === false ? '❌' : '⏳'} | ${event.mitreId} | ${event.sourceIp}`);
    return event;
};
const publishRedEventBatch = async (rawEvents) => {
    const results = [];
    for (const raw of rawEvents) {
        try {
            const event = await publishRedEvent(raw);
            results.push(event);
        } catch (e) {
            console.error(`[ExecutionBridge] Batch event failed: ${e.message}`);
        }
    }
    return results;
};
const getSchemaDefinition = () => ({
    required: REQUIRED_FIELDS,
    validAttackClasses: VALID_ATTACK_CLASSES,
    fields: [
        'eventId', 'timestamp', 'attackClass', 'mitreId', 'severity',
        'sourceIp', 'targetAsset', 'agentName', 'payload', 'command',
        'stdout', 'stderr', 'exitCode', 'result', 'success',
        'mode', '__synthetic', 'phase', 'wargamingRound', 'campaignId', 'raw'
    ]
});
module.exports = {
    publishRedEvent,
    publishRedEventBatch,
    normaliseEvent,
    getSchemaDefinition,
    VALID_ATTACK_CLASSES
};
