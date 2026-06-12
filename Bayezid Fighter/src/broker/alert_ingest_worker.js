const { createClient } = require('redis');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const crypto = require('crypto');
const net = require('net');
const os = require('os');

const prisma = new PrismaClient();

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { reconnectStrategy: false }
});

redisClient.on('error', (err) => {
    if (err && err.code === 'ECONNREFUSED') return;
    console.error('[-] Alert Worker Redis Error:', err.message);
});

const STREAM_KEY = 'bayezid:alerts:raw';
const GROUP_NAME = 'bayezid:alert_consumers';
const CONSUMER_NAME = 'alert_worker_node';

const sendToBroker = (cmdPayload) => {
    const IPC_PATH = os.platform() === 'win32'
        ? '\\\\.\\pipe\\bayezid_broker'
        : '/run/bayezid/broker.sock';

    return new Promise((resolve, reject) => {
        const client = net.connect(IPC_PATH, () => {
            client.write(JSON.stringify(cmdPayload) + '\n');
        });
        let responseData = '';
        client.on('data', (data) => {
            responseData += data.toString();
            const lines = responseData.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const resp = JSON.parse(line);
                    if (['COMPLETED', 'BLOCKED', 'FAILED', 'DENIED'].includes(resp.status)) {
                        client.destroy();
                        resolve(resp);
                        return;
                    }
                } catch (e) {}
            }
        });
        client.on('error', (err) => {
            reject(err);
        });
        
        setTimeout(() => {
            client.destroy();
            reject(new Error('OS Execution Broker timeout'));
        }, 65000);
    });
};

