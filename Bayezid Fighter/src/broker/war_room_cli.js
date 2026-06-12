const { createClient } = require('redis');
const readline = require('readline');
const crypto = require('crypto');


const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { reconnectStrategy: false }
});

const pubsubClient = redisClient.duplicate();

redisClient.on('error', () => {});
pubsubClient.on('error', () => {});

let activeRl = null;
let pendingHitl = null;

const startChatRl = () => {
    if (activeRl) {
        activeRl.close();
    }
    
    activeRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    activeRl.question(`${YELLOW}war_room> ${RESET}`, async (input) => {
        if (!input.trim()) {
            startChatRl();
            return;
        }
        
        if (input.trim().toLowerCase() === 'exit') {
            console.log(`${YELLOW}[+] Exiting War Room CLI...${RESET}`);
            process.exit(0);
        }
        
        console.log(`${CYAN}[💬] Chat command recorded. Broadcasted to War Room memory feed.${RESET}`);
        startChatRl();
    });
};

const runCLI = async () => {
    console.log(`\n=============================================`);
    console.log(` ${YELLOW}${BOLD}🛡️ BAYEZID TACTICAL WAR ROOM CLI 🛡️${RESET} `);
    console.log(`=============================================`);
    console.log(`Connecting to Redis...`);
    
    try {
        await redisClient.connect();
        await pubsubClient.connect();
        console.log(`${GREEN}[⚡] Connected to Redis streams & Pub/Sub feeds.${RESET}`);
    } catch (e) {
        console.error(`${RED}[❌] Redis connection failed: ${e.message}${RESET}`);
        process.exit(1);
    }
    
    const PENDING_STREAM = 'bayezid:hitl:pending';
    const DECISIONS_STREAM = 'bayezid:hitl:decisions';
    const CLI_ID = crypto.randomUUID();
    const PENDING_GROUP = 'warroom_cli_pending_' + CLI_ID;
    const DECISIONS_GROUP = 'warroom_cli_decisions_' + CLI_ID;
    
    try {
        await redisClient.xGroupCreate(PENDING_STREAM, PENDING_GROUP, '$', { MKSTREAM: true });
    } catch (e) {}
    try {
        await redisClient.xGroupCreate(DECISIONS_STREAM, DECISIONS_GROUP, '$', { MKSTREAM: true });
    } catch (e) {}
    
    
    await pubsubClient.subscribe('bayezid_tactical_feed', (message) => {
        try {
            const event = JSON.parse(message);
            if (pendingHitl) {
                return;
            }
            
            
            if (activeRl) {
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
            }
            
            console.log(`\n${GREEN}[📡 LIVE FEED] Event Type: ${event.type}${RESET}`);
            if (event.data && event.data.alertId) {
                console.log(`  Details: Alert ID ${event.data.alertId}`);
            }
            console.log('');
            
            // Restore prompt
            if (activeRl) {
                startChatRl();
            }
        } catch (e) {}
    });
    
    console.log(`${CYAN}[+] Real-time event log viewer active. Subscribed to HITL queue.${RESET}\n`);
    startChatRl();
    
    // Background streams listeners
    // 1. Pending HITL Listener
    (async () => {
        while (true) {
            try {
                if (pendingHitl) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                
                const data = await redisClient.xReadGroup(
                    PENDING_GROUP,
                    'cli_node',
                    { key: PENDING_STREAM, id: '>' },
                    { BLOCK: 2000, COUNT: 1 }
                );
                
                if (data && data.length > 0) {
                    const msg = data[0].messages[0];
                    const msgId = msg.id;
                    const payload = msg.message;
                    
                    pendingHitl = payload;
                    if (activeRl) {
                        activeRl.close();
                    }
                    
                    console.log(`\n\n${RED}${BOLD}[🚨 HITL WARNING] [WAR ROOM]: The Broker wants to run an adversarial exploit.${RESET}`);
                    console.log(`  ${YELLOW}Request ID:${RESET} ${payload.request_id}`);
                    console.log(`  ${YELLOW}Tool:${RESET}       ${payload.tool}`);
                    console.log(`  ${YELLOW}Args:${RESET}       ${payload.args}`);
                    console.log(`  ${YELLOW}Target:${RESET}     ${payload.target}`);
                    console.log(`  ${YELLOW}Engine:${RESET}     ${payload.requesting_engine}`);
                    
                    const promptApproval = () => {
                        activeRl = readline.createInterface({ input: process.stdin, output: process.stdout });
                        activeRl.question(`${RED}${BOLD}Do you authorize this exploit? [Y/N or APPROVE/DENY]: ${RESET}`, async (answer) => {
                            activeRl.close();
                            if (!pendingHitl) {
                                return;
                            }
                            const ans = answer.trim().toUpperCase();
                            const decision = (ans === 'Y' || ans === 'APPROVE') ? 'APPROVE' : 'DENY';
                            
                            try {
                                await redisClient.xAdd(DECISIONS_STREAM, '*', {
                                    request_id: payload.request_id,
                                    decision,
                                    approver: 'WarRoom_CLI'
                                });
                                console.log(`${GREEN}[✔] Decision [${decision}] successfully published.${RESET}\n`);
                            } catch (err) {
                                console.error(`${RED}[❌] Failed to publish decision: ${err.message}${RESET}`);
                            }
                            
                            pendingHitl = null;
                            startChatRl();
                        });
                    };
                    promptApproval();
                    await redisClient.xAck(PENDING_STREAM, PENDING_GROUP, msgId);
                }
            } catch (err) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    })();
    
    
    (async () => {
        while (true) {
            try {
                const data = await redisClient.xReadGroup(
                    DECISIONS_GROUP,
                    'cli_node',
                    { key: DECISIONS_STREAM, id: '>' },
                    { BLOCK: 2000, COUNT: 1 }
                );
                
                if (data && data.length > 0) {
                    const msg = data[0].messages[0];
                    const msgId = msg.id;
                    const payload = msg.message;
                    
                    
                    if (pendingHitl && pendingHitl.request_id === payload.request_id && payload.approver !== 'WarRoom_CLI') {
                        console.log(`\n\n${YELLOW}[👤] Operation was processed by another operator terminal [Decision: ${payload.decision}]. Resuming chat...${RESET}\n`);
                        pendingHitl = null;
                        startChatRl();
                    }
                    await redisClient.xAck(DECISIONS_STREAM, DECISIONS_GROUP, msgId);
                }
            } catch (err) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    })();
};

runCLI().catch((err) => {
    console.error('[-] War Room CLI Error:', err.message);
});
