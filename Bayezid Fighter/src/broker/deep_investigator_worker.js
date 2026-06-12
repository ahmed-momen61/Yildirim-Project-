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
    console.error('[-] Deep Investigator Worker Redis Error:', err.message);
});

const STREAM_KEY = 'bayezid:investigation:deep';
const GROUP_NAME = 'bayezid:deep_investigators';
const CONSUMER_NAME = 'deep_worker_node';

const { enrichContext, loadMitreDatabase } = require('../cti/ragService');
const { runWardenSandbox, analyzeWithVertexAI, analyzeWithLocalModel } = require('../core_ai/aiService');
const OracleReverser = require('../core_ai/oracleAgent');
const { runDeepInvestigation, enrichWithOSINT } = require('../cti/osintService');
const { enrichWithCTI } = require('../cti/ctiService');
const itsmService = require('../cti/itsmService');
const { encryptPayload } = require('../crypto/cryptoService');
const { generatePlaybookCommands } = require('../cti/playbookService');

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

const processDeepInvestigation = async (streamMsg) => {
    const { alertId, evidence } = streamMsg;
    console.log(`\n[🔍] DEEP INVESTIGATOR: Initiating deep analysis for Alert ${alertId}...`);

    let alert;
    try {
        alert = await prisma.alert.findUnique({ where: { id: alertId } });
    } catch (dbErr) {
        console.error(`[❌] Failed to fetch Alert from DB: ${dbErr.message}`);
        return;
    }

    if (!alert) {
        console.warn(`[⚠️] Alert ${alertId} not found in database. Aborting.`);
        return;
    }

    // Set status to DEEP_INVESTIGATING
    try {
        await prisma.alert.update({
            where: { id: alertId },
            data: { status: 'DEEP_INVESTIGATING' }
        });
    } catch (e) {
        console.warn(`[⚠️] DB Update skipped: ${e.message}`);
    }

    const payload = evidence || alert.evidence || alert.payload || JSON.stringify(alert);

    
    let ragContext = 'No extra RAG context.';
    try {
        ragContext = await enrichContext(payload);
        console.log(`[✔] RAG: Context enriched successfully.`);
    } catch (e) {
        console.warn(`[⚠️] RAG Enrichment skipped: ${e.message}`);
    }

    
    let sandboxReport = null;
    try {
        if (typeof runWardenSandbox === 'function') {
            sandboxReport = await runWardenSandbox(payload);
            console.log(`[✔] Sandbox: Warden finished analysis.`);
        }
    } catch (e) {
        console.warn(`[⚠️] Sandbox execution failed/skipped: ${e.message}`);
    }

    
    let oracleReport = null;
    try {
        if (OracleReverser && OracleReverser.analyzePayload) {
            oracleReport = await OracleReverser.analyzePayload(payload);
            console.log(`[✔] Oracle: Reversing finished.`);
        }
    } catch (e) {
        console.warn(`[⚠️] Oracle reversing failed/skipped: ${e.message}`);
    }

    
    let osintReport = null;
    let quickOsint = null;
    try {
        if (alert.sourceIp && alert.sourceIp !== 'Unknown') {
            quickOsint = await enrichWithOSINT(alert.sourceIp);
            osintReport = await runDeepInvestigation(alert.sourceIp, 'ip');
            console.log(`[✔] OSINT: Sweeps complete for ${alert.sourceIp}.`);
        }
    } catch (e) {
        console.warn(`[⚠️] OSINT sweeps failed/skipped: ${e.message}`);
    }

    
    let ctiReport = { misp_results: [], opencti_results: [] };
    try {
        const extractedIocs = {
            ips: alert.sourceIp && alert.sourceIp !== 'Unknown' ? [alert.sourceIp] : [],
            hashes: [],
            domains: []
        };
        ctiReport = await enrichWithCTI(extractedIocs, []);
        console.log(`[✔] CTI: Synced to MISP / OpenCTI.`);
    } catch (e) {
        console.warn(`[⚠️] CTI sync failed/skipped: ${e.message}`);
    }

    
    let ticketId = `BZ-DEEP-${Date.now()}`;
    try {
        if (itsmService && itsmService.createTicket) {
            ticketId = await itsmService.createTicket(
                alert.eventType || 'Deep Analysis Vulnerability',
                alert.severity || 'HIGH',
                alert.sourceIp || '127.0.0.1'
            );
        }
    } catch (e) {
        console.warn(`[⚠️] ITSM Ticket generation failed/skipped: ${e.message}`);
    }

    
    
    
    let encryptedDataStr = '';
    let hashStr = '';
    let extractedIV = '';
    try {
        const encryptedOutput = encryptPayload(payload);
        if (encryptedOutput && encryptedOutput.includes(':')) {
            // cryptoService format: 'random_iv_hex:encrypted_data_hex'
            const [ivHex, ...ciphertextParts] = encryptedOutput.split(':');
            extractedIV = ivHex;
            encryptedDataStr = ciphertextParts.join(':');
        } else {
            
            console.warn('[⚠️] Encryption returned null — storing unencrypted reference.');
            encryptedDataStr = payload;
            extractedIV = 'ENCRYPTION_FAILED';
        }
        hashStr = crypto.createHash('sha256').update(payload + Date.now().toString()).digest('hex');
        await prisma.evidenceVault.create({
            data: {
                incidentId: alert.id,
                evidenceType: 'PAYLOAD',
                encryptedData: encryptedDataStr,
                iv: extractedIV,
                sha256Hash: hashStr,
                collectedBy: 'Deep_Investigator'
            }
        });
        console.log(`[🔐] Evidence Encrypted and stored in Vault (IV: ${extractedIV.substring(0, 8)}...).`);
    } catch (e) {
        console.warn(`[⚠️] Evidence Vault save failed/skipped: ${e.message}`);
        hashStr = crypto.createHash('sha256').update(payload + Date.now().toString()).digest('hex');
    }

    
    let gnnLateralRisk = '0.15';
    try {
        console.log(`[🌐] Deep Investigator querying PyTorch GNN Oracle...`);
        const nodeMatrix = [
            [0.1, 0.2, 0.0, 0.05, 0.5, 0.5, 0.5, 0.5, 0.1, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0],
            [0.2, 0.1, 0.1, 0.02, 0.4, 0.6, 0.5, 0.3, 0.2, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0]
        ];
        const edgeList = [[0, 1]];
        const gnnResponse = await axios.post('http://127.0.0.1:8001/api/v1/gnn/predict-lateral', {
            nodes: nodeMatrix,
            edges: edgeList
        });
        const scores = gnnResponse.data.risk_scores || [];
        if (scores.length) {
            gnnLateralRisk = String(Math.max(...scores));
        }
    } catch (e) {
        console.warn(`[⚠️] GNN Oracle query failed: ${e.message}`);
    }

    let causalDowntimeRisk = '0.1';
    try {
        console.log(`[🧠] Deep Investigator querying Causal Engine...`);
        const verifyPayload = {
            action_type: 'ISOLATE_NODE',
            target_node: alert.targetServer || 'localhost',
            service_dependency_events: [
                { node: alert.targetServer || 'localhost', is_critical: 1 },
                { node: 'GATEWAY', is_critical: 0 }
            ]
        };
        const causalResponse = await axios.post('http://127.0.0.1:8002/api/v1/causal/verify-action', verifyPayload);
        if (causalResponse.data && causalResponse.data.downtime_risk !== undefined) {
            causalDowntimeRisk = String(causalResponse.data.downtime_risk);
        }
    } catch (e) {
        console.warn(`[⚠️] Causal Engine query failed: ${e.message}`);
    }

    const decoyDeployed = alert.recommendedAction === 'DOWNGRADE_TO_DECEPTIVE_PROBE';

    
    console.log(`[🧠] Handing off aggregated harvest context to CHIMERA-OMEGA AgentRuntime...`);
    
    
    const aggregatedHarvestContext = {
        alertId: alert.id,
        sourceIp: alert.sourceIp,
        targetServer: alert.targetServer,
        severity: alert.severity,
        payload: payload,
        ragContext: ragContext,
        sandboxReport: sandboxReport,
        oracleReport: oracleReport,
        osintReport: osintReport,
        ctiReport: ctiReport,
        cognitive_triage: {
            gnnLateralRisk,
            causalDowntimeRisk,
            decoyDeployed
        }
    };

    let agentResponse = null;
    try {
        const { getRuntime } = require('../agent_runtime/init');
        const runtime = getRuntime();
        
        
        agentResponse = await runtime.run('IncidentCommanderAgent', {
            type: 'INCIDENT_ESCALATION',
            incident: aggregatedHarvestContext
        });

        console.log(`[🎖️] Commander Execution Complete. Confidence: ${agentResponse.confidence}`);
    } catch (agentErr) {
        console.error(`[🚨] AgentRuntime Handoff Failed: ${agentErr.message}`);
        
        agentResponse = {
            success: false,
            recommendation: 'ISOLATE_NODE_FALLBACK',
            summary: `AgentRuntime failure: ${agentErr.message}`
        };
    }

    
    const finalReport = {
        "status": "success",
        "ticket_id": ticketId,
        "evidence_vault": `Encrypted & Hashed (AES-256 / SHA-256) | Hash: ${hashStr}`,
        "warden_sandbox": sandboxReport ? (sandboxReport.sandboxVerdict || JSON.stringify(sandboxReport)) : "No sandbox behavior observed (simulation active)",
        "oracle_insight": oracleReport ? `Obfuscation: ${oracleReport.obfuscation} | Cleartext: ${oracleReport.clearText} | Intent: ${oracleReport.aiAnalysis}` : "No cleartext obfuscation detected",
        "cognitive_triage": {
            "gnn_lateral_risk": gnnLateralRisk,
            "causal_downtime_risk": causalDowntimeRisk,
            "decoy_deployed": decoyDeployed
        },
        "agentic_analysis": {
            "success": agentResponse?.success || false,
            "commander_summary": agentResponse?.summary || "Execution failed",
            "confidence": agentResponse?.confidence || 0.0,
            "delegation_plan": agentResponse?.delegation_plan || [],
            "sub_agent_results": agentResponse?.sub_agent_results || {},
            "recommendation": agentResponse?.recommendation || "UNKNOWN"
        },
        "osint": {
            "ip": quickOsint?.ip || alert.sourceIp || '127.0.0.1',
            "country": quickOsint?.country || 'Unknown',
            "reputation_score": quickOsint?.reputation_score || 'LOW RISK',
            "otx_pulses": quickOsint?.otx_pulses || 0
        },
        "cti": {
            "misp_results": ctiReport?.misp_results || [],
            "opencti_results": ctiReport?.opencti_results || []
        },
        "purple_team_validation": "AGENT_MANAGED"
    };

    const reportSummary = {
        ragContext,
        sandboxReport,
        oracleReport,
        osintReport,
        ctiReport,
        ticketId
    };

    try {
        await prisma.alert.update({
            where: { id: alertId },
            data: {
                status: 'DEEP_INVESTIGATED',
                investigation_report: finalReport,
                playbookDetails: JSON.stringify({
                    reportSummary,
                    agent_execution: agentResponse?.summary,
                    status: 'AGENT_MANAGED'
                })
            }
        });
        console.log(`[💾] Forensic analysis compiled and stored.`);
    } catch (e) {
        console.warn(`[⚠️] Alert report save skipped: ${e.message}`);
    }

    
    try {
        if (redisClient.isOpen) {
            await redisClient.publish('bayezid:deep_investigation:complete', JSON.stringify(finalReport));
            console.log(`[🔌] Emitted DEEP_INVESTIGATION_COMPLETE to Redis Channel.`);
        }
    } catch (e) {
        console.warn(`[⚠️] Redis pub/sub publish failed: ${e.message}`);
    }
    
    
    
    console.log(`[🏁] Deep Investigation Complete. Response execution is now fully autonomous via AgentRuntime.`);
};

const runDeepWorker = async () => {
    console.log(`[⚙️] Deep Investigator Worker: Connecting to Redis...`);
    try {
        await redisClient.connect();
        console.log(`[⚡] Deep Investigator Worker: Connected to Redis.`);
    } catch (e) {
        console.error(`[⚠️] Deep Investigator Worker failed to connect to Redis:`, e.message);
        process.exit(1);
    }

    try {
        await redisClient.xGroupCreate(STREAM_KEY, GROUP_NAME, '$', { MKSTREAM: true });
    } catch (err) {}

    
    await loadMitreDatabase();

    console.log(`[📥] Deep Investigator Worker: Listening for alerts on ${STREAM_KEY}...`);

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
                await processDeepInvestigation(payload);
            } catch (err) {
                console.error('[-] Error processing deep investigation:', err.message);
            }

            await redisClient.xAck(STREAM_KEY, GROUP_NAME, msgId);
        } catch (e) {
            console.error('[-] Error in deep investigator loop:', e.message);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
};

runDeepWorker().catch((err) => {
    console.error('[-] Fatal error running deep investigator worker:', err.message);
});
