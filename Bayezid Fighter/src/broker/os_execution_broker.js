const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createClient } = require('redis');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { reconnectStrategy: false }
});

redisClient.on('error', (err) => {
    if (err && err.code === 'ECONNREFUSED') return;
    console.error('[-] Broker Redis Client Error:', err.message);
});

const IPC_PATH = os.platform() === 'win32' 
    ? '\\\\.\\pipe\\bayezid_broker' 
    : '/run/bayezid/broker.sock';


const T0_ALLOWED = new Set(['ss', 'ps', 'cat', 'journalctl', 'yara', 'ls', 'stat']);
const T1_ALLOWED = new Set(['bpftool', 'iptables', 'docker', 'systemctl', 'netsh', 'curl']);
const T2_ALLOWED = new Set(['nmap', 'nuclei', 'msfconsole', 'ping']);
const T3_BLOCKED = new Set(['rm', 'dd', 'mkfs', 'passwd', 'useradd', 'shutdown', 'reboot', 'docker rm']);


const isSanitized = (arg) => {
    if (typeof arg !== 'string') return false;
    
    const blacklist = [';', '|', '`', '$', '(', ')', '&', '>', '<', '\n', '\r', '\0', '../'];
    for (const char of blacklist) {
        if (arg.includes(char)) return false;
    }
    
    if (arg.length > 1024) return false;
    return true;
};

const sanitizeCommand = (tool, args) => {
    if (T3_BLOCKED.has(tool)) {
        return { valid: false, reason: 'Command belongs to T3_BLOCKED taxonomy.' };
    }
    
    if (!T0_ALLOWED.has(tool) && !T1_ALLOWED.has(tool) && !T2_ALLOWED.has(tool)) {
        return { valid: false, reason: `Unknown/unregistered command class: ${tool}` };
    }
    
    for (const arg of args) {
        if (!isSanitized(arg)) {
            return { valid: false, reason: `Argument sanitization check failed: ${arg}` };
        }
    }
    return { valid: true };
};

const determineTier = (tool) => {
    if (T0_ALLOWED.has(tool)) return 'T0';
    if (T1_ALLOWED.has(tool)) return 'T1';
    if (T2_ALLOWED.has(tool)) return 'T2';
    return 'T3';
};

const handleHITLApproval = async (reqData) => {
    const requestId = reqData.request_id || crypto.randomUUID();
    console.log(`[👤] HITL: Suspending execution, requesting approval for ${reqData.tool} on ${reqData.target}...`);
    
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
            tool: reqData.tool,
            args: JSON.stringify(reqData.args),
            target: reqData.target || 'unknown',
            requesting_engine: reqData.requesting_engine || 'unknown',
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
            console.warn(`[👤] HITL: Approval request ${requestId} timed out or denied.`);
        }
    } catch (e) {
        console.error('[-] HITL flow error:', e.message);
    }

    try {
        const { veritasChain } = require('../crypto/veritasProof');
        if (veritasChain) {
            veritasChain.recordDecision('HITL_DECISION', {
                request_id: requestId,
                tool: reqData.tool,
                args: reqData.args,
                approved
            }, { operator: reqData.requesting_engine || 'OS_Execution_Broker' });
        }
    } catch (e) {
        console.error('[-] Failed to record HITL decision in Veritas:', e.message);
    }

    return approved;
};

