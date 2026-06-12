const { askWingman } = require('./wingmanService');
const { verifyDefensiveAction } = require('../blue_swarm/causalVerifier');
const { recallSimilar } = require('../memory_systems/chromaService');
const orchestrateDecision = async (alertContext) => {
    const { chatWithLocalModelFast } = require('./aiService');
    const mode = process.env.BAYEZID_AI_MODE || 'cloud_run';
    console.log(`\n[🧠 ORCHESTRATOR] Routing Mode: ${mode.toUpperCase()}`);

    try {
        if (mode === 'self_ai') {
            console.log('[🧠 ORCHESTRATOR] Engaging Sentience Engine (Autonomous Mode)...');
            
            console.log('[🧠 ORCHESTRATOR] Step 1: Retrieving memories from ChromaDB...');
            let memories = [];
            try {
                memories = await recallSimilar(null, 3);
            } catch (memErr) {
                console.warn(`[⚠️ ORCHESTRATOR] Chroma recall failed: ${memErr.message}`);
            }

            console.log('[🧠 ORCHESTRATOR] Step 2: Querying local LLM directly...');
            const prompt = `You are the Sentience Engine, an autonomous air-gapped cyber-security intelligence block.
Analyze the following alert details in conjunction with our memory of past similar incidents.

Alert Details:
${typeof alertContext === 'string' ? alertContext : JSON.stringify(alertContext)}

Memory of Past Similar Incidents:
${JSON.stringify(memories)}

Decide on the best defensive action. You must select exactly one action from the following list:
- ISOLATE_NODE
- DECEPTIVE_PROBE
- ACTIVE_NEUTRALIZATION
- ESCALATE_RESPONSE
- OBSERVE
- PROACTIVE_HUNT

Respond ONLY with a JSON object in this format:
{
    "recommended_action": "SELECTED_ACTION",
    "confidence": 0.9,
    "reasoning": "Brief explanation"
}`;

            const response = await chatWithLocalModelFast(prompt);
            let decision;
            try {
                const cleanedResponse = response.replace(/```[a-zA-Z0-9]*\n?/g, '').replace(/```/g, '').trim();
                decision = JSON.parse(cleanedResponse);
            } catch (parseErr) {
                console.warn(`[⚠️ ORCHESTRATOR] Parse failed: ${parseErr.message}. Attempting regex fallback.`);
                const match = response.match(/"recommended_action"\s*:\s*"([^"]+)"/);
                const action = match ? match[1] : 'OBSERVE';
                decision = {
                    recommended_action: action,
                    confidence: 0.7,
                    reasoning: response
                };
            }

            console.log(`[🧠 ORCHESTRATOR] Step 3: Verifying action "${decision.recommended_action}" via Causal Gate...`);
            const targetNode = alertContext.extracted_ip || alertContext.sourceIp || alertContext.targetServer || 'unknown';
            try {
                const causalVerdict = await verifyDefensiveAction(decision.recommended_action, targetNode);
                if (causalVerdict && causalVerdict.safe === false) {
                    console.log(`[🧠 ORCHESTRATOR] CAUSAL VETO: Action "${decision.recommended_action}" is UNSAFE. Downgrading to DECEPTIVE_PROBE.`);
                    decision.recommended_action = 'DECEPTIVE_PROBE';
                    decision.causalRisk = causalVerdict.downtime_risk;
                } else {
                    console.log(`[🧠 ORCHESTRATOR] Causal Gate PASSED for "${decision.recommended_action}".`);
                    decision.causalRisk = causalVerdict ? causalVerdict.downtime_risk : 0.0;
                }
            } catch (causalErr) {
                console.warn(`[⚠️ ORCHESTRATOR] Causal verification failed: ${causalErr.message}`);
                decision.causalRisk = 0.0;
            }

            return decision;
        } else {
            console.log('[🧠 ORCHESTRATOR] Delegating decision to Wingman (Cloud Waterfall)...');
            return await askWingman(alertContext);
        }
    } catch (err) {
        console.error(`[🚨 ORCHESTRATOR] Critical Failure:`, err.message);
        return {
            recommended_action: 'OBSERVE',
            confidence: 0.5,
            reasoning: 'Graceful fallback: ' + err.message,
            causalRisk: 0.0
        };
    }
};

module.exports = { orchestrateDecision };
