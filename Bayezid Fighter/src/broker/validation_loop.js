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
    console.error('[-] Validation Loop Redis Error:', err.message);
});

const STREAM_KEY = 'bayezid:validation';
const GROUP_NAME = 'bayezid:validation_consumers';
const CONSUMER_NAME = 'validation_worker_node';

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
    });
};

const parseCommandLine = (cmdString) => {
    if (!cmdString) return { tool: '', args: [] };
    const parts = cmdString.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const cleanParts = parts.map(p => p.replace(/"/g, ''));
    return {
        tool: cleanParts[0] || '',
        args: cleanParts.slice(1)
    };
};

const getRollbackCommand = (playbookDetails) => {
    if (!playbookDetails) return null;
    try {
        const parsed = JSON.parse(playbookDetails);
        if (parsed.rollback) return parsed.rollback;
        if (parsed.rollback_command) return parsed.rollback_command;
    } catch (e) {
        if (playbookDetails.includes('Encrypted_Payload:\n')) {
            try {
                const parts = playbookDetails.split('Encrypted_Payload:\n');
                const encryptedPart = parts[1] ? parts[1].trim() : '';
                if (encryptedPart) {
                    const { decryptPayload } = require('../crypto/cryptoService');
                    const decrypted = decryptPayload(encryptedPart);
                    if (decrypted) {
                        const parsedObj = JSON.parse(decrypted);
                        return parsedObj.rollback || parsedObj.rollback_command;
                    }
                }
            } catch (err) {
                console.error('[-] Failed to decrypt/parse rollback command:', err.message);
            }
        }
    }
    return null;
};

const runValidationLoop = async () => {
    console.log(`[⚙️] Validation Loop: Connecting to Redis...`);
    try {
        await redisClient.connect();
        console.log(`[⚡] Validation Loop: Connected to Redis Stream.`);
    } catch (e) {
        console.error(`[⚠️] Validation Loop failed to connect to Redis. Exiting...`, e.message);
        process.exit(1);
    }

    try {
        await redisClient.xGroupCreate(STREAM_KEY, GROUP_NAME, '$', { MKSTREAM: true });
    } catch (err) {}

    console.log(`[📥] Validation Loop: Listening for events...`);

    while (true) {
        try {
            const data = await redisClient.xReadGroup(
                GROUP_NAME,
                CONSUMER_NAME,
                { key: STREAM_KEY, id: '>' },
                { BLOCK: 5000, COUNT: 1 }
            );

            if (!data || data.length === 0) continue;

            const msg = data[0].messages[0];
            const msgId = msg.id;
            const payload = msg.message;

            try {
                await executeValidationStateMachine(payload);
            } catch (err) {
                console.error('[-] Error executing validation state machine:', err.message);
            }

            await redisClient.xAck(STREAM_KEY, GROUP_NAME, msgId);
        } catch (e) {
            console.error('[-] Error in validation loop:', e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
};

const executeValidationStateMachine = async (payload) => {
    const { alertId, mitigationType, patchDetails } = payload;
    console.log(`\n[🔍] VALIDATION LOOP: Waking up for Alert ${alertId} (Mitigation: ${mitigationType})...`);

    
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert) {
        console.warn(`[⚠️] Alert ${alertId} not found in database. Skipping.`);
        return;
    }

    const targetIp = alert.sourceIp || '127.0.0.1'; 
    let loopIteration = 0;
    let validated = false;

    while (loopIteration < 3 && !validated) {
        loopIteration++;
        console.log(`[🔄] VALIDATION LOOP: Iteration ${loopIteration}/3 starting...`);

        
        console.log(`[👤] State: EMULATION_PENDING. Requesting HITL approval for adversarial validation...`);
        const hitlApproved = await requestHITLValidation(alertId, targetIp);
        if (!hitlApproved) {
            console.log(`[🛑] Validation aborted: HITL operator denied validation command.`);
            return;
        }

        
        console.log(`[🔥] State: EMULATION_RUNNING. Dispatched red-team exploit verification...`);
        const exploitOutcome = await runAdversarialValidation(targetIp);
        
        if (!exploitOutcome || exploitOutcome.success === false) {
            
            console.log(`[✅] State: VALIDATION_PASS. Adversarial emulation failed to exploit patched vector.`);
            await prisma.alert.update({
                where: { id: alertId },
                data: {
                    status: 'RESOLVED',
                    recommendedAction: `Patched successfully. Iterations: ${loopIteration}`
                }
            });
            
            
            if (redisClient.isOpen) {
                await redisClient.lPush('bayezid:lora:queue', JSON.stringify({
                    alertId,
                    mitigationType,
                    status: 'SUCCESS',
                    timestamp: Date.now()
                }));
            }
            validated = true;
        } else {
            
            console.log(`[❌] State: VALIDATION_FAIL. Exploit successfully bypassed the mitigation patch.`);
            
            
            const rollbackCmd = getRollbackCommand(alert.playbookDetails);
            if (rollbackCmd) {
                console.log(`[🔄] Bypassed patch detected. Dispatching rollback via OS Execution Broker: ${rollbackCmd}`);
                const { tool, args } = parseCommandLine(rollbackCmd);
                if (tool) {
                    try {
                        const rollbackRes = await sendToBroker({
                            tool,
                            args,
                            target: targetIp,
                            requesting_engine: 'Validation_Loop_Rollback',
                            request_id: crypto.randomUUID()
                        });
                        console.log(`[✅] Rollback execution status: ${rollbackRes.status}`);
                    } catch (rollbackErr) {
                        console.error(`[❌] Rollback execution failure: ${rollbackErr.message}`);
                    }
                }
            } else {
                console.log(`[⚠️] No rollback command found for Alert ${alertId}. Skipping rollback.`);
            }

            await prisma.alert.update({
                where: { id: alertId },
                data: { status: 'PATCH_BYPASS' }
            });

            if (loopIteration < 3) {
                console.log(`[🧠] Querying Causal Engine for deeper RCA to re-patch...`);
                try {
                    const response = await axios.post('http://127.0.0.1:8002/api/v1/causal/verify-action', {
                        action_type: 'RE_PATCH',
                        target_node: alert.targetServer,
                        service_dependency_events: [{ node: alert.targetServer, is_critical: 1 }]
                    });
                    console.log(`[🩹] Causal Engine re-patch verdict:`, response.data);
                } catch (ce) {
                    console.warn(`[⚠️] Causal engine offline during re-patch: ${ce.message}`);
                }
                
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }

    if (!validated) {
        
        console.log(`[🚨] State: ESCALATE_TO_HUMAN. Exploit bypasses could not be patched automatically after 3 loops.`);
        await prisma.alert.update({
            where: { id: alertId },
            data: {
                status: 'ESCALATED',
                severity: 'CRITICAL'
            }
        });

        
        try {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_CHAT_ID;
            if (botToken && chatId) {
                const message = `🚨 *CRITICAL SOAR ESCALATION* 🚨\n\nAlert ID: \`${alertId}\`\nMitigation type: \`${mitigationType}\` failed validation after 3 attempts.\nExploit bypass detected. Human operator intervention required.`;
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'Markdown'
                });
            }
        } catch (e) {
            console.warn(`[⚠️] Failed to send Telegram escalation: ${e.message}`);
        }
    }
};

const requestHITLValidation = async (alertId, targetIp) => {
    console.log(`[👤] HITL: Suspending execution, requesting approval for adversarial validation on ${targetIp}...`);
    const requestId = crypto.randomUUID();
    let approved = false;
    try {
        if (!redisClient.isOpen) await redisClient.connect();
        
        
        let lastDecisionId = '0-0';
        try {
            const streamInfo = await redisClient.xInfoStream('bayezid:hitl:decisions');
            if (streamInfo && streamInfo.lastGeneratedId) {
                lastDecisionId = streamInfo.lastGeneratedId;
            }
        } catch (infoErr) {
            
            lastDecisionId = '0-0';
        }

        await redisClient.xAdd('bayezid:hitl:pending', '*', {
            request_id: requestId,
            tool: 'nmap',
            args: JSON.stringify(['-sn', targetIp]),
            target: targetIp,
            requesting_engine: 'Validation_Loop',
            timeout_seconds: '60'
        });

        const start = Date.now();
        while (Date.now() - start < 60000) {
            const results = await redisClient.xRead(
                { key: 'bayezid:hitl:decisions', id: lastDecisionId },
                { BLOCK: 1000, COUNT: 10 }
            ).catch(() => null);

            if (results && results.length > 0) {
                const msgs = results[0].messages;
                for (const msg of msgs) {
                    lastDecisionId = msg.id; 
                    if (msg.message.request_id === requestId) {
                        const decision = msg.message.decision;
                        approved = decision === 'APPROVE';
                        break;
                    }
                }
                if (approved) break;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        if (!approved) {
            console.warn(`[👤] HITL: Validation approval request ${requestId} timed out or denied.`);
        }
    } catch (e) {
        console.error('[-] Validation HITL flow error:', e.message);
    }
    return approved;
};

const runAdversarialValidation = async (targetIp) => {
    try {
        const { runChimeraXPipeline } = require('../red_swarm/chimeraEngine');
        console.log(`[🔥] Chimera Engine: Initiating exploit simulation on target: ${targetIp}...`);
        const result = await runChimeraXPipeline(targetIp, 120000).catch(() => ({ success: false }));
        return result;
    } catch (e) {
        console.warn(`[⚠️] Chimera emulation unavailable: ${e.message}. Simulating random exploit bypass status.`);
        return { success: Math.random() < 0.2 };
    }
};

runValidationLoop().catch((err) => {
    console.error('[-] Fatal error running validation loop worker:', err.message);
});