const executeCommand = async (reqData, cSocket) => {
    const { tool, args, target, requesting_engine, request_id } = reqData;
    const tier = determineTier(tool);
    
    
    const check = sanitizeCommand(tool, args);
    if (!check.valid) {
        cSocket.write(JSON.stringify({
            request_id,
            status: 'BLOCKED',
            reason: check.reason
        }) + '\n');
        
        
        try {
            await prisma.auditLog.create({
                data: {
                    action: `EXEC_BROKER: Blocked command ${tool}`,
                    aiVetoTriggered: true,
                    aiReasoning: `Blocked execution of ${tool} ${args.join(' ')}. Reason: ${check.reason}`
                }
            });
        } catch (dbErr) {}
        return;
    }

    if (tier === 'T3') {
        cSocket.write(JSON.stringify({ request_id, status: 'BLOCKED', reason: 'Tier-3 Destructive command blocked' }) + '\n');
        return;
    }

    
    if (tier === 'T2') {
        const approved = await handleHITLApproval(reqData);
        if (!approved) {
            cSocket.write(JSON.stringify({ request_id, status: 'DENIED', reason: 'HITL approval denied or timed out' }) + '\n');
            return;
        }
    }

    
    if (tier === 'T1' || tier === 'T2') {
        try {
            await prisma.auditLog.create({
                data: {
                    action: `EXEC_BROKER: Executing T1/T2 ${tool}`,
                    aiReasoning: `Executing command under requesting engine: ${requesting_engine}. Args: ${args.join(' ')}`
                }
            });
        } catch (dbErr) {}
    }

    
    console.log(`[🚀] Broker spawning process: ${tool} ${args.join(' ')}`);
    const startTime = Date.now();
    const proc = spawn(tool, args, { shell: false });

    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (chunk) => {
        stdoutData += chunk;
        cSocket.write(JSON.stringify({ request_id, status: 'RUNNING', chunk: chunk.toString() }) + '\n');
    });

    proc.stderr.on('data', (chunk) => {
        stderrData += chunk;
        cSocket.write(JSON.stringify({ request_id, status: 'RUNNING', chunk: chunk.toString() }) + '\n');
    });

    proc.on('close', async (code) => {
        const duration = Date.now() - startTime;
        const outDigest = stdoutData.substring(0, 4096);
        console.log(`[✅] Command ${tool} completed. Code: ${code}, Duration: ${duration}ms`);

        cSocket.write(JSON.stringify({
            request_id,
            status: 'COMPLETED',
            exit_code: code,
            stdout: outDigest,
            duration_ms: duration
        }) + '\n');

        
        try {
            const commandHash = crypto.createHash('sha256').update(`${tool} ${args.join(' ')}`).digest('hex');
            const opLedger = await prisma.operationLedger.create({
                data: {
                    roeTokenId: null, 
                    agentName: requesting_engine || 'OS_Execution_Broker',
                    targetIp: target || 'localhost',
                    commandHash,
                    outcome: `ExitCode: ${code}. Output: ${outDigest.substring(0, 100)}`,
                    veritasBlock: null
                }
            });

            if (tier === 'T2') {
                try {
                    const { veritasChain } = require('../crypto/veritasProof');
                    if (veritasChain) {
                        const block = veritasChain.recordDecision('T2_BROKER_EXECUTION', {
                            request_id,
                            tool,
                            args,
                            exit_code: code,
                            duration_ms: duration,
                            operationLedgerId: opLedger.id
                        }, { operator: requesting_engine || 'OS_Execution_Broker' });
                        
                        await prisma.operationLedger.update({
                            where: { id: opLedger.id },
                            data: { veritasBlock: block.index }
                        });
                    }
                } catch (vErr) {
                    console.error('[-] Failed to record T2 execution in Veritas:', vErr.message);
                }
            }
        } catch (dbErr) {
            console.error('[-] Failed to write operation ledger entry:', dbErr.message);
        }
    });

    proc.on('error', (err) => {
        console.error(`[-] Process execution error:`, err.message);
        cSocket.write(JSON.stringify({ request_id, status: 'FAILED', reason: err.message }) + '\n');
    });
};

const server = net.createServer((socket) => {
    let dataBuffer = '';

    socket.on('data', async (chunk) => {
        dataBuffer += chunk.toString();
        const lines = dataBuffer.split('\n');
        dataBuffer = lines.pop(); 

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const reqData = JSON.parse(line);
                await executeCommand(reqData, socket);
            } catch (err) {
                socket.write(JSON.stringify({ status: 'ERROR', reason: 'Invalid JSON payload format' }) + '\n');
            }
        }
    });

    socket.on('error', (err) => {
        
    });
});

const startBroker = async () => {
    try {
        if (!redisClient.isOpen) await redisClient.connect();
        console.log(`[⚡] Execution Broker: Connected to Redis.`);
    } catch (e) {
        console.warn(`[⚠️] Execution Broker: Redis connection unavailable or degraded.`);
    }

    if (os.platform() !== 'win32') {
        const socketDir = path.dirname(IPC_PATH);
        if (!fs.existsSync(socketDir)) {
            fs.mkdirSync(socketDir, { recursive: true });
        }
        if (fs.existsSync(IPC_PATH)) {
            fs.unlinkSync(IPC_PATH);
        }
    }

    server.listen(IPC_PATH, () => {
        console.log(`[🛡️] OS Execution Broker listening on: ${IPC_PATH}`);
    });
};

startBroker().catch(err => {
    console.error('[-] Fatal error starting OS Execution Broker:', err.message);
});
