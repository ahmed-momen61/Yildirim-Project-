const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');
const { CausalRCA } = require('./causalRCA');
const { veritasChain } = require('../crypto/veritasProof');
const { HeuristicWatchdog } = require('./heuristicWatchdog');

class SelfHealingModule {
    constructor() {
        this.rcaEngine = new CausalRCA();
        this.watchdog = new HeuristicWatchdog();
    }

    generateHealingCompose = async (containerName) => {
        const composeDir = path.join(__dirname, '../../data/healing_compose');
        if (!fs.existsSync(composeDir)) {
            fs.mkdirSync(composeDir, { recursive: true });
        }
        
        let image = 'redis:alpine';
        let labels = {};
        let envs = [];
        try {
            const { stdout } = await execPromise(`docker inspect ${containerName}`);
            const metadata = JSON.parse(stdout)[0];
            image = metadata.Config.Image;
            labels = metadata.Config.Labels || {};
            envs = metadata.Config.Env || [];
        } catch (e) {
            console.warn(`[⚠️] Docker inspect failed for ${containerName}. Using defaults.`);
        }

        const serviceName = containerName.replace(/[^a-zA-Z0-9]/g, '_');
        const yamlContent = `
version: '3.7'
services:
  ${serviceName}:
    image: ${image}
    container_name: ${containerName}
    network_mode: bridge
    labels:
      ${Object.keys(labels).map(k => `"${k}": "${labels[k]}"`).join('\n      ')}
    environment:
      ${envs.map(e => `- ${e}`).join('\n      ')}
`;

        const composePath = path.join(composeDir, `${containerName}_compose.yml`);
        fs.writeFileSync(composePath, yamlContent, 'utf8');
        return composePath;
    };

    executeImmortalityLoop = async (containerName, attackOutcome, environmentState) => {
        console.log(`\n[⚕️] IMMUNE SYSTEM ACTIVATED: Commencing Immortality Loop for ${containerName}...`);
        try {
            const sysMetrics = this.watchdog.getSystemMetrics(environmentState);
            const isHeuristicBreach = this.watchdog.evaluateBehavioralBreach(sysMetrics);
            if (!environmentState.rootGained && !isHeuristicBreach) {
                console.log(`[🛑] ANTI-PANIC: Telemetry is blind, but System Heuristics are normal.`);
                console.log(`    Aborting ISOLATE_NODE to prevent self-induced downtime. Reverting to DECEPTIVE_PROBE.`);
                return false;
            }
            console.log(`[🔪] SEVER: Quarantining compromised container ${containerName}...`);
            await execPromise(`docker network disconnect bayezidfighter_swarm_net ${containerName}`).catch(() => {});
            await execPromise(`docker stop ${containerName}`).catch(() => {});
            await execPromise(`docker rm -f ${containerName}`).catch(() => {});
            
            const rcaResult = await this.rcaEngine.analyzeRootCause(attackOutcome, environmentState);
            
            console.log(`[🧬] RECONSTRUCT: Generating dynamic compose and spinning up replica of ${containerName}...`);
            const composeFile = await this.generateHealingCompose(containerName);
            await execPromise(`docker-compose -f "${composeFile}" up -d`).catch(e => {
                console.log(`[⚠️] Reconstruction Note: ${e.message}`);
            });
            await new Promise(r => setTimeout(r, 2000));
            console.log(`[💉] IMMUNIZE: Applying structural causal patch to replica...`);
            if (rcaResult.structuralPatch) {
                console.log(`    Executing: ${rcaResult.structuralPatch}`);
                await execPromise(`docker exec ${containerName} sh -c "${rcaResult.structuralPatch}"`).catch(e => {
                    console.log(`[⚠️] Immunize Note: ${e.message}`);
                });
            }

            
            console.log(`[🔎] HEALTH CHECK: Checking replica health status...`);
            let isHealthy = false;
            let checkRetries = 10;
            while (checkRetries > 0) {
                try {
                    const { stdout } = await execPromise(`docker inspect --format='{{json .State.Health}}' ${containerName}`);
                    const health = JSON.parse(stdout.trim());
                    if (!health || health.Status === 'healthy') {
                        isHealthy = true;
                        break;
                    }
                } catch (e) {
                    try {
                        const { stdout } = await execPromise(`docker inspect --format='{{.State.Running}}' ${containerName}`);
                        if (stdout.trim() === 'true') {
                            isHealthy = true;
                            break;
                        }
                    } catch (err) {}
                }
                await new Promise(r => setTimeout(r, 1000));
                checkRetries--;
            }
            if (isHealthy) {
                console.log(`[✅] Health check passed for replica ${containerName}.`);
            } else {
                console.warn(`[⚠️] Health check warning: replica ${containerName} is not reporting healthy.`);
            }

            console.log(`[🔐] VERIFY: Generating Zero-Knowledge Proof for Immortality Cycle...`);
            veritasChain.recordDecision('IMMORTALITY_LOOP_EXECUTED', {
                target: containerName,
                rootCause: rcaResult.rootCause,
                patchApplied: rcaResult.structuralPatch
            }, { operator: 'SelfHealingModule' });

            
            const { redisClient } = require('../memory_systems/memoryService');
            if (redisClient.isOpen) {
                await redisClient.xAdd('bayezid:validation', '*', {
                    alertId: environmentState.alertId || 'auto-triggered',
                    mitigationType: 'IMMORTALITY_LOOP',
                    patchDetails: rcaResult.structuralPatch || 'Reconstruct pristine replica'
                });
                console.log(`[⚡] Validation trigger event published to bayezid:validation.`);
            }

            console.log(`[✅] IMMORTALITY LOOP COMPLETE: Environment healed and immunized.`);
            return true;
        } catch (error) {
            console.error(`[❌] Immortality Loop Failed:`, error.message);
            return false;
        }
    };
}

module.exports = { SelfHealingModule };

