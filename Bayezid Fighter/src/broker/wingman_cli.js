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

redisClient.on('error', () => {});

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
    
    activeRl.question(`${CYAN}wingman> ${RESET}`, async (input) => {
        if (!input.trim()) {
            startChatRl();
            return;
        }
        
        if (input.trim().toLowerCase() === 'exit') {
            console.log(`${YELLOW}[+] Exiting Wingman CLI...${RESET}`);
            process.exit(0);
        }
        
        console.log(`${GREEN}[⏳] Wingman is thinking...${RESET}`);
        try {
            const { chatWithLocalModelFast, askRedSwarmAI } = require('../core_ai/aiService');
            let reply;
            try {
                reply = await chatWithLocalModelFast(input);
            } catch (localErr) {
                reply = await askRedSwarmAI(input, false);
            }
            console.log(`\n${BOLD}Wingman:${RESET} ${reply}\n`);
        } catch (err) {
            console.log(`\n${RED}[❌] Wingman Offline: ${err.message}${RESET}\n`);
        }
        
        startChatRl();
    });
};

const runCLI = async () => {
    console.log(`\n=============================================`);
    console.log(` ${GREEN}${BOLD}🦅 WINGMAN SECURITY CO-PILOT CLI 🦅${RESET} `);
    console.log(`=============================================`);
    console.log(`Connecting to Redis...`);
    
    try {
        await redisClient.connect();
        console.log(`${GREEN}[⚡] Connected to Redis.${RESET}`);
    } catch (e) {
        console.error(`${RED}[❌] Redis connection failed: ${e.message}${RESET}`);
        process.exit(1);
    }
    
    console.log(`${CYAN}[+] Wingman Co-Pilot Active. Type your queries below.${RESET}\n`);
    startChatRl();
};

runCLI().catch((err) => {
    console.error('[-] Wingman CLI Error:', err.message);
});
