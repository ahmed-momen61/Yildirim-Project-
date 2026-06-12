const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const HONEY_TOKENS = [
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7HONEYTOK",
    "DB_PASSWORD=fake_admin_pass_99",
    "ROOT_SSH_KEY_B64=LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0=" 
];
class LateralDefense {
    constructor() {
        this.activeDecoys = new Map();
        this.morphingInterval = null;
    }
    startEnvironmentMorphing() {
        console.log(`\n[🌀] DYNAMIC ENVIRONMENT MORPHING: Initializing 60-second rotation cycle...`);
        this.morphingInterval = setInterval(() => {
            console.log(`[🌀] MORPH: Rotating all environmental credentials and Honey-Tokens...`);
            for (const [container, oldToken] of this.activeDecoys.entries()) {
                this.deployHoneyTokens(container); 
            }
        }, 60000);
    }
    stopEnvironmentMorphing() {
        if (this.morphingInterval) clearInterval(this.morphingInterval);
    }
    async deployHoneyTokens(targetContainer) {
        console.log(`\n[🍯] LATERAL DEFENSE: Deploying Honey-Tokens to ${targetContainer}...`);
        const selectedToken = HONEY_TOKENS[Math.floor(Math.random() * HONEY_TOKENS.length)];
        try {
            await execPromise(`docker exec ${targetContainer} sh -c "echo '${selectedToken}' >> /tmp/.env.backup"`);
            await execPromise(`docker exec ${targetContainer} sh -c "mkdir -p /root/.ssh && echo 'ssh-rsa AAAAB3NzaC1yc2EAAA... decoy@blue' > /root/.ssh/id_rsa_decoy"`);
            this.activeDecoys.set(targetContainer, selectedToken);
            console.log(`[✨] Deception Active: Injected ${selectedToken.split('=')[0]} into ${targetContainer}`);
            return true;
        } catch (e) {
            console.log(`[⚠️] Failed to deploy Honey-Tokens: ${e.message}`);
            return false;
        }
    }
    monitorDecoyUsage(telepathyBroadcast) {
        if (!telepathyBroadcast) return false;
        console.log(`\n[🕵️] DEFENSE INTEL: Monitoring Hive Mind broadcasts for Honey-Token signatures...`);
        for (const [node, token] of this.activeDecoys.entries()) {
             if (telepathyBroadcast.includes(token) || telepathyBroadcast.includes('decoy')) {
                 console.log(`[🚨] DECOY TRIGGERED! The Red Swarm broadcasted a Honey-Token from ${node}!`);
                 return { tripped: true, compromisedNode: node };
             }
        }
        return { tripped: false };
    }
    async isolateNode(nodeName) {
         console.log(`\n[🧱] TACTICAL ISOLATION: Severing lateral pathways for ${nodeName}...`);
         try {
             await execPromise(`docker network disconnect bayezidfighter_swarm_net ${nodeName}`).catch(() => {});
             console.log(`[✅] ${nodeName} isolated successfully.`);
             return true;
         } catch(e) {
             console.log(`[⚠️] Isolation failed: ${e.message}`);
             return false;
         }
    }
}
module.exports = { LateralDefense };
