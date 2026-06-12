const zmq = require('zeromq');
const axios = require('axios');
const { emitTelemetry } = require('./telemetryHub');
const kernelStriker = require('../blue_swarm/kernelStriker');

const ML_SNIPER_URL = 'http://127.0.0.1:8000/api/v1/native/analyze-ioc';
const GNN_ORACLE_URL = 'http://127.0.0.1:8001/api/v1/native/syscall-topology';
const CAUSAL_ENGINE_URL = 'http://127.0.0.1:8002/api/v1/causal/verify-action';

let telemetrySubscriber = null;
let isRunning = false;

const startNativeTelemetryBridge = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
        telemetrySubscriber = new zmq.Subscriber();
        telemetrySubscriber.connect('tcp://127.0.0.1:5555');
        telemetrySubscriber.subscribe('PACKET_EVENT');
        telemetrySubscriber.subscribe('MEMORY_IOC');
        telemetrySubscriber.subscribe('SYSCALL_EVENT');

        console.log('[🌉] NATIVE BRIDGE: Connected to ZMQ Telemetry Spine (tcp://127.0.0.1:5555)');

        for await (const [topic, msg] of telemetrySubscriber) {
            if (!isRunning) break;
            const topicStr = topic.toString();
            try {
                const payload = JSON.parse(msg.toString());
                handleTelemetryEvent(topicStr, payload);
            } catch (err) {
                console.error(`[🌉] NATIVE BRIDGE Error parsing ZMQ message: ${err.message}`);
            }
        }
    } catch (err) {
        console.error(`[🌉] NATIVE BRIDGE Initialization Failed: ${err.message}`);
        isRunning = false;
    }
};

const handleTelemetryEvent = async (topic, payload) => {
    emitTelemetry('NATIVE', {
        topic: topic,
        source_ip: payload.src_ip || '',
        pid: payload.pid || 0,
        process: payload.process || '',
        action: payload.action || '',
        reason: payload.reason || '',
        sensor: payload.sensor || '',
        os: payload.os || '',
        details: payload
    });

    if (topic === 'PACKET_EVENT') {
        console.log(`[🛡️] NATIVE PACKET EVENT: ${payload.action} on ${payload.src_ip} (${payload.sensor})`);
    } 
    else if (topic === 'MEMORY_IOC') {
        console.log(`[🔍] NATIVE MEMORY IOC: PID ${payload.pid} matched ${payload.rule_name}`);
        try {
            const mlRes = await axios.post(ML_SNIPER_URL, payload, { timeout: 3000 });
            if (mlRes.data && mlRes.data.verdict === 'MALICIOUS') {
                await evaluateCausalAction('ISOLATE_NODE', payload.src_ip || payload.pid);
            }
        } catch (e) {
            console.error(`[🌉] ML Sniper unreachable for MEMORY_IOC: ${e.message}`);
        }
    }
    else if (topic === 'SYSCALL_EVENT') {
        console.log(`[👁️] NATIVE SYSCALL EVENT: PID ${payload.pid} invoked ${payload.syscall}`);
        try {
            const mlRes = await axios.post(GNN_ORACLE_URL, { 
                nodes: [[payload.pid, payload.uid]], 
                edges: [] 
            }, { timeout: 3000 });
            
            if (mlRes.data && mlRes.data.lateral_movement_probability > 0.80) {
                await evaluateCausalAction('ISOLATE_NODE', payload.src_ip || payload.pid);
            }
        } catch (e) {
            console.error(`[🌉] GNN Oracle unreachable for SYSCALL_EVENT: ${e.message}`);
        }
    }
};

const evaluateCausalAction = async (actionType, target) => {
    try {
        const causalRes = await axios.post(CAUSAL_ENGINE_URL, {
            action_type: actionType,
            target_node: String(target),
            service_dependency_events: [] 
        }, { timeout: 3000 });

        if (causalRes.data && causalRes.data.safe) {
            console.log(`[✅] CAUSAL ENGINE: ${actionType} on ${target} is SAFE. Executing...`);
            if (typeof target === 'string' && target.includes('.')) {
                kernelStriker.blockIp(target);
            }
        } else {
            console.log(`[❌] CAUSAL ENGINE: ${actionType} on ${target} is UNSAFE (Risk: ${causalRes.data?.downtime_risk}). Aborting.`);
        }
    } catch (e) {
        console.error(`[🌉] Causal Engine unreachable: ${e.message}`);
    }
};

const stopNativeTelemetryBridge = () => {
    isRunning = false;
    if (telemetrySubscriber) {
        telemetrySubscriber.close();
        telemetrySubscriber = null;
        console.log('[🌉] NATIVE BRIDGE: Shutting down ZMQ Subscriber.');
    }
};

module.exports = {
    startNativeTelemetryBridge,
    stopNativeTelemetryBridge
};
