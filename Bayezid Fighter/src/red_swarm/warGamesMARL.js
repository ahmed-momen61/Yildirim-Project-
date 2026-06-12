const EventEmitter = require('events');
const { getExecutionMode, isLiveFire } = require('./modeRouter');
const { liveFireFullKillChain } = require('./liveFireEngine');
const { publishRedEvent } = require('./executionBridge');
const { HeuristicWatchdog } = require('../blue_swarm/heuristicWatchdog');
const { Connection, Client } = require('@temporalio/client');

let temporalClient = null;
const getTemporalClient = async () => {
    if (!temporalClient) {
        try {
            const connection = await Connection.connect();
            temporalClient = new Client({ connection });
        } catch (e) {
            console.error('[⚠️] Temporal Connection Failed:', e.message);
        }
    }
    return temporalClient;
}

const runMARLSimulation = async (episodes = 1) => {
    const mode = getExecutionMode();
    console.log(`\n🧠 [MARL] Initiating Phase 10 Multi-Agent Reinforcement Learning...`);
    console.log(`   [Mode] ${mode} - Wargaming Execution Engine Active`);
    
    if (!isLiveFire()) {
        console.log(`[!] FATAL: Simulation Mode is strictly forbidden by Absolute Symphony Directive.`);
        console.log(`[!] Please set BAYEZID_EXECUTION_MODE=LIVE_FIRE to execute native payloads.`);
        process.exit(1);
    }
    
    console.log(`[🔥] LIVE_FIRE Mode detected. Launching genuine Swarm assault via shadowMirror...`);
    
    try {
        const result = await liveFireFullKillChain('wargaming_target', { sourceIp: '127.0.0.1' });
        console.log(`\n🏆 [MARL LIVE-FIRE COMPLETE] Live Kill-Chain execution finished.`);
        return result;
    } catch (error) {
        console.error(`[❌] Live-Fire Kill-Chain failed: ${error.message}`);
        throw error;
    }
}

if (require.main === module) {
    runMARLSimulation(1);
}

module.exports = { runMARLSimulation };
