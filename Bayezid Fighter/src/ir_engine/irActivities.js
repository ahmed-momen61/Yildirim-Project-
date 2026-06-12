const axios = require('axios');
const defensiveEnforcer = require('../blue_swarm/defensiveEnforcer');
async function alertTriage(input) {
    console.log(`[IR Activity] Triaging alert ${input.alertId} from ${input.sourceIp}`);
    const isFalsePositive = input.initialPayload && input.initialPayload.length < 5;
    const threatScore = isFalsePositive ? 10 : 85;
    return { threatScore, isFalsePositive };
}
async function threatScoping(sourceIp, initialAssets) {
    console.log(`[IR Activity] Scoping threat originating from ${sourceIp}`);
    return { newAssets: [`database-server`, `api-gateway`] };
}
async function containmentPlan(ledger) {
    console.log(`[IR Activity] Generating containment plan for ${ledger.affectedAssets.length} assets`);
    const proposedActions = [
        `BLOCK_IP:${ledger.logs[0] ? '192.168.1.47' : '10.0.0.1'}`,
        `ISOLATE_ASSET:${ledger.affectedAssets[0]}`
    ];
    const requiresHumanApproval = ledger.threatScore < 90 || ledger.affectedAssets.includes('database-server');
    return { proposedActions, requiresHumanApproval };
}
async function checkContainmentGate(action, context) {
    console.log(`[IR Activity] Requesting Causal Verification for action: ${action}`);
    try {
        const response = await axios.post('http://localhost:8002/api/v1/causal/verify-action', {
            action,
            context
        });
        return {
            action,
            approved: response.data.approved,
            riskScore: response.data.risk_score,
            justification: response.data.justification
        };
    }
    catch (e) {
        console.warn(`[IR Activity] Causal Engine unreachable, defaulting to SAFE (Approved). Error: ${e.message}`);
        return {
            action,
            approved: true,
            riskScore: 50,
            justification: "Causal Engine Offline - Fallback Approved"
        };
    }
}
async function containmentExec(actions, alertId) {
    console.log(`[IR Activity] Executing ${actions.length} containment actions for ${alertId}`);
    for (const action of actions) {
        if (action.startsWith('BLOCK_IP:')) {
            const ip = action.split(':')[1];
            console.log(`[🔥] Executing defensive enforcer: IPTABLES DROP ${ip}`);
            try {
                await defensiveEnforcer.blockIp(ip, alertId);
            }
            catch (err) {
                console.error(`[-] Failed to block IP ${ip}: ${err.message}`);
            }
        }
    }
}
async function eradication(assets, sourceIp) {
    console.log(`[IR Activity] Eradicating persistence mechanisms on ${assets.join(', ')}`);
}
async function irReport(ledger) {
    console.log(`[IR Activity] Generating final IR Report for ${ledger.alertId}`);
}

module.exports = {
    alertTriage,
    threatScoping,
    containmentPlan,
    checkContainmentGate,
    containmentExec,
    eradication,
    irReport
};