const runIngestLoop = async () => {
    console.log(`[⚙️] Alert Ingest Worker: Connecting to Redis...`);
    try {
        await redisClient.connect();
        console.log(`[⚡] Alert Ingest Worker: Connected to Redis Stream Bus.`);
    } catch (e) {
        console.error(`[⚠️] Alert Ingest Worker failed to connect to Redis. Exiting...`, e.message);
        process.exit(1);
    }

    try {
        await redisClient.xGroupCreate(STREAM_KEY, GROUP_NAME, '$', { MKSTREAM: true });
        console.log(`[📊] Redis Consumer Group [${GROUP_NAME}] verified/created.`);
    } catch (err) {
        
    }

    console.log(`[📥] Alert Ingest Worker: Listening for events...`);

    while (true) {
        try {
            const data = await redisClient.xReadGroup(
                GROUP_NAME,
                CONSUMER_NAME,
                { key: STREAM_KEY, id: '>' },
                { BLOCK: 5000, COUNT: 10 }
            );

            if (!data || data.length === 0) {
                continue;
            }

            for (const streamInfo of data) {
                const messages = streamInfo.messages;
                for (const msg of messages) {
                    const msgId = msg.id;
                    const alertStr = msg.message.alert;

                    if (!alertStr) {
                        await redisClient.xAck(STREAM_KEY, GROUP_NAME, msgId);
                        continue;
                    }

                    try {
                        const rawAlert = JSON.parse(alertStr);
                        await processAlert(rawAlert);
                    } catch (pe) {
                        console.error('[-] Failed to process message alert payload:', pe.message);
                    }

                    await redisClient.xAck(STREAM_KEY, GROUP_NAME, msgId);
                }
            }
        } catch (loopError) {
            console.error('[-] Error in alert ingest read loop:', loopError.message);
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
};

const processAlert = async (alert) => {
    
    const srcIp = alert.srcip || alert.agent_ip || alert.agent?.ip || '127.0.0.1';
    const targetServer = alert.dstip || alert.agent_name || alert.agent?.name || 'localhost';
    const eventType = alert.rule_description || alert.rule?.description || 'Wazuh Alert Event';
    const severity = String(alert.severity_level || alert.rule?.level || '3');
    const mitreTactic = alert.mitre_tactic || (alert.rule?.mitre && alert.rule.mitre.tactic ? alert.rule.mitre.tactic.join(',') : 'N/A');
    const mitreTechnique = alert.mitre_technique || (alert.rule?.mitre && alert.rule.mitre.id ? alert.rule.mitre.id.join(',') : 'N/A');

    
    const hash = crypto.createHash('sha256').update(`${srcIp}-${targetServer}-${eventType}-${severity}`).digest('hex');
    const isNew = await redisClient.set(`dup:alert:${hash}`, '1', { EX: 60, NX: true });
    
    if (!isNew) {
        console.log(`[🛑] DEDUPLICATOR: Filtered duplicate alert: ${eventType} from ${srcIp}`);
        return;
    }

    console.log(`[📥] PROCESSING NEW ALERT: ${eventType} (${srcIp} -> ${targetServer})`);

    
    let dbAlert;
    let isDbConnected = true;
    try {
        dbAlert = await prisma.alert.create({
            data: {
                sourceIp: srcIp,
                targetServer,
                eventType,
                severity,
                mitreTactic,
                mitreTechnique,
                status: 'NEW'
            }
        });
        console.log(`[💾] Alert written to database. ID: ${dbAlert.id}`);
    } catch (dbError) {
        console.error('[-] Failed to write alert to Prisma DB:', dbError.message);
        console.warn('[⚠️] Operating in degraded/offline DB mode. Proceeding with in-memory pipeline...');
        isDbConnected = false;
        dbAlert = {
            id: crypto.randomUUID(),
            sourceIp: srcIp,
            targetServer,
            eventType,
            severity,
            mitreTactic,
            mitreTechnique,
            status: 'NEW'
        };
    }

    
    try {
        console.log(`[🌐] Worker sending topology to PyTorch GNN Oracle...`);
        
        const nodeMatrix = [
            [0.1, 0.2, 0.0, 0.05, 0.5, 0.5, 0.5, 0.5, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0],
            [0.2, 0.1, 0.1, 0.02, 0.4, 0.6, 0.5, 0.3, 0.2, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0]
        ];
        const edgeList = [[0, 1]];
        await axios.post('http://127.0.0.1:8001/api/v1/gnn/predict-lateral', {
            nodes: nodeMatrix,
            edges: edgeList
        });
    } catch (gnnErr) {
        console.warn(`[⚠️] GNN Oracle prediction skip/fail: ${gnnErr.message}`);
    }

    
    try {
        console.log(`[🧠] Worker sending action to Causal Engine...`);
        
        const verifyPayload = {
            action_type: 'ISOLATE_NODE',
            target_node: targetServer,
            service_dependency_events: [
                { node: targetServer, is_critical: 1 },
                { node: 'GATEWAY', is_critical: 0 }
            ]
        };
        const response = await axios.post('http://127.0.0.1:8002/api/v1/causal/verify-action', verifyPayload);
        const verdict = response.data;
        console.log(`[🧠] Causal Engine verdict: Recommendation=${verdict.recommendation}, DowntimeRisk=${verdict.downtime_risk}`);

        
        if (verdict.recommendation === 'APPROVE' || verdict.recommendation === 'PROCEED') {
            if (isDbConnected) {
                try {
                    await prisma.alert.update({
                        where: { id: dbAlert.id },
                        data: {
                            status: 'ANALYZED',
                            recommendedAction: 'ISOLATE_NODE',
                            playbookDetails: `Causal verification approved action. Downtime risk: ${verdict.downtime_risk}`
                        }
                    });
                } catch (updateErr) {
                    console.error('[-] Failed to update alert in Prisma DB:', updateErr.message);
                }
            } else {
                console.log(`[⚠️] Offline Mode: Skip updating alert ${dbAlert.id} in DB.`);
            }
            const parsedSev = parseInt(severity) || 0;
            if (parsedSev >= 8) {
                console.log(`[⚡] HIGH SEVERITY ALERT (${severity}): Orchestrating Execution Broker triggers...`);
                const t1Payload = {
                    tool: os.platform() === 'win32' ? 'netsh' : 'iptables',
                    args: os.platform() === 'win32'
                        ? ['advfirewall', 'firewall', 'add', 'rule', `name=BayezidBlock_${srcIp}`, 'dir=in', 'action=block', `remoteip=${srcIp}`]
                        : ['-I', 'INPUT', '-s', srcIp, '-j', 'DROP'],
                    target: srcIp,
                    requesting_engine: 'Alert_Ingest_Worker_T1',
                    request_id: crypto.randomUUID()
                };
                console.log(`[🚀] Triggering Tier 1 block command: ${t1Payload.tool} ${t1Payload.args.join(' ')}`);
                try {
                    const res = await sendToBroker(t1Payload);
                    console.log(`[✅] Tier 1 Block status: ${res.status}, exit_code: ${res.exit_code}`);
                } catch (err) {
                    console.error(`[❌] Tier 1 Block failure: ${err.message}`);
                }

                const t2Payload = {
                    tool: 'nmap',
                    args: ['-sn', srcIp],
                    target: srcIp,
                    requesting_engine: 'Alert_Ingest_Worker_T2_Adversarial',
                    request_id: crypto.randomUUID()
                };
                console.log(`[🚀] Triggering Tier 2 adversarial command (requires HITL): ${t2Payload.tool} ${t2Payload.args.join(' ')}`);
                sendToBroker(t2Payload)
                    .then(res => console.log(`[✅] Tier 2 Adversarial Response status: ${res.status}, exit_code: ${res.exit_code}`))
                    .catch(err => console.error(`[❌] Tier 2 Adversarial Response failure/denial: ${err.message}`));
            }
            if (parsedSev >= 6) {
                console.log(`[⚡] Triggering validation/healing loop...`);
                await redisClient.xAdd('bayezid:validation', '*', {
                    alertId: dbAlert.id,
                    mitigationType: 'ISOLATE_NODE',
                    patchDetails: `Isolate IP ${srcIp}`
                });
            }
        } else if (verdict.recommendation === 'DOWNGRADE_TO_DECEPTIVE_PROBE') {
            console.log(`[☸️] Worker: Downtime risk too high. Routing attacker to Interactive Decoy Grid...`);
            if (isDbConnected) {
                try {
                    await prisma.alert.update({
                        where: { id: dbAlert.id },
                        data: {
                            status: 'ANALYZED',
                            recommendedAction: 'DOWNGRADE_TO_DECEPTIVE_PROBE',
                            playbookDetails: `Causal verification downgraded action to deceptive probe. Downtime risk: ${verdict.downtime_risk}`
                        }
                    });
                } catch (updateErr) {
                    console.error('[-] Failed to update alert in Prisma DB:', updateErr.message);
                }
            } else {
                console.log(`[⚠️] Offline Mode: Skip updating alert ${dbAlert.id} in DB.`);
            }
            try {
                const { deployDecoy } = require('../network/decoyManager');
                await deployDecoy({
                    triggerIp: srcIp,
                    targetPort: 80,
                    serviceType: 'nginx'
                });
            } catch (decoyErr) {
                console.error(`[❌] Failed to deploy decoy container: ${decoyErr.message}`);
            }

            const parsedSev = parseInt(severity) || 0;
            if (parsedSev >= 6) {
                console.log(`[⚡] Triggering validation/healing loop for deceptive decoy...`);
                await redisClient.xAdd('bayezid:validation', '*', {
                    alertId: dbAlert.id,
                    mitigationType: 'DECEPTIVE_PROBE',
                    patchDetails: `Deceptive decoy for IP ${srcIp}`
                });
            }
        } else {
            if (isDbConnected) {
                try {
                    await prisma.alert.update({
                        where: { id: dbAlert.id },
                        data: {
                            status: 'FLAGGED',
                            recommendedAction: 'HOLD',
                            playbookDetails: `Causal verification rejected/restricted action. Reasoning: ${verdict.reason || 'High risk'}`
                        }
                    });
                } catch (updateErr) {
                    console.error('[-] Failed to update alert in Prisma DB:', updateErr.message);
                }
            } else {
                console.log(`[⚠️] Offline Mode: Skip updating alert ${dbAlert.id} in DB.`);
            }
        }
    } catch (causalErr) {
        console.warn(`[⚠️] Causal Engine verification failed: ${causalErr.message}`);
    }

    
    const parsedSevTotal = parseInt(severity) || 0;
    if (parsedSevTotal >= 12) {
        console.log(`[🚨] HIGH SEVERITY DETECTED (Level ${parsedSevTotal} >= 12). Auto-escalating to Deep Investigation Pipeline...`);
        try {
            if (redisClient.isOpen) {
                await redisClient.xAdd('bayezid:investigation:deep', '*', {
                    alertId: dbAlert.id,
                    evidence: alert.evidence || alert.payload || JSON.stringify(alert)
                });
                console.log(`[🚀] Alert ${dbAlert.id} pushed to bayezid:investigation:deep stream.`);
            }
        } catch (escalateErr) {
            console.error(`[❌] Auto-escalation failure: ${escalateErr.message}`);
        }
    }
};

runIngestLoop().catch((err) => {
    console.error('[-] Fatal error running raw ingest worker:', err.message);
});
